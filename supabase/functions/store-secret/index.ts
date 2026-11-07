// store-secret — grava API keys BYO (OpenAI/Tavily/Zernio/Apify…) no Supabase Vault.
// Contrato: docs/07-contratos-backend.md §3.8 e §7; Vault em 04-modelo-de-dados.md §11.
// TAVILY_API_KEY habilita a pesquisa web na instância só-gateway (web-search.ts).
// ZERNIO_API_KEY habilita publicação/agendamento real (zernio-proxy — docs/10 Eixo 1).
//
// POST { name, value }        → 200 { ok: true }   (admin only; allowlist de nomes)
// GET  ou POST {action:'status'} → 200 { configured: ['OPENAI_API_KEY', ...] }
//
// Regras de ouro:
// - O valor NUNCA é logado nem retornado; não existe endpoint de leitura para o
//   frontend — a UI só vê "configurada/não configurada".
// - A escrita usa rpc store_vault_secret com o client AUTENTICADO do usuário:
//   a função SQL é SECURITY DEFINER e revalida admin via auth.uid().
// - A checagem de admin também acontece aqui (verify_jwt só garante "autenticado").

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, createUserClient, getUser } from '../_shared/supabase.ts';

// Toda credencial de fornecedor que a instância usa entra por aqui — é o único
// caminho de escrita no Vault que o app oferece, e a regra é que o CLIENTE
// forneça todas, pelo onboarding. Não há segredo que dependa de alguém abrir o
// SQL editor: os *_CRON_SECRET a instância gera sozinha no seed, os
// *_WEBHOOK_SECRET os próprios `setup` do Zernio e do Replicate gravam, e o
// HF_MCP_CLIENT_ID sai do OAuth do Higgsfield.
const SECRET_ALLOWLIST = [
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'TAVILY_API_KEY',
  'FIRECRAWL_API_KEY',
  'ZERNIO_API_KEY',
  'REPLICATE_API_TOKEN',
  'ELEVEN_API_KEY',
  'ELEVEN_VOICE_ID',
  'HEYGEN_API_KEY',
  'HIGGSFIELD_API_KEY',
  'APIFY_TOKEN',
  'RENDER_WORKER_URL',
  'RENDER_WORKER_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'CLAUDE_ROUTINE_URL',
  'CLAUDE_ROUTINE_TOKEN',
] as const;
type SecretName = (typeof SECRET_ALLOWLIST)[number];

/**
 * Validação de formato por nome (rejeita valor obviamente inválido — 07 §3.8).
 * Antes era um mapa de prefixos; virou função porque nem toda key tem prefixo
 * textual simples (a do Zernio é sk_ + 64 hex exatos).
 */
const FORMAT_VALIDATORS: Record<SecretName, { hint: string; valid: (v: string) => boolean }> = {
  OPENAI_API_KEY: { hint: 'prefixo "sk-"', valid: (v) => v.startsWith('sk-') },
  // Grok (xAI): chaves do console.x.ai começam com "xai-".
  XAI_API_KEY: { hint: 'prefixo "xai-"', valid: (v) => v.startsWith('xai-') },
  TAVILY_API_KEY: { hint: 'prefixo "tvly-"', valid: (v) => v.startsWith('tvly-') },
  FIRECRAWL_API_KEY: { hint: 'prefixo "fc-"', valid: (v) => v.startsWith('fc-') },
  ZERNIO_API_KEY: { hint: 'formato "sk_" + 64 hex', valid: (v) => /^sk_[0-9a-f]{64}$/.test(v) },
  REPLICATE_API_TOKEN: {
    hint: 'prefixo "r8_"',
    valid: (v) => /^r8_[A-Za-z0-9_-]{20,}$/.test(v),
  },
  // A ElevenLabs mudou o formato da key ao longo do tempo (hoje `sk_` + hex,
  // antes 32 hex puros) e a documentação não promete estabilidade. Validar por
  // prefixo aqui rejeitaria key boa de conta antiga, que é pior do que aceitar
  // uma errada — a errada falha no primeiro TTS com mensagem da própria
  // ElevenLabs. Então só barra o óbvio: vazio, curto ou com espaço.
  ELEVEN_API_KEY: {
    hint: 'ao menos 20 caracteres, sem espaço',
    valid: (v) => /^[A-Za-z0-9_-]{20,}$/.test(v),
  },
  // Não é segredo, é identificador — mora no Vault só para não abrir um segundo
  // caminho de escrita. Formato: 20 caracteres alfanuméricos.
  ELEVEN_VOICE_ID: {
    hint: 'ID alfanumérico da voz (ex.: 20 caracteres, sem espaço)',
    valid: (v) => /^[A-Za-z0-9]{16,32}$/.test(v),
  },
  // HeyGen: a documentação não promete formato da key — só barra o óbvio; uma
  // errada falha na primeira chamada com a mensagem da própria HeyGen.
  // chave da API do Higgsfield: "<id>:<segredo>", o id é um UUID (console.higgsfield.ai)
  HIGGSFIELD_API_KEY: {
    hint: 'o ID e o segredo juntos, "id:segredo"',
    valid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\S{8,}$/i.test(v),
  },
  HEYGEN_API_KEY: {
    hint: 'ao menos 20 caracteres, sem espaço',
    valid: (v) => /^[A-Za-z0-9_=-]{20,}$/.test(v),
  },
  // Apify: tokens novos começam com "apify_api_"; contas antigas têm 25
  // caracteres alfanuméricos. Só barra o óbvio (módulo Mercado — competitor-sync).
  RENDER_WORKER_URL: { hint: 'endereço https do app no Modal', valid: (v) => /^https:\/\/[\w.-]+\.modal\.run\/?$/.test(v) },
  RENDER_WORKER_TOKEN: { hint: 'Token ID, ponto e Token Secret', valid: (v) => /^\S+\.\S+$/.test(v) },
  GOOGLE_CLIENT_ID: { hint: 'termina em .apps.googleusercontent.com', valid: (v) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(v) },
  GOOGLE_CLIENT_SECRET: { hint: 'ao menos 20 caracteres, sem espaço', valid: (v) => /^[A-Za-z0-9_-]{20,}$/.test(v) },
  CLAUDE_ROUTINE_URL: {
    hint: 'o endereço que termina em /fire',
    valid: (v) => /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_\w+\/fire$/.test(v),
  },
  CLAUDE_ROUTINE_TOKEN: { hint: 'começa com sk-ant-oat01-', valid: (v) => /^sk-ant-oat01-\S{20,}$/.test(v) },
  APIFY_TOKEN: {
    hint: 'token da conta Apify (ex.: "apify_api_…"), sem espaço',
    valid: (v) => /^[A-Za-z0-9_-]{20,}$/.test(v),
  },
};

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const user = await getUser(req);
    if (!user) {
      return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    }

    // Checagem de admin dentro da função (mesmo predicado da função SQL has_role).
    const service = createServiceClient();
    const { data: isAdmin, error: roleError } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (roleError) {
      return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${roleError.message}`);
    }
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Apenas administradores podem gerenciar API keys.');
    }

    // Num Remix novo o Vault nasce legível por `anon` até o seed rodar
    // (docs/15 §"o seed vem antes do Vault"). Gravar uma chave antes disso é
    // publicá-la. A função SQL vault_fechado() vem no seed: sem ela, o seed não
    // rodou e nada entra; com ela respondendo false, idem.
    if (req.method === 'POST') {
      const { data: fechado, error: vaultError } = await service.rpc('vault_fechado');
      if (vaultError || fechado !== true) {
        return errorResponse(
          412,
          'vault_open',
          'O cofre desta instância ainda está aberto: rode o seed-instancia.sql antes de guardar qualquer chave.',
        );
      }
    }

    if (req.method === 'GET') {
      return await handleStatus(service);
    }

    if (req.method !== 'POST') {
      return errorResponse(405, 'invalid_input', 'Use POST (ou GET para status).');
    }

    let body: { action?: unknown; name?: unknown; value?: unknown };
    try {
      body = await req.json();
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    if (body.action === 'status') {
      return await handleStatus(service);
    }

    // ── Gravação ─────────────────────────────────────────────────────────────
    const name = body.name;
    if (typeof name !== 'string' || !(SECRET_ALLOWLIST as readonly string[]).includes(name)) {
      return errorResponse(
        400,
        'invalid_input',
        `Nome de segredo fora da allowlist. Aceitos: ${SECRET_ALLOWLIST.join(', ')}.`,
      );
    }
    const secretName = name as SecretName;

    const value = body.value;
    if (typeof value !== 'string' || value.trim().length === 0) {
      return errorResponse(400, 'invalid_input', 'Valor da key não pode ser vazio.');
    }
    if (/\s/.test(value)) {
      return errorResponse(400, 'invalid_input', 'Valor da key não pode conter espaços ou quebras de linha.');
    }
    if (!FORMAT_VALIDATORS[secretName].valid(value)) {
      return errorResponse(
        400,
        'invalid_input',
        `Formato inesperado para ${secretName} — esperado ${FORMAT_VALIDATORS[secretName].hint}.`,
      );
    }

    // Upsert no Vault via client autenticado do usuário: store_vault_secret é
    // SECURITY DEFINER e revalida admin via auth.uid() (defesa em profundidade).
    const userClient = createUserClient(req);
    const { error: storeError } = await userClient.rpc('store_vault_secret', {
      _name: secretName,
      _value: value,
    });
    if (storeError) {
      // Nunca inclui o valor em log/resposta.
      const forbidden = storeError.message?.toLowerCase().includes('forbidden');
      console.error(`[store-secret] rpc store_vault_secret falhou para ${secretName}: ${storeError.message}`);
      if (forbidden) {
        return errorResponse(403, 'forbidden', 'Apenas administradores podem gravar segredos.');
      }
      return errorResponse(500, 'internal_error', 'Falha ao gravar o segredo no Vault.');
    }

    console.info(`[store-secret] segredo ${secretName} gravado por ${user.id}`);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('[store-secret] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});

/**
 * Status: quais nomes da allowlist já estão configurados no Vault.
 * Consulta via get_vault_secret (service role) — o schema vault não é exposto
 * pelo PostgREST. Só NOMES saem daqui; valores jamais.
 */
async function handleStatus(
  service: ReturnType<typeof createServiceClient>,
): Promise<Response> {
  const configured: string[] = [];
  for (const name of SECRET_ALLOWLIST) {
    const { data, error } = await service.rpc('get_vault_secret', { _name: name });
    if (!error && typeof data === 'string' && data.length > 0) {
      configured.push(name);
    }
  }
  return jsonResponse({ configured });
}

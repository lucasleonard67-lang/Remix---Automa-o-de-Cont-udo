// generate-content — ponto de entrada da geração por comando livre (rota /criar).
// Contrato: docs/07-contratos-backend.md §3.1; saga em docs/06-arquitetura-ia.md §3.
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.generate-content] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9)
//
// POST { prompt, channel_types?, web_search? } → 200 { job_id, status: 'classifying' }
// web_search=true liga a etapa `researching` da saga (pesquisa web reativa sobre a
// pauta — docs/06-arquitetura-ia.md §5.4). Indisponível/falhou → o job segue sem
// pesquisa, com o motivo em generation_jobs.web_research.
// Auth: autenticado (verify_jwt = true no gateway + getUser aqui).
// Fluxo: valida prompt → INSERT generation_jobs (status 'created', created_by =
// user.id, via service role — RLS não permite insert do client) → responde
// IMEDIATAMENTE e roda a saga em background (EdgeRuntime.waitUntil):
//   classifying (Roteador, structured output) → needs_angle_choice=true →
//   awaiting_angle e PARA (frontend escolhe via resume-job); senão
//   selected_angle = angles[0] → retrieving → … → awaiting_review.
// Falha do background NUNCA vira HTTP error — vira status 'failed' + error no
// job, visível em /criar via Realtime.
// 409 brand_reading enquanto app_settings.brand_autopilot.status === 'running'
// (a marca está sendo lida; a voz nova ainda não está ativa).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { runSaga } from '../_shared/saga.ts';
import { CHANNEL_TYPES, type ChannelType } from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const MAX_PROMPT_CHARS = 4000;

/** app_settings.brand_autopilot.status === 'running'? null = não deu para ler. */
async function isBrandReading(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'brand_autopilot')
    .maybeSingle();
  if (error) {
    console.error('[generate-content] falha ao ler brand_autopilot:', error.message);
    return null;
  }
  const status = ((data as { value?: { status?: unknown } } | null)?.value ?? {}).status;
  return status === 'running';
}

interface GenerateContentRequest {
  prompt?: unknown;
  channel_types?: unknown;
  web_search?: unknown;
  /** A peça fica na fila para o Claude da pessoa, pela assinatura. Nada gera aqui. */
  pedir_ao_claude?: unknown;
}

import { requireDrive } from '../_shared/drive-gate.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    const user = await getUser(req);
    if (!user) {
      return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    }

    const semDrive = await requireDrive(createServiceClient(), 'generate-content');
    if (semDrive) return semDrive;

    // Cota por usuário: esta operação gasta crédito de IA (migration 202607300013).
    const limited = await enforceRateLimit(user.id, 'generate-content');
    if (limited) return limited;

    let body: GenerateContentRequest;
    try {
      body = (await req.json()) as GenerateContentRequest;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return errorResponse(400, 'invalid_input', 'Campo prompt é obrigatório e não pode ser vazio.');
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return errorResponse(
        400,
        'invalid_input',
        `Prompt acima do limite de ${MAX_PROMPT_CHARS} caracteres.`,
      );
    }

    let requestedChannels: ChannelType[] | undefined;
    if (body.channel_types !== undefined) {
      if (
        !Array.isArray(body.channel_types) ||
        body.channel_types.some((c) => !CHANNEL_TYPES.includes(c as ChannelType))
      ) {
        return errorResponse(
          400,
          'invalid_input',
          `channel_types inválido — valores aceitos: ${CHANNEL_TYPES.join(', ')}.`,
        );
      }
      requestedChannels = body.channel_types as ChannelType[];
    }

    // Criação do job SEMPRE via service role (RLS: insert só pela edge function).
    const supabase = createServiceClient();

    // Marca em leitura (brand-autopilot running): persona/estratégia/guardrails
    // estão sendo trocados — peça criada agora sairia na voz antiga ou no meio
    // da troca. As 3 amostras do gate de tom NÃO passam por aqui (o tone-gate
    // insere os jobs e chama runSaga direto), então seguem normais.
    const brandReading = await isBrandReading(supabase);
    if (brandReading === null) {
      return errorResponse(500, 'internal_error', 'Falha ao conferir o estado da leitura da marca.');
    }
    if (brandReading) {
      return errorResponse(
        409,
        'brand_reading',
        'A marca ainda está sendo lida. Espere a leitura terminar para criar peças com a voz nova.',
      );
    }

    // Canal pedido mas desligado: recusa em vez de trocar calado. A saga faz
    // `classification.channel_types ∩ enabled` e cai em TODOS os enabled quando a
    // interseção é vazia — rede de proteção contra o Roteador escolher canal
    // desligado, mas aplicada a um pedido EXPLÍCITO ela devolve 200 e entrega
    // outros canais. A UI de /criar só oferece canal habilitado; isto fecha a API.
    if (requestedChannels && requestedChannels.length > 0) {
      const { data: channelRows, error: channelsError } = await supabase
        .from('channels')
        .select('type, enabled');
      if (channelsError) {
        return errorResponse(
          500,
          'internal_error',
          `Falha ao carregar canais: ${channelsError.message}`,
        );
      }
      const enabled = new Set(
        ((channelRows ?? []) as Array<{ type: ChannelType; enabled: boolean }>)
          .filter((c) => c.enabled)
          .map((c) => c.type),
      );
      const disabled = requestedChannels.filter((t) => !enabled.has(t));
      if (disabled.length > 0) {
        return errorResponse(
          409,
          'invalid_state',
          `Canal desabilitado nesta instância: ${disabled.join(', ')}. ` +
            'Habilite em /marca/canais ou peça outro canal.',
        );
      }
    }
    if (body.pedir_ao_claude === true) {
      // o Claude que atende a fila é o do administrador, com as ferramentas de serviço:
      // só administrador enfileira trabalho para ele
      const { data: ehAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      if (ehAdmin !== true) {
        return errorResponse(403, 'forbidden', 'Só administradores pedem ao Claude da assinatura.');
      }
      const { data: pedido, error: erroPedido } = await supabase.from('generation_jobs').insert({
        prompt,
        status: 'created',
        created_by: user.id,
        // origem 'criar': pedido ao Claude da assinatura (conector personalizado); nunca cai para outro modelo
        timings: { pedido_claude: { formato: 'instagram_carousel', origem: 'criar' } },
      }).select('id').single();
      if (erroPedido || !pedido) return errorResponse(500, 'internal_error', 'Falha ao criar o pedido.');
      return jsonResponse({ job_id: (pedido as { id: string }).id, status: 'created' });
    }

    const webSearchRequested = body.web_search === true;
    const { data, error } = await supabase
      .from('generation_jobs')
      .insert({
        prompt,
        status: 'created',
        created_by: user.id,
        ...(webSearchRequested ? { web_research: { requested: true } } : {}),
      })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[generate-content] falha ao criar job:', error?.message);
      return errorResponse(500, 'internal_error', 'Falha ao criar o job de geração.');
    }
    const jobId = (data as { id: string }).id;

    // Saga em background — a resposta sai antes; o frontend acompanha via Realtime.
    const task = runSaga(jobId, {
      from: 'classifying',
      ...(requestedChannels ? { requested_channel_types: requestedChannels } : {}),
    }).catch((err) => console.error(`[generate-content] saga do job ${jobId} falhou:`, err));
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
      EdgeRuntime.waitUntil(task);
    } else {
      void task;
    }

    return jsonResponse({ job_id: jobId, status: 'classifying' });
  } catch (err) {
    console.error('[generate-content] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao iniciar a geração.');
  }
});

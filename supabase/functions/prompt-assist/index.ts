// prompt-assist — ajuda nos campos de prompt (componente PromptTools).
//
// POST multipart { file } → 200 { text }
//   Scribe v2 direto do ElevenLabs: resposta na hora, sem fila.
// POST { text, kind, max? } → 200 { text, provider, model }
//   Reescreve o pedido como um editor, na voz da marca, com o provedor
//   conectado (papel `generator` de app_settings.ai_providers).
//
// Sem chave: 412 not_connected, com `details.integration` para a tela abrir
// a integração certa. O papel `generator` também é o que gera a peça.
//
// Auth: autenticado (verify_jwt = true no gateway + getUser aqui).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { chat, LlmError, resolveProvider, type DriverName } from '../_shared/llm.ts';
import {
  PROMPT_KINDS,
  PROMPT_MAX_CHARS,
  promptAssistMessages,
  type PromptKind,
} from '../_shared/prompts/prompt-assist.ts';
import { hybridSearch } from '../_shared/retrieval.ts';
import type { PersonaContent, StrategyContent } from '../_shared/types.ts';

type Service = ReturnType<typeof createServiceClient>;

/** 25 MB: bem acima dos 2 min de fala que o microfone grava. */
const AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** Chave de cada provedor BYO; o gateway da Lovable não pede nenhuma. */
const DRIVER_SECRET: Partial<Record<DriverName, string>> = {
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
};

async function vaultSecret(service: Service, name: string): Promise<string | null> {
  const { data } = await service.rpc('get_vault_secret', { _name: name });
  return typeof data === 'string' && data ? data : Deno.env.get(name) ?? null;
}

async function transcribe(req: Request, service: Service): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse(400, 'invalid_input', 'Nada foi gravado. Tente de novo.');
  }
  if (file.size > AUDIO_MAX_BYTES) {
    return errorResponse(400, 'invalid_input', 'Áudio grande demais. Grave um trecho menor.');
  }
  const key = await vaultSecret(service, 'ELEVEN_API_KEY');
  if (!key) {
    return errorResponse(412, 'not_connected', 'Conecte o ElevenLabs para falar em vez de digitar.', {
      integration: 'elevenlabs',
    });
  }

  const body = new FormData();
  body.append('model_id', 'scribe_v2');
  body.append('language_code', 'pt');
  body.append('tag_audio_events', 'false');
  body.append('file', file, file.name || 'fala.webm');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body,
  });
  if (r.status === 401) {
    return errorResponse(412, 'not_connected', 'A chave do ElevenLabs não foi aceita.', {
      integration: 'elevenlabs',
    });
  }
  if (!r.ok) {
    console.error(`[prompt-assist] scribe ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return errorResponse(502, 'provider_error', 'Não deu para transcrever. Tente de novo.');
  }
  const text = ((await r.json()) as { text?: unknown }).text;
  if (typeof text !== 'string' || !text.trim()) {
    return errorResponse(422, 'empty_transcript', 'Não ouvi nada. Fale mais perto do microfone.');
  }
  return jsonResponse({ text: text.trim() });
}

async function loadActive<T>(service: Service, table: 'brand_persona' | 'brand_strategy'): Promise<T | null> {
  const { data } = await service.from(table).select('content').eq('status', 'active').maybeSingle();
  return ((data as { content?: T } | null)?.content ?? null) as T | null;
}

async function improve(req: Request, service: Service): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; kind?: unknown; max?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return errorResponse(400, 'invalid_input', 'Escreva ou fale o pedido primeiro.');
  if (text.length > PROMPT_MAX_CHARS) {
    return errorResponse(400, 'invalid_input', 'Texto longo demais para melhorar.');
  }
  if (!PROMPT_KINDS.includes(body.kind as PromptKind)) {
    return errorResponse(400, 'invalid_input', 'Tipo de campo inválido.');
  }
  const kind = body.kind as PromptKind;
  // Campos de vídeo são escritos pelo Claude da pessoa, pelo conector (pedido em
  // roteiro_pedidos): aqui não existe mais caminho por gateway para eles.
  if (kind === 'video' || kind === 'script' || kind === 'scene') {
    return errorResponse(410, 'gone', 'Este campo é escrito pelo seu Claude: use “Escrever com o seu Claude”.');
  }
  const max =
    typeof body.max === 'number' && body.max > 0 ? Math.min(body.max, PROMPT_MAX_CHARS) : 1500;

  const provider = await resolveProvider('generator');
  const secret = DRIVER_SECRET[provider.driver];
  if (secret && !(await vaultSecret(service, secret))) {
    return errorResponse(412, 'not_connected', 'Conecte a IA escolhida para melhorar o prompt.', {
      integration: provider.driver,
    });
  }

  const [persona, strategy, hits] = await Promise.all([
    loadActive<PersonaContent>(service, 'brand_persona'),
    loadActive<StrategyContent>(service, 'brand_strategy'),
    hybridSearch(text, undefined, 4).catch(() => []),
  ]);
  // persona pode ter vindo de uma versão antiga sem `identity`: nada aqui pode estourar
  const id = persona?.identity;
  const marca = [
    id?.name ? `Quem fala: ${id.name}${id.role ? `, ${id.role}` : ''}. ${id.positioning ?? ''}` : '',
    id?.audience ? `Público da marca: ${id.audience}` : '',
    strategy?.theses?.length ? `Teses: ${strategy.theses.slice(0, 5).join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const material = hits
    .map((h) => `## ${h.title}\n${h.content.slice(0, 700)}`)
    .join('\n\n')
    .slice(0, 5000);

  const { system, user } = promptAssistMessages({ text, kind, marca, material, max });
  const result = await chat({
    role_hint: 'generator',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  });
  const improved = (result.parsed as { text?: unknown } | undefined)?.text;
  if (typeof improved !== 'string' || !improved.trim()) {
    return errorResponse(502, 'provider_error', 'A IA não devolveu texto. Tente de novo.');
  }
  return jsonResponse({
    text: improved.trim().slice(0, max),
    provider: result.provider,
    model: result.model,
  });
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const limited = await enforceRateLimit(user.id, 'prompt-assist');
    if (limited) return limited;

    const service = createServiceClient();
    const multipart = (req.headers.get('content-type') ?? '').startsWith('multipart/form-data');
    return multipart ? await transcribe(req, service) : await improve(req, service);
  } catch (err) {
    console.error('[prompt-assist] falhou:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    if (err instanceof LlmError) return errorResponse(err.status, err.code, err.message);
    return errorResponse(500, 'internal', err instanceof Error ? err.message : String(err));
  }
});

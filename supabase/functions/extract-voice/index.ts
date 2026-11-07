// extract-voice — extração assistida de voz (onboarding passo 4, rota /onboarding → voz).
// Contrato: docs/07-contratos-backend.md §3.3; papel em docs/06-arquitetura-ia.md §2.4.
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.extract-voice] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9)
//
// POST { context_item_ids: string[] }                → 200 { draft: PersonaContent }
// POST { mode: 'interview', answers?: [{question, answer}] }
//                                                    → 200 { next_question } | { draft }
// Auth: admin (rota consumidora é guarded admin; a função revalida via rpc has_role).
//
// Modo corpus: carrega os itens (title+body, status 'ready'), monta o
// voiceExtractorPrompt com o template de nicho escolhido no onboarding
// (app_settings.onboarding.niche_template_slug → niche_templates.payload) e chama
// o papel 'voice_extractor' com o schema das 9 seções. Retorna APENAS o rascunho —
// NADA é persistido: o humano aceita/edita e o frontend grava brand_persona pelo
// CRUD normal (esta função nunca escreve a persona).
//
// Modo entrevista (cliente sem corpus): o Extrator decide, com structured output
// {done, next_question?, draft?}, se ainda falta matéria-prima (→ próxima pergunta)
// ou se as respostas já bastam (→ rascunho das 9 seções).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { chat, LlmError } from '../_shared/llm.ts';
import {
  VOICE_EXTRACTOR_SCHEMA,
  voiceExtractorPrompt,
  voiceInterviewPrompt,
  type CorpusItem,
  type InterviewTurn,
  type NicheTemplateHint,
} from '../_shared/prompts/voice-extractor.ts';
import type { ContextKind, PersonaContent } from '../_shared/types.ts';

const MIN_ITEMS = 1;
const MAX_ITEMS = 20;
/** Teto de texto por item no prompt (corpus limitado — 07 §3.3: chamada síncrona). */
const MAX_ITEM_CHARS = 12_000;
const MAX_INTERVIEW_TURNS = 15;

/** Structured output do modo entrevista: o LLM decide entre pergunta e rascunho. */
const INTERVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['done'],
  properties: {
    done: {
      type: 'boolean',
      description: 'true quando as respostas já dão matéria-prima suficiente para as 9 seções',
    },
    next_question: {
      type: 'string',
      description: 'Próxima pergunta da entrevista (obrigatória quando done = false)',
    },
    draft: {
      ...(VOICE_EXTRACTOR_SCHEMA as Record<string, unknown>),
      description: 'Rascunho das 9 seções do contrato de voz (obrigatório quando done = true)',
    },
  },
};

interface ExtractVoiceRequest {
  mode?: unknown;
  context_item_ids?: unknown;
  answers?: unknown;
}

interface ContextItemRow {
  id: string;
  title: string;
  kind: ContextKind;
  body: string | null;
  status: string;
}

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

    // Checagem de admin dentro da função (mesmo padrão de store-secret).
    const service = createServiceClient();
    const { data: isAdmin, error: roleError } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (roleError) {
      return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${roleError.message}`);
    }
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Apenas administradores podem extrair a voz da marca.');
    }

    let body: ExtractVoiceRequest;
    try {
      body = (await req.json()) as ExtractVoiceRequest;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    if (body.mode === 'interview') {
      return await handleInterview(body.answers);
    }
    return await handleCorpus(service, body.context_item_ids);
  } catch (err) {
    if (err instanceof LlmError) {
      return errorResponse(err.status, err.code, err.message);
    }
    console.error('[extract-voice] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao extrair a voz.');
  }
});

// ── Modo corpus ──────────────────────────────────────────────────────────────

async function handleCorpus(
  service: ReturnType<typeof createServiceClient>,
  rawIds: unknown,
): Promise<Response> {
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    rawIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
  ) {
    return errorResponse(
      400,
      'invalid_input',
      'Campo context_item_ids é obrigatório: lista de ids de itens do Conteúdo de Contexto.',
    );
  }
  const ids = [...new Set((rawIds as string[]).map((id) => id.trim()))];
  if (ids.length < MIN_ITEMS || ids.length > MAX_ITEMS) {
    return errorResponse(
      400,
      'invalid_input',
      `Selecione entre ${MIN_ITEMS} e ${MAX_ITEMS} itens do corpus (recebidos: ${ids.length}).`,
    );
  }

  const { data, error } = await service
    .from('context_items')
    .select('id, title, kind, body, status')
    .in('id', ids);
  if (error) {
    console.error('[extract-voice] falha ao carregar context_items:', error.message);
    return errorResponse(500, 'internal_error', 'Falha ao carregar os itens do corpus.');
  }
  const rows = (data ?? []) as ContextItemRow[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return errorResponse(404, 'not_found', 'Item de contexto não encontrado.', { missing });
  }

  const notReady = rows.filter((r) => r.status !== 'ready');
  if (notReady.length > 0) {
    return errorResponse(
      409,
      'invalid_state',
      'Há itens do corpus ainda não processados (status diferente de ready). ' +
        'Aguarde a ingestão terminar ou reprocesse em /contexto.',
      { items: notReady.map((r) => ({ id: r.id, title: r.title, status: r.status })) },
    );
  }

  const empty = rows.filter((r) => !r.body || r.body.trim().length === 0);
  if (empty.length > 0) {
    return errorResponse(
      400,
      'invalid_input',
      'Há itens do corpus sem texto (body vazio) — a extração de voz precisa do conteúdo.',
      { items: empty.map((r) => ({ id: r.id, title: r.title })) },
    );
  }

  // Preserva a ordem pedida pelo frontend (curadoria humana do corpus).
  const corpus: CorpusItem[] = ids.map((id) => {
    const row = byId.get(id) as ContextItemRow;
    return {
      title: row.title,
      kind: row.kind,
      content: (row.body as string).trim().slice(0, MAX_ITEM_CHARS),
    };
  });

  const nicheTemplate = await loadNicheTemplate(service);
  const { system, user: userMsg } = voiceExtractorPrompt({
    corpus,
    niche_template: nicheTemplate,
  });

  const result = await chat({
    role_hint: 'voice_extractor',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ],
    schema: VOICE_EXTRACTOR_SCHEMA,
  });

  const draft = coerceDraft(result.parsed);
  if (!draft) {
    return errorResponse(
      502,
      'provider_error',
      'O Extrator de Voz não retornou um rascunho válido das 9 seções. Tente novamente.',
    );
  }
  return jsonResponse({ draft });
}

// ── Modo entrevista ──────────────────────────────────────────────────────────

async function handleInterview(rawAnswers: unknown): Promise<Response> {
  const turns: InterviewTurn[] = [];
  if (rawAnswers !== undefined) {
    if (!Array.isArray(rawAnswers)) {
      return errorResponse(400, 'invalid_input', 'Campo answers deve ser uma lista de {question, answer}.');
    }
    for (const item of rawAnswers) {
      const o = (item ?? {}) as Record<string, unknown>;
      if (typeof o.question !== 'string' || typeof o.answer !== 'string') {
        return errorResponse(400, 'invalid_input', 'Cada resposta deve ter question e answer (strings).');
      }
      turns.push({ question: o.question.trim(), answer: o.answer.trim() });
    }
  }
  if (turns.length > MAX_INTERVIEW_TURNS) {
    return errorResponse(
      400,
      'invalid_input',
      `Entrevista acima do limite de ${MAX_INTERVIEW_TURNS} respostas — gere o rascunho com o que há.`,
    );
  }

  const { system, user: userMsg } = voiceInterviewPrompt(turns);
  const result = await chat({
    role_hint: 'voice_extractor',
    messages: [
      { role: 'system', content: system },
      {
        // Sobrepõe o formato de saída do prompt base: em vez de texto puro/DONE,
        // o LLM decide via structured output entre próxima pergunta e rascunho.
        role: 'system',
        content:
          'FORMATO DE SAÍDA (obrigatório, sobrepõe qualquer instrução anterior de formato): responda APENAS o ' +
          'JSON {done, next_question?, draft?}. Enquanto faltar matéria-prima: done=false + next_question (a ' +
          'próxima pergunta, UMA só). Quando as respostas já cobrirem as 9 seções (ou a entrevista atingir ~10 ' +
          'perguntas): done=true + draft com o rascunho completo das 9 seções do contrato de voz, extraído ' +
          'SOMENTE do que o cliente respondeu.',
      },
      { role: 'user', content: userMsg },
    ],
    schema: INTERVIEW_SCHEMA,
  });

  const parsed = (result.parsed ?? {}) as Record<string, unknown>;
  if (parsed.done === true) {
    const draft = coerceDraft(parsed.draft);
    if (!draft) {
      return errorResponse(
        502,
        'provider_error',
        'O Extrator encerrou a entrevista sem um rascunho válido. Tente novamente.',
      );
    }
    return jsonResponse({ draft });
  }

  const nextQuestion = typeof parsed.next_question === 'string' ? parsed.next_question.trim() : '';
  if (!nextQuestion) {
    return errorResponse(
      502,
      'provider_error',
      'O Extrator não retornou a próxima pergunta da entrevista. Tente novamente.',
    );
  }
  return jsonResponse({ next_question: nextQuestion });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** app_settings.onboarding.niche_template_slug → niche_templates.payload (hint). */
async function loadNicheTemplate(
  service: ReturnType<typeof createServiceClient>,
): Promise<NicheTemplateHint | null> {
  const { data: setting } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'onboarding')
    .maybeSingle();
  const value = (setting as { value?: Record<string, unknown> } | null)?.value;
  const slug = value && typeof value.niche_template_slug === 'string' ? value.niche_template_slug : null;
  if (!slug) return null;

  const { data: template } = await service
    .from('niche_templates')
    .select('payload')
    .eq('slug', slug)
    .maybeSingle();
  return toNicheHint((template as { payload?: unknown } | null)?.payload);
}

/** Mapeia niche_templates.payload (04 §8.10) para o hint do prompt, defensivamente. */
function toNicheHint(payload: unknown): NicheTemplateHint | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const hint: NicheTemplateHint = {};

  if (typeof p.editorial_stance === 'string' && p.editorial_stance.trim().length > 0) {
    hint.editorial_stance = p.editorial_stance;
  }
  if (Array.isArray(p.archetypes)) {
    const archetypes = p.archetypes
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .filter((a) => typeof a.name === 'string' && typeof a.description === 'string')
      .map((a) => ({ name: a.name as string, description: a.description as string }));
    if (archetypes.length > 0) hint.archetypes = archetypes;
  }
  if (Array.isArray(p.hook_families)) {
    const hooks = p.hook_families
      .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
      .filter(
        (h) =>
          typeof h.name === 'string' && typeof h.pattern === 'string' && typeof h.example === 'string',
      )
      .map((h) => ({
        name: h.name as string,
        pattern: h.pattern as string,
        example: h.example as string,
      }));
    if (hooks.length > 0) hint.hook_families = hooks;
  }
  return Object.keys(hint).length > 0 ? hint : null;
}

/**
 * Validação leve do rascunho (o shape fino vem do structured output): objeto com
 * as 9 seções presentes. banlist é SEMPRE forçada à referência {ref:'guardrails'}
 * — fonte única da ban list (07 §3.3).
 */
function coerceDraft(raw: unknown): PersonaContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const required = [
    'identity', 'credenciais', 'worldview', 'tone_principles', 'signature_lexicon',
    'calibration_heuristics', 'opinioes', 'voice_checklist', 'reference_examples',
  ];
  for (const key of required) {
    if (!(key in r)) return null;
  }
  if (!r.identity || typeof r.identity !== 'object') return null;
  return { ...(r as unknown as PersonaContent), banlist: { ref: 'guardrails' } };
}

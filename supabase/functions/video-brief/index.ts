// video-brief — briefing de vídeo PRÉ-GERADO a partir do tema.
//
// POST { theme } → 200 { brief: { objetivo, publico, smp, numero_heroi, cta, tom } }
//
// O passo "Criar" do fluxo de configuração não pode mandar a pessoa preencher
// seis campos de briefing: ela diz o tema e o briefing nasce pronto, na voz da
// marca (persona + estratégia) e com o número-herói tirado do material do
// Contexto. Tudo editável na tela antes de gerar o vídeo.
//
// Auth: autenticado (verify_jwt = true no gateway + getUser aqui).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { chat, LlmError } from '../_shared/llm.ts';
import { hybridSearch } from '../_shared/retrieval.ts';
import type { PersonaContent, StrategyContent } from '../_shared/types.ts';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    objetivo: { type: 'string' },
    publico: { type: 'string' },
    smp: { type: 'string' },
    numero_heroi: { type: 'string' },
    cta: { type: 'string' },
    tom: { type: 'string' },
  },
  required: ['objetivo', 'publico', 'smp', 'numero_heroi', 'cta', 'tom'],
} as const;

const SYSTEM = [
  'Você é roteirista de Reels curtos (20–30 s) com apresentador falando para a câmera.',
  'Monte o BRIEFING do vídeo a partir do tema, da marca e do material. Responda em português do Brasil, frases curtas, sem emojis.',
  '- objetivo: uma de "Educar", "Vender", "Gerar conversa", "Viralizar" — a que melhor serve o tema e a estratégia.',
  '- publico: para quem o vídeo fala, em uma frase concreta (quem, onde, qual dor), a partir da persona.',
  '- smp: a mensagem única do vídeo, 1–2 frases, na voz da marca; é o que o apresentador defende.',
  '- numero_heroi: UM número que prova a mensagem, com unidade e contexto (ex.: "92 de cada 100 tutores voltam em 30 dias"). Use SOMENTE um número que esteja no material; se não houver nenhum, devolva "".',
  '- cta: a frase falada no final, uma só, no repertório de CTAs da marca quando houver.',
  '- tom: 2 a 3 adjetivos da voz da marca (ex.: "sóbrio, direto").',
  'Nunca invente dados, nomes ou resultados.',
].join('\n');

async function loadActive<T>(
  service: ReturnType<typeof createServiceClient>,
  table: 'brand_persona' | 'brand_strategy',
): Promise<T | null> {
  const { data } = await service.from(table).select('content').eq('status', 'active').maybeSingle();
  return ((data as { content?: T } | null)?.content ?? null) as T | null;
}

import { requireDrive } from '../_shared/drive-gate.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const semDrive = await requireDrive(createServiceClient(), 'video-brief');
    if (semDrive) return semDrive;
    const limited = await enforceRateLimit(user.id, 'video-brief');
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as { theme?: unknown };
    const theme = typeof body.theme === 'string' ? body.theme.trim() : '';
    if (!theme) return errorResponse(400, 'invalid_input', 'Diga o tema do vídeo.');

    const service = createServiceClient();
    const [persona, strategy, hits] = await Promise.all([
      loadActive<PersonaContent>(service, 'brand_persona'),
      loadActive<StrategyContent>(service, 'brand_strategy'),
      hybridSearch(theme, undefined, 6).catch(() => []),
    ]);

    // persona pode ter vindo de uma versão antiga sem `identity`: nada aqui pode estourar
    const id = persona?.identity;
    const marca = [
      id?.name ? `Quem fala: ${id.name}${id.role ? `, ${id.role}` : ''}. ${id.positioning ?? ''}` : '',
      id?.audience ? `Público da marca: ${id.audience}` : '',
      strategy?.theses?.length ? `Teses: ${strategy.theses.slice(0, 5).join(' | ')}` : '',
      strategy?.cta_repertoire?.length ? `CTAs da marca: ${strategy.cta_repertoire.slice(0, 6).join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const material = hits
      .map((h) => `## ${h.title}\n${h.content.slice(0, 900)}`)
      .join('\n\n')
      .slice(0, 8000);

    const result = await chat({
      role_hint: 'generator',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `TEMA:\n${theme}\n\nMARCA:\n${marca || '(sem marca lida ainda)'}\n\nMATERIAL:\n${material || '(sem material)'}`,
        },
      ],
      schema: SCHEMA as unknown as Record<string, unknown>,
      // sem teto curto: modelos com "pensamento" (Gemini 2.5 Pro) gastam tokens
      // antes da resposta e um max_tokens de 700 voltava vazio
    });
    const parsed = (result.parsed ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof parsed[k] === 'string' ? (parsed[k] as string).trim() : '');
    const brief = {
      objetivo: str('objetivo') || 'Educar',
      publico: str('publico') || id?.audience || '',
      smp: str('smp') || theme,
      numero_heroi: str('numero_heroi'),
      cta: str('cta') || strategy?.cta_repertoire?.[0] || '',
      tom: str('tom') || 'sóbrio, direto',
    };
    return jsonResponse({ brief });
  } catch (err) {
    // o histórico HTTP da plataforma não guarda o corpo: sem este log ninguém
    // descobre por que a função devolveu 500
    console.error('[video-brief] falhou:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    if (err instanceof LlmError) return errorResponse(err.status, err.code, err.message);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, 'internal', message);
  }
});

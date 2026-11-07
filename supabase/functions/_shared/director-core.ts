// _shared/director-core.ts — nucleo do planejamento do agente-diretor.
// Consumido por director-plan (chamada manual/worker) e director-advance (cron edge).
// Craft: docs/12-direcao-de-cena.md + docs/13-arquitetura-agentes-video.md (validado na PoC).

import { chat } from './llm.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concept', 'look_lock', 'character_gender', 'shots'],
  properties: {
    concept: { type: 'string', description: 'tema/conceito em 1 frase' },
    character_gender: {
      type: 'string',
      enum: ['female', 'male'],
      description: 'gênero do personagem principal — define a voz da narração (voz e rosto precisam bater)',
    },
    look_lock: {
      type: 'string',
      description:
        'bloco de look colado VERBATIM em todo keyframe prompt (câmera, luz motivada, paleta 60-30-10 com objeto-acento, texturas; termina proibindo texto/logos)',
    },
    shots: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'idx', 'role', 'speech', 'scale', 'angle', 'with_character',
          'keyframe_prompt', 'motion_prompt', 'sequence_group',
        ],
        properties: {
          idx: { type: 'integer' },
          role: { type: 'string', enum: ['hook', 'problema', 'solucao', 'resultado', 'cta'] },
          speech: { type: 'string', description: 'fala pt-BR do bloco (narração; no CTA é a fala do personagem)' },
          scale: { type: 'string', enum: ['DETALHE', 'MEDIO', 'AMPLO_MEDIO', 'AMPLO', 'CLOSE'] },
          angle: { type: 'string', description: 'ângulo/posição de câmera em poucas palavras' },
          with_character: { type: 'boolean' },
          keyframe_prompt: {
            type: 'string',
            description: 'cena estática em inglês, SEM o look_lock (o worker concatena); se with_character, começa com "the same person from the reference image" adaptado ao mundo do brief',
          },
          motion_prompt: {
            type: 'string',
            description: 'inglês, SÓ movimento/câmera (1 ação; "Nothing else changes." quando couber); no CTA: fala olho no olho com lipsync natural',
          },
          sequence_group: {
            type: 'integer',
            description:
              '0 = shot avulso. Shots de b-roll CONTÍGUOS sem o personagem principal podem compartilhar um número de grupo (1, 2, ...) para virarem UMA geração de vídeo com corte interno. Nunca em shot com with_character=true nem no CTA.',
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Você é o diretor de um estúdio de vídeo por IA (Reels 9:16 de conversão).
Produza um plano de filmagem a partir do brief, seguindo RIGOROSAMENTE. O mundo do filme
(lugar, pessoas, ofício, linguagem) vem do objetivo, do público e do tom do brief; nunca
presuma um setor que o brief não indica.

ESTRUTURA (results-first): hook com o número-herói FALADO na 1ª frase (nunca establishing/logo) →
problema → solução → resultado → CTA verbal explícito. 1 claim central; frases curtas (1 frase = 1 ideia,
cada fala ≤ ~14 palavras); alvo total de fala = duração do brief menos ~4s de respiro.

DECUPAGEM: escala NUNCA repete em cortes vizinhos; o close mais fechado é o CTA (personagem
olho no olho, fala a última linha). O PERSONAGEM É O FIO HUMANO do filme: ele aparece em ~40%
dos shots (ex.: 2 de 5, 3 de 6), NUNCA em shots consecutivos, e uma dessas aparições é CEDO
(no hook ou no 2º shot — trabalhando, em ação, não posando); a última é o CTA. REGRA DURA DE
HUMANIDADE: TODO shot tem presença humana VISÍVEL — quando o personagem principal não está em
quadro, o keyframe_prompt inclui explicitamente 1-3 pessoas em segundo plano ou meio-fundo
fazendo algo coerente com o mundo do brief (rostos pequenos ou desfocados, nunca em close), e
o motion_prompt dá vida a essa camada (alguém cruza ao fundo, um gesto continua). O lugar é
VIVO, em plena atividade; cenário vazio é erro. B-roll nunca estático.

LOOK: escreva um look_lock coerente com o mundo do brief — luz com fonte diegética NOMEADA,
contraste ~4:1, paleta 60-30-10 com UMA cor de acento num único objeto físico por quadro,
texturas honestas, grão de filme sutil; PROIBIDO no texto: "8k", "masterpiece", "perfect",
"cinematic lighting" solto; o bloco termina proibindo texto/letras/logos na imagem.

KEYFRAME_PROMPT: cena congelada no frame de pico da ação (a ~60% do gesto), em inglês,
sem redescrever o look (o sistema concatena o look_lock). Evite: mãos manipulando objetos em
close, texto legível, líquidos, multidões, contato físico entre pessoas.

MOTION_PROMPT: descreve APENAS o que se move (uma ação + um movimento de câmera sutil e
motivado). Nunca redescreva a cena. Português apenas nas falas; prompts em inglês.

MULTI-CENA (sequence_group): quando 2-3 shots de B-ROLL SEM o personagem principal ficam
CONTÍGUOS na decupagem, dê a eles o MESMO sequence_group (1, 2, ...) — eles serão gerados
como UM vídeo só com corte seco interno, o que dá continuidade de mundo entre os planos.
Shots com with_character=true e o CTA ficam sempre com sequence_group=0. Num grupo, o
keyframe_prompt de cada shot além do primeiro precisa descrever a cena COMPLETA e
autossuficiente (só o primeiro shot do grupo tem imagem de partida; os seguintes nascem
do texto). A regra dos 30 graus e a troca de escala valem TAMBÉM entre os shots do grupo.`;


export interface DirectorPlanShot {
  idx: number;
  role: 'hook' | 'problema' | 'solucao' | 'resultado' | 'cta';
  speech: string;
  scale: string;
  angle: string;
  with_character: boolean;
  keyframe_prompt: string;
  motion_prompt: string;
  /** 0 = shot avulso; >0 = shots contíguos de mesmo grupo viram UMA geração com corte interno. */
  sequence_group?: number;
}

export interface DirectorPlan {
  concept: string;
  look_lock: string;
  /** ausente em planos antigos → voz configurada sem checagem */
  character_gender?: 'female' | 'male';
  shots: DirectorPlanShot[];
}

// ── motor de vídeo (Higgsfield × Replicate) ──────────────────────────────────
// A escolha vem da UI em config (engine/model_id/ab_model_id); briefs antigos
// podem trazê-la no próprio brief. No primeiro tick ela é CONGELADA em
// artifacts.engine: mudar o config no meio não troca o motor de um job em voo.
// Sem nada → Higgsfield (compatível com todo job anterior a esta mudança).

export type VideoEngine = 'higgsfield' | 'replicate';

export interface EngineChoice {
  engine: VideoEngine;
  /** modelo das cenas (null = padrão do motor) */
  model_id: string | null;
  /** modelo da cena extra do A/B (null = padrão do motor) */
  ab_model_id: string | null;
}

const ENGINE_KEYS = ['engine', 'model_id', 'ab_model_id'] as const;

const cleanId = (v: unknown): string | null =>
  typeof v === 'string' && /^[\w./-]{1,120}$/.test(v) ? v : null;

function pickChoice(src: Record<string, unknown> | null | undefined): EngineChoice | null {
  if (!src || typeof src !== 'object') return null;
  const engine = src.engine;
  if (engine !== 'higgsfield' && engine !== 'replicate') return null;
  return { engine, model_id: cleanId(src.model_id), ab_model_id: cleanId(src.ab_model_id) };
}

/** artifacts.engine (congelado) > config > brief > Higgsfield. */
export function readEngineChoice(job: {
  brief?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  artifacts?: Record<string, unknown> | null;
}): EngineChoice {
  const frozen = pickChoice((job.artifacts as { engine?: Record<string, unknown> } | null)?.engine);
  return (
    frozen
    ?? pickChoice(job.config)
    ?? pickChoice(job.brief)
    ?? { engine: 'higgsfield', model_id: null, ab_model_id: null }
  );
}

/** Grava a escolha em artifacts.engine uma vez (idempotente); devolve a vigente. */
export async function freezeEngineChoice(
  service: SupabaseClient,
  job: {
    id: string;
    brief?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
    artifacts: Record<string, unknown>;
  },
): Promise<EngineChoice> {
  const choice = readEngineChoice(job);
  if (pickChoice(job.artifacts.engine as Record<string, unknown> | undefined)) return choice;
  job.artifacts.engine = choice;
  const { error } = await service
    .from('director_jobs')
    .update({ artifacts: job.artifacts })
    .eq('id', job.id);
  if (error) throw new Error(error.message);
  return choice;
}

/** Brief sem as chaves de motor — elas não são assunto do roteirista. */
function planningBrief(brief: Record<string, unknown>): Record<string, unknown> {
  const out = { ...brief };
  for (const k of ENGINE_KEYS) delete out[k];
  return out;
}

const briefText = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * Contexto do vídeo para o roteirista: objetivo, público e tom reais do job,
 * só os preenchidos. Vazio quando o brief não traz nenhum.
 */
export function plannerContext(brief: Record<string, unknown>): string {
  const lines = [
    ['Objetivo', briefText(brief.objetivo)],
    ['Público', briefText(brief.publico)],
    ['Tom', briefText(brief.tom)],
  ].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`);
  return lines.length ? `CONTEXTO DO VÍDEO (oriente mundo, pessoas e linguagem por isto):\n${lines.join('\n')}\n\n` : '';
}

/**
 * Prompt da trilha de fundo (ambiência, sem música nem voz): neutro, do tema do
 * plano e do tom do brief; sem nenhum dos dois, uma ambiência genérica.
 */
export function bedPrompt(concept: unknown, tom: unknown): string {
  const theme = briefText(concept, 200);
  const mood = briefText(tom, 80);
  const subject = theme ? `Subtle background ambience for a short video about: ${theme}.` : 'Subtle neutral room tone ambience.';
  return (
    `${subject}${mood ? ` Mood: ${mood}.` : ''} Soft, steady and unobtrusive, matching the setting. ` +
    'No music, no voices, no sudden loud sounds, loopable.'
  );
}

/** Limite de caracteres por pedido do eleven_v3 (página de modelos do ElevenLabs). */
export const ELEVEN_V3_MAX_CHARS = 5000;

/**
 * Texto do TTS dentro do limite: até `max`, cortado no fim de frase mais
 * próximo abaixo dele; sem fim de frase, no último espaço; senão, seco.
 * Texto que já cabe volta igual.
 */
export function clipTtsText(text: string, max = ELEVEN_V3_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  let cut = -1;
  for (const m of head.matchAll(/[.!?…]+["'”)\]]*(?=\s|$)/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end <= max) cut = end;
  }
  if (cut > 0) return text.slice(0, cut).trim();
  const space = head.lastIndexOf(' ', max);
  return (space > 0 ? text.slice(0, space) : text.slice(0, max)).trim();
}

/** Gera o plano e aplica o lint estrutural (30 graus). Nao grava nada. */
export async function generateDirectorPlan(
  brief: Record<string, unknown>,
  maxShots: number,
): Promise<DirectorPlan> {
  const result = await chat({
    role_hint: 'generator',
    max_tokens: 8000,
    schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          plannerContext(brief) +
          `BRIEF (JSON):\n${JSON.stringify(planningBrief(brief))}\n\n` +
          `Número de shots: exatamente ${maxShots}. Responda apenas com o JSON do plano.`,
      },
    ],
  });
  const plan = result.parsed as DirectorPlan | undefined;
  if (!plan || !Array.isArray(plan.shots) || plan.shots.length === 0) {
    throw new Error('Plano inválido do gerador.');
  }
  for (let i = 1; i < plan.shots.length; i++) {
    if (plan.shots[i].scale === plan.shots[i - 1].scale) {
      plan.shots[i].scale = plan.shots[i].scale === 'CLOSE' ? 'MEDIO' : 'CLOSE';
    }
  }
  sanitizeSequenceGroups(plan.shots);
  return plan;
}

/**
 * Lint dos grupos multi-cena: grupo só vale em b-roll sem personagem e fora do
 * CTA; membros precisam ser CONTÍGUOS e em número >= 2 — o resto vira 0.
 */
export function sanitizeSequenceGroups(shots: DirectorPlanShot[]): void {
  for (const s of shots) {
    if (s.with_character || s.role === 'cta' || !s.sequence_group || s.sequence_group < 0) {
      s.sequence_group = 0;
    }
  }
  // membros não-contíguos (na ordem do array): mantém só a primeira sequência contígua
  const seen = new Set<number>();
  for (let i = 0; i < shots.length; i++) {
    const g = shots[i].sequence_group ?? 0;
    if (!g) continue;
    const prevSame = i > 0 && (shots[i - 1].sequence_group ?? 0) === g;
    if (!prevSame && seen.has(g)) shots[i].sequence_group = 0;
    else seen.add(g);
  }
  // grupo de 1 membro só não é grupo
  const counts = new Map<number, number>();
  for (const s of shots) {
    const g = s.sequence_group ?? 0;
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  for (const s of shots) {
    if (s.sequence_group && (counts.get(s.sequence_group) ?? 0) < 2) s.sequence_group = 0;
  }
}

export async function savePlan(
  service: SupabaseClient,
  jobId: string,
  plan: DirectorPlan,
  nextStatus: string,
  expectStatuses?: string[],
): Promise<void> {
  // guard otimista: o planning leva 30-60s de LLM — um cancelamento no meio
  // não pode ser sobrescrito de volta pra 'tts'
  let q = service
    .from('director_jobs')
    .update({ plan: plan as unknown as Record<string, unknown>, status: nextStatus })
    .eq('id', jobId);
  if (expectStatuses?.length) q = q.in('status', expectStatuses);
  const { data, error } = await q.select('id');
  if (error) throw new Error(error.message);
  if (expectStatuses?.length && !data?.length) throw new Error('status_changed_externally');
}

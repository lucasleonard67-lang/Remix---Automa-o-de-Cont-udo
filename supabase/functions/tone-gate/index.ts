// tone-gate — gate de tom do onboarding (passo 9): gera as 3 peças-amostra.
// Contrato: docs/07-contratos-backend.md §3.6; saga em docs/06-arquitetura-ia.md §3.
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.tone-gate] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9)
//
// POST {} → 200 { job_ids: string[] }   (admin; 3 jobs, sagas em background)
//
// Deriva 3 comandos-amostra das teses da brand_strategy ativa (1 por tese;
// fallback: comandos genéricos do nicho), cria 3 generation_jobs marcados como
// amostra (marcador sample:true dentro de timings — a flag NÃO faz parte do shape
// canônico de Classification) limitados ao carrossel, se habilitado (fallback
// instagram_post; nunca stories) e roda as sagas em background EM PARALELO (a versão sequencial estourava
// o tempo de vida da invocação e matava a última amostra). Amostra não pede interação: se o
// Roteador parar em awaiting_angle, o primeiro ângulo é auto-selecionado e a
// saga continua. As peças caem como draft na Biblioteca; os vereditos do cliente
// vão para piece_feedback pela UI de aprovação normal (não por esta função).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { runSaga } from '../_shared/saga.ts';
import {
  type AngleOption,
  type ChannelType,
  type Classification,
  type StrategyContent,
} from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const SAMPLE_COUNT = 3;
const SAMPLE_CHANNEL: ChannelType = 'instagram_carousel';
const FALLBACK_CHANNEL: ChannelType = 'instagram_post';

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

    const service = createServiceClient();
    const { data: isAdmin, error: roleError } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (roleError) {
      return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${roleError.message}`);
    }
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Apenas administradores podem rodar o gate de tom.');
    }

    // Pré-requisitos do onboarding (07 §3.6): a saga exige persona + estratégia +
    // guardrails ativos — falha clara aqui em vez de 3 jobs failed.
    const [persona, strategy, guardrails] = await Promise.all([
      loadActiveContent(service, 'brand_persona'),
      loadActiveContent(service, 'brand_strategy'),
      loadActiveContent(service, 'guardrails'),
    ]);
    const missing: string[] = [];
    if (!persona) missing.push('voz (brand_persona)');
    if (!strategy) missing.push('bandeira (brand_strategy)');
    if (!guardrails) missing.push('guardrails');
    if (missing.length > 0) {
      return errorResponse(
        409,
        'invalid_state',
        `Onboarding incompleto para o gate de tom — sem versão ativa de: ${missing.join(', ')}. ` +
          'Complete os passos anteriores do wizard.',
      );
    }

    // Canal da amostra: carrossel editorial se estiver ligado, senão post. Nunca
    // stories nem outros — a amostra mostra a voz no formato que a tela de
    // aprovação lê melhor.
    const { data: channelRows, error: channelsError } = await service
      .from('channels')
      .select('type, enabled');
    if (channelsError) {
      return errorResponse(500, 'internal_error', `Falha ao carregar canais: ${channelsError.message}`);
    }
    const enabled = new Set(
      ((channelRows ?? []) as Array<{ type: ChannelType; enabled: boolean }>)
        .filter((c) => c.enabled)
        .map((c) => c.type),
    );
    const sampleChannel: ChannelType = enabled.has(SAMPLE_CHANNEL) ? SAMPLE_CHANNEL : FALLBACK_CHANNEL;

    const [corpus, nicheName] = await Promise.all([
      loadCorpusHighlights(service),
      loadNicheName(service),
    ]);

    // Acervo vazio é reprovação garantida, não amostra ruim: sem item `ready` o
    // retrieval devolve nada, o Gerador é obrigado a marcar [VERIFICAR] em vez de
    // usar número, e o juiz reprova por prova ausente (regra 'proprietario') nas
    // 3 amostras. O passo 3 do wizard tem "Pular", então dá para chegar aqui sem
    // acervo — falha clara apontando o passo, em vez de 3 jobs failed e 6 chamadas
    // de LLM queimadas.
    if (corpus === null) {
      return errorResponse(
        500,
        'internal_error',
        'Falha ao ler o acervo de contexto — tente de novo em alguns instantes.',
      );
    }
    if (corpus.length === 0) {
      return errorResponse(
        409,
        'invalid_state',
        'O gate de tom precisa de pelo menos um item de contexto processado — as amostras ' +
          'provam a voz com material seu, e sem acervo elas seriam reprovadas por falta de prova. ' +
          'Volte ao passo "Conteúdo de contexto" e cadastre ao menos um material (um case com ' +
          'número é o ideal).',
      );
    }
    const prompts = buildSamplePrompts(strategy as StrategyContent, nicheName, corpus);

    // 3 jobs marcados como amostra: sample:true vive em timings (jsonb) — o runner
    // da saga preserva chaves desconhecidas de timings nos checkpoints.
    const jobIds: string[] = [];
    for (const prompt of prompts) {
      const { data, error } = await service
        .from('generation_jobs')
        .insert({
          prompt,
          status: 'created',
          created_by: user.id,
          timings: { sample: true },
        })
        .select('id')
        .single();
      if (error || !data) {
        return errorResponse(
          500,
          'internal_error',
          `Falha ao criar os jobs do gate de tom: ${error?.message ?? 'sem detalhe'}.`,
        );
      }
      jobIds.push((data as { id: string }).id);
    }

    // Sagas em PARALELO no background; resposta imediata com os job_ids.
    const task = runSamplesInParallel(service, jobIds, sampleChannel).catch((err) =>
      console.error('[tone-gate] falha nas sagas de amostra:', err),
    );
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
      EdgeRuntime.waitUntil(task);
    } else {
      void task;
    }

    return jsonResponse({ job_ids: jobIds });
  } catch (err) {
    console.error('[tone-gate] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao iniciar o gate de tom.');
  }
});

// ── Comandos-amostra ─────────────────────────────────────────────────────────

/**
 * Comandos-amostra ancorados no ACERVO do cliente, com as teses como complemento.
 *
 * Por que o acervo vem primeiro: as teses iniciais costumam vir do preset do nicho,
 * enquanto o material que o cliente subiu é sobre o negócio dele — pedir "prove a
 * tese T" quando nada no acervo sustenta T faz o Gerador escrever sobre o material
 * e ignorar a tese, e o Juiz reprova por desalinhamento com o briefing (visto em
 * teste: 2 de 3 amostras perdidas exatamente assim). Amostra boa é a que mostra ao
 * cliente O MATERIAL DELE na voz dele — então cada item do acervo vira um comando, e
 * as teses só entram para completar as 3 quando falta material.
 */
function buildSamplePrompts(
  strategy: StrategyContent,
  nicheName: string | null,
  corpus: string[],
): string[] {
  const suffix = ' (peça-amostra do gate de tom do onboarding)';

  const prompts: string[] = corpus.slice(0, SAMPLE_COUNT).map(
    (title) =>
      `Conte a história do nosso material "${title}": comece pela situação concreta ` +
      `(quem, o que estava acontecendo), mostre a virada com o número da fonte e feche com a ` +
      `lição prática. Use SOMENTE dados que estejam no contexto recuperado.${suffix}`,
  );

  const theses = (Array.isArray(strategy.theses) ? strategy.theses : [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .slice(0, Math.max(0, SAMPLE_COUNT - prompts.length));

  // Complemento por tese, quando o acervo não dá 3 comandos. O comando precisa dar ao
  // Gerador uma HISTÓRIA para contar, não uma tese para ilustrar: "sustente a tese X"
  // produz peça abstrata, que o juiz reprova na regra 'proprietario'. E a tese entra
  // como lente, não como obrigação — se o material não a sustentar, a peça deve seguir
  // o material (é melhor uma amostra fiel à marca do que uma reprovada por desalinho).
  for (const thesis of theses) {
    prompts.push(
      `Conte um caso concreto do nosso contexto (com nome, número e o antes/depois). ` +
        `Se o material sustentar, use como lente a ideia de que "${thesis.trim()}" e deixe isso ` +
        `aparecer na moral, na camada 7; se não sustentar, siga o material e tire a lição que ` +
        `ele permite. Feche com um CTA do repertório da marca.${suffix}`,
    );
  }

  const niche = nicheName ? ` no mercado de ${nicheName}` : ' no nosso mercado';
  const generic = [
    `Conte o caso de alguém${niche} que cometeu o erro mais comum que vemos, o que aconteceu ` +
      `de concreto e como sairia diferente. Use uma prova real do nosso contexto.${suffix}`,
    `Conte um resultado real do nosso contexto — situação inicial, o que mudou e o número final ` +
      `— e termine com a lição prática por trás dele.${suffix}`,
    `Pegue uma crença comum${niche} e mostre, com um caso concreto do nosso contexto, por que ` +
      `ela não se sustenta na prática.${suffix}`,
  ];
  for (const g of generic) {
    if (prompts.length >= SAMPLE_COUNT) break;
    prompts.push(g);
  }
  return prompts.slice(0, SAMPLE_COUNT);
}

/** Nome do template de nicho escolhido no onboarding (flavor dos comandos genéricos). */
/**
 * Títulos dos itens do acervo que servem de âncora para as amostras.
 * Prioriza `case` e `offer` (material com prova e com oferta), depois o resto —
 * e só itens `ready`, porque item sem chunk não é recuperável pelo retrieval.
 */
async function loadCorpusHighlights(
  service: ReturnType<typeof createServiceClient>,
): Promise<string[] | null> {
  const { data, error } = await service
    .from('context_items')
    .select('title, kind')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(20);
  // null = falha ao LER o acervo; [] = acervo lido e vazio. Confundir os dois
  // mandaria o admin cadastrar material que ele já cadastrou.
  if (error) {
    console.error('[tone-gate] falha ao carregar o acervo para as amostras:', error.message);
    return null;
  }

  const rows = (data ?? []) as Array<{ title: string; kind: string }>;
  const rank = (kind: string) => (kind === 'case' ? 0 : kind === 'offer' ? 1 : 2);
  return rows
    .filter((r) => typeof r.title === 'string' && r.title.trim().length > 0)
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((r) => r.title.trim())
    .slice(0, SAMPLE_COUNT);
}

async function loadNicheName(
  service: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
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
    .select('name')
    .eq('slug', slug)
    .maybeSingle();
  const name = (template as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name : null;
}

// ── Execução das amostras (em paralelo) ──────────────────────────────────────
//
// As 3 sagas rodam CONCORRENTEMENTE, de propósito. A versão sequencial evitava
// concorrência de créditos do gateway, mas custava caro no lugar errado: cada saga
// leva ~60-90s (roteador + gerador + juiz + eventuais reescritas) e as três somadas
// estouravam o tempo de vida da invocação da edge function — a última amostra morria
// no meio, ficava presa em `judging` até o watchdog marcá-la como failed, e o gate de
// tom (a última tela do onboarding, a primeira impressão do cliente) entregava 2 de 3
// peças. Em paralelo o total fica na duração da amostra mais lenta. Três chamadas
// simultâneas são irrelevantes para o gateway.

async function runSamplesInParallel(
  service: ReturnType<typeof createServiceClient>,
  jobIds: string[],
  channel: ChannelType,
): Promise<void> {
  await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        const status = await runSaga(jobId, {
          from: 'classifying',
          requested_channel_types: [channel],
        });
        // Amostra não deve pedir interação (07 §3.6): awaiting_angle →
        // auto-seleciona o primeiro ângulo proposto e continua a saga.
        if (status === 'awaiting_angle') {
          const angle = await autoSelectFirstAngle(service, jobId);
          if (angle) {
            await runSaga(jobId, { from: 'retrieving' });
          } else {
            console.error(`[tone-gate] job ${jobId} em awaiting_angle sem ângulos — amostra abandonada.`);
          }
        }
      } catch (err) {
        // Falha de uma amostra não derruba as demais (o job fica failed no banco).
        console.error(`[tone-gate] saga da amostra ${jobId} falhou:`, err);
      }
    }),
  );
}

async function autoSelectFirstAngle(
  service: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<AngleOption | null> {
  const { data } = await service
    .from('generation_jobs')
    .select('classification')
    .eq('id', jobId)
    .maybeSingle();
  const classification = (data as { classification?: Classification | null } | null)?.classification;
  const angle = classification?.angles?.[0] ?? null;
  if (!angle) return null;

  const { error } = await service
    .from('generation_jobs')
    .update({ selected_angle: angle })
    .eq('id', jobId);
  if (error) {
    console.error(`[tone-gate] falha ao gravar ângulo da amostra ${jobId}:`, error.message);
    return null;
  }
  return angle;
}

// ── Loader ───────────────────────────────────────────────────────────────────

async function loadActiveContent(
  service: ReturnType<typeof createServiceClient>,
  table: 'brand_persona' | 'brand_strategy' | 'guardrails',
): Promise<unknown | null> {
  const { data, error } = await service
    .from(table)
    .select('content')
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar ${table}: ${error.message}`);
  return (data as { content?: unknown } | null)?.content ?? null;
}

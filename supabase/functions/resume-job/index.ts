// resume-job — continua a saga de um job a partir do estado atual.
// Contrato: docs/07-contratos-backend.md §3.2; saga em docs/06-arquitetura-ia.md §3.
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.resume-job] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9. O watchdog pg_cron
//    invoca com Bearer do service role, que passa no verify_jwt.)
//
// POST { job_id, selected_angle? } → 200 { job_id, status }
// Três chamadores: (a) frontend após a escolha de ângulo; (b) watchdog pg_cron
// para jobs travados; (c) retry humano de jobs failed. Regras:
// - awaiting_angle + selected_angle no body → grava o ângulo e retoma em retrieving.
// - failed → retoma do checkpoint (timings.last_stage), attempt preservado.
// - estado intermediário TRAVADO (updated_at mais velho que
//   engine_defaults.watchdog_stale_minutes) → retoma do estado atual; job ainda
//   fresco → 409 (evita corrida com um runner em andamento).
// - done / awaiting_review / cancelled → 409 (terminais / revisão humana).
// Responde rápido e processa em background (EdgeRuntime.waitUntil).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { deriveResumeStage, loadEngineDefaults, runSaga } from '../_shared/saga.ts';
import type { AngleOption, Classification, JobStatus } from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

interface ResumeJobRequest {
  job_id?: unknown;
  selected_angle?: unknown;
}

interface ResumeJobRow {
  id: string;
  status: JobStatus;
  classification: Classification | null;
  timings: { last_stage?: string } | null;
  updated_at: string;
}

/** Estados de processamento cobertos pelo watchdog (07 §4 — espera humana fica fora). */
const PROCESSING_STATUSES: readonly JobStatus[] = [
  'created', 'classifying', 'retrieving', 'researching', 'generating',
  'linting', 'grounding', 'judging', 'rewriting', 'adapting',
] as const;

function runInBackground(task: Promise<unknown>, jobId: string): void {
  const guarded = task.catch((err) =>
    console.error(`[resume-job] saga do job ${jobId} falhou:`, err),
  );
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
    EdgeRuntime.waitUntil(guarded);
  } else {
    void guarded;
  }
}

/**
 * Valida o selected_angle do body. Quando o job tem classification.angles, o
 * ângulo DEVE ser um deles (match por id — retorna o objeto canônico gravado).
 */
// Tetos do ângulo vindo do corpo (só usados quando classification.angles está vazio).
const MAX_ANGLE_ID_CHARS = 120;
const MAX_ANGLE_TITLE_CHARS = 200;
const MAX_ANGLE_HOOK_CHARS = 500;
const MAX_ANGLE_RATIONALE_CHARS = 500;

function canonicalAngle(raw: unknown, classification: Classification | null): AngleOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';

  const angles = classification?.angles ?? [];
  if (angles.length > 0) {
    return angles.find((a) => a.id === id) ?? null;
  }
  // Fallback: o Roteador pode devolver needs_angle_choice com angles vazio, e nesse
  // caso o ângulo vem do corpo. Como esse texto entra DIRETO no prompt do Gerador em
  // todas as tentativas, ele é tratado como entrada não confiável: tetos de tamanho
  // (custo de token e superfície de injeção) e nada além dos campos conhecidos.
  if (id && typeof o.title === 'string' && typeof o.hook === 'string') {
    if (
      id.length > MAX_ANGLE_ID_CHARS ||
      o.title.length > MAX_ANGLE_TITLE_CHARS ||
      o.hook.length > MAX_ANGLE_HOOK_CHARS ||
      (typeof o.rationale === 'string' && o.rationale.length > MAX_ANGLE_RATIONALE_CHARS)
    ) {
      return null;
    }
    return {
      id,
      title: o.title,
      hook: o.hook,
      ...(typeof o.rationale === 'string' ? { rationale: o.rationale } : {}),
    };
  }
  return null;
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

    let body: ResumeJobRequest;
    try {
      body = (await req.json()) as ResumeJobRequest;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
    if (!jobId) {
      return errorResponse(400, 'invalid_input', 'Campo job_id é obrigatório.');
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('generation_jobs')
      .select('id, status, classification, timings, updated_at, created_by')
      .eq('id', jobId)
      .maybeSingle();
    if (error) {
      console.error('[resume-job] falha ao carregar job:', error.message);
      return errorResponse(500, 'internal_error', 'Falha ao carregar o job.');
    }
    if (!data) {
      return errorResponse(404, 'not_found', 'Job não encontrado.');
    }
    const job = data as ResumeJobRow & { created_by?: string | null };
    // só quem criou o job, ou um administrador, retoma (o cliente de serviço ignora RLS)
    if (job.created_by && job.created_by !== user.id) {
      const { data: ehAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      if (ehAdmin !== true) return errorResponse(403, 'forbidden', 'Esta geração não é sua.');
    }

    // Terminais / espera de revisão humana: nada a retomar.
    if (job.status === 'done' || job.status === 'cancelled') {
      return errorResponse(409, 'invalid_state', `Job em estado terminal (${job.status}).`);
    }
    if (job.status === 'awaiting_review') {
      return errorResponse(
        409,
        'invalid_state',
        'Job aguardando revisão humana na Biblioteca — nada a retomar.',
      );
    }

    // (a) Escolha de ângulo pelo humano.
    if (job.status === 'awaiting_angle') {
      if (body.selected_angle === undefined) {
        return errorResponse(
          400,
          'invalid_input',
          'selected_angle é obrigatório para retomar um job em awaiting_angle.',
        );
      }
      const angle = canonicalAngle(body.selected_angle, job.classification);
      if (!angle) {
        return errorResponse(
          400,
          'invalid_input',
          'selected_angle inválido — envie um dos ângulos propostos em classification.angles.',
        );
      }
      const { error: updateError } = await supabase
        .from('generation_jobs')
        .update({ selected_angle: angle })
        .eq('id', jobId);
      if (updateError) {
        console.error('[resume-job] falha ao gravar selected_angle:', updateError.message);
        return errorResponse(500, 'internal_error', 'Falha ao gravar o ângulo escolhido.');
      }
      runInBackground(runSaga(jobId, { from: 'retrieving' }), jobId);
      return jsonResponse({ job_id: jobId, status: 'retrieving' });
    }

    // Pedido feito ao Claude da assinatura pela tela Criar: só o Claude escreve.
    // O watchdog não o entrega a outro modelo; "tentar de novo" o devolve à fila.
    const pedidoClaude = (job.timings as { pedido_claude?: { origem?: string } } | null)?.pedido_claude;
    if (pedidoClaude?.origem === 'criar') {
      if (job.status !== 'failed') {
        return errorResponse(409, 'invalid_state', 'Pedido com o seu Claude: ele escreve pela assinatura.');
      }
      const { claim: _claim, ...semReserva } = pedidoClaude as Record<string, unknown>;
      const { error: filaError } = await supabase
        .from('generation_jobs')
        .update({
          status: 'created',
          error: null,
          timings: {
            ...(job.timings as Record<string, unknown>),
            pedido_claude: { ...semReserva, retomado_em: new Date().toISOString() },
          },
        })
        .eq('id', jobId);
      if (filaError) return errorResponse(500, 'internal_error', 'Falha ao devolver o pedido ao seu Claude.');
      return jsonResponse({ job_id: jobId, status: 'created' });
    }

    // (b) Retry de job failed — retoma do checkpoint (timings.last_stage).
    if (job.status === 'failed') {
      const next = deriveResumeStage(job.status, job.timings) ?? 'classifying';
      runInBackground(runSaga(jobId), jobId);
      return jsonResponse({ job_id: jobId, status: next });
    }

    // (c) Job travado em estado de processamento (watchdog / diagnóstico):
    // só retoma se estiver de fato parado — updated_at mais velho que o
    // threshold do watchdog; job fresco provavelmente tem um runner ativo.
    if (PROCESSING_STATUSES.includes(job.status)) {
      const defaults = await loadEngineDefaults(supabase);
      const staleMs = defaults.watchdog_stale_minutes * 60_000;
      const updatedAt = Date.parse(job.updated_at);
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt < staleMs) {
        return errorResponse(
          409,
          'invalid_state',
          `Job ainda em processamento (${job.status}, atualizado há menos de ` +
            `${defaults.watchdog_stale_minutes} min) — nada a retomar.`,
        );
      }
      const next = deriveResumeStage(job.status, job.timings) ?? 'classifying';
      runInBackground(runSaga(jobId), jobId);
      return jsonResponse({ job_id: jobId, status: next });
    }

    return errorResponse(409, 'invalid_state', `Job em estado não retomável (${job.status}).`);
  } catch (err) {
    console.error('[resume-job] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao retomar o job.');
  }
});

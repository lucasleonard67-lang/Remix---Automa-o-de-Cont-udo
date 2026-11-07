// regenerate-piece — regeneração guiada de uma peça já gerada.
// Contrato: docs/07-contratos-backend.md §3.9; saga em docs/06-arquitetura-ia.md §3.
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.regenerate-piece] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9)
//
// POST { piece_id, instruction } → 200 { job_id, piece_id, status: 'processing' }
//   job_id  = novo job que produzirá a nova versão da peça
//   piece_id = a peça original (arquivada quando a nova chegar a awaiting_review)
//
// Estratégia: em vez de reimplementar o pipeline, cria um NOVO generation_jobs
// herdando o briefing do job de origem (classification + selected_angle), restrito
// ao channel_type da peça, e roda a saga normal a partir de `retrieving` com a
// diretiva do usuário injetada no prompt do Gerador (RunSagaOptions.instruction).
// Assim a regeneração passa exatamente pelos mesmos gates (linter → grounding →
// juiz, reescrita ≤ max_rewrites) e carimba as versões ativas do mesmo jeito.
//
// A peça original só é arquivada se a regeneração chegar a awaiting_review — falha
// ou cancelamento deixam o estado anterior intacto (o usuário não perde a peça que
// tinha). Nenhum piece_feedback é gravado: regenerar não é um veredito editorial.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { runSaga } from '../_shared/saga.ts';
import type { AngleOption, ChannelType, Classification, WebResearch } from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const MAX_INSTRUCTION_CHARS = 2000;

interface PieceRow {
  id: string;
  job_id: string;
  channel_type: ChannelType;
  status: string;
}

interface JobRow {
  id: string;
  prompt: string;
  classification: Classification | null;
  selected_angle: AngleOption | null;
  web_research: WebResearch | null;
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

    const semDrive = await requireDrive(createServiceClient(), 'regenerate-piece');
    if (semDrive) return semDrive;

    // Cota por usuário: esta operação gasta crédito de IA (migration 202607300013).
    const limited = await enforceRateLimit(user.id, 'regenerate-piece');
    if (limited) return limited;

    let body: { piece_id?: unknown; instruction?: unknown };
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'invalid_input', 'Corpo da requisição não é JSON válido.');
    }

    const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';

    if (!pieceId) {
      return errorResponse(400, 'invalid_input', 'Informe piece_id.');
    }
    if (!instruction) {
      return errorResponse(
        400,
        'invalid_input',
        'Informe a instrução de regeneração (ex.: "mais provocador", "encurta a abertura").',
      );
    }
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      return errorResponse(
        400,
        'invalid_input',
        `Instrução muito longa (máx. ${MAX_INSTRUCTION_CHARS} caracteres).`,
      );
    }

    const service = createServiceClient();

    const { data: pieceData, error: pieceError } = await service
      .from('content_pieces')
      .select('id, job_id, channel_type, status')
      .eq('id', pieceId)
      .maybeSingle();
    if (pieceError) {
      return errorResponse(500, 'internal_error', `Falha ao carregar a peça: ${pieceError.message}`);
    }
    const piece = pieceData as PieceRow | null;
    if (!piece) {
      return errorResponse(404, 'not_found', 'Peça não encontrada.');
    }
    if (piece.status === 'archived') {
      return errorResponse(
        409,
        'invalid_state',
        'Esta peça já foi arquivada — regenere a versão mais recente.',
      );
    }

    const { data: jobData, error: jobError } = await service
      .from('generation_jobs')
      .select('id, prompt, classification, selected_angle, web_research')
      .eq('id', piece.job_id)
      .maybeSingle();
    if (jobError) {
      return errorResponse(500, 'internal_error', `Falha ao carregar o job: ${jobError.message}`);
    }
    const job = jobData as JobRow | null;
    if (!job) {
      return errorResponse(404, 'not_found', 'Job de origem da peça não encontrado.');
    }
    if (!job.classification || !job.selected_angle) {
      return errorResponse(
        409,
        'invalid_state',
        'O job de origem não tem briefing completo (classificação/ângulo) — gere uma peça nova em /criar.',
      );
    }

    // Briefing herdado, restrito ao canal desta peça: a regeneração não deve
    // reabrir a escolha de ângulo nem espalhar para outros canais.
    const classification: Classification = {
      ...job.classification,
      channel_types: [piece.channel_type],
      angles: [job.selected_angle],
      needs_angle_choice: false,
    };

    const { data: created, error: insertError } = await service
      .from('generation_jobs')
      .insert({
        prompt: job.prompt,
        status: 'created',
        classification,
        selected_angle: job.selected_angle,
        created_by: user.id,
        // Pesquisa web: herda o pedido do job original (busca NOVA — informação
        // fresca é o ponto da regeneração; não reusa o digest antigo).
        ...(job.web_research?.requested ? { web_research: { requested: true } } : {}),
        // Marcador de proveniência (fora do shape canônico de Classification,
        // mesma convenção do sample:true usado pelo tone-gate).
        timings: { regenerated_from: { piece_id: piece.id, job_id: job.id, instruction } },
      })
      .select('id')
      .single();
    if (insertError || !created) {
      return errorResponse(
        500,
        'internal_error',
        `Falha ao criar o job de regeneração: ${insertError?.message ?? 'sem retorno'}`,
      );
    }

    const newJobId = (created as { id: string }).id;

    // Pipeline em background: a peça nova chega na Biblioteca via Realtime.
    const work = (async () => {
      try {
        const status = await runSaga(newJobId, { from: 'retrieving', instruction });
        if (status === 'awaiting_review') {
          const { error: archiveError } = await service
            .from('content_pieces')
            .update({ status: 'archived' })
            .eq('id', piece.id)
            .eq('status', piece.status); // não sobrescreve decisão concorrente do usuário
          if (archiveError) {
            console.error(`[regenerate-piece] falha ao arquivar ${piece.id}:`, archiveError.message);
          }
        }
      } catch (err) {
        // runSaga já persiste o erro no job (status failed); a peça original
        // permanece como estava.
        console.error(`[regenerate-piece] regeneração de ${piece.id} falhou:`, err);
      }
    })();

    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
      EdgeRuntime.waitUntil(work);
    } else {
      void work;
    }

    return jsonResponse({ job_id: newJobId, piece_id: piece.id, status: 'processing' });
  } catch (err) {
    console.error('[regenerate-piece] erro inesperado:', err);
    const message = err instanceof Error ? err.message : 'Erro inesperado.';
    return errorResponse(500, 'internal_error', message);
  }
});

// director-plan — planejamento criativo do agente-diretor (chamada manual/worker).
// Núcleo compartilhado em _shared/director-core.ts (o director-advance usa o mesmo).
//
// Deploy config: verify_jwt = true (admin-only).
// POST { job_id } → 200 { plan }

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { freezeEngineChoice, generateDirectorPlan, savePlan } from '../_shared/director-core.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');

    const service = createServiceClient();
    const { data: isAdmin } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (!isAdmin) return errorResponse(403, 'forbidden', 'Apenas admin.');

    const { job_id } = await req.json().catch(() => ({}));
    if (!job_id) return errorResponse(400, 'invalid_input', 'job_id obrigatório.');

    const { data: job, error: jobErr } = await service
      .from('director_jobs').select('*').eq('id', job_id).single();
    if (jobErr || !job) return errorResponse(404, 'not_found', 'Job não encontrado.');

    const maxShots = Math.min(Number(job.config?.max_shots ?? 5), 8);
    // motor (Higgsfield × Replicate) congelado no job antes do roteiro
    const engine = await freezeEngineChoice(service, { ...job, artifacts: job.artifacts ?? {} });
    const plan = await generateDirectorPlan(job.brief, maxShots);
    await savePlan(service, job_id, plan, 'plan_ready', [job.status]);
    return jsonResponse({ plan, engine });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, 'internal', message);
  }
});

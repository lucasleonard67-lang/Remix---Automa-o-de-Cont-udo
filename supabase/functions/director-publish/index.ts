// director-publish — ações interativas de publicação TikTok do agente-diretor.
// A publicação em si é assíncrona (job 'publishing' processado pelo director-advance);
// esta função cobre só o que a UI precisa na hora: estado da conta, URL de
// conexão OAuth e lista de músicas trending para o dialog de publicação.
//
// Deploy config: verify_jwt = true (admin-only).
// POST { action: 'accounts' | 'connect' | 'music', ...opções } → 200 { ... }

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { mcp, mcpRaw, parseActiveConnector } from '../_shared/hf-mcp.ts';

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

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'accounts') {
      const out = await mcp(service, 'tiktok_accounts', {});
      const connectorId = parseActiveConnector(out);
      return jsonResponse({
        connected: Boolean(connectorId),
        connector_id: connectorId,
        raw: out.slice(0, 800),
      });
    }

    if (action === 'connect') {
      const out = await mcp(service, 'tiktok_connect', {});
      const url = out.match(/https:\/\/[^\s"'`)\]]+/)?.[0] ?? null;
      if (!url) return errorResponse(500, 'internal', `connect sem URL: ${out.slice(0, 300)}`);
      return jsonResponse({ authorize_url: url });
    }

    if (action === 'music') {
      const out = await mcp(service, 'tiktok_accounts', {});
      const connectorId = parseActiveConnector(out);
      if (!connectorId) {
        return errorResponse(400, 'invalid_input', 'Nenhuma conta TikTok ativa.');
      }
      const music = await mcp(service, 'tiktok_music_trending', {
        connector_id: connectorId,
        limit: Math.min(Number(body.limit ?? 10), 30),
        ...(body.genre ? { genre: String(body.genre) } : {}),
        ...(body.country_code ? { country_code: String(body.country_code) } : {}),
      });
      // devolve o texto do catálogo; a UI mostra e o usuário escolhe o song_clip_id
      return jsonResponse({ connector_id: connectorId, tracks_raw: music.slice(0, 6000) });
    }

    // consulta de catálogo (read-only) — o catálogo do Higgsfield gira sem aviso
    if (action === 'models') {
      const out = await mcpRaw(service, 'models_explore', {
        action: String(body.explore ?? 'search'),
        ...(body.query ? { query: String(body.query) } : {}),
        ...(body.model_id ? { model_id: String(body.model_id) } : {}),
        ...(body.type ? { type: String(body.type) } : {}),
        ...(body.limit ? { limit: Number(body.limit) } : {}),
      });
      return jsonResponse({ raw: JSON.stringify(out).slice(0, 20000) });
    }

    return errorResponse(400, 'invalid_input', "action deve ser 'accounts', 'connect', 'music' ou 'models'.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, 'internal', message);
  }
});

// _shared/hf-mcp.ts — client do MCP oficial do Higgsfield para a lane edge.
// Extraído do director-advance para reuso (director-publish). Tokens OAuth
// rotativos vivem em director_state (key hf_oauth); rotação OTIMISTA: só
// persiste se ninguém rotacionou no meio, senão adota o token do vencedor.

import { NotConnectedError } from './not-connected.ts';
import { createServiceClient } from './supabase.ts';

export type Service = ReturnType<typeof createServiceClient>;

export const MCP_URL = 'https://mcp.higgsfield.ai/mcp';
export const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;
/** Imagem/vídeo: o que os jobs de geração do Diretor devolvem (regra original). */
export const VISUAL_URL_RE = /https:\/\/[^\s"']+\.(?:png|mp4|webp|jpg)(?:\?[^\s"']*)?/;
/**
 * Qualquer mídia de saída: imagem, vídeo, áudio (TTS, trilha) e texto
 * (brain_activity e afins). hfCheck procura primeiro a visual — um job de
 * vídeo com áudio de referência no texto continua devolvendo o mp4.
 */
export const MEDIA_URL_RE =
  /https:\/\/[^\s"']+\.(?:png|mp4|webp|jpg|jpeg|webm|mov|mp3|wav|m4a|aac|ogg|flac|txt|json|srt|vtt)(?:\?[^\s"']*)?/;

/** URL de resultado num texto do job_status: visual primeiro, depois áudio/texto. */
export function resultUrl(out: string): string | null {
  return out.match(VISUAL_URL_RE)?.[0] ?? out.match(MEDIA_URL_RE)?.[0] ?? null;
}

let hfSession: string | null = null;

/**
 * Dá para obter um token válido do Higgsfield agora? Mesmo critério do status
 * em higgsfield-oauth (sem refresh_token não há conexão): reusa hfToken, que
 * renova se preciso. false → quem chama cai no caminho sem Higgsfield.
 */
export async function hfConnected(service: Service): Promise<boolean> {
  try {
    await hfToken(service);
    return true;
  } catch {
    return false;
  }
}

async function hfToken(service: Service): Promise<string> {
  const { data } = await service.from('director_state').select('value').eq('key', 'hf_oauth').maybeSingle();
  const tok = (data?.value ?? {}) as {
    access_token?: string;
    refresh_token?: string;
    obtained_at?: number;
    expires_in?: number;
    client_id?: string;
    /** refresh recusado de vez (invalid_grant): só reconectar resolve */
    broken?: boolean;
  };
  if (tok.broken) {
    throw new NotConnectedError('higgsfield', 'A conexão com o Higgsfield expirou. Reconecte em Config → Integrações.');
  }
  // janela útil do access: expires_in curto (< 5 min) não pode virar refresh a cada chamada
  const usefulMs = Math.max((tok.expires_in ?? 0) - 300, 60) * 1000;
  if (tok.access_token && tok.obtained_at && Date.now() - tok.obtained_at < usefulMs) {
    return tok.access_token;
  }
  if (!tok.refresh_token) {
    throw new NotConnectedError('higgsfield', 'Higgsfield não conectado — conecte em Config → Integrações.');
  }
  // O refresh_token só vale com o client que o emitiu: usa o client gravado
  // junto dos tokens e cai no Vault só para conexões antigas (sem esse campo).
  let clientId: string | null = tok.client_id ?? null;
  if (!clientId) {
    const { data } = await service.rpc('get_vault_secret', { _name: 'HF_MCP_CLIENT_ID' });
    clientId = (data as string) ?? null;
  }
  if (!clientId) throw new Error('HF_MCP_CLIENT_ID ausente do Vault.');
  const r = await fetch('https://mcp.higgsfield.ai/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: tok.refresh_token,
      client_id: String(clientId), resource: MCP_URL,
    }),
  });
  const j = await r.json();
  if (!j.access_token) {
    // refresh_token inválido/revogado: outra lane pode ter rotacionado agora —
    // se a linha mudou, o próximo hfToken usa o token do vencedor; se não
    // mudou, a conexão morreu de vez e só reconectar resolve.
    if (j.error === 'invalid_grant') {
      const { data: again } = await service.from('director_state').select('value').eq('key', 'hf_oauth').maybeSingle();
      const now = (again?.value ?? {}) as { refresh_token?: string };
      if (now.refresh_token && now.refresh_token !== tok.refresh_token) return hfToken(service);
      await service.from('director_state').update({ value: { ...tok, broken: true, broken_at: Date.now() } }).eq('key', 'hf_oauth');
      throw new NotConnectedError('higgsfield', 'A conexão com o Higgsfield expirou. Reconecte em Config → Integrações.');
    }
    throw new Error(`refresh HF falhou: ${JSON.stringify(j).slice(0, 180)}`);
  }
  const value = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? tok.refresh_token,
    obtained_at: Date.now(),
    expires_in: j.expires_in ?? 86400,
    // preserva o emissor: sem isso o próximo refresh cairia no Vault e poderia
    // pegar um client_id que não emitiu este refresh_token
    client_id: clientId,
  };
  // rotação OTIMISTA: só persiste se ninguém rotacionou no meio; senão relê e usa o do vencedor
  const { data: updated } = await service
    .from('director_state')
    .update({ value })
    .eq('key', 'hf_oauth')
    .filter('value->>refresh_token', 'eq', tok.refresh_token)
    .select('key');
  hfSession = null;
  if (!updated?.length) {
    const { data: winner } = await service.from('director_state').select('value').eq('key', 'hf_oauth').maybeSingle();
    const w = (winner?.value ?? {}) as { access_token?: string };
    if (w.access_token) return w.access_token;
  }
  return value.access_token;
}

async function mcpPost(service: Service, payload: unknown, session?: string | null, retried = false) {
  const t = await hfToken(service);
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${t}`,
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(payload),
  });
  const sid = r.headers.get('mcp-session-id');
  const raw = await r.text();
  // 401: o access foi revogado antes da hora. Força um refresh (zera obtained_at)
  // e repete UMA vez; se continuar 401, é reconexão — não "generate_image sem job id".
  if (r.status === 401) {
    if (retried) throw new NotConnectedError('higgsfield', 'O Higgsfield recusou o acesso. Reconecte em Config → Integrações.');
    const { data } = await service.from('director_state').select('value').eq('key', 'hf_oauth').maybeSingle();
    const cur = (data?.value ?? {}) as Record<string, unknown>;
    await service.from('director_state').update({ value: { ...cur, obtained_at: 0 } }).eq('key', 'hf_oauth');
    hfSession = null;
    return mcpPost(service, payload, session, true);
  }
  let data: { result?: { content?: { type: string; text: string }[] }; error?: { message?: string } } | null = null;
  for (const line of raw.split('\n')) if (line.startsWith('data:')) data = JSON.parse(line.slice(5));
  if (!data && raw.trim()) data = JSON.parse(raw);
  return { data, sid };
}

/** Como mcp(), mas devolve o result JSON-RPC inteiro (content não-textual incluso). */
export async function mcpRaw(service: Service, name: string, args: unknown): Promise<unknown> {
  await mcp(service, 'balance', {}).catch(() => {}); // garante sessão inicializada
  const { data } = await mcpPost(service, {
    jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name, arguments: args },
  }, hfSessionId());
  if (data?.error) throw new Error(`MCP ${name}: ${JSON.stringify(data.error).slice(0, 250)}`);
  return data?.result ?? null;
}

export function hfSessionId(): string | null {
  return hfSession;
}

export async function mcp(service: Service, name: string, args: unknown, retriedSession = false): Promise<string> {
  if (!hfSession) {
    const { data, sid } = await mcpPost(service, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'director-edge', version: '0.4' } },
    });
    if (!data?.result) throw new Error('MCP init falhou');
    await mcpPost(service, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    hfSession = sid;
  }
  const { data } = await mcpPost(service, {
    jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name, arguments: args },
  }, hfSession);
  if (data?.error) {
    // sessão caiu: reabre UMA vez (sem teto isso virava recursão infinita)
    if (!retriedSession && String(data.error.message ?? '').toLowerCase().includes('session')) {
      hfSession = null;
      return mcp(service, name, args, true);
    }
    throw new Error(`MCP ${name}: ${JSON.stringify(data.error).slice(0, 250)}`);
  }
  return (data?.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

export async function hfGenerate(service: Service, tool: string, params: Record<string, unknown>): Promise<string> {
  let out = await mcp(service, tool, { params });
  const preset = out.match(/declined_preset_id:\s*"([a-f0-9-]+)"/) ?? out.match(/Preset id:\s*([a-f0-9-]+)/);
  if (preset && !out.includes('Submitted')) {
    out = await mcp(service, tool, { params: { ...params, declined_preset_id: preset[1] } });
  }
  const jobId = out.match(/^- ([a-f0-9-]{36})/m)?.[1];
  if (!jobId) throw new Error(`${tool} sem job id: ${out.slice(0, 200)}`);
  return jobId;
}

/** Poll não-bloqueante: url quando completed, null enquanto roda, lança em falha. */
export async function hfCheck(service: Service, hfJobId: string): Promise<string | null> {
  const out = await mcp(service, 'job_status', { jobId: hfJobId, sync: false });
  if (out.includes('completed')) {
    const url = resultUrl(out);
    if (!url) throw new Error(`completed sem url: ${out.slice(0, 160)}`);
    return url;
  }
  if (/failed|nsfw/.test(out)) throw new Error(`HF job ${hfJobId}: ${out.slice(0, 160)}`);
  return null;
}

export async function hfBalance(service: Service): Promise<number | null> {
  const m = (await mcp(service, 'balance', {})).match(/Credits:\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

export async function hfUploadAudio(service: Service, bytes: Uint8Array, filename: string): Promise<string> {
  const out = await mcp(service, 'media_upload', { files: [{ filename }], type: 'audio' });
  const mediaId = out.match(UUID_RE)?.[0];
  const url = out.match(/'(https:\/\/[^']+)'/)?.[1];
  if (!mediaId || !url) throw new Error(`media_upload: ${out.slice(0, 160)}`);
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: new Blob([bytes as unknown as BlobPart], { type: 'audio/mpeg' }),
  });
  if (!put.ok) throw new Error(`PUT audio ${put.status}`);
  await mcp(service, 'media_confirm', { type: 'audio', media_ids: [mediaId] });
  return mediaId;
}

/** Importa uma URL https para o storage do Higgsfield; devolve id e (se houver) a URL hospedada lá. */
export async function hfImportMedia(
  service: Service,
  url: string,
  type: 'image' | 'video' | 'audio',
): Promise<{ id: string; hostedUrl: string | null }> {
  const out = await mcp(service, 'media_import_url', { url, type });
  const id = out.match(UUID_RE)?.[0];
  if (!id) throw new Error(`import falhou: ${out.slice(0, 160)}`);
  // URL hospedada no Higgsfield (nunca a URL de origem, que pode ser ecoada no output)
  const all = out.match(/https:\/\/[^\s"'`)\]]+/g) ?? [];
  const hostedUrl = all.find((u) => u !== url && /higgsfield/.test(u))
    ?? all.find((u) => u !== url && !/supabase/.test(u) && VISUAL_URL_RE.test(u))
    ?? all.find((u) => u !== url && !/supabase/.test(u) && MEDIA_URL_RE.test(u)) ?? null;
  return { id, hostedUrl };
}

export async function hfImportImage(service: Service, url: string): Promise<string> {
  return (await hfImportMedia(service, url, 'image')).id;
}

/**
 * Connector TikTok ATIVO da listagem de tiktok_accounts: linha com 'active' que
 * não é inactive/erro (o primeiro UUID do texto pode ser uma conta morta).
 */
export function parseActiveConnector(out: string): string | null {
  for (const line of out.split('\n')) {
    if (!/\bactive\b/i.test(line) || /inactive|error|expired|revoked/i.test(line)) continue;
    const id = line.match(UUID_RE)?.[0];
    if (id) return id;
  }
  // formato de linha diferente: aceita se há exatamente 1 connector e status ativo
  const uuids = [...new Set(out.match(new RegExp(UUID_RE.source, 'g')) ?? [])];
  if (uuids.length === 1 && /\bactive\b/i.test(out) && !/inactive/i.test(out)) return uuids[0];
  return null;
}

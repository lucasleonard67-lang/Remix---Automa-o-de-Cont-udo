// delete-content — exclui peça, vídeo ou item do Contexto. Só admin; o item do
// Contexto também pode ser excluído por quem o criou.
//
// POST { kind: 'piece' | 'video' | 'context', id } → 200 { ok, drive_pendente }
//   409 busy: ainda em uso; a mensagem diz o que esperar.
//
// O post publicado segue na rede. Envio agendado de peça é cancelado pela tela antes.
// A cópia do Drive vai para a lixeira do Drive. O vídeo mantém um registro invisível
// (`config.excluido_em`) porque o centro de custos soma por ele.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { accessToken, trashFile } from '../_shared/drive-api.ts';
import { makeDriveIo } from '../_shared/drive-io.ts';
import {
  ARQUIVOS_BUCKET,
  arquivosExclusivos,
  CONTEXTO_BUCKET,
  EDICOES_ABERTAS,
  JOBS_ENCERRADOS,
  pastasDoVideo,
  pecaOcupada,
  POSTS_ABERTOS,
  videoOcupado,
} from '../_shared/excluir-conteudo.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';

type Service = ReturnType<typeof createServiceClient>;

const PROJETOS_ENCERRADOS = '(ready,failed,cancelled)';
const LOTE = 100;

/** Caminhos de uma pasta, descendo nas subpastas. */
async function listarPasta(service: Service, pasta: string): Promise<string[]> {
  const bucket = service.storage.from(ARQUIVOS_BUCKET);
  const achados: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(pasta.replace(/\/$/, ''), { limit: 1000, offset });
    if (error) throw new Error(`storage: ${error.message}`);
    for (const item of data ?? []) {
      const caminho = `${pasta}${item.name}`;
      if (item.id) achados.push(caminho);
      else achados.push(...(await listarPasta(service, `${caminho}/`)));
    }
    if ((data ?? []).length < 1000) return achados;
  }
}

/** Cópia que falha fica na conta: a tela avisa em vez de dizer que apagou. */
async function apagarDoDrive(service: Service, caminhos: string[], pastas: string[], bucket = ARQUIVOS_BUCKET): Promise<number> {
  const filtros = [
    ...(caminhos.length ? [`path.in.(${caminhos.map((c) => `"${c}"`).join(',')})`] : []),
    ...pastas.map((p) => `path.like.${p}*`),
  ];
  if (!filtros.length) return 0;
  const { data, error } = await service.from('drive_files').select('id, drive_file_id')
    .eq('bucket', bucket).or(filtros.join(','));
  if (error) throw new Error(`drive_files: ${error.message}`);
  const linhas = (data ?? []) as { id: string; drive_file_id: string | null }[];
  if (!linhas.length) return 0;

  const io = makeDriveIo(service);
  const comCopia = linhas.some((l) => l.drive_file_id);
  const conectado = comCopia ? await accessToken(io).then(() => true, () => false) : true;
  let pendentes = 0;
  for (const linha of linhas) {
    try {
      if (linha.drive_file_id) {
        if (!conectado) throw new Error('Drive desconectado');
        await trashFile(io, linha.drive_file_id);
      }
      await service.from('drive_files').delete().eq('id', linha.id);
    } catch (err) {
      pendentes += 1;
      console.error('[delete-content] drive:', linha.id, err instanceof Error ? err.message : err);
    }
  }
  return pendentes;
}

async function apagarArquivos(service: Service, caminhos: string[], pastas: string[]): Promise<number> {
  const dasPastas = (await Promise.all(pastas.map((p) => listarPasta(service, p)))).flat();
  const todos = [...new Set([...caminhos, ...dasPastas])];
  for (let i = 0; i < todos.length; i += LOTE) {
    const { error } = await service.storage.from(ARQUIVOS_BUCKET).remove(todos.slice(i, i + LOTE));
    if (error) console.error('[delete-content] storage:', error.message);
  }
  return await apagarDoDrive(service, caminhos, pastas);
}

async function excluirPeca(service: Service, id: string): Promise<Response> {
  const { data } = await service.from('content_pieces')
    .select('id, job_id, render_path, adapted_content').eq('id', id).maybeSingle();
  const peca = data as { id: string; job_id: string; render_path: string | null; adapted_content: Record<string, unknown> } | null;
  if (!peca) return errorResponse(404, 'not_found', 'Esta peça já foi excluída.');

  const [{ data: envios }, { data: projetos }] = await Promise.all([
    service.from('published_posts').select('id').eq('piece_id', id).in('status', POSTS_ABERTOS),
    service.from('video_projects').select('id').eq('piece_id', id).not('status', 'in', PROJETOS_ENCERRADOS),
  ]);
  if (envios?.length) return errorResponse(409, 'busy', 'Cancele o envio agendado antes de excluir.');
  const ocupada = pecaOcupada(peca, Boolean(projetos?.length));
  if (ocupada) return errorResponse(409, 'busy', ocupada);

  const { data: irmas, error: leitura } = await service.from('content_pieces')
    .select('render_path, adapted_content').eq('job_id', peca.job_id).neq('id', id);
  if (leitura) throw new Error(leitura.message);
  const caminhos = arquivosExclusivos(peca, (irmas ?? []) as Parameters<typeof arquivosExclusivos>[1]);

  // a linha sai primeiro: arquivo órfão não aparece, peça sem arquivo apareceria quebrada
  const posts = await service.from('published_posts').delete().eq('piece_id', id);
  if (posts.error) throw new Error(posts.error.message);
  const { error } = await service.from('content_pieces').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return jsonResponse({ ok: true, drive_pendente: await apagarArquivos(service, caminhos, []) });
}

async function excluirVideo(service: Service, id: string): Promise<Response> {
  const { data } = await service.from('director_jobs').select('id, status, config, artifacts').eq('id', id).maybeSingle();
  const job = data as { id: string; status: string; config: Record<string, unknown>; artifacts: Record<string, never> } | null;
  if (!job || job.config?.excluido_em) return errorResponse(404, 'not_found', 'Este vídeo já foi excluído.');

  const pasta = `director/${id}/`;
  const [edicoes, porCaminho, refazendo, pecas, projetos] = await Promise.all([
    service.from('video_edits').select('id, status').eq('source_id', id),
    service.from('video_edits').select('id').like('source_path', `${pasta}%`).in('status', EDICOES_ABERTAS),
    service.from('director_jobs').select('id').eq('config->>refaz_de', id).not('status', 'in', `(${JOBS_ENCERRADOS.join(',')})`),
    service.from('content_pieces').select('id').like('adapted_content->video->>path', `${pasta}%`).limit(1),
    service.from('video_projects').select('id').like('final_video_path', `${pasta}%`).limit(1),
  ]);
  const erro = [edicoes, porCaminho, refazendo, pecas, projetos].find((r) => r.error)?.error;
  if (erro) throw new Error(erro.message);
  const minhas = (edicoes.data ?? []) as { id: string; status: string }[];
  const ocupado = videoOcupado(job, {
    edicaoAberta: minhas.some((e) => EDICOES_ABERTAS.includes(e.status)) || Boolean(porCaminho.data?.length),
    outroVideo: Boolean(refazendo.data?.length || pecas.data?.length || projetos.data?.length),
  });
  if (ocupado) return errorResponse(409, 'busy', ocupado);

  const { error } = await service.from('director_jobs').update({
    artifacts: {},
    config: { ...job.config, excluido_em: new Date().toISOString() },
  }).eq('id', id);
  if (error) throw new Error(error.message);
  if (minhas.length) {
    const edits = await service.from('video_edits').update({ status: 'reverted' }).eq('source_id', id);
    if (edits.error) throw new Error(edits.error.message);
  }
  const pastas = pastasDoVideo(id, minhas.map((e) => e.id));
  return jsonResponse({ ok: true, drive_pendente: await apagarArquivos(service, [], pastas) });
}

async function excluirContexto(service: Service, id: string, usuario: string, admin: boolean): Promise<Response> {
  const { data } = await service.from('context_items').select('id, created_by, file_path').eq('id', id).maybeSingle();
  const item = data as { id: string; created_by: string | null; file_path: string | null } | null;
  if (!item) return errorResponse(404, 'not_found', 'Este item já foi excluído.');
  if (!admin && item.created_by !== usuario) {
    return errorResponse(403, 'forbidden', 'Só quem criou o item ou um administrador pode excluí-lo.');
  }

  // os trechos caem por cascade; peças que usaram o item seguem na Biblioteca
  const { error } = await service.from('context_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
  if (!item.file_path) return jsonResponse({ ok: true, drive_pendente: 0 });
  const removido = await service.storage.from(CONTEXTO_BUCKET).remove([item.file_path]);
  if (removido.error) console.error('[delete-content] storage:', removido.error.message);
  return jsonResponse({ ok: true, drive_pendente: await apagarDoDrive(service, [item.file_path], [], CONTEXTO_BUCKET) });
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const service = createServiceClient();
    const { data: admin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });

    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    if (!/^[0-9a-f-]{36}$/.test(id)) return errorResponse(400, 'invalid_input', 'Item inválido.');
    if (body.kind === 'context') return await excluirContexto(service, id, user.id, admin === true);
    if (!admin) return errorResponse(403, 'forbidden', 'Só um administrador pode excluir.');
    if (body.kind === 'piece') return await excluirPeca(service, id);
    if (body.kind === 'video') return await excluirVideo(service, id);
    return errorResponse(400, 'invalid_input', 'Tipo inválido.');
  } catch (err) {
    console.error('[delete-content] falhou:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    return errorResponse(500, 'internal', 'Não deu para excluir. Tente de novo.');
  }
});

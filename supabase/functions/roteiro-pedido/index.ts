// roteiro-pedido — a pessoa escreve do jeito dela; o Claude da assinatura escreve certo.
//
// POST { tipo?, texto | briefing, contexto?, referencias?: [{ url, nota? } | url] }
//      → 200 { pedido_id, acordou }: o pedido fica em roteiro_pedidos para a rotina do
//        Claude da pessoa ler pelo conector (roteiro_pedidos) e entregar (roteiro_entregar)
//        (a rotina é opcional: sem ela, o Claude atende na próxima vez que rodar pelo conector)
//      → 409 ja_aberto { pedido_id }: já há um pedido aberto deste tipo neste campo
//      tipo: roteiro (padrão; com plano de produção), ideia, briefing_cenas, fala, cena, pessoa
//      contexto: { alvo, ferramenta, modelo, max, segundos, formato, apresentador, voz }
// POST { action: 'cancelar', pedido_id } → 200 { ok: true }
// POST { action: 'responder', pedido_id | edit_id, texto } → 200 { ok, acordou }: a resposta da pessoa
//      entra na conversa do pedido (roteiro ou montagem), o pedido volta à fila e a rotina é acordada
//
// Nada aqui chama LLM. Quem pesquisa, estuda as referências e escreve é o Claude da
// pessoa, no ambiente dela. Auth: autenticado (verify_jwt no gateway + getUser aqui).

import { acordarRotina, ROTINA_TOKEN, ROTINA_URL } from '../_shared/claude-rotina.ts';
import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { comMensagem, MENSAGEM_MAX } from '../_shared/conversa.ts';
import { andamento, BRIEFING_MAX, lerReferencias } from '../_shared/roteiro.ts';
import { lerContexto, lerTipo } from '../_shared/receitas-de-video.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';

type Service = ReturnType<typeof createServiceClient>;

async function segredo(service: Service, nome: string): Promise<string> {
  const { data } = await service.rpc('get_vault_secret', { _name: nome });
  return typeof data === 'string' ? data : '';
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const service = createServiceClient();

    // Pedir e responder enfileiram trabalho que o Claude do ADMIN executa com
    // ferramentas de serviço (AGENTS.md, segurança): só admin. Cancelar o
    // próprio pedido continua livre.
    if (body.action !== 'cancelar') {
      const { data: admin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      if (!admin) return errorResponse(403, 'forbidden', 'Só administradores pedem ao Claude da assinatura.');
    }

    if (body.action === 'cancelar') {
      const id = typeof body.pedido_id === 'string' ? body.pedido_id : '';
      if (!/^[0-9a-f-]{36}$/.test(id)) return errorResponse(400, 'invalid_input', 'Pedido inválido.');
      const { error } = await service.from('roteiro_pedidos').update({ status: 'cancelado', claim: null })
        .eq('id', id).eq('status', 'aberto').eq('created_by', user.id);
      if (error) throw new Error(error.message);
      return jsonResponse({ ok: true });
    }

    if (body.action === 'responder') {
      const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
      if (!texto) return errorResponse(400, 'invalid_input', 'Escreva a resposta.');
      if (texto.length > MENSAGEM_MAX) return errorResponse(400, 'invalid_input', 'Resposta longa demais.');
      const limitadoResposta = await enforceRateLimit(user.id, 'regenerate-piece');
      if (limitadoResposta) return limitadoResposta;
      const pedidoId = typeof body.pedido_id === 'string' ? body.pedido_id : '';
      const editId = typeof body.edit_id === 'string' ? body.edit_id : '';
      if (pedidoId) {
        if (!/^[0-9a-f-]{36}$/.test(pedidoId)) return errorResponse(400, 'invalid_input', 'Pedido inválido.');
        const { data } = await service.from('roteiro_pedidos').select('id, status, conversa, created_by').eq('id', pedidoId).maybeSingle();
        const pedido = data as { id: string; status: string; conversa: unknown; created_by: string | null } | null;
        if (!pedido || pedido.status !== 'aberto') return errorResponse(409, 'not_open', 'Este pedido não está mais aberto.');
        if (pedido.created_by && pedido.created_by !== user.id) return errorResponse(403, 'forbidden', 'Este pedido é de outra pessoa.');
        const { error } = await service.from('roteiro_pedidos').update({
          conversa: comMensagem(pedido.conversa, 'pessoa', texto), aguardando_pessoa: false, claim: null,
          andamento: andamento('pegou', 'Resposta enviada. Aguardando o seu Claude retomar.'),
        }).eq('id', pedidoId);
        if (error) throw new Error(error.message);
      } else if (editId) {
        if (!/^[0-9a-f-]{36}$/.test(editId)) return errorResponse(400, 'invalid_input', 'Edição inválida.');
        const { data } = await service.from('video_edits').select('id, status, analysis, created_by').eq('id', editId).maybeSingle();
        const edit = data as { id: string; status: string; analysis: Record<string, unknown>; created_by: string | null } | null;
        if (!edit || edit.status !== 'suggested' || !edit.analysis?.external) return errorResponse(409, 'not_open', 'Este pedido não está mais aberto.');
        if (edit.created_by && edit.created_by !== user.id) return errorResponse(403, 'forbidden', 'Este pedido é de outra pessoa.');
        const { claim: _c, ...resto } = edit.analysis;
        const { error } = await service.from('video_edits').update({
          analysis: { ...resto, conversa: comMensagem(edit.analysis.conversa, 'pessoa', texto), aguardando_pessoa: false, retomado_em: new Date().toISOString() },
        }).eq('id', editId);
        if (error) throw new Error(error.message);
      } else {
        return errorResponse(400, 'invalid_input', 'Diga a qual pedido a resposta pertence.');
      }
      const [url, token] = await Promise.all([segredo(service, ROTINA_URL), segredo(service, ROTINA_TOKEN)]);
      const acordou = url && token ? await acordarRotina({ url, token, texto: `Resposta ${pedidoId || editId}` }) : false;
      return jsonResponse({ ok: true, acordou });
    }

    const tipo = lerTipo(body.tipo);
    const contexto = lerContexto(body.contexto);
    const bruto = typeof body.texto === 'string' ? body.texto : typeof body.briefing === 'string' ? body.briefing : '';
    const briefing = bruto.trim();
    // tipos curtos aceitam uma frase; o roteiro (pesquisa + plano) precisa de uma ideia inteira
    const minimo = tipo === 'roteiro' ? 20 : 3;
    if (briefing.length < minimo) return errorResponse(400, 'invalid_input', 'Escreva a ideia em poucas palavras e peça ao seu Claude.');
    if (briefing.length > BRIEFING_MAX) return errorResponse(400, 'invalid_input', 'Texto longo demais.');
    const referencias = lerReferencias(body.referencias);
    if (!referencias) return errorResponse(400, 'invalid_input', 'Referência precisa ser um link https.');

    // o pedido vale pelo conector; a rotina (opcional) só acorda o Claude na hora
    const [url, token] = await Promise.all([segredo(service, ROTINA_URL), segredo(service, ROTINA_TOKEN)]);
    const limitado = await enforceRateLimit(user.id, 'regenerate-piece');
    if (limitado) return limitado;

    const enviado = andamento('enviado', 'Pedido enviado ao seu Claude.');
    let inserido = await service.from('roteiro_pedidos')
      .insert({ created_by: user.id, tipo, contexto, briefing, referencias, andamento: enviado })
      .select('id').single();
    // um pedido aberto por pessoa × tipo × campo: a tela mostra o que já está aberto
    if (inserido.error?.code === '23505') {
      const { data: aberto } = await service.from('roteiro_pedidos').select('id')
        .eq('created_by', user.id).eq('status', 'aberto').eq('tipo', tipo)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return errorResponse(409, 'ja_aberto', 'O seu Claude já está escrevendo este campo.', {
        pedido_id: (aberto as { id: string } | null)?.id ?? null,
      });
    }
    // instância sem as colunas novas (SQL roteiro-pedidos.sql ainda não rodou): só o roteiro entra
    if (inserido.error?.message?.match(/tipo|contexto|andamento/)) {
      if (tipo !== 'roteiro') return errorResponse(412, 'not_deployed', 'Este campo chega no próximo deploy do motor.');
      inserido = await service.from('roteiro_pedidos').insert({ created_by: user.id, briefing, referencias }).select('id').single();
    }
    const { data, error } = inserido;
    if (error || !data) throw new Error(error?.message ?? 'sem id');
    const id = (data as { id: string }).id;
    const acordou = url && token ? await acordarRotina({ url, token, texto: `Escrita ${tipo} ${id}` }) : false;
    await service.from('roteiro_pedidos').update({
      andamento: andamento('enviado', acordou ? 'O seu Claude foi acordado e vai pegar o pedido.' : 'Aguardando o seu Claude pegar o pedido.'),
    }).eq('id', id).then(() => undefined, () => undefined);
    return jsonResponse({ pedido_id: id, acordou });
  } catch (err) {
    console.error('[roteiro-pedido] falhou:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    return errorResponse(500, 'internal', 'Não deu para pedir o roteiro. Tente de novo.');
  }
});

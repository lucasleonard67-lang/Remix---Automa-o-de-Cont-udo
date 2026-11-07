// edit-slide — muda uma unidade da peça por prompt, sem refazer as outras.
//
// POST { piece_id, index, instruction, confirmar? } → 200 { gerar_foto, conferir, provider, model }
// POST { piece_id, index, instruction, pedir_ao_claude: true, confirmar? }
//      → 200 { status: 'pedido', acordou }: o pedido fica na peça para o Claude da
//        assinatura (rotina) escrever e entregar pelo conector (slide_pedidos/slide_entregar)
//        (a rotina é opcional: sem ela, o Claude atende na próxima vez que rodar pelo conector)
// POST { piece_id, index, action: 'cancelar_pedido' }  → 200 { ok: true }
// POST { piece_id, index, action: 'desfazer' }         → 200 { ok: true }
//   409 needs_confirm: peça fora de revisão; a tela confirma e reenvia.
//   409 busy: fotos gerando, ou a peça mudou no meio do caminho.
//   422 invalid_edit: o pedido não cabe nas regras; a mensagem diz o porquê.
//
// A foto nova sai por generate-image (scope 'slides'), chamada pela tela depois daqui,
// com o brief que esta função grava no slide. Nenhum caminho usa API de LLM paga:
// ou o Claude da assinatura, ou a IA inclusa.

import { acordarRotina, ROTINA_TOKEN, ROTINA_URL } from '../_shared/claude-rotina.ts';
import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  comUnidade, desempilhar, EDICAO_SCHEMA, entregarEdicao, formatoDoCanal, INSTRUCAO_MAX,
  pedidoDaPeca, prefixoDaPendencia, receitaDaEdicao, teseDaPeca,
  type EdicaoDoModelo, type Historico, type PecaEditavel, type PedidoDeSlide,
} from '../_shared/editar-slide.ts';
import { chat, LlmError } from '../_shared/llm.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';

type Service = ReturnType<typeof createServiceClient>;
type Peca = PecaEditavel;

const ENCERRADAS = ['rejected', 'archived'];

/** updated_at no filtro: duas abas editando não sobrescrevem uma à outra. */
async function salvar(service: Service, peca: Peca, campos: Record<string, unknown>): Promise<Response | null> {
  const { data, error } = await service.from('content_pieces').update(campos)
    .eq('id', peca.id).eq('updated_at', peca.updated_at).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) return errorResponse(409, 'busy', 'A peça mudou agora há pouco. Tente de novo.');
  return null;
}

async function desfazer(service: Service, peca: Peca, index: number): Promise<Response> {
  const historico = (peca.adapted_content.edicoes ?? {}) as Historico;
  const { historico: resto, anterior } = desempilhar(historico, index);
  if (!anterior) return errorResponse(409, 'invalid_state', 'Não há edição para desfazer neste slide.');
  const pendencia = prefixoDaPendencia(index);
  const barrou = await salvar(service, peca, {
    adapted_content: { ...comUnidade(peca.adapted_content, peca.channel_type, anterior), edicoes: resto },
    core_content: {
      ...peca.core_content,
      verify_flags: (peca.core_content.verify_flags ?? []).filter((f) => !f.startsWith(pendencia)),
    },
  });
  return barrou ?? jsonResponse({ ok: true });
}

async function cancelarPedido(service: Service, peca: Peca): Promise<Response> {
  const adapted = { ...peca.adapted_content };
  delete adapted.pedido_claude;
  const barrou = await salvar(service, peca, { adapted_content: adapted });
  return barrou ?? jsonResponse({ ok: true });
}

async function segredo(service: Service, nome: string): Promise<string> {
  const { data } = await service.rpc('get_vault_secret', { _name: nome });
  return typeof data === 'string' ? data : '';
}

/** Grava o pedido na peça e acorda a rotina do Claude; ela entrega pelo conector. */
async function pedirAoClaude(service: Service, peca: Peca, index: number, instrucao: string): Promise<Response> {
  // o pedido vale pelo conector; a rotina (opcional) só acorda o Claude na hora
  const [url, token] = await Promise.all([segredo(service, ROTINA_URL), segredo(service, ROTINA_TOKEN)]);
  if (!receitaDaEdicao(peca.channel_type, peca.adapted_content, index, instrucao, teseDaPeca(peca))) {
    return errorResponse(404, 'not_found', 'Este slide não existe mais.');
  }
  const aberto = pedidoDaPeca(peca.adapted_content);
  if (aberto && !aberto.erro && aberto.index !== index) {
    return errorResponse(409, 'busy', `Já há um pedido aberto no slide ${aberto.index + 1}. Espere ele terminar ou cancele.`);
  }
  const pedido: PedidoDeSlide = { index, instrucao, pedido_em: new Date().toISOString() };
  const barrou = await salvar(service, peca, { adapted_content: { ...peca.adapted_content, pedido_claude: pedido } });
  if (barrou) return barrou;
  const acordou = url && token ? await acordarRotina({ url, token, texto: `Slide ${peca.id}:${index}` }) : false;
  return jsonResponse({ status: 'pedido', acordou });
}

async function editar(service: Service, peca: Peca, index: number, instrucao: string): Promise<Response> {
  const receita = receitaDaEdicao(peca.channel_type, peca.adapted_content, index, instrucao, teseDaPeca(peca));
  if (!receita) return errorResponse(404, 'not_found', 'Este slide não existe mais.');
  const pedir = (correcao?: string) => chat({
    role_hint: 'generator',
    messages: [
      { role: 'system', content: receita.instrucoes },
      { role: 'user', content: correcao ? `${receita.pedido}\n\nA RESPOSTA ANTERIOR FOI RECUSADA:\n${correcao}\nResponda de novo, corrigindo isso.` : receita.pedido },
    ],
    schema: EDICAO_SCHEMA,
  });
  let resposta = await pedir();
  let edicao = resposta.parsed as EdicaoDoModelo | undefined;
  if (!edicao) return errorResponse(502, 'provider_error', 'A IA não devolveu a edição. Tente de novo.');

  let entrega = await entregarEdicao(service, peca, index, edicao);
  if (!entrega.ok && entrega.code === 'invalid_edit') {
    // a IA errou a forma (gráfico vazio, texto longo, regra da marca): ela corrige uma vez, sem devolver o erro à pessoa
    resposta = await pedir(entrega.message);
    edicao = resposta.parsed as EdicaoDoModelo | undefined;
    if (edicao) entrega = await entregarEdicao(service, peca, index, edicao);
  }
  if (!entrega.ok) {
    const status = entrega.code === 'not_found' ? 404 : entrega.code === 'busy' ? 409 : 422;
    return errorResponse(status, entrega.code, entrega.message);
  }
  return jsonResponse({
    gerar_foto: entrega.gerar_foto, conferir: entrega.conferir, provider: resposta.provider, model: resposta.model,
  });
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.piece_id === 'string' ? body.piece_id : '';
    const index = Number(body.index);
    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(index) || index < 0) {
      return errorResponse(400, 'invalid_input', 'Slide inválido.');
    }
    const service = createServiceClient();
    const { data } = await service.from('content_pieces')
      .select('id, status, channel_type, adapted_content, core_content, updated_at').eq('id', id).maybeSingle();
    const peca = data as Peca | null;
    if (!peca) return errorResponse(404, 'not_found', 'Peça não encontrada.');
    if (!formatoDoCanal(peca.channel_type)) {
      return errorResponse(400, 'invalid_input', 'Este formato ainda não edita por slide.');
    }
    if (body.action === 'cancelar_pedido') return await cancelarPedido(service, peca);
    if ((peca.adapted_content.slide_images_job as { status?: string } | undefined)?.status === 'running') {
      return errorResponse(409, 'busy', 'Espere as fotos terminarem de gerar.');
    }
    if (ENCERRADAS.includes(peca.status)) {
      return errorResponse(409, 'invalid_state', 'Peça rejeitada ou arquivada não edita. Gere uma nova versão.');
    }
    if (peca.status !== 'draft' && body.confirmar !== true) {
      return errorResponse(409, 'needs_confirm', 'Esta peça já saiu da revisão. Confirme a edição.');
    }

    if (body.action === 'desfazer') return await desfazer(service, peca, index);

    const instrucao = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instrucao) return errorResponse(400, 'invalid_input', 'Diga o que mudar neste slide.');
    if (instrucao.length > INSTRUCAO_MAX) return errorResponse(400, 'invalid_input', 'Pedido longo demais.');
    const limitado = await enforceRateLimit(user.id, 'regenerate-piece');
    if (limitado) return limitado;
    if (body.pedir_ao_claude === true) return await pedirAoClaude(service, peca, index, instrucao);
    return await editar(service, peca, index, instrucao);
  } catch (err) {
    console.error('[edit-slide] falhou:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    if (err instanceof LlmError) return errorResponse(err.status, err.code, err.message);
    return errorResponse(500, 'internal', 'Não deu para editar. Tente de novo.');
  }
});

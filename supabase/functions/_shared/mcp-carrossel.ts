// _shared/mcp-carrossel.ts — carrossel escrito pelo Claude da pessoa, pelo conector.
// Sem LLM do servidor: valida com as regras do escritor e grava o rascunho no formato
// da saga. Grounding e juiz dependem do LLM, então a peça entra sem eles e os chips
// da revisão ficam pendentes.

import { normalizeArt } from './carousel-art.ts';
import { CARROSSEL_RECEITA } from './carrossel-receita.ts';
import { STATUS_DO_PEDIDO } from './claude-rotina.ts';
import { checkWrittenCarousel, type WrittenCarousel, type WrittenSlide } from './editorial-carousel.ts';
import { lintText } from './linter.ts';
import { shortHash } from './heygen.ts';
import { ENGINE_VERSION, type CoreContent, type GuardrailsContent, type PersonaContent } from './types.ts';
import type { createServiceClient } from './supabase.ts';

type Service = ReturnType<typeof createServiceClient>;
type Args = Record<string, unknown>;

const CANAL = 'instagram_carousel';
const TEMA_MAX = 300;
const LEGENDA_MAX = 2200;

export const CARROSSEL_CRIAR_TOOL = {
  description:
    'O caminho para você mesmo escrever um carrossel no padrão da casa, sem gerar pela plataforma. Sem cover nem ' +
    'slides, devolve a receita: chame assim primeiro. Com o conteúdo (cover, slides e cta), confere as regras e grava como RASCUNHO na ' +
    'fila de revisão. Se vier a lista de problemas, nada foi gravado: corrija e chame de novo. Fotos entram depois ' +
    'por carrossel_fotos. Este conector não aprova nem publica.',
  inputSchema: {
    type: 'object',
    properties: {
      pedido_id: { type: 'string', description: 'O pedido de conteudo_pedidos que esta peça atende' },
      tema: { type: 'string', description: 'O assunto, em uma frase' },
      legenda: { type: 'string', description: 'Legenda do post no Instagram' },
      cover: {
        type: 'object',
        properties: {
          headline: { type: 'string', description: 'Gancho; a virada com o número vai entre **dois asteriscos**' },
          image_brief: { type: 'string', description: 'A foto que a capa pede' },
        },
        required: ['headline'],
        additionalProperties: false,
      },
      slides: {
        type: 'array',
        description: 'Os cards depois da capa, em ordem',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            paragraphs: { type: 'array', items: { type: 'string' } },
            visual: { type: 'string', enum: ['photo', 'chart', 'none'] },
            image_brief: { type: 'string', description: 'A foto que este card pede' },
            chart: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                bars: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      value: { type: 'number' },
                      fonte: { type: 'string', description: 'De onde veio o número. Obrigatória se ele não estiver em material' },
                    },
                    required: ['label', 'value'],
                    additionalProperties: false,
                  },
                },
                highlight: { type: 'number', description: 'Barra em destaque; sem isso, a última' },
              },
              required: ['label', 'bars'],
              additionalProperties: false,
            },
          },
          required: ['title', 'paragraphs', 'visual'],
          additionalProperties: false,
        },
      },
      cta: {
        type: 'object',
        description: 'O card final: a tese, o próximo passo e o botão',
        properties: {
          title: { type: 'string', description: 'A tese em uma frase curta, até 60 caracteres' },
          paragraph: { type: 'string', description: 'O próximo passo, até 160 caracteres' },
          button: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['whatsapp', 'direct', 'site', 'perfil'] },
              label: { type: 'string', description: 'Texto do botão, 2 a 4 palavras, até 28 caracteres' },
            },
            required: ['kind', 'label'],
            additionalProperties: false,
          },
        },
        required: ['title', 'paragraph', 'button'],
        additionalProperties: false,
      },
      material: { type: 'string', description: 'Texto de onde saíram os números, se houver' },
      fontes: { type: 'array', items: { type: 'string' }, description: 'Fontes da história, para quem revisa' },
    },
    additionalProperties: false,
  },
} as const;

async function ativo<T>(service: Service, tabela: 'brand_persona' | 'brand_strategy' | 'guardrails' | 'brand_kit') {
  const { data } = await service.from(tabela).select('content, version').eq('status', 'active').maybeSingle();
  return data as { content: T; version: number } | null;
}

/** Linha em `content_pieces`: mesmo formato da saga, sem as auditorias que dependem de LLM. */
export function pecaDoCarrossel(entrada: {
  jobId: string;
  tema: string;
  legenda: string;
  slides: unknown[];
  headline: string;
  fontes: unknown[];
  violacoes: unknown[];
  versoes: { persona: number; strategy: number; guardrails: number; brandKit: number | null };
}) {
  const core: CoreContent = {
    idea: entrada.tema,
    hook: { visual: '', written: entrada.headline.replace(/\*\*/g, '') },
    funnel_blocks: [],
    proof: { claim: '', context_item_id: null },
    verify_flags: [],
    cta: '',
    image_brief: null,
  };
  return {
    job_id: entrada.jobId,
    channel_type: CANAL,
    core_content: core,
    adapted_content: {
      channel_type: CANAL,
      slides: entrada.slides,
      caption: entrada.legenda,
      ...(entrada.fontes.length ? { fontes: entrada.fontes } : {}),
    },
    audit: { linter: { passed: true, violations: entrada.violacoes } },
    status: 'draft',
    persona_version: entrada.versoes.persona,
    strategy_version: entrada.versoes.strategy,
    guardrails_version: entrada.versoes.guardrails,
    brand_kit_version: entrada.versoes.brandKit,
    engine_version: ENGINE_VERSION,
    context_ids: [],
  };
}

export async function carrosselCriar(service: Service, args: Args): Promise<Record<string, unknown> | string> {
  if (!args.cover && !args.slides) return { receita: CARROSSEL_RECEITA };

  const tema = String(args.tema ?? '').trim();
  const legenda = String(args.legenda ?? '').trim();
  if (!tema || tema.length > TEMA_MAX) return `Diga o tema em até ${TEMA_MAX} caracteres.`;
  if (!legenda || legenda.length > LEGENDA_MAX) return `Escreva a legenda em até ${LEGENDA_MAX} caracteres.`;

  const { data: canal } = await service.from('channels').select('type').eq('type', CANAL).eq('enabled', true).maybeSingle();
  if (!canal) return 'Carrossel desligado nesta instância. Ligue em Marca > Canais.';

  const [persona, strategy, guardrails, brandKit] = await Promise.all([
    ativo<PersonaContent>(service, 'brand_persona'),
    ativo<unknown>(service, 'brand_strategy'),
    ativo<GuardrailsContent>(service, 'guardrails'),
    ativo<{ art?: unknown }>(service, 'brand_kit'),
  ]);
  if (!persona || !strategy || !guardrails) return 'A marca ainda não tem persona, estratégia e regras ativas.';
  if (normalizeArt(brandKit?.content?.art).layout !== 'editorial') {
    return 'O design system desta marca não usa o layout editorial, então este padrão não se aplica. Use gerar_conteudo.';
  }

  const escrito: WrittenCarousel = {
    cover: (args.cover ?? {}) as WrittenCarousel['cover'],
    slides: (args.slides ?? []) as WrittenSlide[],
    ...(args.cta && typeof args.cta === 'object' ? { cta: args.cta as WrittenCarousel['cta'] } : {}),
  };
  const conferido = checkWrittenCarousel(escrito, {
    guardrails: guardrails.content,
    signatureLexicon: persona.content.signature_lexicon,
    material: typeof args.material === 'string' ? args.material : '',
  });
  const lint = lintText({
    text: legenda,
    guardrails: guardrails.content,
    channel_type: CANAL,
    signature_lexicon: persona.content.signature_lexicon,
  });
  const problemas = [
    ...conferido.problemas,
    ...lint.violations.filter((v) => v.severity === 'error').map((v) => `Legenda: quebra a regra da marca ${v.rule}: "${v.match}".`),
  ];
  if (problemas.length) return { gravado: false, problemas };

  // repetir a mesma chamada devolve a mesma peça
  const assinatura = shortHash(JSON.stringify({ tema, legenda, escrito }));
  const { data: anterior } = await service.from('generation_jobs').select('id')
    .eq('timings->>conector_carrossel', assinatura).limit(1).maybeSingle();
  if (anterior) {
    const { data: peca } = await service.from('content_pieces').select('id').eq('job_id', (anterior as { id: string }).id).limit(1).maybeSingle();
    if (peca) return { peca_id: (peca as { id: string }).id, aviso: 'Este carrossel já foi criado.' };
  }

  // pedido feito na tela: a peça entra no mesmo job, e a pessoa é avisada por ele
  const pedidoId = typeof args.pedido_id === 'string' ? args.pedido_id : '';
  const { data: aberto } = pedidoId
    ? await service.from('generation_jobs').select('id, timings')
      .eq('id', pedidoId).in('status', STATUS_DO_PEDIDO).not('timings->pedido_claude', 'is', null).maybeSingle()
    : { data: null };
  const pedido = aberto as { id: string; timings: Record<string, unknown> } | null;
  if (pedidoId) {
    if (!pedido) return 'Este pedido não está mais aberto. Veja conteudo_pedidos.';
  }
  const { data: job, error: erroJob } = pedido
    ? await service.from('generation_jobs').update({
      status: 'awaiting_review', timings: { ...pedido.timings, conector_carrossel: assinatura },
    }).eq('id', pedido.id).select('id').single()
    : await service.from('generation_jobs').insert({
      prompt: tema, status: 'awaiting_review', timings: { conector_carrossel: assinatura },
    }).select('id').single();
  if (erroJob || !job) return `Não deu para criar: ${erroJob?.message ?? 'sem id'}`;

  const headline = conferido.slides[0].text;
  const fontesGerais = (Array.isArray(args.fontes) ? args.fontes : []).map((f) => String(f).trim()).filter(Boolean);
  const { data: peca, error } = await service.from('content_pieces').insert(pecaDoCarrossel({
    jobId: (job as { id: string }).id, tema, legenda, headline, slides: conferido.slides,
    fontes: [...conferido.fontes, ...fontesGerais.map((fonte) => ({ fonte }))],
    violacoes: lint.violations,
    versoes: { persona: persona.version, strategy: strategy.version, guardrails: guardrails.version, brandKit: brandKit?.version ?? null },
  })).select('id').single();
  if (error || !peca) {
    if (pedido) await service.from('generation_jobs').update({ status: 'generating', timings: pedido.timings }).eq('id', pedido.id);
    else await service.from('generation_jobs').delete().eq('id', (job as { id: string }).id);
    return `Não deu para criar: ${error?.message ?? 'sem id'}`;
  }

  const fotos = conferido.slides.filter((s) => s.visual === 'photo').map((s) => ({ indice: s.index, cena: s.image_brief ?? null }));
  const pecaId = (peca as { id: string }).id;
  return {
    peca_id: pecaId,
    fotos_pendentes: fotos,
    proximo: 'Desenhe a arte de cada card: veja artes_pendentes e envie em arte_enviar. Aprovar e publicar são só na tela.',
  };
}

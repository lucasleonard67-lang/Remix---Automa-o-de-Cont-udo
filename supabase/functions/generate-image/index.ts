// generate-image — imagem IA de uma peça (ou de um brief avulso) no bucket `renders`.
// Contrato: docs/07-contratos-backend.md §3.5 e §6 ("divisão de responsabilidade no render").
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.generate-image] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9)
//
// POST { piece_id }                                → 200 { path, signed_url }
// POST { image_brief }                             → 200 { path, signed_url }   (brief avulso)
// POST { piece_id, scope: 'slides', slide_indexes? } → 200 { started: true, total }
//
// scope 'slides' (carrossel): direção de arte em UMA chamada LLM (style bible +
// brief por slide, consistência visual do deck) e geração das fotos em BACKGROUND
// (EdgeRuntime.waitUntil) — progresso em adapted_content.slide_images_job e paths
// em adapted_content.slides[i].image_path, acompanhados via Realtime (UPDATE em
// content_pieces). Cada imagem consome 1 unidade do rate limit generate-image.
// slide_indexes regenera só os slides pedidos (reusa o brief salvo no slide).
// Sem slide_indexes: carrossel gera SÓ a capa (o miolo é render do design system
// e descartaria a foto); stories/post geram todas as unidades, que exibem foto.
//
// REGRA INEGOCIÁVEL (07 §6): o tweet-card é render CLIENT-SIDE determinístico
// (React + tokens do brand kit → PNG, upload direto do frontend, path em
// content_pieces.render_path). Esta função gera EXCLUSIVAMENTE imagens de IA
// (insumo do card) — nunca desenha card e NUNCA escreve em render_path.
// Com piece_id (single), o path é mesclado em adapted_content.image_path.
//
// Prompt = brief (+ style bible no batch) + brand_kit.negative_constraints[] +
// direção visual do adapter (aspect ratio do canal). O provider vem do papel
// 'image' do resolveProvider; a direção de arte usa o papel 'generator'.

import {
  COVER_ART_SCHEMA,
  artPhotoDirection,
  artUsesPhoto,
  buildCoverPrompt,
  normalizeArt,
  type CarouselArt,
  type CoverArt,
} from '../_shared/carousel-art.ts';
import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { chat, generateImage, LlmError, semApiPaga } from '../_shared/llm.ts';
import { getAdapter } from '../_shared/adapters/base.ts';
import { aspectoDaFoto, type AspectoDaFoto } from '../_shared/fotos-automaticas.ts';
import type { AspectRatio } from '../_shared/render-spec.ts';
import type {
  BrandKitContent,
  ChannelType,
  CoreContent,
  SlideImageComposition,
  SlideImagesJob,
  StoryFrame,
  TweetCardSlide,
} from '../_shared/types.ts';
// deploy: 3adc0bb — capa como peça de arte (cover_art + gemini-3-pro-image)

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const RENDERS_BUCKET = 'renders';
/** Validade da signed URL devolvida ao frontend. */
const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_BRIEF_CHARS = 4000;
/** Imagens geradas em paralelo no batch (gateway aguenta; DB write é serializado). */
const BATCH_CONCURRENCY = 2;
/** Um batch `running` mais velho que isto é considerado morto (pode reiniciar). */
const BATCH_STALE_MINUTES = 10;

/** Tamanhos aceitos pela família gpt-image, por aspect ratio do canal. */
const SIZE_BY_ASPECT: Record<AspectoDaFoto, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
  '4:3': '1536x1024',
};

interface GenerateImageRequest {
  piece_id?: unknown;
  image_brief?: unknown;
  scope?: unknown;
  slide_indexes?: unknown;
  composition?: unknown;
}

interface PieceRow {
  id: string;
  channel_type: ChannelType;
  core_content: CoreContent | null;
  adapted_content: Record<string, unknown> | null;
}

import { requireDrive } from '../_shared/drive-gate.ts';
import { CONECTOR_USUARIO, usuarioDoConector } from '../_shared/conector-interno.ts';

async function atender(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    const conector = await usuarioDoConector(req, createServiceClient());
    const user = conector ? { id: conector } : await getUser(req);
    if (!user) {
      return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    }

    const semDrive = await requireDrive(createServiceClient(), 'generate-image');
    if (semDrive) return semDrive;

    let body: GenerateImageRequest;
    try {
      body = (await req.json()) as GenerateImageRequest;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
    const rawBrief = typeof body.image_brief === 'string' ? body.image_brief.trim() : '';

    // ── Batch de fotos por slide (carrossel) ────────────────────────────────
    if (body.scope === 'slides') {
      if (!pieceId) {
        return errorResponse(400, 'invalid_input', "scope 'slides' exige piece_id.");
      }
      if (
        body.composition !== undefined &&
        body.composition !== 'background' &&
        body.composition !== 'inline'
      ) {
        return errorResponse(400, 'invalid_input', "composition deve ser 'background' ou 'inline'.");
      }
      const composition = (body.composition ?? 'background') as SlideImageComposition;
      return await startSlidesBatch(user.id, pieceId, body.slide_indexes, composition);
    }

    // ── Caminho single (inalterado): 1 imagem por chamada ───────────────────
    // Cota por usuário: esta operação gasta crédito de IA (migration 202607300013).
    const limited = await enforceRateLimit(user.id, 'generate-image');
    if (limited) return limited;

    // Exatamente um dos dois campos (07 §3.5).
    if (pieceId && rawBrief) {
      return errorResponse(
        400,
        'invalid_input',
        'Envie piece_id OU image_brief — nunca os dois.',
      );
    }
    if (!pieceId && !rawBrief) {
      return errorResponse(400, 'invalid_input', 'Envie piece_id ou image_brief.');
    }
    if (rawBrief.length > MAX_BRIEF_CHARS) {
      return errorResponse(
        400,
        'invalid_input',
        `image_brief acima do limite de ${MAX_BRIEF_CHARS} caracteres.`,
      );
    }

    const service = createServiceClient();

    // ── Resolve o brief e o aspect ratio ────────────────────────────────────
    let brief = rawBrief;
    let piece: PieceRow | null = null;
    let aspect: AspectRatio = '1:1';

    if (pieceId) {
      const loaded = await loadPiece(service, pieceId);
      if (loaded instanceof Response) return loaded;
      piece = loaded;

      const pieceBrief = piece.core_content?.image_brief;
      if (typeof pieceBrief !== 'string' || pieceBrief.trim().length === 0) {
        return errorResponse(
          400,
          'invalid_input',
          'Esta peça não tem image_brief no core_content — o formato não pede imagem de IA.',
        );
      }
      brief = pieceBrief.trim();
      aspect = resolveAspect(piece.channel_type);
    }

    const negativeConstraints = await loadNegativeConstraints(service);
    const prompt = buildPrompt(brief, await loadReferenceDirection(service), negativeConstraints, aspect);

    // ── Geração ─────────────────────────────────────────────────────────────
    const image = await generateImage({ prompt, size: SIZE_BY_ASPECT[aspect] });
    const bytes = decodeBase64(image.b64);
    if (bytes.length === 0) {
      return errorResponse(502, 'provider_error', 'O modelo de imagem retornou um payload vazio.');
    }

    // ── Upload no bucket privado `renders` (service role) ───────────────────
    // Path: {piece_id}/ai-image-{ts}.png — a política renders_insert_authenticated
    // exige que a primeira pasta seja um piece_id existente; o service role
    // bypassa RLS, por isso o prefixo 'briefs/' (brief avulso) é legal aqui e
    // não seria por upload direto do client.
    const path = `${pieceId || 'briefs'}/ai-image-${Date.now()}.png`;
    const uploadError = await uploadPng(service, path, bytes);
    if (uploadError) {
      console.error('[generate-image] falha no upload:', uploadError);
      return errorResponse(500, 'internal_error', 'Falha ao gravar a imagem no bucket renders.');
    }

    const { data: signed, error: signError } = await service.storage
      .from(RENDERS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      console.error('[generate-image] falha ao assinar a URL:', signError?.message);
      return errorResponse(500, 'internal_error', 'Imagem gravada, mas falhou ao gerar a signed URL.');
    }

    // ── Merge do path na peça (nunca em render_path — ver cabeçalho) ────────
    // Patch SÓ da chave image_path: snapshot do adapted_content inteiro
    // perderia escritas concorrentes (batch de fotos, export do frontend).
    if (piece) {
      const mergeError = await mergeAdapted(service, piece.id, { image_path: path });
      if (mergeError) {
        // A imagem existe no bucket e o path volta na resposta: não é erro fatal.
        console.error('[generate-image] falha ao gravar image_path na peça:', mergeError);
      }
    }

    console.info(
      `[generate-image] ${image.provider}/${image.model} → ${path} (${bytes.length} bytes)`,
    );
    return jsonResponse({ path, signed_url: signed.signedUrl });
  } catch (err) {
    if (err instanceof LlmError) {
      // 402 credits_exhausted · 429 rate_limited · 502 provider_error · 500 invalid_config
      return errorResponse(err.status, err.code, err.message);
    }
    console.error('[generate-image] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao gerar a imagem.');
  }
}

// pelo conector, a imagem nunca sai de chave de API
Deno.serve((req: Request) => (req.headers.has(CONECTOR_USUARIO) ? semApiPaga(() => atender(req)) : atender(req)));

// ── Batch de fotos por slide (carrossel) ─────────────────────────────────────

/**
 * Valida o pedido, roda a direção de arte (1 chamada LLM) e dispara a geração
 * das fotos em background. Resposta imediata; progresso via Realtime.
 */
async function startSlidesBatch(
  userId: string,
  pieceId: string,
  rawIndexes: unknown,
  composition: SlideImageComposition,
): Promise<Response> {
  const service = createServiceClient();
  const loaded = await loadPiece(service, pieceId);
  if (loaded instanceof Response) return loaded;
  const piece = loaded;

  const target = slideTargetsFor(piece);
  if (!target) {
    return errorResponse(
      400,
      'invalid_input',
      "scope 'slides' só se aplica a canais de card: instagram_carousel, instagram_stories e instagram_post.",
    );
  }
  // `photo_slot: 'none'` significa SEM FOTOGRAFIA NO MIOLO — não "sem capa".
  // A distinção passou a existir quando a capa virou peça de arte com
  // tipografia própria: um design system gráfico continua querendo capa, ela é
  // que não é uma foto. Então em vez de recusar o lote inteiro, o alvo encolhe
  // para a capa; só quando o pedido é exclusivamente de miolo é que sobra 409.
  const brandArt = await loadBrandArt(service);
  const soCapa = target.key === 'slides' && !artUsesPhoto(brandArt);

  const adapted = (piece.adapted_content ?? {}) as { slide_images_job?: SlideImagesJob };
  const slides = target.units;
  if (slides.length === 0) {
    return errorResponse(409, 'invalid_state', 'Esta peça não tem unidades adaptadas para fotos.');
  }

  // slide_indexes: subconjunto explícito (retry pontual) ou todos os slides.
  let targets: number[];
  if (rawIndexes !== undefined) {
    if (
      !Array.isArray(rawIndexes) ||
      rawIndexes.some((i) => typeof i !== 'number' || !Number.isInteger(i)) ||
      rawIndexes.length === 0
    ) {
      return errorResponse(400, 'invalid_input', 'slide_indexes deve ser uma lista de inteiros.');
    }
    const valid = new Set(slides.map((s) => s.index));
    const bad = (rawIndexes as number[]).filter((i) => !valid.has(i));
    if (bad.length > 0) {
      return errorResponse(400, 'invalid_input', `Slides inexistentes: ${bad.join(', ')}.`);
    }
    targets = [...new Set(rawIndexes as number[])].sort((a, b) => a - b);
  } else if (target.key === 'slides') {
    // CARROSSEL: só a CAPA por padrão.
    //
    // O render do carrossel usa a foto exclusivamente no slide 0
    // (`useCoverPhoto = isCover && Boolean(imageUrl)`); o miolo é fundo sólido
    // do design system, por regra da casa. Gerar foto para os slides 2..N era
    // pagar arte que a tela descarta — medido: 10 geradas, 1 exibida.
    // Miolo só ganha foto quando o usuário promove um slide (slide_indexes) —
    // ou quando o carrossel editorial já nasceu com a foto pedida no slide
    // (`visual: 'photo'` + `photo_promoted`), que é o que a tela vai exibir.
    targets = slides
      .filter((s, i) => i === 0 || (s as { photo_promoted?: boolean }).photo_promoted === true)
      .map((s) => s.index);
  } else {
    // Stories e post exibem a foto de TODAS as unidades — o lote inteiro vale.
    targets = slides.map((s) => s.index).sort((a, b) => a - b);
  }

  // Design system gráfico: a capa continua (ela é arte, não foto), o miolo não.
  if (soCapa) {
    const capa = slides[0]?.index;
    const restou = capa === undefined ? [] : targets.filter((i) => i === capa);
    if (restou.length === 0) {
      return errorResponse(
        409,
        'system_without_photo',
        'O design system da marca não usa fotografia no miolo do carrossel — só a capa leva arte. Mude o lugar da foto em Marca > Brand kit para liberar os demais slides.',
      );
    }
    targets = restou;
  }

  // Mudou o alvo de composição? Briefs e style bible do batch anterior foram
  // dirigidos para o OUTRO modo (fundo limpo × cena detalhada) — descarta para
  // a direção de arte rodar de novo no alvo certo.
  const previousComposition = adapted.slide_images_job?.composition ?? 'background';
  if (previousComposition !== composition) {
    for (const slide of slides) delete slide.image_brief;
  }

  // ── Claim ATÔMICO do batch, ANTES de qualquer trabalho caro ───────────────
  // claim_slide_images_batch (migration 15) é um update condicional: só passa
  // se não há batch `running` fresco. Check-then-act em memória teria janela
  // de segundos (a direção de arte é uma chamada LLM) — duas abas gerariam
  // tudo em dobro.
  const job: SlideImagesJob = {
    status: 'running',
    total: targets.length,
    done: 0,
    composition,
    style_bible: previousComposition === composition
      ? (adapted.slide_images_job?.style_bible ?? '')
      : '',
    started_at: new Date().toISOString(),
  };
  const { data: claimed, error: claimError } = await service.rpc('claim_slide_images_batch', {
    _piece_id: piece.id,
    _job: job,
    _stale_minutes: BATCH_STALE_MINUTES,
  });
  if (claimError) {
    return errorResponse(500, 'internal_error', `Falha ao iniciar o batch: ${claimError.message}`);
  }
  if (claimed !== true) {
    return errorResponse(
      409,
      'invalid_state',
      'Já existe uma geração de fotos em andamento para esta peça.',
    );
  }

  // Deste ponto em diante o claim é nosso: qualquer falha precisa soltá-lo
  // (status 'error') para não travar a peça por BATCH_STALE_MINUTES.
  const releaseClaim = async (message: string): Promise<void> => {
    job.status = 'error';
    job.ended_at = new Date().toISOString();
    job.error = message;
    await mergeAdapted(service, piece.id, { slide_images_job: job });
  };

  try {
    const brandVisual = await loadBrandVisual(service, brandArt);

    // ── Direção de arte: garante brief por slide + style bible comum ────────
    // Reusa briefs já salvos nos slides (retry não redireciona a arte); só
    // chama o LLM quando algum slide alvo está sem brief.
    const missing = targets.filter((i) => {
      const s = slides.find((x) => x.index === i);
      return !s?.image_brief?.trim();
    });
    // ...MAS a capa tem contrato próprio (`cover_art`), que não existia antes.
    // MEDIDO: numa peça que já rodara um lote, os briefs e a style bible já
    // estavam salvos, a direção de arte era pulada e a capa caía calada no
    // caminho antigo — a arte com tipografia simplesmente nunca acontecia na
    // maioria das peças. Faltando a direção da capa, o LLM roda de novo.
    const capaIndex = slides[0]?.index;
    const capaNoAlvo = capaIndex !== undefined && targets.includes(capaIndex);
    const semDirecaoDaCapa = capaNoAlvo && !job.cover_art?.headline;
    if (missing.length > 0 || !job.style_bible || semDirecaoDaCapa) {
      const direction = await directArt(
        piece, slides, brandVisual, composition, brandArt.layout === 'editorial' ? '16:9' : target.aspect,
      );
      job.style_bible = direction.style_bible;
      // guardada no job: um retry pontual não pode redirigir a capa
      if (direction.cover_art.headline) job.cover_art = direction.cover_art;
      for (const b of direction.briefs) {
        const slide = slides.find((s) => s.index === b.index);
        if (slide && !slide.image_brief?.trim()) slide.image_brief = b.brief;
      }
    }

    const stillMissing = targets.filter(
      (i) => !slides.find((s) => s.index === i)?.image_brief?.trim(),
    );
    if (stillMissing.length > 0) {
      await releaseClaim(`Direção de arte não cobriu os slides ${stillMissing.join(', ')}.`);
      return errorResponse(
        502,
        'provider_error',
        `A direção de arte não cobriu os slides ${stillMissing.join(', ')} — tente de novo.`,
      );
    }

    // Briefs + style bible persistidos (patch só das NOSSAS chaves).
    const startError = await mergeAdapted(service, piece.id, targetPatch(target, job));
    if (startError) {
      await releaseClaim(`Falha ao persistir a direção de arte: ${startError}`);
      return errorResponse(500, 'internal_error', `Falha ao iniciar o batch: ${startError}`);
    }
  } catch (err) {
    const message = err instanceof LlmError ? err.message : 'Falha na direção de arte.';
    await releaseClaim(message);
    if (err instanceof LlmError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }

  const task = runSlidesBatch(
    service,
    userId,
    piece.id,
    target,
    job,
    targets,
    brandArt,
  ).catch(
    async (err) => {
      console.error(`[generate-image] batch da peça ${piece.id} falhou:`, err);
      await releaseClaim('Falha inesperada no batch de fotos.').catch(() => {});
    },
  );
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
    EdgeRuntime.waitUntil(task);
  } else {
    void task;
  }

  return jsonResponse({ started: true, total: targets.length, piece_id: piece.id });
}

/** Patch de topo em adapted_content via RPC (nunca snapshot — lost update). */
async function mergeAdapted(
  service: ReturnType<typeof createServiceClient>,
  pieceId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await service.rpc('merge_piece_adapted_content', {
    _piece_id: pieceId,
    _patch: patch,
  });
  if (error) return error.message;
  if (data !== true) return 'peça não encontrada para o merge';
  return null;
}

/**
 * Gera as fotos dos slides alvo com concorrência limitada. Escritas no banco são
 * SERIALIZADAS (uma promise-chain) e sempre PATCHES de topo (slides +
 * slide_images_job via merge_piece_adapted_content) — nunca snapshot do
 * adapted_content inteiro, que perderia escritas concorrentes de outros
 * escritores (export do frontend em slide_renders, imagem única em image_path).
 * Cada imagem consome 1 unidade do rate limit.
 */
async function runSlidesBatch(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  pieceId: string,
  target: SlideTarget,
  job: SlideImagesJob,
  targets: number[],
  /** Arte da marca — decide a linguagem fotográfica. */
  art: CarouselArt,
): Promise<void> {
  const slides = target.units;
  const brandVisual = await loadBrandVisual(service, art);
  const failed: number[] = [];
  let fatal: string | null = null;

  // Fila de escrita: cada persist envia o patch das chaves do batch, em ordem.
  let writeChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    writeChain = writeChain.then(async () => {
      const error = await mergeAdapted(service, pieceId, targetPatch(target, job));
      if (error) console.error(`[generate-image] batch ${pieceId}: falha ao persistir:`, error);
    });
    return writeChain;
  };

  const queue = [...targets];
  const worker = async (): Promise<void> => {
    while (queue.length > 0 && !fatal) {
      const index = queue.shift();
      if (index === undefined) return;
      const slide = slides.find((s) => s.index === index);
      const brief = slide?.image_brief?.trim();
      if (!slide || !brief) {
        failed.push(index);
        continue;
      }
      try {
        // 1 unidade de cota POR IMAGEM (o teto subiu para 60/h na migration 15).
        const limited = await enforceRateLimit(userId, 'generate-image');
        if (limited) {
          fatal = 'Rate limit de imagens atingido no meio do batch — tente os slides restantes mais tarde.';
          failed.push(index, ...queue.splice(0));
          break;
        }
        // A CAPA é outra coisa: peça de arte fechada, com a manchete
        // tipografada pelo próprio modelo. O miolo segue brief de foto, sem
        // texto — modelo escrevendo em dez slides seguidos erra ortografia em
        // série, e o chassi já desenha o miolo melhor do que ele.
        const ehCapa = target.key === 'slides' && index === 0;
        // No layout EDITORIAL (o padrão da casa) a capa é FOTO pura: a
        // manchete, a assinatura e o "Arrasta pro lado" são desenhados pelo
        // chassi por cima (docs/carrossel-editorial.md). Capa tipografada
        // pelo modelo aqui saía com o texto dentro da imagem e faixas pretas
        // (o gateway ignora o tamanho pedido) — a "imagem cortada no meio".
        const capaComTipo =
          ehCapa && Boolean(job.cover_art?.headline) && art.layout !== 'editorial';
        // O editorial exibe a foto numa caixa própria: gerar em outro formato é pedir corte.
        const aspecto: AspectoDaFoto = art.layout === 'editorial' ? aspectoDaFoto(target.key, index) : target.aspect;
        const prompt = capaComTipo
          ? buildCoverPrompt({
              cover: job.cover_art!,
              art,
              paletteDesc: brandVisual.paletteDesc,
              negativeConstraints: brandVisual.negativeConstraints,
              typography: brandVisual.typography,
              aspect: target.aspect,
              brandName: brandVisual.brandName,
            })
          : buildPrompt(
              brief,
              job.style_bible || null,
              brandVisual.negativeConstraints,
              aspecto,
              job.composition ?? 'background',
              ehCapa,
              brandVisual.paletteDesc,
              brandVisual.systemPhotoDirection,
            );
        const image = await generateImage({ prompt, size: SIZE_BY_ASPECT[aspecto] });
        const bytes = decodeBase64(image.b64);
        if (bytes.length === 0) throw new Error('payload de imagem vazio');

        const path = `${pieceId}/slide-${index}-${Date.now()}.png`;
        const uploadError = await uploadPng(service, path, bytes);
        if (uploadError) throw new Error(uploadError);

        slide.image_path = path;
        // A marca vai no ARTEFATO, não no papel do slide: se o modelo recusar
        // ou a peça for antiga, ela fica false e o chassi desenha o texto como
        // sempre desenhou. Slide em branco nunca é o resultado.
        if (ehCapa) (slide as { cover_art_rendered?: boolean }).cover_art_rendered = capaComTipo;
        // Unidade fora da capa gerada sob demanda: marca a promoção para o render
        // exibi-lo. Sem a marca, a regra da casa mantém o miolo em fundo sólido
        // — e carrosséis antigos, que têm foto em todos, seguem como estão.
        if (target.key === 'card' || index !== 0) {
          (slide as TweetCardSlide).photo_promoted = true;
        }
        job.done += 1;
        await persist();
        console.info(`[generate-image] batch ${pieceId}: slide ${index} → ${path}`);
      } catch (err) {
        failed.push(index);
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[generate-image] batch ${pieceId}: slide ${index} falhou:`, detail);
        if (err instanceof LlmError && (err.code === 'credits_exhausted' || err.code === 'invalid_config')) {
          // Sem créditos/config: os próximos slides falhariam igual — aborta o resto.
          fatal = err.message;
          failed.push(...queue.splice(0));
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, targets.length) }, () => worker()),
  );

  job.status = failed.length === 0 ? 'done' : 'error';
  job.ended_at = new Date().toISOString();
  if (failed.length > 0) {
    job.failed_indexes = [...new Set(failed)].sort((a, b) => a - b);
    job.error =
      fatal ??
      `Falha ao gerar ${job.failed_indexes.length} de ${job.total} foto(s) — regenere os slides que faltaram.`;
  } else {
    delete job.failed_indexes;
    delete job.error;
  }
  await persist();
}

/** Schema do structured output da direção de arte. */
const ART_DIRECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    style_bible: {
      type: 'string',
      description:
        'Direção de arte comum a TODOS os slides: estilo (foto/ilustração), paleta emocional, iluminação, composição, lente. 2-4 frases.',
    },
    briefs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', description: 'index do slide (0-based)' },
          brief: {
            type: 'string',
            description: 'Cena visual concreta que ilustra o texto do slide. 1-2 frases, sem texto na imagem.',
          },
        },
        required: ['index', 'brief'],
      },
    },
    cover_art: COVER_ART_SCHEMA,
  },
  required: ['style_bible', 'briefs', 'cover_art'],
} as const;

interface ArtDirection {
  style_bible: string;
  briefs: Array<{ index: number; brief: string }>;
  cover_art: CoverArt;
}

/**
 * UMA chamada LLM (papel 'generator') que devolve a style bible do deck + um
 * brief visual por slide, DIRIGIDA pelo alvo de composição:
 * - 'background': a foto fica ATRÁS do texto → fundo LIMPO de marca (atmosfera,
 *   espaço negativo, baixo detalhe, paleta do brand kit) — detalhe demais polui
 *   a leitura.
 * - 'inline': a foto vive num bloco PRÓPRIO abaixo do texto → cena concreta e
 *   rica em detalhe funciona.
 * Sob demanda, fora da saga (06 §3 — nenhum modelo de imagem/direção no
 * caminho crítico da geração de texto).
 */
async function directArt(
  piece: PieceRow,
  slides: SlideUnit[],
  brandVisual: BrandVisual,
  composition: SlideImageComposition,
  aspect: AspectoDaFoto,
): Promise<ArtDirection> {
  const idea = piece.core_content?.idea ?? '';
  const hook = piece.core_content?.hook?.visual ?? '';
  const slideLines = slides
    .map((s) => {
      const role = s.role ? ` (${s.role})` : '';
      return `- slide ${s.index}${role}: ${s.text.replace(/\s+/g, ' ').slice(0, 220)}`;
    })
    .join('\n');

  const compositionRules =
    composition === 'background'
      ? 'As fotos são FUNDO full-bleed: o texto do card fica POR CIMA da imagem inteira. Cada ' +
        'brief descreve um fundo LIMPO e atmosférico: uma única cena com POUCOS elementos, ' +
        'grandes áreas suaves/desfocadas ou em sombra, muito espaço negativo, BAIXO nível de ' +
        'detalhe — nada que dispute atenção com o texto. Pense em textura, luz e atmosfera de ' +
        'marca, não em "ilustrar a frase".'
      : 'As fotos vivem num BLOCO PRÓPRIO abaixo do texto (não competem com a leitura): cada ' +
        'brief descreve UMA cena fotográfica concreta e rica que ILUSTRA o texto do slide, com ' +
        'UM sujeito principal e UMA ação.';

  const system =
    'Você é diretor de arte de conteúdo do Instagram (carrossel, stories e post). ' +
    compositionRules +
    ' Regras duras: cada brief é UMA ÚNICA cena contínua — nunca uma lista de dois ou três ' +
    'elementos (o modelo de imagem transforma listas em colagem de painéis, que é proibida); ' +
    (aspect === '16:9'
      ? 'composição HORIZONTAL, com o sujeito inteiro dentro do quadro e folga nas bordas; fotografia '
      : `composição VERTICAL (retrato ${aspect}), centro de interesse centralizado; fotografia `) +
    'cinematográfica autêntica com profundidade de campo — nada de banco de imagem corporativo ' +
    "genérico; nenhuma imagem contém texto, letra, número, logotipo ou marca d'água; TODOS os " +
    'slides seguem a MESMA direção de arte (mesma paleta, mesmo estilo, mesma luz) com cenas ' +
    'diferentes. Responda em português BR.\n\n' +
    // A CAPA é outro contrato: não é um brief de fundo, é uma peça de arte com
    // manchete tipografada pelo próprio modelo de imagem. Por isso ela sai num
    // campo separado e com regra própria.
    'A CAPA (`cover_art`) segue regra DIFERENTE dos briefs: ela é uma peça de arte fechada, ' +
    'com a manchete escrita NA imagem. Duas exigências: (1) se o conteúdo cita uma pessoa, ' +
    'empresa, produto ou lugar REAL, esse sujeito tem que estar na capa, NOMEADO — nada de ' +
    'metáfora genérica no lugar de quem o texto está falando; (2) a manchete é curta, de ' +
    'impacto, no máximo 8 palavras, em português correto e acentuado. Os briefs dos demais ' +
    'slides continuam SEM texto na imagem.' +
    (brandVisual.paletteDesc
      ? ` Paleta da marca (ancore a direção nela): ${brandVisual.paletteDesc}.`
      : '') +
    (brandVisual.negativeConstraints.length > 0
      ? ` Restrições visuais da marca (NUNCA violar): ${brandVisual.negativeConstraints.join('; ')}.`
      : '');
  const user =
    `Ideia da peça: ${idea}\n` +
    (hook ? `Gancho visual da capa: ${hook}\n` : '') +
    `Slides:\n${slideLines}\n\n` +
    'Crie: (a) a style bible do deck, (b) um brief visual por slide (todos os indexes ' +
    'listados, sem texto na imagem) e (c) a `cover_art` da capa — sujeito nomeado, manchete ' +
    'e direção.';

  const result = await chat({
    role_hint: 'generator',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: ART_DIRECTION_SCHEMA as unknown as Record<string, unknown>,
    max_tokens: 4000,
  });

  const parsed = result.parsed as Partial<ArtDirection> | undefined;
  const styleBible = typeof parsed?.style_bible === 'string' ? parsed.style_bible.trim() : '';
  const coverBruta = parsed?.cover_art;
  const coverArt: CoverArt = {
    subject: typeof coverBruta?.subject === 'string' ? coverBruta.subject.trim() : '',
    headline: typeof coverBruta?.headline === 'string' ? coverBruta.headline.trim() : '',
    art_direction:
      typeof coverBruta?.art_direction === 'string' ? coverBruta.art_direction.trim() : '',
  };
  const briefs = Array.isArray(parsed?.briefs)
    ? parsed.briefs.filter(
        (b): b is { index: number; brief: string } =>
          typeof b === 'object' && b !== null &&
          Number.isInteger((b as { index?: unknown }).index) &&
          typeof (b as { brief?: unknown }).brief === 'string' &&
          ((b as { brief: string }).brief.trim().length > 0),
      )
    : [];
  if (!styleBible || briefs.length === 0) {
    throw new LlmError('provider_error', 502, 'A direção de arte retornou um formato inválido.');
  }
  return { style_bible: styleBible, briefs, cover_art: coverArt };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Unidade fotografável de uma peça: slide (carrossel), frame (stories) ou o
 * card único (post). Todos compartilham index/text/image_brief/image_path.
 */
type SlideUnit = (TweetCardSlide | StoryFrame) & { role?: string };

interface SlideTarget {
  /** Chave de adapted_content onde as unidades vivem (patch do merge). */
  key: 'slides' | 'frames' | 'card';
  units: SlideUnit[];
  aspect: AspectRatio;
}

/** Alvo do batch por canal — null para canais sem card fotografável. */
function slideTargetsFor(piece: PieceRow): SlideTarget | null {
  const adapted = (piece.adapted_content ?? {}) as {
    slides?: TweetCardSlide[];
    frames?: StoryFrame[];
    card?: TweetCardSlide;
  };
  switch (piece.channel_type) {
    case 'instagram_carousel':
      return {
        key: 'slides',
        units: Array.isArray(adapted.slides) ? adapted.slides : [],
        aspect: '4:5',
      };
    case 'instagram_stories':
      return {
        key: 'frames',
        units: Array.isArray(adapted.frames) ? adapted.frames : [],
        aspect: '9:16',
      };
    case 'instagram_post':
      return {
        key: 'card',
        units: adapted.card ? [adapted.card] : [],
        aspect: resolveAspect(piece.channel_type),
      };
    default:
      return null;
  }
}

/** Patch de topo do batch: unidades de volta na chave certa + o job. */
function targetPatch(target: SlideTarget, job: SlideImagesJob): Record<string, unknown> {
  return target.key === 'card'
    ? { card: target.units[0], slide_images_job: job }
    : { [target.key]: target.units, slide_images_job: job };
}

/** Carrega a peça ou devolve a Response de erro pronta. */
async function loadPiece(
  service: ReturnType<typeof createServiceClient>,
  pieceId: string,
): Promise<PieceRow | Response> {
  const { data, error } = await service
    .from('content_pieces')
    .select('id, channel_type, core_content, adapted_content')
    .eq('id', pieceId)
    .maybeSingle();
  if (error) {
    console.error('[generate-image] falha ao carregar a peça:', error.message);
    return errorResponse(500, 'internal_error', 'Falha ao carregar a peça.');
  }
  if (!data) {
    return errorResponse(404, 'not_found', 'Peça não encontrada.');
  }
  return data as PieceRow;
}

async function uploadPng(
  service: ReturnType<typeof createServiceClient>,
  path: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const { error } = await service.storage
    .from(RENDERS_BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: false });
  return error ? error.message : null;
}

/** Aspect ratio do canal: default do adapter (channels.config é override de UI). */
function resolveAspect(channelType: ChannelType): AspectRatio {
  try {
    return getAdapter(channelType).aspect_ratio;
  } catch (_err) {
    return '1:1';
  }
}

interface BrandVisual {
  negativeConstraints: string[];
  /** Descrição textual da paleta ("primary #0B1B2B; accent #C9A227") para os prompts. */
  paletteDesc: string;
  /**
   * Direção FOTOGRÁFICA composta do design system da marca (brand_kit.art).
   * Sem ela a arte muda e a foto continua a mesma — a peça fica costurada.
   * Vazia quando a marca não usa foto no carrossel.
   */
  systemPhotoDirection: string;
  /** Famílias da marca — o modelo de imagem tipografa a capa "no estilo de". */
  typography: { heading: string; body: string };
  /** Nome da marca, para a assinatura discreta na capa. */
  brandName: string;
}

/** brand_kit ativo → restrições visuais + paleta (ancoram a direção de arte). */
async function loadBrandVisual(
  service: ReturnType<typeof createServiceClient>,
  /** Arte da marca já carregada (evita reler o brand_kit). */
  art?: CarouselArt | null,
): Promise<BrandVisual> {
  const { data, error } = await service
    .from('brand_kit')
    .select('content')
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) {
    return {
      negativeConstraints: [],
      paletteDesc: '',
      systemPhotoDirection: art ? artPhotoDirection(art) : '',
      typography: { heading: '', body: '' },
      brandName: '',
    };
  }
  const content = (data as { content?: Partial<BrandKitContent> | null }).content;
  const constraints = content?.negative_constraints;
  const negativeConstraints = Array.isArray(constraints)
    ? constraints.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
  const palette = content?.palette && typeof content.palette === 'object' ? content.palette : {};
  const paletteDesc = Object.entries(palette)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .slice(0, 6)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
  // A arte é da MARCA, não da peça: `brand_kit.content.art`. Peças antigas
  // ainda carregam `adapted_content.carousel_system`, que é ignorado de
  // propósito — honrá-lo faria a arte sair de um vocabulário e a foto de outro.
  const artDaMarca = art ?? normalizeArt((content as { art?: unknown })?.art);
  const tipo = (content as { typography?: { heading?: unknown; body?: unknown } })?.typography;
  return {
    negativeConstraints,
    paletteDesc,
    systemPhotoDirection: artPhotoDirection(artDaMarca),
    typography: {
      heading: typeof tipo?.heading === 'string' ? tipo.heading : '',
      body: typeof tipo?.body === 'string' ? tipo.body : '',
    },
    brandName: await loadBrandName(service),
  };
}

/** Nome da marca — persona ativa, com o onboarding como reserva (igual ao front). */
async function loadBrandName(
  service: ReturnType<typeof createServiceClient>,
): Promise<string> {
  const { data: persona } = await service
    .from('brand_persona')
    .select('content')
    .eq('status', 'active')
    .maybeSingle();
  const identity = (persona as { content?: { identity?: { name?: unknown } } } | null)?.content
    ?.identity;
  if (typeof identity?.name === 'string' && identity.name.trim()) return identity.name.trim();

  const { data: onboarding } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'onboarding')
    .maybeSingle();
  const nome = (onboarding as { value?: { brand_name?: unknown } } | null)?.value?.brand_name;
  return typeof nome === 'string' ? nome.trim() : '';
}

/** Vocabulário de arte ativo da marca. */
async function loadBrandArt(
  service: ReturnType<typeof createServiceClient>,
): Promise<CarouselArt> {
  const { data } = await service
    .from('brand_kit')
    .select('content')
    .eq('status', 'active')
    .maybeSingle();
  const content = (data as { content?: { art?: unknown } | null } | null)?.content;
  return normalizeArt(content?.art);
}

/** Compat: chamadas do caminho single só precisam das restrições. */
async function loadNegativeConstraints(
  service: ReturnType<typeof createServiceClient>,
): Promise<string[]> {
  return (await loadBrandVisual(service)).negativeConstraints;
}

/**
 * Prompt de imagem = enquadro + brief (+ style bible) + restrições da marca (07 §3.5).
 * O enquadro abre o prompt e as regras duras fecham: o modelo de imagem do
 * gateway (gemini via chat endpoint) IGNORA o parâmetro size — o formato
 * retrato precisa ser pedido no texto — e transforma briefs com lista de
 * elementos em colagem de painéis se não for proibido explicitamente.
 */
function buildPrompt(
  brief: string,
  styleBible: string | null,
  negativeConstraints: string[],
  aspect: AspectoDaFoto,
  composition: SlideImageComposition = 'inline',
  /** CAPA pede peça de impacto, não foto de apoio: é ela que para o scroll. */
  isCover = false,
  paleta = '',
  /** Direção fotográfica do sistema de carrossel em vigor. */
  systemDirection = '',
): string {
  const orientation =
    aspect === '1:1'
      ? 'Fotografia em enquadramento QUADRADO (1:1)'
      : aspect === '16:9' || aspect === '4:3'
        ? `Fotografia em formato HORIZONTAL ${aspect} (mais larga que alta)`
        : `Fotografia em formato RETRATO VERTICAL ${aspect} (mais alta que larga)`;
  const parts = [
    `${orientation}, UMA única cena contínua.`,
    brief,
  ];
  if (systemDirection) {
    // Antes da style bible de propósito: o sistema é a moldura em que a
    // direção do conjunto tem que caber, não o contrário.
    parts.push(`Linguagem fotográfica do sistema visual (obrigatória): ${systemDirection}`);
  }
  if (styleBible) {
    parts.push(`Direção de arte do conjunto (seguir à risca): ${styleBible}`);
  }
  if (isCover) {
    // A capa é a arte que segura o scroll — e o texto entra POR CIMA dela no
    // render, então ela precisa de zona calma, não de "foto bonita" genérica.
    parts.push(
      'USO: CAPA de carrossel — a primeira imagem, a que precisa parar o scroll. ' +
        'Composição de impacto, com um sujeito ou gesto visual forte e ' +
        'iluminação dramática; nada de foto de banco de imagens genérica. ' +
        'A metade INFERIOR fica calma (sombra, desfoque ou área lisa): o título ' +
        'da peça é escrito por cima dela.',
    );
    if (paleta) {
      parts.push(
        `Paleta da marca a respeitar na luz, no ambiente e nos objetos: ${paleta}. ` +
          'A cor entra pela cena — nunca como filtro chapado por cima.',
      );
    }
  }
  if (composition === 'background') {
    parts.push(
      'USO: fundo de card com texto POR CIMA da imagem inteira. Fundo LIMPO e atmosférico: ' +
        'poucos elementos, grandes áreas suaves, desfocadas ou em sombra, muito espaço ' +
        'negativo, baixo nível de detalhe — nada que dispute atenção com o texto sobreposto.',
    );
  }
  if (negativeConstraints.length > 0) {
    parts.push(`NUNCA inclua: ${negativeConstraints.join('; ')}.`);
  }
  parts.push(
    'REGRAS DURAS: uma única cena fotográfica contínua — NUNCA colagem, painéis, divisão em ' +
      'colunas, grade, moldura ou tela dividida. Sujeito principal centralizado e INTEIRO dentro do ' +
      'quadro, com cabeça e corpo visíveis e folga em todas as bordas. ' +
      "Sem texto, sem letras, sem números, sem marca d'água e sem logotipo na imagem — " +
      'o texto da peça é renderizado por cima, fora da imagem.',
  );
  return parts.join('\n\n');
}

/** base64 → bytes (o upload do storage aceita Uint8Array). */
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

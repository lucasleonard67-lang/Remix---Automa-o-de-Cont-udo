import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ChannelType } from "@/hooks/use-channels";
import { useSignedUrl } from "@/hooks/use-storage";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Tipos (espelham docs/04-modelo-de-dados.md §6.10/§6.11/§8.6/§8.8 e
// 07-contratos-backend.md §3.9 — regenerate-piece)
// ---------------------------------------------------------------------------

export const PIECE_STATUSES = ["draft", "approved", "published", "rejected", "archived"] as const;

export type PieceStatus = (typeof PIECE_STATUSES)[number];

export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  draft: "Em revisão",
  approved: "Aprovada",
  published: "Publicada",
  rejected: "Rejeitada",
  archived: "Arquivada",
};

// --- §8.6 — core_content (saída do Gerador, agnóstica de canal) -------------

export interface CoreFunnelBlock {
  layer: number;
  name: string;
  content: string;
}

export interface CoreContent {
  idea: string;
  hook: { visual: string; written: string; spoken?: string };
  funnel_blocks: CoreFunnelBlock[];
  proof: { claim: string; context_item_id: string | null; source_url?: string };
  verify_flags: string[];
  cta: string;
  image_brief: string | null;
}

// --- §8.6 — adapted_content (união discriminada por channel_type) -----------

/** Gráfico de barras do slide editorial — só com números que vieram do contexto. */
export interface SlideChart {
  label: string;
  bars: { label: string; value: number }[];
  /** Índice da barra em destaque (padrão: a última). */
  highlight?: number;
}

/** Botão do fecho do carrossel: por onde a pessoa age depois de ler. */
export interface SlideCta {
  kind: "whatsapp" | "direct" | "site" | "perfil";
  label: string;
}

export interface TweetCardSlide {
  index: number;
  text: string;
  /** Fecho do carrossel (último slide): a tese, o próximo passo e o botão. */
  role?: "cta";
  cta?: SlideCta;
  /** Editorial: manchete curta do slide (a capa usa `paragraphs`). */
  title?: string;
  /** Editorial: parágrafos curtos; **negrito** marca o número ou a frase-chave. */
  paragraphs?: string[];
  /** Editorial: o apoio visual do slide — foto 16:9, gráfico ou só texto. */
  visual?: "photo" | "chart" | "none";
  chart?: SlideChart;
  /** Brief da imagem IA do slide (gerado na direção de arte do batch). */
  image_brief?: string;
  /** Slide do miolo promovido a foto pelo usuário (a capa não precisa da marca). */
  photo_promoted?: boolean;
  /** Foto IA do slide no bucket `renders` (generate-image scope 'slides'). */
  image_path?: string;
  /**
   * A imagem deste slide JÁ TRAZ a manchete tipografada — capa gerada como
   * peça de arte fechada pelo modelo de imagem. Só o servidor escreve, e só
   * quando a imagem voltou: com a marca, o chassi para de desenhar texto por
   * cima (sairia manchete em dobro); sem ela, desenha como sempre desenhou.
   */
  cover_art_rendered?: boolean;
}

/**
 * Progresso do batch de fotos por slide (adapted_content.slide_images_job).
 * Atualizado pela edge function a cada imagem — a UI acompanha via Realtime.
 */
/** Alvo de composição da foto: fundo full-bleed limpo × bloco detalhado abaixo. */
export type SlideImageComposition = "background" | "inline";

export interface SlideImagesJob {
  status: "running" | "done" | "error";
  total: number;
  done: number;
  composition?: SlideImageComposition;
  style_bible?: string;
  /** Direção da capa (sujeito nomeado + manchete escrita NA imagem). */
  cover_art?: { subject: string; headline: string; art_direction: string };
  started_at: string;
  ended_at?: string;
  error?: string;
  failed_indexes?: number[];
}

/** Arte final exportada por slide (PNG do card no bucket `renders`). */
export interface SlideRender {
  index: number;
  path: string;
}

/** Beat do roteiro de Reel — o texto FALADO vira narração da cena de vídeo. */
export interface ReelBeat {
  index: number;
  role: "gancho" | "desenvolvimento" | "cta";
  narration: string;
  on_screen_text?: string;
  duration_target_s: number;
}

export interface StoryFrame {
  index: number;
  role: "gancho" | "desenvolvimento" | "cta";
  text: string;
  /** Editorial: manchete curta do quadro (o gancho usa `paragraphs`). */
  title?: string;
  /** Editorial: parágrafos curtos; **negrito** marca o número ou a frase-chave. */
  paragraphs?: string[];
  /** Editorial: o apoio visual do quadro — foto 16:9, gráfico ou só texto. */
  visual?: "photo" | "chart" | "none";
  chart?: SlideChart;
  /** Quadro com foto pedida pelo escritor (o lote de fotos o inclui). */
  photo_promoted?: boolean;
  /** Brief da imagem IA do frame (direção de arte do batch). */
  image_brief?: string;
  /** Foto IA do frame no bucket `renders` (generate-image scope 'slides'). */
  image_path?: string;
}

export interface LinkedinBlocks {
  hook: string;
  contexto: string;
  lista: string[];
  insight: string;
  ponte: string;
  cta: string;
}

export type AdaptedContent =
  | {
      channel_type: "instagram_carousel";
      slides: TweetCardSlide[];
      caption: string;
      slide_images_job?: SlideImagesJob;
      slide_renders?: SlideRender[];
    }
  | {
      channel_type: "instagram_post";
      card: TweetCardSlide;
      caption: string;
      slide_images_job?: SlideImagesJob;
    }
  | {
      channel_type: "instagram_stories";
      frames: StoryFrame[];
      slide_images_job?: SlideImagesJob;
      slide_renders?: SlideRender[];
    }
  | {
      channel_type: "x_post";
      text: string;
      thread?: string[];
      caption?: string;
      image_brief?: string;
    }
  | {
      channel_type: "threads_post";
      text: string;
      thread?: string[];
      caption?: string;
      image_brief?: string;
    }
  | { channel_type: "linkedin_post"; blocks: LinkedinBlocks; text: string; image_brief?: string }
  | { channel_type: "facebook_post"; text: string; image_brief?: string };

/**
 * Visão "achatada" e tolerante do adapted_content — o jsonb pode vir parcial
 * (peça recém-criada, motor antigo). O `channel_type` da LINHA é a autoridade
 * sobre qual campo ler; a união discriminada acima documenta o contrato pleno.
 */
export interface AdaptedFields {
  slides?: TweetCardSlide[];
  card?: TweetCardSlide;
  frames?: StoryFrame[];
  text?: string;
  thread?: string[];
  caption?: string;
  blocks?: Partial<LinkedinBlocks>;
  image_brief?: string;
  /**
   * Path da imagem de IA no bucket privado `renders`, mesclado por
   * generate-image (07-contratos-backend.md §3.5). NUNCA é `render_path`
   * — esse é do PNG do tweet-card, exportado client-side.
   */
  image_path?: string;
  /** Roteiro em beats do Reel (docs/11-video-replicate.md §2.4). */
  script?: { target_duration_s?: number; beats?: ReelBeat[] };
  /** Ponteiro do mp4 montado — escrito pelo pipeline de vídeo, nunca pelo adapter. */
  video?: {
    path: string;
    duration_s: number;
    project_id: string;
    resolution: string;
    generated_at: string;
  };
  /** Progresso do batch de fotos por slide (carrossel). */
  slide_images_job?: SlideImagesJob;
  /** Artes finais exportadas por slide (carrossel). */
  slide_renders?: SlideRender[];
  /**
   * LEGADO, ignorado de propósito. Peças criadas na versão que tinha seletor
   * de sistema por peça carregam estas chaves. A arte passou a vir SÓ do
   * design system da marca (`brand_kit.content.art`), então honrá-las faria a
   * peça antiga desenhar num vocabulário e a foto vir de outro — exatamente o
   * descasamento que o guard do servidor evita. Ficam declaradas para que
   * ninguém as reintroduza achando que "não estavam sendo usadas".
   */
  carousel_system?: string;
  carousel_surface?: string;
}

export function getAdaptedFields(piece: ContentPiece): AdaptedFields {
  return (piece.adapted_content ?? {}) as AdaptedFields;
}

// --- §8.8 — audit (linter / grounding / judge) ------------------------------

export interface LinterViolation {
  rule: string;
  match: string;
  position?: number;
  severity: "error" | "warn";
}

export interface AuditLinter {
  passed: boolean;
  violations: LinterViolation[];
}

export interface GroundingChecked {
  claim: string;
  source_item_id: string | null;
  status: "ok" | "divergent" | "missing";
}

export interface GroundingFlag {
  claim: string;
  reason: string;
  replaced_with?: string;
}

export interface AuditGrounding {
  passed: boolean;
  checked: GroundingChecked[];
  flagged: GroundingFlag[];
}

export type JudgeRuleName = "novidade" | "aplicabilidade" | "proprietario" | "narrativa";

export const JUDGE_RULE_LABELS: Record<JudgeRuleName, string> = {
  novidade: "Novidade",
  aplicabilidade: "Aplicabilidade",
  proprietario: "Proprietário",
  narrativa: "Narrativa",
};

export interface JudgeRule {
  rule: JudgeRuleName;
  passed: boolean;
  note?: string;
}

export interface AuditJudge {
  verdict: "approve" | "rewrite";
  score: number;
  rules: JudgeRule[];
  voice_pass: boolean;
  bridge_logical: boolean;
  diagnosis: string[];
}

export interface Audit {
  linter: AuditLinter;
  grounding: AuditGrounding;
  judge: AuditJudge;
}

// --- §6.10 — content_pieces --------------------------------------------------

export interface ContentPiece {
  id: string;
  job_id: string;
  channel_type: ChannelType;
  core_content: Partial<CoreContent>;
  adapted_content: Record<string, unknown>;
  render_path: string | null;
  audit: Partial<Audit>;
  status: PieceStatus;
  /** F5.4 — data/hora alvo de publicação (calendário editorial); null = sem agendamento. */
  scheduled_at: string | null;
  persona_version: number | null;
  strategy_version: number | null;
  guardrails_version: number | null;
  brand_kit_version: number | null;
  engine_version: string | null;
  context_ids: string[];
  created_at: string;
  updated_at: string;
  /** Job que gerou a peça (embed): `timings.sample` marca amostra do teste de tom. */
  job?: { timings: Record<string, unknown> | null } | null;
}

/** Amostra do teste de tom ou regeneração: nasce do sistema, não de um pedido. */
export function isSamplePiece(piece: ContentPiece): boolean {
  const timings = piece.job?.timings;
  return Boolean(timings && typeof timings === "object" && timings.sample === true);
}

// ---------------------------------------------------------------------------
// Helpers de apresentação
// ---------------------------------------------------------------------------

/**
 * O que VARIA entre as peças irmãs de um job.
 *
 * `pieceHeadline` lê `core_content`, que a saga grava IDÊNTICO em todas as N
 * peças do job (saga.ts, `rows = targets.map(...)` com o mesmo core). Numa fila,
 * isso rende blocos de linhas com a mesma frase. A linha precisa mostrar a
 * primeira unidade ADAPTADA — é ela que muda de canal para canal.
 */
export function pieceRowExcerpt(piece: ContentPiece): string {
  const a = getAdaptedFields(piece);
  const candidato =
    a.slides?.[0]?.text ||
    a.card?.text ||
    a.frames?.[0]?.text ||
    a.script?.beats?.[0]?.narration ||
    a.blocks?.hook ||
    a.text ||
    a.thread?.[0] ||
    "";
  return candidato.trim() || pieceHeadline(piece);
}

/** Forma da peça em uma palavra — "8 slides", "42s", "thread 4". */
export function pieceShape(piece: ContentPiece): string | null {
  const a = getAdaptedFields(piece);
  if (a.slides?.length) return `${a.slides.length} ${a.slides.length === 1 ? "slide" : "slides"}`;
  if (a.frames?.length) return `${a.frames.length} ${a.frames.length === 1 ? "frame" : "frames"}`;
  if (a.script?.target_duration_s) return `${Math.round(a.script.target_duration_s)}s`;
  if (a.thread && a.thread.length > 1) return `thread ${a.thread.length}`;
  return null;
}

/** Primeira linha "cara" da peça: hook escrito > ideia > texto adaptado. */
export function pieceHeadline(piece: ContentPiece): string {
  const core = piece.core_content ?? {};
  const adapted = getAdaptedFields(piece);
  const candidate =
    core.hook?.written ||
    core.idea ||
    adapted.card?.text ||
    adapted.slides?.[0]?.text ||
    adapted.frames?.[0]?.text ||
    adapted.text ||
    "";
  const firstLine = candidate.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.trim() || "(peça sem texto)";
}

/** Serializa o adapted_content completo (texto + legenda) para copiar. */
export function adaptedContentToText(channelType: ChannelType, adapted: AdaptedFields): string {
  const parts: Array<string | undefined | null> = [];
  switch (channelType) {
    case "instagram_post":
      parts.push(adapted.card?.text, adapted.caption);
      break;
    case "instagram_carousel":
      parts.push(
        [...(adapted.slides ?? [])]
          .sort((a, b) => a.index - b.index)
          .map((slide) => slide.text)
          .join("\n\n---\n\n"),
        adapted.caption,
      );
      break;
    case "instagram_stories":
      parts.push(
        [...(adapted.frames ?? [])]
          .sort((a, b) => a.index - b.index)
          .map((frame) => `[${frame.role}] ${frame.text}`)
          .join("\n\n"),
      );
      break;
    case "x_post":
    case "threads_post":
      parts.push(adapted.text, ...(adapted.thread ?? []), adapted.caption);
      break;
    case "linkedin_post": {
      const blocks = adapted.blocks;
      parts.push(
        adapted.text ||
          (blocks
            ? [
                blocks.hook,
                blocks.contexto,
                (blocks.lista ?? []).map((item) => `— ${item}`).join("\n"),
                blocks.insight,
                blocks.ponte,
                blocks.cta,
              ]
                .filter(Boolean)
                .join("\n\n")
            : undefined),
      );
      break;
    }
    case "facebook_post":
      parts.push(adapted.text);
      break;
    case "instagram_reel":
      parts.push(
        [...(adapted.script?.beats ?? [])]
          .sort((a, b) => a.index - b.index)
          .map((beat) => `[${beat.role}] ${beat.narration}`)
          .join("\n\n"),
        adapted.caption,
      );
      break;
  }
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Erros das edge functions — 404 na invocação significa que a function ainda
// não foi deployada nesta instância (regenerate-piece chega com o backend F3).
// ---------------------------------------------------------------------------

const REGENERATE_NOT_DEPLOYED_MESSAGE =
  "Gerar nova versão ainda não está disponível nesta instância. Peça ao administrador para ativar e tente de novo.";

const GENERATE_IMAGE_NOT_DEPLOYED_MESSAGE =
  "A geração de imagem ainda não está disponível nesta instância. Peça ao administrador para ativar e tente de novo.";

/** 404 na invocação = function ausente; qualquer outro status usa o envelope. */
async function getPieceFunctionErrorMessage(
  error: unknown,
  fallback: string,
  notDeployedMessage: string,
): Promise<string> {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) return notDeployedMessage;
  return getFunctionErrorMessage(error, fallback);
}

// ---------------------------------------------------------------------------
// Leituras — query keys ['pieces', filters], ['piece', id],
// ['piece-context-items', ids], ['pieces-pending-count']
// ---------------------------------------------------------------------------

export interface PieceFilters {
  status?: PieceStatus | "agendadas";
  channelType?: ChannelType | null;
  /** Busca por texto no core_content (filtro client-side, base pequena/single-tenant). */
  search?: string;
}

function pieceMatchesSearch(piece: ContentPiece, query: string): boolean {
  const haystack = `${JSON.stringify(piece.core_content ?? {})}\n${JSON.stringify(
    piece.adapted_content ?? {},
  )}`.toLocaleLowerCase("pt-BR");
  return query
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/**
 * Lista de peças filtrada por status/canal (server-side) e texto (client-side,
 * via `select`, sem refetch a cada tecla — a query cacheia por status+canal).
 */
/**
 * Segmento da esteira. "agendadas" NÃO é status: é `approved` com data marcada.
 * Separar os dois é o que faz a peça aprovada-sem-data parar de sumir.
 */
export type PieceStage = PieceStatus | "agendadas";

export function useContentPieces(filters: PieceFilters = {}) {
  const status = filters.status ?? null;
  const channelType = filters.channelType ?? null;
  const search = filters.search?.trim() ?? "";
  return useQuery({
    queryKey: ["pieces", { status, channelType }],
    queryFn: async (): Promise<ContentPiece[]> => {
      let query = supabase
        .from("content_pieces")
        .select("*, job:generation_jobs(timings)")
        .order("created_at", { ascending: false });
      if (status === "agendadas") {
        query = query.eq("status", "approved").not("scheduled_at", "is", null);
      } else if (status === "approved") {
        // Aprovadas = ainda SEM data. Com data, a peça vive em "Agendadas".
        query = query.eq("status", "approved").is("scheduled_at", null);
      } else if (status) {
        query = query.eq("status", status);
      }
      // TODO: remover o cast quando o Lovable regenerar types.ts com o valor
      // `instagram_reel` no enum channel_type (o banco já tem — migration 0022).
      if (channelType) query = query.eq("channel_type", channelType as never);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      // core_content/adapted_content/audit são jsonb (Json) — §8.6/§8.8.
      return (data ?? []) as unknown as ContentPiece[];
    },
    select: (pieces) =>
      search ? pieces.filter((piece) => pieceMatchesSearch(piece, search)) : pieces,
  });
}

/** Peça única por id (detalhe /biblioteca/$pieceId). */
export function useContentPiece(pieceId: string | undefined) {
  return useQuery({
    queryKey: ["piece", pieceId],
    enabled: Boolean(pieceId),
    queryFn: async (): Promise<ContentPiece | null> => {
      if (!pieceId) return null;
      const { data, error } = await supabase
        .from("content_pieces")
        .select("*")
        .eq("id", pieceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // core_content/adapted_content/audit são jsonb (Json) — §8.6/§8.8.
      return (data ?? null) as unknown as ContentPiece | null;
    },
  });
}

/**
 * Contagens dos segmentos da esteira de aprovação.
 *
 * "Aprovada sem data" não é um status: é `approved` com `scheduled_at` nulo, e
 * hoje some — fica misturada na aba Aprovadas e não entra no calendário, que
 * exige data. Separar aqui é o que torna esse gargalo visível.
 */
export interface PieceStageCounts {
  draft: number;
  approved: number;
  agendadas: number;
  published: number;
  rejected: number;
  archived: number;
}

export function usePieceStageCounts() {
  return useQuery({
    queryKey: ["piece-stage-counts"],
    staleTime: 15_000,
    queryFn: async (): Promise<PieceStageCounts> => {
      // Contagem no BANCO, não no cliente. Trazer as linhas para contar batia no
      // teto de 1000 do PostgREST: a partir daí os números parariam de crescer e
      // ninguém notaria — a tela seguiria plausível, só que errada.
      const contar = async (
        aplica: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>,
      ): Promise<number> => {
        const { count, error } = await aplica(baseQuery());
        if (error) throw new Error(error.message);
        return count ?? 0;
      };
      const baseQuery = () =>
        supabase.from("content_pieces").select("id", { count: "exact", head: true });

      const [draft, approved, agendadas, published, rejected, archived] = await Promise.all([
        contar((q) => q.eq("status", "draft")),
        contar((q) => q.eq("status", "approved").is("scheduled_at", null)),
        contar((q) => q.eq("status", "approved").not("scheduled_at", "is", null)),
        contar((q) => q.eq("status", "published")),
        contar((q) => q.eq("status", "rejected")),
        contar((q) => q.eq("status", "archived")),
      ]);
      return { draft, approved, agendadas, published, rejected, archived };
    },
  });
}

/** Contagem de peças aguardando revisão (status draft) — card do Dashboard. */
export function usePendingReviewCount() {
  return useQuery({
    queryKey: ["pieces-pending-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("content_pieces")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

export interface PieceContextItemSummary {
  id: string;
  title: string;
  kind: string;
}

/** Títulos dos context_items referenciados pela peça (proveniência). */
export function usePieceContextItems(contextIds: string[] | undefined) {
  const ids = contextIds ?? [];
  return useQuery({
    queryKey: ["piece-context-items", [...ids].sort()],
    enabled: ids.length > 0,
    queryFn: async (): Promise<PieceContextItemSummary[]> => {
      const { data, error } = await supabase
        .from("context_items")
        .select("id, title, kind")
        .in("id", ids);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Escritas — aprovação/rejeição/arquivo (update + piece_feedback), upload de
// render (bucket renders) e regeneração guiada (regenerate-piece)
// ---------------------------------------------------------------------------

function invalidatePieces(queryClient: ReturnType<typeof useQueryClient>, pieceId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["pieces"] });
  void queryClient.invalidateQueries({ queryKey: ["pieces-pending-count"] });
  void queryClient.invalidateQueries({ queryKey: ["pieces-scheduled"] });
  if (pieceId) void queryClient.invalidateQueries({ queryKey: ["piece", pieceId] });
}

export interface UpdatePieceStatusInput {
  pieceId: string;
  status: Extract<PieceStatus, "approved" | "rejected" | "archived">;
  /** Gravadas em piece_feedback quando aprovar/rejeitar (§6.11). */
  notes?: string;
}

/** Canais cuja arte é um deck de imagens por unidade (slide, frame ou card). */
const PHOTO_DECK_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>([
  "instagram_carousel",
  "instagram_post",
  "instagram_stories",
]);

/**
 * Dispara a arte da CAPA assim que a peça é aprovada.
 *
 * A imagem não sai junto com o texto de propósito: o juiz reprova parte das
 * gerações, e arte de peça reprovada é dinheiro fora. Aprovou, a capa começa —
 * sem depender de alguém lembrar de clicar num botão.
 *
 * Só a capa (índice 0). O miolo do carrossel é render do design system; slide
 * do miolo só ganha foto quando o usuário promove um, na página da peça.
 */
async function dispararArteDaCapa(pieceId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("content_pieces")
      .select("channel_type, adapted_content")
      .eq("id", pieceId)
      .maybeSingle();
    const channel = (data as { channel_type?: ChannelType } | null)?.channel_type;
    if (!channel || !PHOTO_DECK_CHANNELS.has(channel)) return;

    const adapted = getAdaptedFields((data ?? {}) as ContentPiece);
    const capa = adapted.slides?.[0] ?? adapted.frames?.[0] ?? adapted.card;
    if (!capa) return;
    if (capa.image_path) return; // já tem arte — aprovar de novo não repaga

    await supabase.functions.invoke("generate-image", {
      body: { piece_id: pieceId, scope: "slides", slide_indexes: [0] },
    });
  } catch (err) {
    // Nunca derruba a aprovação: a arte é consequência, não pré-requisito.
    console.warn("[pieces] arte da capa não disparou na aprovação:", err);
  }
}

/**
 * Atualiza o status da peça; aprovar/rejeitar grava também `piece_feedback`
 * {verdict, notes} (append-only — alimenta a calibração futura do juiz).
 */
export function useUpdatePieceStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePieceStatusInput): Promise<void> => {
      const { data, error } = await supabase
        .from("content_pieces")
        // Rejeitar/arquivar cancela o agendamento: peça fora do fluxo de
        // publicação não pode continuar aparecendo no calendário editorial.
        .update({ status: input.status, scheduled_at: null })
        .eq("id", input.pieceId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(
          "A peça não foi encontrada. Ela pode ter sido removida — recarregue a Biblioteca.",
        );
      }

      if (input.status === "approved" || input.status === "rejected") {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user.id ?? null;
        const { error: feedbackError } = await supabase.from("piece_feedback").insert({
          piece_id: input.pieceId,
          verdict: input.status,
          notes: input.notes?.trim() || null,
          created_by: userId,
        });
        if (feedbackError) {
          throw new Error(
            `A decisão foi salva, mas o comentário não foi registrado (${feedbackError.message}).`,
          );
        }
      }
    },
    onSuccess: (_data, input) => {
      invalidatePieces(queryClient, input.pieceId);
      // Aprovou → a arte da capa começa. É o ponto 2.1 do plano: a imagem não
      // sai junto com o texto (peça reprovada seria arte paga no lixo), mas
      // também não pode depender de alguém lembrar de clicar num botão.
      if (input.status === "approved") {
        void dispararArteDaCapa(input.pieceId).then(() =>
          invalidatePieces(queryClient, input.pieceId),
        );
      }
    },
  });
}

export interface UploadRenderInput {
  pieceId: string;
  blob: Blob;
}

/**
 * Sobe o PNG exportado do tweet-card para o bucket `renders` no path
 * `{piece_id}/tweet-card-{ts}.png` e grava `render_path` na peça.
 */
export function useUploadRender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadRenderInput): Promise<string> => {
      const path = `${input.pieceId}/tweet-card-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .upload(path, input.blob, { contentType: "image/png" });
      if (uploadError) throw new Error(`O envio da imagem falhou: ${uploadError.message}`);

      const { data, error } = await supabase
        .from("content_pieces")
        .update({ render_path: path })
        .eq("id", input.pieceId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("A imagem foi salva, mas não ficou ligada à peça. Exporte de novo.");
      }
      return path;
    },
    onSuccess: (_path, input) => invalidatePieces(queryClient, input.pieceId),
  });
}

export interface RegeneratePieceInput {
  pieceId: string;
  instruction: string;
}

export interface RegeneratePieceResult {
  job_id: string;
  piece_id: string;
}

/**
 * Regeneração guiada: POST regenerate-piece {piece_id, instruction}
 * (07-contratos-backend.md §3.9). Cria um novo job só para o canal da peça;
 * a original é arquivada quando a nova ficar pronta.
 */
export function useRegeneratePiece() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegeneratePieceInput): Promise<RegeneratePieceResult> => {
      const { data, error } = await supabase.functions.invoke("regenerate-piece", {
        body: { piece_id: input.pieceId, instruction: input.instruction },
      });
      if (error) {
        throw new Error(
          await getPieceFunctionErrorMessage(
            error,
            "Não foi possível gerar a nova versão.",
            REGENERATE_NOT_DEPLOYED_MESSAGE,
          ),
        );
      }
      return data as RegeneratePieceResult;
    },
    onSuccess: (_data, input) => {
      invalidatePieces(queryClient, input.pieceId);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job-pieces"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Imagem de IA da peça — edge function generate-image (07 §3.5) + leitura da
// URL exibível. O card em si NUNCA vem da IA (render client-side): esta é a
// imagem opcional que aparece DENTRO/ABAIXO do texto.
// ---------------------------------------------------------------------------

/** `adapted_content.image_path` (bucket `renders`) ou null. */
export function pieceImagePath(piece: ContentPiece | null | undefined): string | null {
  const path = (piece?.adapted_content as AdaptedFields | null | undefined)?.image_path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

/** Brief da imagem no core_content — sem ele o formato não pede imagem de IA. */
export function pieceImageBrief(piece: ContentPiece | null | undefined): string | null {
  const brief = piece?.core_content?.image_brief;
  return typeof brief === "string" && brief.trim() ? brief.trim() : null;
}

/**
 * URL exibível da imagem de IA da peça: signed URL do bucket privado `renders`
 * a partir de `adapted_content.image_path`. Sem path, a query fica desabilitada
 * (nenhuma requisição). Reaproveita a key ['signed-url','renders',path] — é a
 * mesma que `useGenerateImage` semeia com a URL já devolvida pela function.
 */
export function usePieceImageUrl(piece: ContentPiece | null | undefined, expiresIn = 3600) {
  return useSignedUrl("renders", pieceImagePath(piece), expiresIn);
}

export interface GenerateImageInput {
  pieceId: string;
}

export interface GenerateImageResult {
  path: string;
  signed_url: string;
}

/**
 * Gera a imagem de IA da peça: POST generate-image {piece_id}. A function usa
 * o `core_content.image_brief`, sobe o PNG no bucket `renders` e mescla o path
 * em `adapted_content.image_path` (nunca em render_path).
 */
export function useGenerateImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateImageInput): Promise<GenerateImageResult> => {
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: { piece_id: input.pieceId },
      });
      if (error) {
        throw new Error(
          await getPieceFunctionErrorMessage(
            error,
            "Não foi possível gerar a imagem.",
            GENERATE_IMAGE_NOT_DEPLOYED_MESSAGE,
          ),
        );
      }
      return data as GenerateImageResult;
    },
    onSuccess: (data, input) => {
      // A signed URL já veio na resposta: semeia o cache para a imagem aparecer
      // sem um round-trip extra assim que a peça recarregar com o novo path.
      queryClient.setQueryData(["signed-url", "renders", data.path], data.signed_url);
      invalidatePieces(queryClient, input.pieceId);
    },
  });
}

// ---------------------------------------------------------------------------
// Fotos por slide do carrossel — generate-image {scope:'slides'} (07 §3.5) +
// Realtime do detalhe da peça (o batch atualiza adapted_content slide a slide)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F5.4 — Calendário editorial (scheduled_at em content_pieces)
// ---------------------------------------------------------------------------

export interface SchedulePieceInput {
  pieceId: string;
  /** ISO datetime; null remove o agendamento. */
  scheduledAt: string | null;
}

/** Agenda (ou desagenda) a publicação de uma peça aprovada. */
export function useSchedulePiece() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SchedulePieceInput): Promise<void> => {
      const { data, error } = await supabase
        .from("content_pieces")
        .update({ scheduled_at: input.scheduledAt })
        .eq("id", input.pieceId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(
          "A peça não foi encontrada. Ela pode ter sido removida — recarregue a Biblioteca.",
        );
      }
    },
    onSuccess: (_data, input) => {
      invalidatePieces(queryClient, input.pieceId);
      void queryClient.invalidateQueries({ queryKey: ["pieces-scheduled"] });
    },
  });
}

/** Peças com agendamento dentro do intervalo (visão de calendário). */
export function useScheduledPieces(rangeStartIso: string, rangeEndIso: string) {
  return useQuery({
    queryKey: ["pieces-scheduled", rangeStartIso, rangeEndIso],
    queryFn: async (): Promise<ContentPiece[]> => {
      const { data, error } = await supabase
        .from("content_pieces")
        .select("*")
        // Aprovadas (agendar é pós-aprovação) e publicadas (Eixo 1: a peça que
        // saiu continua visível no calendário com o estado de publicada).
        .in("status", ["approved", "published"])
        .gte("scheduled_at", rangeStartIso)
        .lt("scheduled_at", rangeEndIso)
        .order("scheduled_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ContentPiece[];
    },
  });
}

export interface GenerateSlideImagesInput {
  pieceId: string;
  /** Regenera só estes slides (retry pontual); omitido = todos. */
  slideIndexes?: number[];
  /**
   * Alvo de composição: 'background' (fundo limpo de marca) ou 'inline' (cena
   * detalhada no bloco abaixo do texto). Mudar o alvo invalida os briefs do
   * batch anterior — a direção de arte roda de novo no modo certo.
   */
  composition?: SlideImageComposition;
}

export interface GenerateSlideImagesResult {
  started: boolean;
  total: number;
  piece_id: string;
}

/**
 * Dispara o batch de fotos dos slides do carrossel. A resposta volta imediata;
 * o progresso chega em `adapted_content.slide_images_job` via Realtime
 * (usePieceRealtime) — cada foto gerada aparece no seu slide.
 */
export function useGenerateSlideImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateSlideImagesInput): Promise<GenerateSlideImagesResult> => {
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: {
          piece_id: input.pieceId,
          scope: "slides",
          ...(input.slideIndexes?.length ? { slide_indexes: input.slideIndexes } : {}),
          ...(input.composition ? { composition: input.composition } : {}),
        },
      });
      if (error) {
        throw new Error(
          await getPieceFunctionErrorMessage(
            error,
            "Não foi possível iniciar a geração das fotos.",
            GENERATE_IMAGE_NOT_DEPLOYED_MESSAGE,
          ),
        );
      }
      return data as GenerateSlideImagesResult;
    },
    onSuccess: (_data, input) => invalidatePieces(queryClient, input.pieceId),
  });
}

/**
 * Realtime do detalhe da peça: UPDATE na linha invalida ['piece', id] — é o que
 * faz o progresso do batch de fotos (e qualquer mudança da peça) aparecer sem
 * refresh. Fallback: polling de 3s enquanto o canal não conecta E há batch ativo.
 */
export function usePieceRealtime(pieceId: string | undefined, options: { poll?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!pieceId) return;
    const channel = supabase
      .channel(`piece-${pieceId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "content_pieces", filter: `id=eq.${pieceId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["piece", pieceId] });
          void queryClient.invalidateQueries({ queryKey: ["pieces"] });
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [pieceId, queryClient]);

  useEffect(() => {
    if (!pieceId || connected || !options.poll) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["piece", pieceId] });
    }, 3000);
    return () => clearInterval(timer);
  }, [pieceId, connected, options.poll, queryClient]);

  return { realtimeConnected: connected };
}

export interface SaveSlideRendersInput {
  pieceId: string;
  renders: Array<{ index: number; blob: Blob }>;
}

/**
 * Sobe as artes finais do carrossel (PNG por slide, export client-side) para
 * `renders/{piece_id}/slide-card-{index}-{ts}.png` e persiste a lista via
 * `merge_piece_adapted_content` — patch de topo SÓ da chave `slide_renders`,
 * nunca o adapted_content inteiro (um snapshot clobberaria as escritas
 * concorrentes do batch de fotos: slides[i].image_path, slide_images_job).
 */
export function useSaveSlideRenders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveSlideRendersInput): Promise<SlideRender[]> => {
      const ts = Date.now();
      const uploaded: SlideRender[] = [];
      for (const render of input.renders) {
        const path = `${input.pieceId}/slide-card-${render.index}-${ts}.png`;
        const { error } = await supabase.storage
          .from("renders")
          .upload(path, render.blob, { contentType: "image/png" });
        if (error) {
          throw new Error(`O envio da arte do slide ${render.index} falhou: ${error.message}`);
        }
        uploaded.push({ index: render.index, path });
      }

      const { data: merged, error: mergeError } = await supabase.rpc(
        "merge_piece_adapted_content",
        {
          _piece_id: input.pieceId,
          _patch: { slide_renders: uploaded } as unknown as Json,
        },
      );
      if (mergeError) throw new Error(mergeError.message);
      if (merged !== true) {
        throw new Error("As artes foram salvas, mas não ficaram ligadas à peça. Exporte de novo.");
      }
      return uploaded;
    },
    onSuccess: (_renders, input) => invalidatePieces(queryClient, input.pieceId),
  });
}

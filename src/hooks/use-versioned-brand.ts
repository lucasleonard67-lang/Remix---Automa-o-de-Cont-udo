import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizeArt, type CarouselArt } from "@/lib/carousel-art";
import { useEffect, useMemo, useState } from "react";
import { useFlash } from "@/hooks/use-feedback";
import { toast } from "@/lib/toast";

import type { ChannelType } from "@/hooks/use-channels";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { fetchIsAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Tabelas versionadas (docs/04-modelo-de-dados.md §6.5): version int sequencial,
// status draft|active|archived, content jsonb, índice único de 1 active.
// ---------------------------------------------------------------------------

export const VERSIONED_BRAND_TABLES = [
  "brand_persona",
  "brand_strategy",
  "guardrails",
  "brand_kit",
] as const;

export type VersionedBrandTable = (typeof VERSIONED_BRAND_TABLES)[number];

export type VersionStatus = "draft" | "active" | "archived";

export interface VersionedRow<T = unknown> {
  id: string;
  version: number;
  status: VersionStatus;
  content: T;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const ADMIN_ONLY_MESSAGE = "Só administradores editam a marca. Peça a um administrador da conta.";
const VERSION_CONFLICT_MESSAGE =
  "Outra pessoa alterou esta versão ao mesmo tempo. Recarregue a página e repita a ação.";

function toFriendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return new Error(ADMIN_ONLY_MESSAGE);
  }
  if (error.code === "23505") {
    return new Error(VERSION_CONFLICT_MESSAGE);
  }
  return new Error(error.message);
}

// ---------------------------------------------------------------------------
// Contratos dos content jsonb (docs/04-modelo-de-dados.md §8.1–§8.4)
// ---------------------------------------------------------------------------

/** §8.1 — contrato de voz (9 seções + banlist por referência). */
export interface PersonaContent {
  identity: {
    name: string;
    role: string;
    positioning: string;
    audience: string;
  };
  credenciais: Array<{ claim: string; source: string }>;
  worldview: { summary: string; theses: string[] };
  tone_principles: string[];
  signature_lexicon: Array<{ term: string; usage: string; max_per_piece: number }>;
  calibration_heuristics: string[];
  /** Referência à fonte única (guardrails ativa); nunca duplica conteúdo. */
  banlist: { ref: "guardrails" };
  opinioes: Array<{ topic: string; stance: string }>;
  voice_checklist: string[];
  reference_examples: {
    good: Array<{ text: string; why: string }>;
    bad: Array<{ text: string; why: string }>;
  };
}

/** §8.2 — bandeira. */
export interface StrategyContent {
  brand_promise: string;
  theses: string[];
  enemy: string;
  safe_list: string[];
  icp: { perfil: string; desejos: string[] };
  editorial_stance: string;
  content_mix: Record<string, number>;
  cta_repertoire: string[];
}

/** §8.3 — fonte única de regras duras. */
export interface GuardrailsContent {
  banned_punctuation: string[];
  banned_words: string[];
  banned_metaphors: string[];
  banned_ctas: string[];
  allowed_ctas: string[];
  channel_scope_overrides: Partial<
    Record<ChannelType, { banned_words?: string[]; allowed_ctas?: string[] }>
  >;
  qa_rubric: Record<string, string>;
  approval_threshold: {
    default: number;
    per_channel?: Partial<Record<ChannelType, number>>;
  };
  dosage_rules: {
    signature_lexicon_max_per_piece: number;
    emoji_max?: number;
    hashtag_policy?: "none" | "metadata_only";
  };
}

/** §8.4 — identidade visual. */
export interface BrandKitContent {
  palette: Record<string, string>;
  typography: { heading: string; body: string };
  logo_path: string | null;
  negative_constraints: string[];
  photo_paths: string[];
  /**
   * Vocabulário de ARTE da marca (composição, moldura, textura, foto…).
   * Fica AQUI, no documento versionado, junto de paleta e tipografia — é a
   * mesma coisa que elas: design system da marca, gerado no onboarding. Não é
   * catálogo nem estado de tela, e não tem seletor por peça.
   */
  art: CarouselArt;
}

// ---------------------------------------------------------------------------
// Normalizadores — jsonb do banco pode vir parcial/vazio; a UI trabalha sempre
// com o shape completo do contrato.
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objArray<T>(value: unknown, map: (raw: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) =>
    map(typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}),
  );
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizePersonaContent(raw: unknown): PersonaContent {
  const c = record(raw);
  const identity = record(c.identity);
  const worldview = record(c.worldview);
  const examples = record(c.reference_examples);
  const example = (item: Record<string, unknown>) => ({ text: str(item.text), why: str(item.why) });
  return {
    identity: {
      name: str(identity.name),
      role: str(identity.role),
      positioning: str(identity.positioning),
      audience: str(identity.audience),
    },
    credenciais: objArray(c.credenciais, (item) => ({
      claim: str(item.claim),
      source: str(item.source),
    })),
    worldview: { summary: str(worldview.summary), theses: strArray(worldview.theses) },
    tone_principles: strArray(c.tone_principles),
    signature_lexicon: objArray(c.signature_lexicon, (item) => ({
      term: str(item.term),
      usage: str(item.usage),
      max_per_piece: numOr(item.max_per_piece, 1),
    })),
    calibration_heuristics: strArray(c.calibration_heuristics),
    banlist: { ref: "guardrails" },
    opinioes: objArray(c.opinioes, (item) => ({
      topic: str(item.topic),
      stance: str(item.stance),
    })),
    voice_checklist: strArray(c.voice_checklist),
    reference_examples: {
      good: objArray(examples.good, example),
      bad: objArray(examples.bad, example),
    },
  };
}

export function normalizeStrategyContent(raw: unknown): StrategyContent {
  const c = record(raw);
  const icp = record(c.icp);
  const mix: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(c.content_mix))) {
    if (typeof value === "number" && Number.isFinite(value)) mix[key] = value;
  }
  return {
    brand_promise: str(c.brand_promise),
    theses: strArray(c.theses),
    enemy: str(c.enemy),
    safe_list: strArray(c.safe_list),
    icp: { perfil: str(icp.perfil), desejos: strArray(icp.desejos) },
    editorial_stance: str(c.editorial_stance),
    content_mix: mix,
    cta_repertoire: strArray(c.cta_repertoire),
  };
}

export function normalizeGuardrailsContent(raw: unknown): GuardrailsContent {
  const c = record(raw);
  const threshold = record(c.approval_threshold);
  const perChannelRaw = record(threshold.per_channel);
  const perChannel: Partial<Record<ChannelType, number>> = {};
  for (const [key, value] of Object.entries(perChannelRaw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      perChannel[key as ChannelType] = value;
    }
  }
  const rubric: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(c.qa_rubric))) {
    if (typeof value === "string") rubric[key] = value;
  }
  const dosage = record(c.dosage_rules);
  const hashtagPolicy = dosage.hashtag_policy;
  return {
    banned_punctuation: strArray(c.banned_punctuation),
    banned_words: strArray(c.banned_words),
    banned_metaphors: strArray(c.banned_metaphors),
    banned_ctas: strArray(c.banned_ctas),
    allowed_ctas: strArray(c.allowed_ctas),
    channel_scope_overrides: record(
      c.channel_scope_overrides,
    ) as GuardrailsContent["channel_scope_overrides"],
    qa_rubric: rubric,
    approval_threshold: {
      default: numOr(threshold.default, 7),
      ...(Object.keys(perChannel).length > 0 ? { per_channel: perChannel } : {}),
    },
    dosage_rules: {
      signature_lexicon_max_per_piece: numOr(dosage.signature_lexicon_max_per_piece, 2),
      ...(typeof dosage.emoji_max === "number" && Number.isFinite(dosage.emoji_max)
        ? { emoji_max: dosage.emoji_max }
        : {}),
      ...(hashtagPolicy === "none" || hashtagPolicy === "metadata_only"
        ? { hashtag_policy: hashtagPolicy }
        : {}),
    },
  };
}

export function normalizeBrandKitContent(raw: unknown): BrandKitContent {
  const c = record(raw);
  const typography = record(c.typography);
  const palette: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(c.palette))) {
    if (typeof value === "string") palette[key] = value;
  }
  return {
    palette,
    typography: { heading: str(typography.heading), body: str(typography.body) },
    logo_path: typeof c.logo_path === "string" && c.logo_path ? c.logo_path : null,
    negative_constraints: strArray(c.negative_constraints),
    photo_paths: strArray(c.photo_paths),
    art: normalizeArt(c.art),
  };
}

// ---------------------------------------------------------------------------
// Leituras — query keys ['doc', table, 'active' | 'draft' | 'history']
// ---------------------------------------------------------------------------

/** Linha `active` da tabela (no máximo 1, por índice único parcial). */
export function useActiveVersion<T = unknown>(table: VersionedBrandTable) {
  return useQuery({
    queryKey: ["doc", table, "active"],
    queryFn: async (): Promise<VersionedRow<T> | null> => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(error.message);
      // `content` é jsonb (Json); `status` é text livre no banco — §6.5.
      return (data ?? null) as unknown as VersionedRow<T> | null;
    },
  });
}

/** Rascunho em edição (a mecânica do produto mantém no máximo 1). */
export function useDraftVersion<T = unknown>(table: VersionedBrandTable) {
  return useQuery({
    queryKey: ["doc", table, "draft"],
    queryFn: async (): Promise<VersionedRow<T> | null> => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("status", "draft")
        .order("version", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      // `content` é jsonb (Json); `status` é text livre no banco — §6.5.
      return ((data ?? [])[0] ?? null) as unknown as VersionedRow<T> | null;
    },
  });
}

/** Histórico completo (draft + active + archived), mais recente primeiro. */
export function useVersionList(table: VersionedBrandTable) {
  return useQuery({
    queryKey: ["doc", table, "history"],
    queryFn: async (): Promise<Array<VersionedRow>> => {
      const { data, error } = await supabase
        .from(table)
        .select("id, version, status, created_by, created_at, updated_at, content")
        .order("version", { ascending: false });
      if (error) throw new Error(error.message);
      // `status` é text livre no banco; a UI trabalha com o enum de §6.5.
      return (data ?? []) as unknown as Array<VersionedRow>;
    },
  });
}

// ---------------------------------------------------------------------------
// Escritas (RLS restringe a admin — erros viram mensagem amigável)
// ---------------------------------------------------------------------------

function invalidateDoc(queryClient: ReturnType<typeof useQueryClient>, table: VersionedBrandTable) {
  void queryClient.invalidateQueries({ queryKey: ["doc", table] });
}

/**
 * Salva o rascunho: se já existe linha `draft`, atualiza o content dela;
 * senão cria um draft novo com `version = max(version) + 1`.
 */
export function useSaveDraft<T = unknown>(table: VersionedBrandTable) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: T): Promise<VersionedRow<T>> => {
      const { data: drafts, error: draftError } = await supabase
        .from(table)
        .select("id")
        .eq("status", "draft")
        .order("version", { ascending: false })
        .limit(1);
      if (draftError) throw toFriendlyError(draftError);

      const draftId = (drafts ?? [])[0]?.id;
      if (draftId) {
        const { data, error } = await supabase
          .from(table)
          // `content` é jsonb (Json); o shape de `T` é o contrato de §8.1–§8.4.
          .update({ content: content as unknown as Json })
          .eq("id", draftId)
          .select()
          .maybeSingle();
        if (error) throw toFriendlyError(error);
        if (!data) throw new Error(ADMIN_ONLY_MESSAGE);
        return data as unknown as VersionedRow<T>;
      }

      const { data: latest, error: maxError } = await supabase
        .from(table)
        .select("version")
        .order("version", { ascending: false })
        .limit(1);
      if (maxError) throw toFriendlyError(maxError);
      const nextVersion = ((latest ?? [])[0]?.version ?? 0) + 1;

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;

      const { data, error } = await supabase
        .from(table)
        .insert({
          version: nextVersion,
          status: "draft",
          // `content` é jsonb (Json); o shape de `T` é o contrato de §8.1–§8.4.
          content: content as unknown as Json,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw toFriendlyError(error);
      return data as unknown as VersionedRow<T>;
    },
    onSuccess: () => invalidateDoc(queryClient, table),
  });
}

/**
 * Ativa o rascunho (transação client-side em 2 passos):
 * active atual → archived, depois draft → active. Se o segundo passo falhar
 * (corrida com outra ativação / rascunho descartado), restaura o active
 * anterior best-effort e lança erro amigável.
 */
export function useActivateDraft(table: VersionedBrandTable) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string): Promise<void> => {
      // Passo 1 — arquiva a active atual (se houver).
      const { data: archivedRows, error: archiveError } = await supabase
        .from(table)
        .update({ status: "archived" })
        .eq("status", "active")
        .select("id");
      if (archiveError) throw toFriendlyError(archiveError);
      const archivedId = (archivedRows ?? [])[0]?.id ?? null;

      // Passo 2 — promove o draft (guardado por status='draft' contra corridas).
      const { data: promoted, error: promoteError } = await supabase
        .from(table)
        .update({ status: "active" })
        .eq("id", draftId)
        .eq("status", "draft")
        .select("id");

      if (promoteError || !promoted || promoted.length === 0) {
        // Rollback best-effort: devolve a versão anterior ao estado active.
        if (archivedId) {
          await supabase.from(table).update({ status: "active" }).eq("id", archivedId);
        }
        if (promoteError) throw toFriendlyError(promoteError);
        const isAdmin = await fetchIsAdmin();
        throw new Error(isAdmin ? VERSION_CONFLICT_MESSAGE : ADMIN_ONLY_MESSAGE);
      }
    },
    onSuccess: () => invalidateDoc(queryClient, table),
  });
}

/** Descarta o rascunho (delete da linha `draft`). */
export function useDiscardDraft(table: VersionedBrandTable) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string): Promise<void> => {
      const { error, count } = await supabase
        .from(table)
        .delete({ count: "exact" })
        .eq("id", draftId)
        .eq("status", "draft");
      if (error) throw toFriendlyError(error);
      if (!count) {
        const isAdmin = await fetchIsAdmin();
        throw new Error(
          isAdmin ? "Este rascunho já foi descartado. Recarregue a página." : ADMIN_ONLY_MESSAGE,
        );
      }
    },
    onSuccess: () => invalidateDoc(queryClient, table),
  });
}

// ---------------------------------------------------------------------------
// useVersionedEditor — estado compartilhado das 4 telas de /marca:
// formulário local sobre o RASCUNHO (nunca a ativa), dirty check,
// salvar/ativar/descartar com toasts. Não-admin: somente leitura da ativa.
// ---------------------------------------------------------------------------

export interface VersionedEditorState {
  isAdmin: boolean;
  isLoading: boolean;
  isError: boolean;
  active: VersionedRow | null;
  draft: VersionedRow | null;
  dirty: boolean;
  saving: boolean;
  /** Rascunho acabou de ser salvo (confirmação no botão). */
  saved: boolean;
  activating: boolean;
  /** Versão acabou de ser ativada (confirmação no botão). */
  activated: boolean;
  discarding: boolean;
  onSaveDraft: () => void;
  onActivate: () => void;
  onDiscardDraft: () => void;
}

export interface VersionedEditor<T> extends VersionedEditorState {
  content: T;
  patch: (partial: Partial<T>) => void;
  setContent: (next: T) => void;
}

export function useVersionedEditor<T>(
  table: VersionedBrandTable,
  normalize: (raw: unknown) => T,
  sanitize?: (content: T) => T,
): VersionedEditor<T> {
  const { isAdmin, isLoading: rolesLoading } = useIsAdmin();
  const activeQuery = useActiveVersion<T>(table);
  const draftQuery = useDraftVersion<T>(table);
  const saveDraft = useSaveDraft<T>(table);
  const activateDraft = useActivateDraft(table);
  const discardDraft = useDiscardDraft(table);
  const [activating, setActivating] = useState(false);

  const isLoading = rolesLoading || activeQuery.isLoading || draftQuery.isLoading;
  const active = activeQuery.data ?? null;
  const draft = draftQuery.data ?? null;

  // Admin edita o rascunho (fallback: cópia da ativa); user comum vê só a ativa.
  const baselineRow = isAdmin ? (draft ?? active) : active;
  const baseline = useMemo(() => normalize(baselineRow?.content ?? null), [normalize, baselineRow]);

  const [form, setForm] = useState<T | null>(null);
  useEffect(() => {
    if (!isLoading && form === null) setForm(baseline);
  }, [isLoading, form, baseline]);

  const content = form ?? baseline;
  const dirty = isAdmin && form !== null && JSON.stringify(form) !== JSON.stringify(baseline);

  const patch = (partial: Partial<T>) => setForm({ ...content, ...partial });

  const prepare = (value: T): T => (sanitize ? sanitize(value) : value);
  // confirmação no próprio botão ("✓ Salvo" / "✓ Ativada") — ver ui/feedback
  const [saved, flashSaved] = useFlash();
  const [activated, flashActivated] = useFlash();

  const onSaveDraft = () => {
    if (!dirty || saveDraft.isPending) return;
    const payload = prepare(content);
    saveDraft.mutate(payload, {
      onSuccess: () => {
        setForm(payload);
        flashSaved();
      },
      onError: (error) => {
        toast.retry("Não foi possível salvar o rascunho", {
          description: error.message,
          onRetry: onSaveDraft,
        });
      },
    });
  };

  const onActivate = async () => {
    if (activating) return;

    // MEDIDO: sem rascunho e sem alteração, ativar mintava uma versão NOVA
    // (cópia byte a byte da ativa), arquivava a anterior e seguia em frente
    // como se algo tivesse mudado. O histórico enchia de versões idênticas e a
    // peça carimbava um número que não significa nada — e a Proveniência
    // existe justamente para dizer "esta peça saiu da v1". Ativar o que já
    // está ativo é não-operação.
    if (!draft && !dirty && active) {
      toast.info(`A v${active.version} já está ativa`, {
        description: "Nada mudou desde a versão ativa. Edite algum campo antes de ativar.",
      });
      return;
    }

    setActivating(true);
    try {
      let draftId = draft?.id ?? null;
      if (!draftId || dirty) {
        const payload = prepare(content);
        const saved = await saveDraft.mutateAsync(payload);
        setForm(payload);
        draftId = saved.id;
      }
      await activateDraft.mutateAsync(draftId);
      flashActivated();
      toast.success("Versão ativada", {
        description: "As próximas peças já usam esta versão.",
      });
    } catch (error) {
      toast.retry("Não foi possível ativar a versão", {
        description: error instanceof Error ? error.message : undefined,
        onRetry: () => void onActivate(),
      });
    } finally {
      setActivating(false);
    }
  };

  const onDiscardDraft = () => {
    if (discardDraft.isPending) return;
    const resetToActive = () => setForm(normalize(active?.content ?? null));
    if (!draft) {
      // Sem rascunho persistido: descartar = zerar alterações locais.
      resetToActive();
      return;
    }
    discardDraft.mutate(draft.id, {
      onSuccess: () => {
        resetToActive();
        toast.success("Rascunho descartado", {
          description: active ? `A versão ativa (v${active.version}) continua valendo.` : undefined,
        });
      },
      onError: (error) => {
        toast.error("Não foi possível descartar", { description: error.message });
      },
    });
  };

  return {
    isAdmin,
    isLoading,
    isError: activeQuery.isError || draftQuery.isError,
    active: active as VersionedRow | null,
    draft: draft as VersionedRow | null,
    dirty,
    saving: saveDraft.isPending,
    saved,
    activating,
    activated,
    discarding: discardDraft.isPending,
    onSaveDraft,
    onActivate: () => void onActivate(),
    onDiscardDraft,
    content,
    patch,
    setContent: setForm,
  };
}

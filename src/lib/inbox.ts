// Avisos do app: o que terminou, derivado das tabelas de trabalho (sem tabela
// própria). "Lido" é um carimbo por pessoa, guardado no navegador: tudo que
// mudou depois dele conta como não lido.

export type InboxKind = "piece" | "video" | "avatar" | "voice" | "roteiro";
export type InboxTone = "success" | "error" | "info";

export interface InboxOutcome {
  tone: InboxTone;
  title: string;
  action: string;
}

export const INBOX_OUTCOMES: Record<InboxKind, Record<string, InboxOutcome>> = {
  piece: {
    done: { tone: "success", title: "Peça pronta", action: "Ver peça" },
    failed: { tone: "error", title: "A peça não foi gerada", action: "Ver detalhes" },
    awaiting_angle: { tone: "info", title: "Escolha o ângulo da peça", action: "Escolher" },
    awaiting_review: { tone: "info", title: "Peça pronta para revisar", action: "Revisar" },
  },
  video: {
    done: { tone: "success", title: "Vídeo pronto", action: "Ver vídeo" },
    failed: { tone: "error", title: "O vídeo parou", action: "Ver detalhes" },
    awaiting_keyframe_approval: {
      tone: "info",
      title: "Quadros do vídeo para aprovar",
      action: "Aprovar",
    },
    awaiting_audio_approval: {
      tone: "info",
      title: "Som do vídeo para aprovar",
      action: "Aprovar",
    },
  },
  avatar: {
    ready: { tone: "success", title: "Avatar pronto", action: "Ver avatar" },
    failed: { tone: "error", title: "O avatar não foi criado", action: "Ver detalhes" },
    pending_consent: { tone: "info", title: "Avatar espera o consentimento", action: "Ver avatar" },
  },
  voice: {
    ready: { tone: "success", title: "Voz pronta", action: "Ouvir voz" },
    failed: { tone: "error", title: "A voz não foi criada", action: "Ver detalhes" },
  },
  roteiro: {
    entregue: { tone: "success", title: "Roteiro pronto", action: "Revisar e gerar" },
    falhou: { tone: "error", title: "O roteiro não chegou", action: "Pedir de novo" },
  },
};

export interface InboxItem extends InboxOutcome {
  /** `tipo:id`: o mesmo item ao longo das mudanças de status. */
  key: string;
  kind: InboxKind;
  id: string;
  status: string;
  /** Nome do que terminou. */
  detail: string;
  at: string;
}

export interface InboxPiece {
  id: string;
  status: string;
  prompt: string;
  updated_at: string;
}

export interface InboxVideo {
  id: string;
  status: string;
  brief: { title?: string; smp?: string; objetivo?: string } | null;
  plan: { concept?: string } | null;
  updated_at: string;
}

export interface InboxAvatar {
  id: string;
  name: string;
  updated_at: string;
  provider_refs: {
    heygen?: { status?: string };
    higgsfield?: { status?: string };
  } | null;
}

export interface InboxVoice {
  id: string;
  name: string;
  status: string;
  updated_at: string;
}

export interface InboxRoteiro {
  id: string;
  status: string;
  briefing: string;
  updated_at: string;
}

/** Estado do preparo do avatar: HeyGen, quando há, senão o Higgsfield. */
export function avatarStatus(avatar: Pick<InboxAvatar, "provider_refs">): string | null {
  const refs = avatar.provider_refs;
  const heygen = refs?.heygen?.status;
  if (heygen) return heygen === "completed" ? "ready" : heygen;
  return refs?.higgsfield?.status ?? null;
}

function item(kind: InboxKind, id: string, status: string | null, detail: string, at: string) {
  const outcome = status ? INBOX_OUTCOMES[kind][status] : undefined;
  if (!outcome || !status) return null;
  return { ...outcome, key: `${kind}:${id}`, kind, id, status, detail, at };
}

export const INBOX_LIMIT = 30;

/** Tudo que terminou, do mais novo para o mais antigo. */
export function buildInbox(rows: {
  pieces: InboxPiece[];
  videos: InboxVideo[];
  avatars: InboxAvatar[];
  voices: InboxVoice[];
  roteiros?: InboxRoteiro[];
}): InboxItem[] {
  return [
    ...(rows.roteiros ?? []).map((r) => item("roteiro", r.id, r.status, r.briefing, r.updated_at)),
    ...rows.pieces.map((r) => item("piece", r.id, r.status, r.prompt, r.updated_at)),
    ...rows.videos.map((r) =>
      item(
        "video",
        r.id,
        r.status,
        r.plan?.concept ||
          r.brief?.smp ||
          r.brief?.title ||
          r.brief?.objetivo ||
          "Vídeo sem título",
        r.updated_at,
      ),
    ),
    ...rows.avatars.map((r) => item("avatar", r.id, avatarStatus(r), r.name, r.updated_at)),
    ...rows.voices.map((r) => item("voice", r.id, r.status, r.name, r.updated_at)),
  ]
    .filter((row): row is InboxItem => row !== null)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, INBOX_LIMIT);
}

export function isUnread(item: Pick<InboxItem, "at">, readAt: string): boolean {
  return new Date(item.at).getTime() > new Date(readAt).getTime();
}

export function unreadCount(items: InboxItem[], readAt: string): number {
  return items.filter((row) => isUnread(row, readAt)).length;
}

/** O que passou a valer desde a última leitura, para avisar uma vez por mudança. */
export function changedItems(items: InboxItem[], seen: ReadonlyMap<string, string>): InboxItem[] {
  return items.filter((row) => seen.get(row.key) !== row.status);
}

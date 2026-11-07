import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { INBOX_KEY, useInbox } from "@/hooks/use-inbox";
import { supabase } from "@/integrations/supabase/client";
import { browserNotify } from "@/lib/browser-notify";
import { changedItems, INBOX_OUTCOMES, type InboxKind, type InboxOutcome } from "@/lib/inbox";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Aviso de tarefa concluída em qualquer tela (heurística 1 de Nielsen). Peça e
// vídeo rodam por minutos em segundo plano; sem isto, quem sai da página só
// descobre o resultado se voltar para procurar. Escuta as mudanças de status
// de generation_jobs e director_jobs e avisa UMA vez por transição — pronto,
// falhou ou esperando você — com o atalho para o item.
//
// Só avisa transições que viu acontecer: o status de partida vem da semente
// (jobs ativos ao montar) ou de um evento anterior. Um job que já estava
// concluído e recebeu outra escrita não gera aviso. Avatar e voz não têm
// Realtime: a mudança vem da releitura da lista do sino (useInbox). Cada
// evento também atualiza o sino.
// ---------------------------------------------------------------------------

const SEED_LIMIT = 30;

/** Toast com atalho; com a aba em segundo plano, também o aviso do navegador. */
function announce(outcome: InboxOutcome, detail: string, go: () => void) {
  const options = { action: { label: outcome.action, onClick: go } };
  if (outcome.tone === "success") toast.success(outcome.title, options);
  else if (outcome.tone === "error") toast.error(outcome.title, options);
  else toast.info(outcome.title, options);
  browserNotify(outcome.title, detail);
}

export function TaskWatcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const seen = useRef(new Map<string, string>());
  const queryClient = useQueryClient();
  const { data: inbox } = useInbox();
  // avatar e voz: a primeira leitura é a semente; depois, só o que mudou
  const slowSeen = useRef<Map<string, string> | null>(null);
  const mountedAt = useRef(new Date().toISOString());

  useEffect(() => {
    if (!inbox) return;
    const slow = inbox.filter((item) => item.kind === "avatar" || item.kind === "voice");
    const before = slowSeen.current;
    slowSeen.current = new Map(slow.map((item) => [item.key, item.status]));
    if (!before) return;
    // leitura que falhou volta vazia: o que é anterior a esta sessão nunca vira aviso
    const fresh = slow.filter((item) => item.at > mountedAt.current);
    for (const item of changedItems(fresh, before)) {
      const to = item.kind === "avatar" ? "/marca/avatares" : "/marca/vozes";
      announce(item, item.detail, () => void navigate({ to }));
    }
  }, [inbox, navigate]);

  useEffect(() => {
    let alive = true;
    const statuses = seen.current;

    const seed = async () => {
      const [pieces, videos, roteiros] = await Promise.all([
        supabase
          .from("generation_jobs")
          .select("id, status")
          .order("created_at", { ascending: false })
          .limit(SEED_LIMIT),
        supabase
          .from("director_jobs")
          .select("id, status")
          .order("created_at", { ascending: false })
          .limit(SEED_LIMIT),
        supabase
          .from("roteiro_pedidos")
          .select("id, status")
          .order("created_at", { ascending: false })
          .limit(SEED_LIMIT),
      ]);
      if (!alive) return;
      for (const row of pieces.data ?? []) statuses.set(`piece:${row.id}`, row.status as string);
      for (const row of videos.data ?? []) statuses.set(`video:${row.id}`, row.status as string);
      for (const row of roteiros.data ?? [])
        statuses.set(`roteiro:${row.id}`, row.status as string);
    };

    const notify = (kind: InboxKind, id: string, status: string) => {
      const outcome = INBOX_OUTCOMES[kind][status];
      if (!outcome) return;
      const go = () =>
        kind === "piece"
          ? void navigate({ to: "/criar/$jobId", params: { jobId: id } })
          : kind === "roteiro"
            ? void navigate({ to: "/videos/novo", search: { rota: "avatar" } })
            : void navigate({ to: "/videos" });
      // quem já está olhando o item vê o resultado ali; o aviso seria repetição
      if (kind === "piece" && path.current.includes(id)) return;
      if (kind === "roteiro" && path.current.startsWith("/videos/novo")) return;
      announce(outcome, "", go);
    };

    const onChange =
      (kind: InboxKind) => (payload: { eventType: string; new: Record<string, unknown> }) => {
        const id = payload.new?.id;
        const status = payload.new?.status;
        if (typeof id !== "string" || typeof status !== "string") return;
        void queryClient.invalidateQueries({ queryKey: INBOX_KEY });
        const key = `${kind}:${id}`;
        const before = statuses.get(key);
        statuses.set(key, status);
        if (payload.eventType === "INSERT" || before === undefined || before === status) return;
        notify(kind, id, status);
      };

    void seed();
    const channel = supabase
      .channel("task-watcher")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generation_jobs" },
        onChange("piece"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "director_jobs" },
        onChange("video"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roteiro_pedidos" },
        onChange("roteiro"),
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [navigate, queryClient]);

  return null;
}

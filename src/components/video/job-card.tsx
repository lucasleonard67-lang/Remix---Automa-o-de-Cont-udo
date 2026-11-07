import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Music,
  RefreshCw,
  Send,
  ThumbsUp,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { BrandIcon } from "@/components/brand-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  directorStatusLabel,
  directorPublishAction,
  directorSignedUrl,
  isJobActive,
  kickDirector,
  usePublishTikTok,
  useRetryDirectorJob,
  useUpdateDirectorJobStatus,
  type DirectorJob,
  type TikTokPublishConfig,
} from "@/hooks/use-director-jobs";
import { avisoDoDrive, useDeleteVideo } from "@/hooks/use-delete-content";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";
import { usePublishDirectorInstagram, useSyncDirectorInstagram } from "@/hooks/use-zernio";
import { ProductionStudio } from "@/components/video/production-studio";
import { useSceneEdit } from "@/components/video/scene-edit";
import { JobCover, jobTitle } from "@/components/video/job-cover";
import { PolishStrip, type PolishView } from "@/components/video/polish-strip";
import { humanizeError } from "@/lib/humanize-error";
import { promptDeMontagem, urlDoClaude } from "@/lib/claude-prompt";

// ---------------------------------------------------------------------------
// Produção da biblioteca de vídeos. Fechada: miniatura, título, status e a
// régua de etapas. Aberta: o estúdio (palco 9:16 + storyboard das cenas), os
// gates, A/B e publicação. Ações mudam a máquina de estados e o Realtime
// atualiza sozinho.
// ---------------------------------------------------------------------------

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "failed" || status === "canceled") return "destructive";
  if (status.startsWith("awaiting")) return "outline";
  return "secondary";
}

export function JobCard({
  job,
  embedded = false,
}: {
  job: DirectorJob;
  /** dentro do painel da galeria: já aberto, sem miniatura nem recolher */
  embedded?: boolean;
}) {
  const updateStatus = useUpdateDirectorJobStatus();
  const retry = useRetryDirectorJob();
  const sceneEdit = useSceneEdit(job);
  // Aprimorar com IA: com versão editada, o palco abre nela
  const [polishView, setPolishView] = useState<PolishView>("edited");
  const editedPath = polishView === "edited" ? (job.artifacts.edited?.path ?? null) : null;
  // falhou ou espera a pessoa: nasce aberto — o motivo e a ação não podem ficar escondidos
  const [expanded, setOpen] = useState(
    () => job.status === "failed" || job.status.startsWith("awaiting"),
  );
  const open = embedded || expanded;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { isAdmin } = useIsAdmin();
  const deleteVideo = useDeleteVideo();
  // e abre também quando o status MUDA para falha/espera (Realtime); nunca fecha sozinho
  const lastStatus = useRef(job.status);
  useEffect(() => {
    if (lastStatus.current === job.status) return;
    lastStatus.current = job.status;
    if (job.status === "failed" || job.status.startsWith("awaiting")) setOpen(true);
  }, [job.status]);

  const spent = job.costs?.hf_credits_spent;
  const shots = job.plan?.shots ?? [];
  const noBudget = Number(job.config?.budget_credits ?? 0) <= 0;

  const cancel = () =>
    updateStatus.mutate(
      { id: job.id, status: "canceled", fromStatus: job.status },
      {
        onSuccess: () => toast.success("Produção cancelada."),
        onError: (err) => toast.error(err.message),
      },
    );

  const remove = () =>
    deleteVideo.mutate(job.id, {
      onSuccess: ({ drive_pendente }) =>
        toast.success("Vídeo excluído.", { description: avisoDoDrive(drive_pendente) }),
      onError: (err) => toast.error(err.message),
    });

  return (
    <article className="py-3" data-testid="video-job">
      <div
        {...(embedded
          ? { className: "flex gap-4 px-3 py-2 sm:px-4" }
          : {
              role: "button",
              tabIndex: 0,
              "aria-expanded": open,
              className:
                "via-row-signature flex cursor-pointer gap-4 rounded-[18px] p-3 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] sm:p-4",
              onClick: () => setOpen((o) => !o),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              },
            })}
      >
        {embedded ? null : (
          <JobCover job={job} className="hidden w-14 shrink-0 rounded-[12px] sm:block" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 text-base font-medium leading-snug tracking-[-0.01em] text-[var(--via-text-primary)]">
              {jobTitle(job)}
            </h3>
            <div className="flex items-center gap-2">
              {isJobActive(job) && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              )}
              <Badge variant={statusVariant(job.status)}>{directorStatusLabel(job)}</Badge>
              {embedded ? null : (
                <ChevronDown
                  className={cn(
                    "size-4 text-[var(--via-text-muted)] transition-transform duration-200",
                    open && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-[var(--via-text-muted)]">
            <span>
              {new Date(job.created_at).toLocaleString("pt-BR")}
              {shots.length > 0 && ` · ${shots.length} cenas`}
              {typeof spent === "number" &&
                spent > 0 &&
                ` · ${spent.toFixed(0)} créditos Higgsfield`}
            </span>
            {/* teto <= 0 = sem limite: quem revisa precisa enxergar isso */}
            {noBudget ? <Badge variant="outline">Sem teto de créditos</Badge> : null}
          </div>
          <PipelineBar job={job} />
          {job.status === "queued" && <StaleQueueLine since={job.updated_at || job.created_at} />}
        </div>
      </div>
      {open && (
        <div className="space-y-5 px-3 pb-4 pt-3 sm:px-4">
          {(job.artifacts as { voice_note?: string }).voice_note ? (
            <p className="text-sm text-[var(--via-text-muted)]">
              {(job.artifacts as { voice_note?: string }).voice_note}
            </p>
          ) : null}
          {job.error && (
            <Alert variant="destructive">
              <AlertDescription className="space-y-2">
                <p>{humanizeError(job.error)}</p>
                {/* a frase traduzida às vezes esconde a causa ("sem conexão"):
                    o texto original fica a um clique, para diagnosticar */}
                <details className="text-xs">
                  <summary className="cursor-pointer select-none opacity-80">
                    Detalhe técnico
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{job.error}</pre>
                </details>
                <ErrorFix error={job.error} />
              </AlertDescription>
            </Alert>
          )}
          {job.status === "awaiting_keyframe_approval" && (
            <GateBar
              label="Quadros de referência prontos. Confira as imagens abaixo e aprove para gerar as cenas."
              onApprove={() =>
                updateStatus.mutate(
                  { id: job.id, status: "videos", fromStatus: "awaiting_keyframe_approval" },
                  {
                    onSuccess: () => toast.success("Quadros aprovados. Gerando as cenas."),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              pending={updateStatus.isPending}
            />
          )}
          {job.status === "awaiting_audio_approval" && (
            <GateBar
              label="Vídeo montado. Ouça o som e aprove para finalizar."
              onApprove={() =>
                updateStatus.mutate(
                  { id: job.id, status: "done", fromStatus: "awaiting_audio_approval" },
                  {
                    onSuccess: () => toast.success("Vídeo aprovado. Já pode publicar."),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              pending={updateStatus.isPending}
            />
          )}
          {(job.artifacts as { claude?: unknown }).claude ? <ClaudeBar job={job} /> : null}
          {job.status === "failed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                retry.mutate(job, {
                  onSuccess: () => toast.success("Produção retomada de onde parou."),
                  onError: (err) => toast.error(err.message),
                })
              }
              disabled={retry.isPending}
            >
              <RefreshCw aria-hidden="true" /> Retomar produção
            </Button>
          )}
          <ProductionStudio job={job} edit={sceneEdit} finalPath={editedPath} />
          {job.status === "done" && job.artifacts.final && (
            <PolishStrip job={job} view={polishView} onView={setPolishView} />
          )}
          {(job.artifacts.ab_videos?.length ?? 0) > 0 && <AbStrip job={job} />}
          {job.artifacts.ab_error && (
            <p className="text-xs text-muted-foreground">
              {/grupo multi-cena/.test(job.artifacts.ab_error)
                ? "A cena de comparação não foi gerada: o roteiro deste vídeo não tem cenas encadeadas. O vídeo principal não é afetado."
                : `A cena de comparação falhou: ${humanizeError(job.artifacts.ab_error)} O vídeo principal não é afetado.`}
            </p>
          )}
          {(job.status === "done" || job.status === "publishing") && job.artifacts.final && (
            <TikTokSection job={job} />
          )}
          {job.status === "done" && job.artifacts.final && <InstagramSection job={job} />}
          {/* cancelar vale em qualquer etapa ativa: de planning a muxing a
              produção paga continua por 10-20 min sem isso. Gerações já
              enviadas ao provedor seguem cobradas — a confirmação avisa. */}
          {isAdmin && ["done", "failed", "canceled"].includes(job.status) && (
            <Button
              size="sm"
              variant="outline"
              className="border-destructive text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden="true" /> Excluir
            </Button>
          )}
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir este vídeo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Os arquivos saem daqui e não voltam. O que já foi publicado continua na rede.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Manter</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  disabled={deleteVideo.isPending}
                  onClick={remove}
                >
                  {deleteVideo.isPending ? "Excluindo…" : "Excluir"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {(isJobActive(job) || job.status.startsWith("awaiting")) && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                const paid = job.status !== "queued" && !job.status.startsWith("awaiting");
                if (paid) setConfirmCancel(true);
                else cancel();
              }}
            >
              <XCircle aria-hidden="true" /> Cancelar
            </Button>
          )}
          <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar a produção?</AlertDialogTitle>
                <AlertDialogDescription>
                  O que já foi enviado ao provedor continua cobrado.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Continuar produzindo</AlertDialogCancel>
                <AlertDialogAction onClick={cancel}>Cancelar produção</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </article>
  );
}

// Régua do vídeo de cenas (Diretor). Os estúdios (remake, avatar, agente)
// têm etapas próprias e só mostram o status.
const PIPELINE: Array<{ label: string; statuses: string[] }> = [
  { label: "Roteiro", statuses: ["queued", "planning", "plan_ready"] },
  { label: "Voz", statuses: ["tts"] },
  { label: "Quadros", statuses: ["keyframes", "awaiting_keyframe_approval"] },
  { label: "Cenas", statuses: ["videos"] },
  {
    label: "Montagem",
    statuses: [
      "muxing",
      "concatenating",
      "bed",
      "assembling",
      "awaiting_audio_approval",
      "mastering",
    ],
  },
  { label: "Pronto", statuses: ["done", "publishing"] },
];

/** Etapa em que o job parou, deduzida do que já foi produzido. */
function stoppedAt(job: DirectorJob): number {
  const a = job.artifacts ?? {};
  if (a.final) return 5;
  if ((a.videos?.length ?? 0) > 0 || (a.pending_vid?.length ?? 0) > 0) return 3;
  // quadros todos prontos: parou ao gerar as cenas
  const shots = job.plan?.shots?.length ?? 0;
  if ((a.keyframes?.length ?? 0) > 0) return shots && (a.keyframes?.length ?? 0) >= shots ? 3 : 2;
  if ((a.tts?.length ?? 0) > 0) return 1;
  return 0;
}

function PipelineBar({ job }: { job: DirectorJob }) {
  if (job.config?.mode) return null;
  const failed = job.status === "failed" || job.status === "canceled";
  const found = PIPELINE.findIndex((p) => p.statuses.includes(job.status));
  const at = failed ? stoppedAt(job) : Math.max(0, found);
  const done = job.status === "done" || job.status === "publishing";
  return (
    <ol className="flex max-w-xl gap-1.5 pt-1" aria-label="Etapas da produção">
      {PIPELINE.map((step, i) => {
        const state =
          done || i < at
            ? "done"
            : i === at
              ? failed
                ? "failed"
                : job.status.startsWith("awaiting")
                  ? "waiting"
                  : "running"
              : "pending";
        return (
          <li
            key={step.label}
            className="min-w-0 flex-1"
            aria-current={i === at && !done ? "step" : undefined}
          >
            <span
              className={cn(
                "relative block h-1 overflow-hidden rounded-full",
                state === "done" && "bg-[var(--via-navy)]",
                state === "running" && "ce-segment-current bg-[var(--via-navy-14)]",
                state === "waiting" && "bg-[var(--via-brand-blue)]",
                state === "failed" && "bg-[var(--via-coral)]",
                state === "pending" && "bg-[var(--via-navy-06)]",
              )}
            />
            <span
              className={cn(
                "mt-1 block truncate text-xs leading-tight",
                state === "pending"
                  ? "text-[var(--via-text-faint)]"
                  : state === "failed"
                    ? "text-[var(--via-coral)]"
                    : state === "done"
                      ? "text-[var(--via-text-muted)]"
                      : "font-medium text-[var(--via-text-primary)]",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const STALE_QUEUE_MS = 2 * 60 * 1000;

/**
 * Pedido parado em "Na fila" há mais de 2 min: o motor (agendamento) não puxou.
 * Admin ganha um empurrão manual (a edge só aceita JWT de admin); os demais,
 * só o aviso. Um timeout único acorda no instante em que vira "parado".
 */
function StaleQueueLine({ since }: { since: string }) {
  const { isAdmin } = useIsAdmin();
  const sinceMs = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());
  const remaining = Number.isFinite(sinceMs) ? sinceMs + STALE_QUEUE_MS - now : Infinity;
  useEffect(() => {
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 500);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  const [busy, setBusy] = useState(false);
  const cooldown = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (cooldown.current) window.clearTimeout(cooldown.current);
    },
    [],
  );
  if (remaining > 0) return null;

  const tryNow = async () => {
    setBusy(true);
    const ok = await kickDirector();
    if (ok) {
      toast.info("Motor acionado. O pedido deve sair da fila em instantes.");
      // segura o botão um pouco: o tick leva alguns segundos para aparecer
      cooldown.current = window.setTimeout(() => setBusy(false), 30_000);
    } else {
      toast.error("Não deu para acionar o motor agora.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--via-text-muted)]">
      <span>
        {isAdmin
          ? "O motor de vídeo não puxou este pedido ainda."
          : "O motor de vídeo não puxou este pedido ainda. Se passar de 5 min, avise o administrador."}
      </span>
      {isAdmin ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={(e) => {
            // o cabeçalho inteiro abre/fecha o card — o clique não deve propagar
            e.stopPropagation();
            void tryNow();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <RefreshCw aria-hidden="true" /> Tentar agora
        </Button>
      ) : null}
    </div>
  );
}

function GateBar({
  label,
  onApprove,
  pending,
}: {
  label: string;
  onApprove: () => void;
  pending: boolean;
}) {
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{label}</span>
        <Button size="sm" onClick={onApprove} disabled={pending}>
          <ThumbsUp aria-hidden="true" /> Aprovar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Sem o Higgsfield, a montagem e a legenda são do Claude da pessoa (conector
 * personalizado): a barra diz o que falta e abre o Claude com o pedido escrito.
 */
function ClaudeBar({ job }: { job: DirectorJob }) {
  const tipo =
    (job.artifacts as { claude?: { tipo?: string } }).claude?.tipo === "legenda"
      ? "legenda"
      : "montagem";
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {tipo === "legenda"
            ? "Vídeo montado. Falta o seu Claude pôr a legenda."
            : "Cenas prontas. Falta o seu Claude montar o vídeo."}
        </span>
        <Button asChild size="sm">
          <a
            href={urlDoClaude(promptDeMontagem(job.id, tipo))}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="abrir-no-claude"
          >
            <BrandIcon name="claude" />
            Abrir no Claude
          </a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Clipes do experimento A/B multi-cena lado a lado, com rótulo do modelo. */
function AbStrip({ job }: { job: DirectorJob }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        (job.artifacts.ab_videos ?? []).map(async (ab) => {
          try {
            return [ab.path, await directorSignedUrl(ab.path, 7200, { restore: false })] as const;
          } catch {
            return [ab.path, ""] as const;
          }
        }),
      );
      if (alive) setUrls(Object.fromEntries(entries.filter(([, u]) => u)));
    })();
    return () => {
      alive = false;
    };
  }, [job.artifacts.ab_videos]);

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-[var(--via-text-primary)]">
        Mesma cena em outro modelo, para comparar
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(job.artifacts.ab_videos ?? []).map((ab) => (
          <div key={ab.path} className="shrink-0">
            {urls[ab.path] ? (
              <video
                src={urls[ab.path]}
                controls
                playsInline
                className="aspect-[9/16] w-44 rounded-[10px] border border-[var(--via-border-soft)] bg-black"
              />
            ) : (
              <Skeleton className="aspect-[9/16] w-44 rounded-[10px]" />
            )}
            <p className="mt-1 text-center text-xs text-muted-foreground">
              sequência {ab.group} · {ab.model}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const TIKTOK_PRIVACY_OPTIONS = [
  { value: "SELF_ONLY", label: "Só eu (teste seguro)" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Amigos" },
  { value: "FOLLOWER_OF_CREATOR", label: "Seguidores" },
  { value: "PUBLIC_TO_EVERYONE", label: "Público" },
] as const;

/** Legenda inicial: as falas do roteiro em sequência + o CTA do briefing. */
function defaultCaption(job: DirectorJob): string {
  const speech = (job.plan?.shots ?? [])
    .map((s) => s.speech.trim())
    .filter(Boolean)
    .join(" ");
  const cta = job.brief.cta?.trim();
  return [speech, cta && !speech.includes(cta) ? cta : ""].filter(Boolean).join("\n\n");
}

/** Reel no Instagram via Zernio: publica na hora, estado volta pelo webhook/Realtime. */
function InstagramSection({ job }: { job: DirectorJob }) {
  const publish = usePublishDirectorInstagram();
  const sync = useSyncDirectorInstagram();
  const ig = job.artifacts.instagram;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [caption, setCaption] = useState("");

  const send = () =>
    publish.mutate(
      { jobId: job.id, caption },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success("Enviado ao Instagram", {
            description: "O status muda aqui quando o Instagram confirmar.",
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );

  if (ig?.status === "published") {
    return (
      <Alert>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          Publicado no Instagram.
          {ig.url && (
            <a
              href={ig.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Abrir <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (ig?.status === "pending" || ig?.status === "publishing") {
    return (
      <Alert>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Publicando no Instagram. Leva alguns minutos; clique em “Atualizar” para ver o status.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => sync.mutate(job.id, { onError: (err) => toast.error(err.message) })}
            disabled={sync.isPending}
          >
            <RefreshCw aria-hidden="true" /> Atualizar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {ig?.status === "failed" && (
        <Alert variant="destructive">
          <AlertDescription className="break-all">
            O Instagram recusou o envio: {humanizeError(ig.error)}
          </AlertDescription>
        </Alert>
      )}
      {!open ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCaption((c) => c || defaultCaption(job));
            setOpen(true);
          }}
        >
          <BrandIcon name="instagram" />
          {ig?.status === "failed" ? "Tentar de novo no Instagram" : "Publicar no Instagram"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-[14px] border border-[var(--via-border-soft)] bg-[var(--via-bg-soft)] p-3">
          <div className="space-y-1.5">
            <Label htmlFor={`ig-caption-${job.id}`}>Legenda do Reel</Label>
            <Textarea
              id={`ig-caption-${job.id}`}
              value={caption}
              maxLength={2200}
              rows={5}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirm(true)} disabled={publish.isPending}>
              {publish.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Publicar Reel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              Sai na conta ligada para Reels.
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => openIntegration("zernio")}
              >
                Trocar conta
              </Button>
            </span>
          </div>
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar no Instagram agora?</AlertDialogTitle>
            <AlertDialogDescription>
              O Reel sai na hora, via Zernio, na conta ligada para Reels. Não dá para desfazer por
              aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={send}>Publicar agora</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Publicação TikTok: estado + formulário; o job vai pra 'publishing' e o cron executa. */
function TikTokSection({ job }: { job: DirectorJob }) {
  const publish = usePublishTikTok();
  const tiktok = job.artifacts.tiktok;
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<{ connected: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [tracksRaw, setTracksRaw] = useState<string | null>(null);
  const [form, setForm] = useState<{
    mode: TikTokPublishConfig["mode"];
    title: string;
    privacy: string;
    musicId: string;
    confirmed: boolean;
  }>({ mode: "UPLOAD_TO_DRAFT", title: "", privacy: "SELF_ONLY", musicId: "", confirmed: false });

  const checkAccount = async () => {
    setChecking(true);
    try {
      const res = await directorPublishAction<{ connected: boolean }>("accounts");
      setAccount(res);
      if (!res.connected)
        toast.info("Nenhuma conta TikTok conectada. Clique em “Conectar TikTok”.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const connect = async () => {
    // abre a aba SINCRONAMENTE no clique (popup blocker mata window.open pós-await)
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await directorPublishAction<{ authorize_url: string }>("connect");
      if (tab) tab.location.href = res.authorize_url;
      else window.open(res.authorize_url, "_blank", "noopener");
      toast.info("Autorize na aba que abriu e depois clique em “Verificar conexão”.");
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const loadMusic = async () => {
    try {
      const res = await directorPublishAction<{ tracks_raw: string }>("music");
      setTracksRaw(res.tracks_raw);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (job.status === "publishing") {
    return (
      <Alert>
        <AlertDescription className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Publicando no TikTok. O status muda aqui quando terminar.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {tiktok?.status === "published" && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {`Publicado no TikTok${tiktok.mode === "UPLOAD_TO_DRAFT" ? " (rascunho no app)" : ""}.`}
            {tiktok.url && (
              <a
                href={tiktok.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                Abrir <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </AlertDescription>
        </Alert>
      )}
      {(tiktok?.status === "error" || tiktok?.status === "timeout") && (
        <Alert variant={tiktok.status === "error" ? "destructive" : "default"}>
          <AlertDescription className="break-all">
            O TikTok não publicou: {humanizeError(tiktok.error)} Clique em “Publicar de novo”.
          </AlertDescription>
        </Alert>
      )}
      {!open ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(true);
            setForm((f) => ({ ...f, title: f.title || job.plan?.concept || "" }));
            void checkAccount();
          }}
        >
          <BrandIcon name="tiktok" /> {tiktok?.status ? "Publicar de novo" : "Publicar no TikTok"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-[14px] border border-[var(--via-border-soft)] bg-[var(--via-bg-soft)] p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Conta TikTok:</span>
            {account == null ? (
              <span className="text-muted-foreground">verificando conexão…</span>
            ) : account.connected ? (
              <Badge>Conectada</Badge>
            ) : (
              <>
                <Badge variant="outline">Não conectada</Badge>
                <Button size="sm" variant="outline" onClick={connect}>
                  <BrandIcon name="tiktok" />
                  Conectar TikTok
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={checkAccount} disabled={checking}>
              {checking ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              Verificar conexão
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`tt-mode-${job.id}`}>Destino</Label>
              <Select
                value={form.mode}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, mode: v as TikTokPublishConfig["mode"] }))
                }
              >
                <SelectTrigger id={`tt-mode-${job.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UPLOAD_TO_DRAFT">Rascunho no TikTok (recomendado)</SelectItem>
                  <SelectItem value="DIRECT_POST">Publicar direto no perfil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.mode === "DIRECT_POST" && (
              <div className="space-y-1.5">
                <Label htmlFor={`tt-priv-${job.id}`}>Privacidade</Label>
                <Select
                  value={form.privacy}
                  onValueChange={(v) => setForm((f) => ({ ...f, privacy: v }))}
                >
                  <SelectTrigger id={`tt-priv-${job.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIKTOK_PRIVACY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`tt-title-${job.id}`}>Legenda / título (máx. 150)</Label>
            <Input
              id={`tt-title-${job.id}`}
              maxLength={150}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          {form.mode === "DIRECT_POST" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`tt-music-${job.id}`}>Música (opcional)</Label>
                <Button size="sm" variant="ghost" onClick={loadMusic}>
                  <Music aria-hidden="true" /> Ver músicas em alta
                </Button>
              </div>
              <Input
                id={`tt-music-${job.id}`}
                placeholder="cole o ID de uma música em alta"
                value={form.musicId}
                onChange={(e) => setForm((f) => ({ ...f, musicId: e.target.value }))}
              />
              {tracksRaw && (
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-[10px] border bg-muted p-2 text-xs">
                  {tracksRaw}
                </pre>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.confirmed}
              onCheckedChange={(v) => setForm((f) => ({ ...f, confirmed: v }))}
            />
            Assisti ao vídeo final e confirmo a publicação. O conteúdo foi gerado por IA.
          </label>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!form.confirmed || !account?.connected || publish.isPending}
              onClick={() =>
                publish.mutate(
                  {
                    job,
                    tiktok: {
                      mode: form.mode,
                      title: form.title.trim() || undefined,
                      privacy_level: form.mode === "DIRECT_POST" ? form.privacy : undefined,
                      music_sound_id:
                        form.mode === "DIRECT_POST" && form.musicId.trim()
                          ? form.musicId.trim()
                          : undefined,
                      music_volume: 30,
                      original_volume: 100,
                      confirmed: true,
                    },
                  },
                  {
                    onSuccess: () => {
                      toast.success("Publicação na fila. Sai em cerca de 1 minuto.");
                      setOpen(false);
                    },
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              {publish.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Publicar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Erro de chave/permissão: leva direto aonde se conserta — a página do
// provedor (no lugar exato da edição) e a janela do app onde se cola a chave.
// ---------------------------------------------------------------------------

type IntegrationTarget = "elevenlabs" | "heygen" | "higgsfield" | "replicate";

// Plano do provedor não inclui o recurso (não é chave nem permissão): o caminho
// é a página de planos, e a alternativa sem custo vai no texto.
const PLAN_FIXES: Array<{ test: RegExp; url: string; label: string; hint: string }> = [
  {
    test: /paid_plan_required|can_not_use_instant_voice_cloning|subscription does not include/i,
    url: "https://elevenlabs.io/app/subscription",
    label: "Ver planos do ElevenLabs",
    hint: 'O plano atual do ElevenLabs não clona voz (o clone instantâneo começa no Starter). Assine e clique em "Retomar produção", ou crie de novo escolhendo voz feminina, masculina ou outra voz (Voice ID).',
  },
];

const FIXES: Array<{
  test: RegExp;
  integration: IntegrationTarget;
  url?: string;
  urlLabel?: string;
  appLabel: string;
}> = [
  {
    // permissão faltando na chave (ex.: voices_write para clonar a voz)
    test: /elevenlabs|missing the permission|voices_write|text_to_speech|speech_to_text|sound_generation/i,
    integration: "elevenlabs",
    url: "https://elevenlabs.io/app/settings/api-keys",
    urlLabel: "Editar permissões da chave no ElevenLabs",
    appLabel: "Colar chave nova do ElevenLabs",
  },
  {
    test: /heygen/i,
    integration: "heygen",
    url: "https://app.heygen.com/settings?nav=API",
    urlLabel: "Abrir a chave de API no HeyGen",
    appLabel: "Colar chave nova do HeyGen",
  },
  {
    test: /higgsfield|MCP /i,
    integration: "higgsfield",
    appLabel: "Reconectar o Higgsfield",
  },
  {
    test: /replicate/i,
    integration: "replicate",
    url: "https://replicate.com/account/api-tokens",
    urlLabel: "Abrir os tokens no Replicate",
    appLabel: "Colar token novo do Replicate",
  },
];

const KEY_PROBLEM =
  /chave|api key|token|permiss|permission|unauthori[sz]ed|n[aã]o conectad|not connected|reconect|credit|cr[eé]dito|missing_permissions/i;

function ErrorFix({ error }: { error: string }) {
  const plan = PLAN_FIXES.find((item) => item.test.test(error));
  if (plan) {
    return (
      <div className="space-y-2 pt-1">
        <p className="text-sm">{plan.hint}</p>
        <Button asChild size="sm" variant="outline">
          <a href={plan.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            {plan.label}
          </a>
        </Button>
      </div>
    );
  }
  if (!KEY_PROBLEM.test(error)) return null;
  const fix = FIXES.find((item) => item.test.test(error));
  if (!fix) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {fix.url ? (
        <Button asChild size="sm" variant="outline">
          <a href={fix.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            {fix.urlLabel}
          </a>
        </Button>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => openIntegration(fix.integration)}>
        {fix.appLabel}
      </Button>
    </div>
  );
}

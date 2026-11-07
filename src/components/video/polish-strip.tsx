import { Check, Loader2, Paperclip, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { PromptField } from "@/components/prompt/prompt-tools";
import { Button } from "@/components/ui/button";
import { promptDeEdicao, urlDoClaude, type PlanoResumido } from "@/lib/claude-prompt";
import { EditPanel } from "@/components/video/edit-panel";
import type { DirectorJob } from "@/hooks/use-director-jobs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  isEditActive,
  useApplyEdits,
  useApplyPlan,
  useLatestVideoEdit,
  useOpenEdit,
  usePlanEdit,
  useRevertEdit,
  useUploadEditFile,
  type EditAttachment,
  type EditSuggestion,
  type PlanDraft,
  type VideoEdit,
  useVideoEditVersions,
  type VideoEditVersion,
} from "@/hooks/use-video-edit";
import { useMcpTokens } from "@/hooks/use-mcp-tokens";
import { useSignedUrl } from "@/hooks/use-storage";
import { connectorState } from "@/lib/mcp-connector-state";
import { openIntegration } from "@/lib/integration-modal";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Editar com Claude: faixa embaixo do vídeo pronto. O painel faz os ajustes e as
// inserções direto; o pedido em texto vai para o Claude da própria pessoa, pelo
// conector, sem a API. O original nunca muda.
// Contrato: docs/hub-motor-contratos.md §11; desenho: docs/editor-por-prompt/.
// ---------------------------------------------------------------------------

export type PolishView = "edited" | "original";

const REQUEST_MAX = 2000;
const ACCEPT =
  "video/mp4,video/quicktime,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/mp4,.m4a,.wav,.mp3";

const STEP_LABEL: Partial<Record<VideoEdit["status"], string>> = {
  analyzing: "Preparando o vídeo…",
  queued: "Na fila da edição…",
  rendering: "Editando o vídeo…",
  checking: "Conferindo o resultado…",
};

/** Exemplos: tocar escreve a frase no campo; nunca é um segundo fluxo. */
const IDEAS = [
  { label: "Respiros limpos", phrase: "Cortar respiros e vícios de fala." },
  { label: "Título forte", phrase: "Colocar um título forte no começo." },
  { label: "Legenda animada", phrase: "Colocar legenda palavra a palavra na cor da marca." },
  {
    label: "Dado com fonte",
    phrase: "Pesquisar um dado sobre o assunto e mostrar na tela com a fonte.",
  },
  { label: "Tela dividida", phrase: "Dividir a tela com o vídeo que enviei." },
  { label: "Vídeo por cima", phrase: "Colocar o vídeo que enviei por cima da fala." },
  { label: "Deixe o Claude escolher", phrase: "Melhorar este vídeo para reter mais." },
];

export function PolishStrip({
  job,
  view,
  onView,
}: {
  job: DirectorJob;
  view: PolishView;
  onView: (view: PolishView) => void;
}) {
  const { isAdmin } = useIsAdmin();
  const latest = useLatestVideoEdit(job.id);
  const edit = latest.data;
  const apply = useApplyEdits(job.id);
  const applyPlan = useApplyPlan(job.id);
  const plan = usePlanEdit(job.id);
  const open = useOpenEdit(job.id);
  const revert = useRevertEdit(job.id);
  const edited = job.artifacts.edited ?? null;
  // montagem pelo plano do roteiro: o que o servidor registrou ao abrir o pedido
  const montagem = (job.artifacts as { montagem?: { edit_id?: string; erro?: string } }).montagem;
  const [wantsChange, setChanging] = useState(false);
  const mcp = connectorState(useMcpTokens().data ?? []).state;
  // acesso criado já conta: o uso só aparece depois da primeira chamada do Claude
  const accountReady = mcp !== "off";
  const editedId = edited?.edit_id ?? null;

  // edição nova pronta: o palco passa a mostrar o resultado
  useEffect(() => {
    if (editedId) onView("edited");
    // `onView` muda a cada render de quem chama; só a edição nova dispara
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedId]);

  const fail = (error: Error) => toast.error(error.message);
  const versoes = useVideoEditVersions(job.id);
  const promptDaEdicao = edit
    ? promptDeEdicao({
        editId: edit.id,
        pedido: edit.analysis.request,
        plano: (edit.analysis as { plano?: PlanoResumido }).plano ?? null,
      })
    : "";

  // só administradores editam; motor sem a tabela: nada de botão que não funciona
  if (!isAdmin || edit === false) return null;
  if (edit === undefined) {
    if (!latest.isError) return null;
    return (
      <section className="flex flex-wrap items-center gap-3 border-t border-[var(--via-border-soft)] pt-4">
        <p className="text-sm text-[var(--via-text-muted)]">Não deu para carregar a edição.</p>
        <Button size="sm" variant="outline" onClick={() => void latest.refetch()}>
          Tentar de novo
        </Button>
      </section>
    );
  }

  const draft = edit?.status === "suggested" ? edit.analysis.draft : undefined;
  const changing = wantsChange && !isEditActive(edit);
  const waitingClaude =
    edit?.status === "suggested" &&
    edit.analysis.external &&
    !draft &&
    Boolean(edit.analysis.request);
  const panelReady = Boolean(edit?.analysis.words);
  const stepsOfDraft = (plan_: VideoEdit) =>
    plan_.plan?.steps ?? plan_.analysis.draft?.steps.map((_, index) => index) ?? [];
  const askPlan = (request: string, attachments: string[]) =>
    plan.mutate(
      { request, attachments, connector: true },
      { onError: fail, onSuccess: () => setChanging(false) },
    );

  const composer = accountReady ? (
    <RequestComposer
      initial={edit?.analysis.request ?? ""}
      initialFiles={edit?.analysis.attachments ?? []}
      pending={plan.isPending}
      onSubmit={askPlan}
      onCancel={changing ? () => setChanging(false) : undefined}
    />
  ) : (
    <Button size="sm" variant="outline" onClick={() => openIntegration("claude_editor")}>
      Conectar editor
    </Button>
  );

  return (
    <section
      className="space-y-3 border-t border-[var(--via-border-soft)] pt-4"
      aria-label="Editar com Claude"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--via-text-primary)]">
          <BrandIcon name="claude" className="size-4" />
          Editar com Claude
        </h3>
        {edited ? <ViewSwitch view={view} onView={onView} /> : null}
      </header>
      {versoes.data && versoes.data.length > 1 ? (
        <ol
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--via-text-muted)]"
          aria-label="Versões editadas"
        >
          {versoes.data.map((v, i) => (
            <VersaoLink key={v.id} versao={v} numero={versoes.data!.length - i} />
          ))}
        </ol>
      ) : null}

      {edited && edit?.status !== "ready" && !isEditActive(edit) ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={revert.isPending}
          onClick={() =>
            revert.mutate(edited.edit_id, { onError: fail, onSuccess: () => onView("original") })
          }
        >
          <RotateCcw aria-hidden="true" />
          Voltar ao original
        </Button>
      ) : null}

      {!edit ? (
        <Button
          size="sm"
          disabled={open.isPending}
          onClick={() => open.mutate(undefined, { onError: fail })}
        >
          {open.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Abrir editor
        </Button>
      ) : isEditActive(edit) ? (
        <p className="flex items-center gap-2 text-sm text-[var(--via-text-muted)]" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {STEP_LABEL[edit.status]} Pode sair desta tela.
        </p>
      ) : changing ? (
        composer
      ) : montagem?.erro && !edit ? (
        <p className="text-sm text-[var(--via-text-muted)]" role="status">
          <span className="font-medium text-[var(--via-text-primary)]">
            A montagem pelo plano não abriu.
          </span>{" "}
          {montagem.erro} Peça a edição abaixo de novo.
        </p>
      ) : waitingClaude ? (
        <div className="space-y-3">
          <p
            className="flex items-center gap-2 text-sm text-[var(--via-text-primary)]"
            role="status"
          >
            {edit.analysis.aguardando_pessoa ? null : (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {edit.analysis.aguardando_pessoa
              ? "O seu Claude precisa de você para continuar a montagem."
              : "Pedido enviado para o seu Claude."}
          </p>
          <p className="text-xs text-[var(--via-text-muted)]">
            O Claude abre com o pedido pronto, edita e a versão nova aparece aqui. O original fica
            guardado.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <a href={urlDoClaude(promptDaEdicao)} target="_blank" rel="noopener noreferrer">
                Abrir no Claude
              </a>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={revert.isPending}
              onClick={() => revert.mutate(edit.id, { onError: fail })}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : draft ? (
        <PlanReview
          draft={draft}
          pending={applyPlan.isPending}
          onChange={() => setChanging(true)}
          onApply={(steps) => applyPlan.mutate({ editId: edit.id, steps }, { onError: fail })}
        />
      ) : edit.status === "suggested" && edit.analysis.suggestions?.length ? (
        <SuggestionPicker
          suggestions={edit.analysis.suggestions ?? []}
          pending={apply.isPending}
          onApply={(ids) =>
            apply.mutate({ editId: edit.id, suggestionIds: ids }, { onError: fail })
          }
        />
      ) : edit.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-[var(--via-text-muted)]">
            {edit.error ?? "A edição não deu certo. O vídeo original continua igual."}
          </p>
          {edit.artifacts?.last_error ? (
            <details className="w-full text-xs text-[var(--via-text-muted)]">
              <summary className="cursor-pointer">Detalhe técnico</summary>
              <p className="mt-1 break-words font-mono">{edit.artifacts.last_error}</p>
            </details>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // o plano já pago é reaplicado; sem plano, volta para o pedido
              if (edit.plan?.ops?.length && !edit.plan.steps) {
                apply.mutate({ editId: edit.id, ops: edit.plan.ops }, { onError: fail });
              } else if (edit.analysis.draft) {
                applyPlan.mutate({ editId: edit.id, steps: stepsOfDraft(edit) }, { onError: fail });
              } else if (edit.analysis.request) {
                setChanging(true);
              } else {
                open.mutate(undefined, { onError: fail });
              }
            }}
            disabled={open.isPending || applyPlan.isPending || apply.isPending}
          >
            Tentar de novo
          </Button>
          {edit.analysis.draft ? (
            <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
              Mudar o pedido
            </Button>
          ) : null}
        </div>
      ) : panelReady ? (
        <div className="space-y-3">
          {edit.status === "ready" && edit.plan?.dropped?.length ? (
            <p className="text-xs text-[var(--via-text-muted)]">{edit.plan.dropped.join(" ")}</p>
          ) : null}
          <EditPanel
            key={edit.id}
            edit={edit}
            composer={composer}
            busy={apply.isPending || revert.isPending}
            canRevert={edit.status === "ready"}
            onApply={(ops, attachments) =>
              apply.mutate({ editId: edit.id, ops, attachments }, { onError: fail })
            }
            onRevert={() =>
              revert.mutate(edit.id, {
                onError: fail,
                onSuccess: () => onView("original"),
              })
            }
          />
        </div>
      ) : (
        composer
      )}
    </section>
  );
}

const KIND_NAME: Record<EditAttachment["kind"], string> = {
  video: "Vídeo enviado",
  image: "Imagem enviada",
  audio: "Música enviada",
};

function RequestComposer({
  initial,
  initialFiles,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: string;
  initialFiles: { path: string; kind: EditAttachment["kind"] }[];
  pending: boolean;
  onSubmit: (request: string, attachments: string[]) => void;
  onCancel?: () => void;
}) {
  const [request, setRequest] = useState(initial);
  const [files, setFiles] = useState<EditAttachment[]>(() =>
    initialFiles.map((file) => ({ ...file, name: KIND_NAME[file.kind] })),
  );
  const [uploads, setUploads] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const upload = useUploadEditFile();

  // tocar de novo tira a frase; o campo nunca passa do limite
  const toggleIdea = (phrase: string) =>
    setRequest((current) =>
      current.includes(phrase)
        ? current.replace(phrase, "").replace(/\s+/g, " ").trim()
        : (current.trim() ? `${current.trim()} ${phrase}` : phrase).slice(0, REQUEST_MAX),
    );

  const send = (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      setUploads((count) => count + 1);
      upload
        .mutateAsync(file)
        .then((attachment) => setFiles((current) => [...current, attachment]))
        .catch((error: Error) => toast.error(error.message))
        .finally(() => setUploads((count) => count - 1));
    }
  };

  return (
    <div className="space-y-3">
      <PromptField
        kind="scene"
        value={request}
        onChange={setRequest}
        max={REQUEST_MAX}
        rows={3}
        onBusyChange={setVoiceBusy}
        placeholder="Toque no microfone e diga o que mudar"
        aria-label="O que mudar no vídeo"
      />
      <div className="flex flex-wrap gap-1.5">
        {IDEAS.map((idea) => (
          <Button
            key={idea.label}
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            aria-pressed={request.includes(idea.phrase)}
            onClick={() => toggleIdea(idea.phrase)}
          >
            {idea.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--via-text-muted)]">
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            send(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={uploads > 0}
          onClick={() => picker.current?.click()}
        >
          {uploads > 0 ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Paperclip aria-hidden="true" />
          )}
          Enviar vídeo, imagem ou música
        </Button>
        {files.map((file) => (
          <span key={file.path} className="inline-flex min-w-0 items-center gap-1">
            <span className="max-w-48 truncate">{file.name}</span>
            <button
              type="button"
              aria-label={`Tirar ${file.name}`}
              className="inline-flex size-8 shrink-0 items-center justify-center"
              onClick={() => setFiles((all) => all.filter((f) => f.path !== file.path))}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={!request.trim() || pending || uploads > 0 || voiceBusy}
          onClick={() =>
            onSubmit(
              request.trim(),
              files.map((f) => f.path),
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Pedir ao Claude
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <span className="text-xs text-[var(--via-text-muted)]">
          Pelo seu Claude, no conector personalizado
        </span>
      </div>
    </div>
  );
}

function PlanReview({
  draft,
  pending,
  onApply,
  onChange,
}: {
  draft: PlanDraft;
  pending: boolean;
  onApply: (steps: number[]) => void;
  onChange: () => void;
}) {
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const kept = draft.steps.map((_, i) => i).filter((i) => !removed.has(i));

  return (
    <div className="space-y-3">
      {draft.summary ? (
        <p className="text-sm text-[var(--via-text-primary)]">{draft.summary}</p>
      ) : null}
      <ul className="divide-y divide-[var(--via-border-soft)]">
        {draft.steps.map((step, index) =>
          removed.has(index) ? null : (
            <li key={index} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0 space-y-0.5 break-words">
                <span className="block text-sm font-medium text-[var(--via-text-primary)]">
                  {step.title}
                </span>
                <span className="block text-xs text-[var(--via-text-muted)]">{step.detail}</span>
              </span>
              <button
                type="button"
                aria-label={`Tirar ${step.title}`}
                className="inline-flex size-8 shrink-0 items-center justify-center text-[var(--via-text-muted)] hover:text-[var(--via-text-primary)]"
                onClick={() => setRemoved((current) => new Set(current).add(index))}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ),
        )}
      </ul>
      {draft.not_possible.length ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--via-text-muted)]">
            Não dá para fazer: {draft.not_possible.join(" ")}
          </p>
          {draft.needs_render ? (
            <p className="text-xs text-[var(--via-text-muted)]">
              Efeitos de motion saem pelo seu Claude, em “Pedir ao Claude”.
            </p>
          ) : null}
        </div>
      ) : null}
      {kept.length ? null : (
        <p className="text-sm text-[var(--via-text-muted)]">
          {draft.steps.length ? "Você tirou todos os itens." : "Nada neste pedido dá para aplicar."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {kept.length ? (
          <Button size="sm" disabled={pending} onClick={() => onApply(kept)}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Aplicar
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={kept.length ? "ghost" : "default"}
          disabled={pending}
          onClick={onChange}
        >
          Mudar o pedido
        </Button>
        {removed.size ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setRemoved(new Set())}
          >
            Voltar os itens
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ViewSwitch({ view, onView }: { view: PolishView; onView: (view: PolishView) => void }) {
  return (
    <div
      className="inline-flex rounded-full bg-[var(--via-navy-04)] p-0.5 text-xs"
      role="group"
      aria-label="Versão do vídeo"
    >
      {(["edited", "original"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onView(v)}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors duration-[var(--via-dur)]",
            view === v
              ? "bg-white text-[var(--via-text-primary)] shadow-[var(--via-shadow-sm)]"
              : "text-[var(--via-text-muted)] hover:text-[var(--via-text-primary)]",
          )}
        >
          {v === "edited" ? "Editada" : "Original"}
        </button>
      ))}
    </div>
  );
}

function SuggestionPicker({
  suggestions,
  pending,
  onApply,
}: {
  suggestions: EditSuggestion[];
  pending: boolean;
  onApply: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(suggestions.filter((s) => s.recommended).map((s) => s.id)),
  );
  // a análise chega pelo Realtime depois da montagem: marca as recomendadas uma vez
  useEffect(() => {
    setPicked((current) =>
      current.size ? current : new Set(suggestions.filter((s) => s.recommended).map((s) => s.id)),
    );
  }, [suggestions]);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!suggestions.length) {
    return (
      <p className="text-sm text-[var(--via-text-muted)]">
        O Claude não achou nada para melhorar neste vídeo.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {suggestions.map((s) => {
          const on = picked.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[var(--via-radius-md)] border border-[var(--via-border-soft)] p-2 text-left transition-colors duration-[var(--via-dur)] hover:border-[var(--via-navy-30)] focus-visible:shadow-[var(--via-shadow-focus)] focus-visible:outline-none",
                  on && "via-selected",
                )}
                data-testid={`aprimorar-${s.id}`}
              >
                <BeforeAfter suggestion={s} />
                <span className="min-w-0 flex-1 space-y-0.5 py-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        on
                          ? "border-[var(--via-navy)] bg-[var(--via-navy)] text-white"
                          : "border-[var(--via-border-soft)]",
                      )}
                      aria-hidden="true"
                    >
                      {on ? <Check className="size-3" strokeWidth={2.5} /> : null}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--via-text-muted)]">{s.gain}</span>
                  {on && s.why ? (
                    <span className="line-clamp-2 block text-xs leading-4 text-[var(--via-text-soft)]">
                      {s.why}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!picked.size || pending} onClick={() => onApply([...picked])}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Aplicar
        </Button>
      </div>
    </div>
  );
}

/** Quadro de antes e, quando há, o de depois (abertura ou encerramento da marca). */
function BeforeAfter({ suggestion }: { suggestion: EditSuggestion }) {
  const { before, after } = suggestion.preview;
  const thumb = after.thumb_url ?? before.thumb_url;
  const delta = Math.round(after.duration_s - before.duration_s);
  return (
    <span className="relative block aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-[var(--via-radius-xs)] bg-[var(--via-stage)]">
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {delta ? (
        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-xs leading-4 text-white">
          {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`} s
        </span>
      ) : null}
    </span>
  );
}

/** Uma versão editada pronta: número, data e o link para ver. */
function VersaoLink({ versao, numero }: { versao: VideoEditVersion; numero: number }) {
  const url = useSignedUrl("renders", versao.output_path, 3600);
  const quando = new Date(versao.created_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li>
      {url.data ? (
        <a
          href={url.data}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:underline"
        >
          Versão {numero} · {quando}
        </a>
      ) : (
        <span>
          Versão {numero} · {quando}
        </span>
      )}
    </li>
  );
}

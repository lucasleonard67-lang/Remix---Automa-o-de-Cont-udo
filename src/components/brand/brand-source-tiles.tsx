import { useMutation } from "@tanstack/react-query";
import {
  FileUp,
  FolderGit2,
  Globe,
  ImageOff,
  Loader2,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { uploadBrandAsset } from "@/components/brand/brand-kit-form";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  AI_DRIVERS,
  MODEL_CUSTOM,
  modelsFor,
  useSecretStatus,
  type AiDriver,
} from "@/hooks/use-app-settings";
import { useSignedUrl } from "@/hooks/use-storage";
import type { BrandKitContent } from "@/hooks/use-versioned-brand";
import { luminancia } from "@/lib/brand-ink";
import { brandFontsReady, fontesFaltando, loadBrandFonts } from "@/lib/brand-fonts";
import type { BrandName } from "@/lib/brands";
import { normalizeArt, EIXOS_DE_ARTE, type CarouselArt } from "@/lib/carousel-art";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import { supabase } from "@/integrations/supabase/client";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "De onde vem a sua identidade visual?" — quatro origens como ladrilhos, cada
// uma com o seu modal (mesmo padrão de Ajustes → Integrações). A proposta volta
// da edge `brand-kit-suggest` como RASCUNHO: a pessoa vê paleta, fontes e logo
// antes de aplicar, e só "Ativar versão" (na página) coloca em produção.
// ---------------------------------------------------------------------------

export type BrandSourceId = "site" | "file" | "repo" | "ai";

export interface BrandProposal {
  source: BrandSourceId;
  origem: string;
  rationale?: string;
  examples?: Array<{ channel: string; how: string }>;
}

interface Draft {
  palette?: Record<string, string>;
  typography?: { heading: string; body: string };
  negative_constraints?: string[];
  rationale?: string;
  art?: Partial<CarouselArt>;
  examples?: Array<{ channel: string; how: string }>;
}

interface SourceMeta {
  id: BrandSourceId;
  icon: LucideIcon;
  title: string;
  /** Uma linha no ladrilho: o que a origem faz. */
  purpose: string;
  /** Primeira frase do modal: o que a pessoa precisa fazer. */
  when: string;
}

const SOURCES: SourceMeta[] = [
  {
    id: "site",
    icon: Globe,
    title: "Do seu site",
    purpose: "Lê cores, fontes e logo do endereço que você colar.",
    when: "Cole o endereço do site. Lemos a página e propomos cores, fontes e restrições.",
  },
  {
    id: "file",
    icon: FileUp,
    title: "De um arquivo",
    purpose: "Tokens, guia, logo ou o ZIP do repositório.",
    when: "Envie tokens (.json, .css), um guia (.md, .txt), o logo (.png, .svg) ou o ZIP do repositório.",
  },
  {
    id: "repo",
    icon: FolderGit2,
    title: "De um repositório",
    purpose: "GitHub público ou o site do seu design system.",
    when: "Cole o endereço. Lemos tokens, tailwind, README e a documentação de design.",
  },
  {
    id: "ai",
    icon: Wand2,
    title: "Gerado pela IA",
    purpose: "Descreva a marca em três frases; a IA monta o resto.",
    when: "Escolha quem gera e descreva a marca. Em branco, a IA parte da persona e da bandeira salvas.",
  },
];

const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<
  BrandSourceId,
  SourceMeta
>;

const DRIVER_LABEL: Record<AiDriver, string> = {
  "lovable-gateway": "Lovable AI",
  openai: "OpenAI",
  xai: "Grok (xAI)",
};

const DRIVER_BRAND: Record<AiDriver, BrandName> = {
  "lovable-gateway": "lovable",
  openai: "openai",
  xai: "xai",
};

const DRIVER_SECRET: Partial<Record<AiDriver, string>> = {
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
};

const TEXT_EXTENSIONS = new Set([
  "json",
  "css",
  "scss",
  "md",
  "txt",
  "svg",
  "js",
  "ts",
  "cjs",
  "mjs",
]);
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_TEXT_CHARS = 300_000;
/** Teto de arquivos de texto lidos de um ZIP; a edge ordena e corta o resto. */
const MAX_ZIP_FILES = 60;
const ZIP_IGNORAR = /(^|\/)(node_modules|dist|build|out|\.next|\.git|vendor|coverage|__MACOSX)\//i;

/** Arquivos de texto de um ZIP (tokens, CSS, docs) e o primeiro logo encontrado. */
async function readZip(
  file: File,
): Promise<{ textos: Array<{ name: string; content: string }>; logo: File | null }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const textos: Array<{ name: string; content: string }> = [];
  let logo: File | null = null;
  let restante = MAX_TEXT_CHARS;
  const entradas = Object.values(zip.files).filter((e) => !e.dir && !ZIP_IGNORAR.test(e.name));
  for (const entrada of entradas) {
    const nome = entrada.name.replace(/^[^/]+\//, "");
    const ext = fileExtension(nome);
    if (!logo && /logo/i.test(nome) && (ext === "svg" || ext === "png")) {
      const blob = await entrada.async("blob");
      logo = new File([blob], nome.split("/").pop() ?? nome, {
        type: ext === "svg" ? "image/svg+xml" : "image/png",
      });
    }
    if (!TEXT_EXTENSIONS.has(ext) && ext !== "scss") continue;
    if (textos.length >= MAX_ZIP_FILES || restante <= 0) continue;
    const content = (await entrada.async("string")).slice(
      0,
      Math.min(MAX_FILE_CHARS_ZIP, restante),
    );
    if (!content.trim()) continue;
    restante -= content.length;
    textos.push({ name: nome, content });
  }
  return { textos, logo };
}
const MAX_FILE_CHARS_ZIP = 40_000;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

export interface BrandSourceTilesProps {
  patch: (partial: Partial<BrandKitContent>) => void;
  /** Origem da proposta aplicada nesta sessão (marca o ladrilho). */
  applied: BrandSourceId | null;
  onApplied: (proposal: BrandProposal) => void;
}

export function BrandSourceTiles({ patch, applied, onApplied }: BrandSourceTilesProps) {
  const [open, setOpen] = useState<BrandSourceId | null>(null);
  const animate = !reducedMotion();

  return (
    <>
      <ul
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="origens-identidade-visual"
      >
        {SOURCES.map((source, index) => (
          <li
            key={source.id}
            className={cn(
              animate &&
                "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-200 [animation-timing-function:var(--via-ease-out)]",
            )}
            style={animate ? { animationDelay: `${index * 60}ms` } : undefined}
          >
            <SourceTile
              source={source}
              applied={applied === source.id}
              onOpen={() => setOpen(source.id)}
            />
          </li>
        ))}
      </ul>
      {open ? (
        <SourceDialog
          key={open}
          source={SOURCE_BY_ID[open]}
          onClose={() => setOpen(null)}
          onSwitch={setOpen}
          onApply={(draft, logoPath) => {
            // Uma chamada só: `patch` mistura sobre o conteúdo do render atual,
            // então duas chamadas seguidas apagariam a primeira.
            patch({
              ...(draft.palette && Object.keys(draft.palette).length
                ? { palette: draft.palette }
                : {}),
              ...(draft.typography ? { typography: draft.typography } : {}),
              ...(draft.art ? { art: normalizeArt(draft.art) } : {}),
              ...(draft.negative_constraints?.length
                ? { negative_constraints: draft.negative_constraints }
                : {}),
              ...(logoPath ? { logo_path: logoPath } : {}),
            });
            onApplied({
              source: open,
              origem: draft.origem,
              rationale: draft.rationale,
              examples: draft.examples,
            });
            setOpen(null);
            toast.success("Proposta aplicada", {
              description: "Revise abaixo e clique em “Ativar versão”.",
            });
          }}
        />
      ) : null}
    </>
  );
}

function SourceTile({
  source,
  applied,
  onOpen,
}: {
  source: SourceMeta;
  applied: boolean;
  onOpen: () => void;
}) {
  const Icon = source.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid={`origem-${source.id}`}
      className="via-tile via-tile--atmos via-tile--lift ce-tile group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] p-4 text-left hover:border-[var(--via-navy-20)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
    >
      <span className="ce-tile-well">
        <Icon className="size-5 text-[var(--via-text-primary)]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">
            {source.title}
          </span>
          {applied ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--via-text-primary)]">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--via-navy)]" />
              Aplicada
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--via-text-muted)]">
          {source.purpose}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal: formulário da origem → proposta (prévia) → aplicar
// ---------------------------------------------------------------------------

interface Proposal extends Draft {
  origem: string;
}

function SourceDialog({
  source,
  onClose,
  onSwitch,
  onApply,
}: {
  source: SourceMeta;
  onClose: () => void;
  /** Troca a origem sem fechar o fluxo (saída quando a atual não dá). */
  onSwitch: (id: BrandSourceId) => void;
  onApply: (proposal: Proposal, logoPath: string | null) => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const Icon = source.icon;

  const sugerir = useMutation({
    mutationFn: async (body: Record<string, unknown>): Promise<Proposal> => {
      const { data, error } = await supabase.functions.invoke("brand-kit-suggest", { body });
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(
            error,
            "Não foi possível montar a proposta. Tente outra origem.",
          ),
        );
      }
      const payload = data as { draft: Draft; origem: string };
      return { ...payload.draft, origem: payload.origem };
    },
    onSuccess: (result) => setProposal(result),
  });
  const falha = sugerir.isError && !proposal ? sugerir.error.message : null;
  const alternativa: BrandSourceId | null =
    source.id === "repo" || source.id === "site" ? "file" : source.id === "file" ? "ai" : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("max-w-md", proposal && "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-[10px] border border-[var(--via-border-soft)] bg-[var(--via-navy-04)]">
              <Icon className="size-4 text-[var(--via-text-primary)]" aria-hidden="true" />
            </span>
            {source.title}
          </DialogTitle>
          <DialogDescription>
            {proposal ? `Proposta a partir de ${proposal.origem}. Nada foi ativado.` : source.when}
          </DialogDescription>
        </DialogHeader>

        {falha ? (
          <div
            role="alert"
            className="space-y-2 border-l-2 border-[var(--via-coral)] pl-3 text-sm animate-in fade-in duration-[180ms]"
          >
            <p className="font-medium text-[var(--via-coral-dark)]">
              Não deu para montar a proposta
            </p>
            <p className="text-[var(--via-text-primary)]">{falha}</p>
            {alternativa ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  sugerir.reset();
                  onSwitch(alternativa);
                }}
              >
                {alternativa === "file" ? "Enviar os arquivos" : "Gerar pela IA"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {proposal ? (
          <ProposalPreview
            proposal={proposal}
            logoPath={logoPath}
            onBack={() => setProposal(null)}
            onApply={() => onApply(proposal, logoPath)}
          />
        ) : source.id === "site" ? (
          <UrlForm
            id="site"
            label="Endereço do site"
            placeholder="https://suamarca.com.br"
            pending={sugerir.isPending}
            onSubmit={(url) => sugerir.mutate({ source: "site", url })}
          />
        ) : source.id === "repo" ? (
          <UrlForm
            id="repo"
            label="Endereço do repositório ou do design system"
            placeholder="https://github.com/empresa/design-system"
            help="Público no GitHub, ou o site do design system. Repositório privado? Baixe o ZIP e envie em “De um arquivo”."
            pending={sugerir.isPending}
            onSubmit={(url) => sugerir.mutate({ source: "repo", url })}
          />
        ) : source.id === "file" ? (
          <FileForm
            pending={sugerir.isPending}
            onSubmit={(files, logo) => {
              setLogoPath(logo);
              sugerir.mutate({ source: "file", files });
            }}
          />
        ) : (
          <AiForm
            pending={sugerir.isPending}
            onSubmit={(body) => sugerir.mutate({ source: "ai", ...body })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PendingHint({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <p
      className="text-xs text-[var(--via-text-muted)] animate-in fade-in duration-[180ms]"
      aria-live="polite"
    >
      Lendo a origem e montando a proposta. Leva de 20 a 60 segundos.
    </p>
  );
}

function SubmitRow({
  pending,
  disabled,
  label = "Gerar proposta",
}: {
  pending: boolean;
  disabled: boolean;
  label?: string;
}) {
  return (
    <DialogFooter>
      <Button type="submit" disabled={disabled || pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {pending ? "Montando proposta…" : label}
      </Button>
    </DialogFooter>
  );
}

// ── Site e repositório: um endereço ──────────────────────────────────────────

function UrlForm({
  id,
  label,
  placeholder,
  help,
  pending,
  onSubmit,
}: {
  id: string;
  label: string;
  placeholder: string;
  help?: string;
  pending: boolean;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };
  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`origem-${id}-url`}>{label}</Label>
        <Input
          id={`origem-${id}-url`}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={placeholder}
          inputMode="url"
          autoComplete="off"
          autoFocus
        />
        {help ? <p className="text-xs text-[var(--via-text-muted)]">{help}</p> : null}
      </div>
      <PendingHint pending={pending} />
      <SubmitRow pending={pending} disabled={!url.trim()} />
    </form>
  );
}

// ── Arquivo: tokens/guia em texto + logo para o bucket ───────────────────────

function fileExtension(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

function fileKind(file: File): "tokens" | "guia" | "logo" | "logo+cores" | "zip" | null {
  const ext = fileExtension(file.name);
  if (ext === "zip") return "zip";
  if (ext === "svg") return "logo+cores";
  if (LOGO_TYPES.has(file.type)) return "logo";
  if (
    ext === "json" ||
    ext === "css" ||
    ext === "scss" ||
    ["js", "ts", "cjs", "mjs"].includes(ext)
  ) {
    return "tokens";
  }
  if (TEXT_EXTENSIONS.has(ext)) return "guia";
  return null;
}

function FileForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (files: Array<{ name: string; content: string }>, logoPath: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);

  const handlePick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    const rejected = picked.filter((f) => !fileKind(f));
    if (rejected.length) {
      const pdf = rejected.some((f) => fileExtension(f.name) === "pdf");
      toast.error(pdf ? "PDF ainda não é lido" : "Formato não aceito", {
        description: pdf
          ? "Exporte o guia como .md ou .txt e envie de novo."
          : "Aceitos: .json, .css, .md, .txt, .svg, .png, .jpg, .webp e .zip.",
      });
    }
    setFiles((prev) => [...prev, ...picked.filter((f) => fileKind(f))]);
  };

  const handle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (files.length === 0 || pending || preparing) return;
    setPreparing(true);
    try {
      const textos: Array<{ name: string; content: string }> = [];
      let logoPath: string | null = null;
      for (const file of files) {
        const kind = fileKind(file);
        if (kind === "zip") {
          const lido = await readZip(file);
          textos.push(...lido.textos);
          if (lido.logo && !logoPath) logoPath = await uploadBrandAsset(lido.logo, "logo");
          continue;
        }
        if (kind === "logo" || kind === "logo+cores") {
          if (!logoPath) logoPath = await uploadBrandAsset(file, "logo");
          if (kind === "logo+cores") {
            textos.push({ name: file.name, content: (await file.text()).slice(0, MAX_TEXT_CHARS) });
          }
        } else {
          textos.push({ name: file.name, content: (await file.text()).slice(0, MAX_TEXT_CHARS) });
        }
      }
      if (textos.length === 0 && files.some((f) => fileKind(f) === "zip")) {
        throw new Error("O ZIP não tem tokens, CSS nem documentação legível.");
      }
      if (textos.length === 0) {
        // Só logo: o SVG já virou texto acima; PNG/JPG não traz tokens legíveis.
        textos.push({
          name: "logo.txt",
          content: `Logo enviado em imagem (${files[0]?.name ?? "logo"}). Proponha a identidade a partir da persona e da bandeira.`,
        });
      }
      onSubmit(textos, logoPath);
    } catch (error) {
      toast.error("Não foi possível ler os arquivos", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPreparing(false);
    }
  };

  const busy = pending || preparing;
  return (
    <form onSubmit={(event) => void handle(event)} className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".json,.css,.scss,.md,.txt,.svg,.js,.ts,.zip,image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handlePick}
      />
      <div className="space-y-2">
        {files.length > 0 ? (
          <ul className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-[var(--via-text-primary)]">
                  {file.name}
                </span>
                <span className="shrink-0 text-xs font-medium text-[var(--via-text-faint)]">
                  {fileKind(file) === "logo+cores" ? "logo" : fileKind(file)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remover ${file.name}`}
                  disabled={busy}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <FileUp aria-hidden="true" />
          {files.length ? "Adicionar outro" : "Escolher arquivos"}
        </Button>
        <p className="text-xs text-[var(--via-text-muted)]">
          Tokens no formato W3C ou um JSON simples com cores e fontes. O ZIP de um repositório
          também serve. PDF ainda não é lido: exporte como .md ou .txt.
        </p>
      </div>
      <PendingHint pending={busy} />
      <SubmitRow pending={busy} disabled={files.length === 0} />
    </form>
  );
}

// ── IA: descrição + provedor ─────────────────────────────────────────────────

function AiForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (body: {
    description: string;
    use_context: boolean;
    provider: { driver: AiDriver; model?: string };
  }) => void;
}) {
  const secrets = useSecretStatus();
  const [description, setDescription] = useState("");
  const [useContext, setUseContext] = useState(false);
  const [driver, setDriver] = useState<AiDriver>("lovable-gateway");
  const [model, setModel] = useState("");
  const [custom, setCustom] = useState(false);

  const connected = AI_DRIVERS.filter((d) => {
    const secret = DRIVER_SECRET[d];
    return !secret || secrets.data?.includes(secret);
  });
  // Provedores com chave por conectar: cada um é um botão que abre o modal da
  // integração aqui mesmo (os ids coincidem com os do catálogo de integrações).
  const missing = (["openai", "xai"] as const).filter((d) => !connected.includes(d));
  const options = modelsFor(driver, "generator");
  // OpenAI exige ID de modelo; gateway e Grok têm padrão na edge.
  const needsModel = driver === "openai";
  const modelOk = !needsModel || model.trim().length > 0;

  const chooseDriver = (next: AiDriver) => {
    setDriver(next);
    setCustom(false);
    setModel(modelsFor(next, "generator")[0]?.value ?? "");
  };

  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modelOk) return;
    onSubmit({
      description: description.trim(),
      use_context: useContext,
      provider: { driver, ...(model.trim() ? { model: model.trim() } : {}) },
    });
  };

  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="origem-ai-descricao">Sua marca em três frases</Label>
        <Textarea
          id="origem-ai-descricao"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex.: Consultoria de IA para pequenas indústrias. Tom direto e técnico, sem futurismo. Nada de roxo nem robôs."
          rows={4}
          maxLength={2000}
          autoFocus
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--via-text-primary)]">
        <Checkbox checked={useContext} onCheckedChange={(v) => setUseContext(v === true)} />
        Usar também o que está em Contexto
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="origem-ai-provedor">Quem gera</Label>
          <Select value={driver} onValueChange={(v) => chooseDriver(v as AiDriver)}>
            <SelectTrigger id="origem-ai-provedor" aria-label="Quem gera">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connected.map((d) => (
                <SelectItem key={d} value={d}>
                  <span className="flex items-center gap-2">
                    <BrandIcon name={DRIVER_BRAND[d]} className="size-4" />
                    {DRIVER_LABEL[d]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="origem-ai-modelo">Modelo</Label>
          <Select
            value={custom ? MODEL_CUSTOM : model || "__default__"}
            onValueChange={(v) => {
              if (v === MODEL_CUSTOM) {
                setCustom(true);
                setModel("");
                return;
              }
              setCustom(false);
              setModel(v === "__default__" ? "" : v);
            }}
          >
            <SelectTrigger id="origem-ai-modelo" aria-label="Modelo">
              <SelectValue placeholder="Modelo padrão" />
            </SelectTrigger>
            <SelectContent>
              {!needsModel ? <SelectItem value="__default__">Modelo padrão</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
              <SelectItem value={MODEL_CUSTOM}>Outro (digitar ID)…</SelectItem>
            </SelectContent>
          </Select>
          {custom ? (
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="ID do modelo"
              aria-label="ID do modelo"
              autoFocus
            />
          ) : null}
        </div>
      </div>
      {missing.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--via-text-muted)]">
          <span>{connected.length === 1 ? "Só o Lovable AI está ligado." : "Conectar outro:"}</span>
          {missing.map((d) => (
            <Button
              key={d}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => openIntegration(d)}
            >
              <BrandIcon name={DRIVER_BRAND[d]} className="size-3.5" />
              {DRIVER_LABEL[d]}
            </Button>
          ))}
        </div>
      ) : null}
      {needsModel && !modelOk ? (
        <p className="text-xs text-[var(--via-text-muted)]">Escolha o modelo para continuar.</p>
      ) : null}

      <PendingHint pending={pending} />
      <SubmitRow pending={pending} disabled={!modelOk} label="Gerar identidade" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Prévia da proposta: paleta como amostras, fontes renderizadas, logo, arte
// ---------------------------------------------------------------------------

function ProposalPreview({
  proposal,
  logoPath,
  onBack,
  onApply,
}: {
  proposal: Proposal;
  logoPath: string | null;
  onBack: () => void;
  onApply: () => void;
}) {
  const heading = proposal.typography?.heading ?? "";
  const body = proposal.typography?.body ?? "";
  const [missing, setMissing] = useState<string[]>([]);
  const colors = Object.entries(proposal.palette ?? {});
  const art = normalizeArt(proposal.art);

  useEffect(() => {
    let alive = true;
    loadBrandFonts(heading, body);
    void brandFontsReady(heading, body).then(() => {
      if (alive) setMissing(fontesFaltando(heading, body));
    });
    return () => {
      alive = false;
    };
  }, [heading, body]);

  const eixos = EIXOS_DE_ARTE.filter((e) =>
    ["photo_slot", "photo_grade", "surface"].includes(e.chave),
  ).map((e) => {
    const valor = String(art[e.chave as keyof CarouselArt]);
    const opcao = e.opcoes.find((o) => String(o.valor) === valor);
    return `${e.titulo}: ${opcao?.rotulo ?? valor}`;
  });

  return (
    <div className="space-y-5">
      {colors.length ? (
        <section aria-label="Paleta" className="space-y-2">
          <div className="flex h-14 overflow-hidden rounded-[var(--via-radius-lg)] border border-[var(--via-border-soft)]">
            {colors.map(([name, hex]) => (
              <span
                key={name}
                className="flex flex-1 items-end px-1.5 pb-1 text-xs font-medium"
                style={{
                  backgroundColor: hex,
                  color: luminancia(hex) > 0.4 ? "#101828" : "#ffffff",
                }}
                title={`${name} ${hex}`}
              >
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
          <p className="font-mono text-xs text-[var(--via-text-faint)]">
            {colors.map(([, hex]) => hex.toUpperCase()).join(" · ")}
          </p>
        </section>
      ) : null}

      <section aria-label="Tipografia" className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p
            className="truncate text-2xl leading-tight text-[var(--via-text-primary)]"
            style={{ fontFamily: heading ? `"${heading}", sans-serif` : undefined }}
          >
            {heading || "Sem fonte de título"}
          </p>
          <p
            className="text-sm text-[var(--via-text-body)]"
            style={{ fontFamily: body ? `"${body}", sans-serif` : undefined }}
          >
            {body ? `${body} no texto corrido das peças.` : "Sem fonte de corpo."}
          </p>
          {missing.length ? (
            <p className="text-xs text-[var(--via-coral-dark)]">
              Não achei no Google Fonts: {missing.join(", ")}. Troque no campo Tipografia.
            </p>
          ) : null}
        </div>
        {logoPath ? <LogoThumb path={logoPath} /> : null}
      </section>

      {eixos.length ? (
        <p className="text-xs text-[var(--via-text-muted)]">{eixos.join(" · ")}</p>
      ) : null}

      {proposal.rationale ? (
        <p className="text-sm text-[var(--via-text-body)]">{proposal.rationale}</p>
      ) : null}

      {proposal.examples?.length ? (
        <ul className="space-y-1.5 text-sm">
          {proposal.examples.slice(0, 3).map((ex) => (
            <li key={ex.channel} className="flex gap-2">
              <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--via-text-faint)] pt-0.5">
                {ex.channel}
              </span>
              <span className="text-[var(--via-text-body)]">{ex.how}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Descartar
        </Button>
        <Button type="button" onClick={onApply} data-testid="usar-proposta">
          Usar esta proposta
        </Button>
      </DialogFooter>
    </div>
  );
}

function LogoThumb({ path }: { path: string }) {
  const { data: url, isLoading } = useSignedUrl("brand-assets", path);
  if (isLoading) return <Skeleton className="size-16 rounded-md" />;
  if (!url) {
    return (
      <span className="flex size-16 items-center justify-center rounded-md border border-dashed border-[var(--via-border)] text-[var(--via-text-muted)]">
        <ImageOff className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt="Logo enviado"
      className="size-16 shrink-0 rounded-md border border-[var(--via-border-soft)] object-contain"
    />
  );
}

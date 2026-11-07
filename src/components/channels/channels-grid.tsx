import { Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { BrandIcon } from "@/components/brand-icon";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  CHANNEL_TYPE_LABELS,
  FAMILY_OF_CHANNEL,
  FORMAT_FAMILIES,
  useChannels,
  useToggleChannel,
  useUpdateChannelConfig,
  type ChannelRow,
  type ChannelType,
} from "@/hooks/use-channels";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { channelBrand } from "@/lib/brands";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Canais como ladrilhos, agrupados por família de formato: ícone da rede,
// ligado/desligado e os limites em uma linha. Clicar abre o modal do canal,
// com o interruptor e os limites juntos. A mesma grade serve a página
// Marca → Canais e o modal "Ligar canais" aberto de dentro do Criar — regra do
// produto: a ação abre onde o usuário está, nunca manda para outra página.
//
// Campos numéricos editáveis do config, por canal (dot path no jsonb).
// Chaves não listadas (aspect_ratio, render_template, structure…) são
// preservadas intactas no save.
// ---------------------------------------------------------------------------

interface ChannelConfigField {
  path: string;
  label: string;
}

const CUTOFF_FIELD: ChannelConfigField = {
  path: "cutoff_score",
  label: "Nota mínima para aprovar (0 a 10)",
};
const TEXT_MAX_FIELD: ChannelConfigField = {
  path: "text_max_chars",
  label: "Máx. caracteres do texto",
};
const CAPTION_MAX_FIELD: ChannelConfigField = {
  path: "caption_max_chars",
  label: "Máx. caracteres da legenda",
};

const CHANNEL_CONFIG_FIELDS: Record<ChannelType, ChannelConfigField[]> = {
  instagram_stories: [
    CUTOFF_FIELD,
    { path: "frames.min", label: "Telas (mín.)" },
    { path: "frames.max", label: "Telas (máx.)" },
  ],
  instagram_carousel: [
    CUTOFF_FIELD,
    { path: "slides.min", label: "Slides (mín.)" },
    { path: "slides.max", label: "Slides (máx.)" },
    { path: "slide_max_chars", label: "Máx. caracteres por slide" },
    CAPTION_MAX_FIELD,
  ],
  instagram_post: [CUTOFF_FIELD, TEXT_MAX_FIELD, CAPTION_MAX_FIELD],
  x_post: [
    CUTOFF_FIELD,
    TEXT_MAX_FIELD,
    { path: "thread_max_posts", label: "Máx. posts por thread" },
  ],
  threads_post: [
    CUTOFF_FIELD,
    TEXT_MAX_FIELD,
    { path: "thread_max_posts", label: "Máx. posts por thread" },
  ],
  linkedin_post: [CUTOFF_FIELD, TEXT_MAX_FIELD],
  facebook_post: [CUTOFF_FIELD, TEXT_MAX_FIELD],
  // Reel: os overrides do seed da migration 0023 (resolução e aspect são fixos
  // por projeto — docs/11 §0, regra 4 — e por isso não entram como campo).
  instagram_reel: [
    CUTOFF_FIELD,
    { path: "target_duration_s", label: "Duração alvo (s)" },
    { path: "max_scenes", label: "Máx. de cenas" },
  ],
};

/** O que o canal produz — a linha de baixo do ladrilho (aqui e em Criar). */
// eslint-disable-next-line react-refresh/only-export-components -- texto compartilhado com Criar
export const CHANNEL_PURPOSE: Record<ChannelType, string> = {
  instagram_stories: "Sequência de telas verticais.",
  instagram_carousel: "Slides com legenda.",
  instagram_post: "Imagem única com legenda.",
  x_post: "Post curto ou thread.",
  threads_post: "Post curto ou thread.",
  linkedin_post: "Post de texto profissional.",
  facebook_post: "Post de texto.",
  instagram_reel: "Vídeo curto vertical.",
};

function getPath(config: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc === "object" && acc !== null && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, config);
}

function setPath(config: Record<string, unknown>, path: string, value: number): void {
  const keys = path.split(".");
  let node = config;
  for (const key of keys.slice(0, -1)) {
    const current = node[key];
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function deletePath(config: Record<string, unknown>, path: string): void {
  const keys = path.split(".");
  let node: Record<string, unknown> | undefined = config;
  for (const key of keys.slice(0, -1)) {
    const current: unknown = node?.[key];
    if (typeof current !== "object" || current === null || Array.isArray(current)) return;
    node = current as Record<string, unknown>;
  }
  if (node) delete node[keys[keys.length - 1]];
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

export interface ChannelsGridProps {
  className?: string;
}

/** Ladrilhos de todos os canais + modal do canal clicado. Sem cabeçalho. */
export function ChannelsGrid({ className }: ChannelsGridProps) {
  const { isAdmin } = useIsAdmin();
  const channelsQuery = useChannels();
  const [openId, setOpenId] = useState<string | null>(null);
  const channels = channelsQuery.data ?? [];
  const open = channels.find((channel) => channel.id === openId) ?? null;

  // ordem canônica das famílias (vídeo → story → carrossel → imagem → texto)
  const ordered = FORMAT_FAMILIES.flatMap((family) =>
    channels.filter((channel) => FAMILY_OF_CHANNEL[channel.type] === family),
  );

  if (channelsQuery.isLoading) {
    return (
      <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[88px] w-full rounded-[var(--via-radius-lg)]" />
        ))}
      </div>
    );
  }

  if (channelsQuery.isError || channels.length === 0) {
    return (
      <EmptyState
        icon={Share2}
        title="Não foi possível carregar os canais"
        description="Verifique a conexão e recarregue a página. Se continuar, fale com o suporte."
      />
    );
  }

  return (
    <>
      <ul className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {ordered.map((channel) => (
          <li key={channel.id}>
            <ChannelTile channel={channel} onOpen={() => setOpenId(channel.id)} />
          </li>
        ))}
      </ul>

      {open ? (
        <ChannelDialog channel={open} isAdmin={isAdmin} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

/** A grade dentro de um modal — "Ligar canais" a partir do Criar. */
export function ChannelsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,46rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Canais</DialogTitle>
          <DialogDescription>
            Clique em um canal para ligar. Vale na hora para as próximas peças.
          </DialogDescription>
        </DialogHeader>
        <ChannelsGrid className="lg:grid-cols-2" />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Pronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ladrilho e modal do canal
// ---------------------------------------------------------------------------

function ChannelIcon({ type, className }: { type: ChannelType; className?: string }) {
  const brand = channelBrand(type);
  if (brand) return <BrandIcon name={brand} className={className} />;
  return <Share2 className={cn("text-[var(--via-text-muted)]", className)} aria-hidden="true" />;
}

export function ChannelTile({ channel, onOpen }: { channel: ChannelRow; onOpen: () => void }) {
  const cutoff = getPath(channel.config, "cutoff_score");

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid={`channel-${channel.type}`}
      className={cn(
        "via-tile via-tile--atmos via-tile--lift ce-tile group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] p-4 text-left hover:border-[var(--via-navy-20)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
        !channel.enabled && "[&>*]:opacity-70",
      )}
    >
      <span className="ce-tile-well">
        <ChannelIcon type={channel.type} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">
            {CHANNEL_TYPE_LABELS[channel.type]}
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
              channel.enabled ? "text-[var(--via-text-primary)]" : "text-[var(--via-text-faint)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                channel.enabled ? "bg-[var(--via-navy)]" : "border border-[var(--via-border)]",
              )}
            />
            {channel.enabled ? "Ligado" : "Desligado"}
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--via-text-muted)]">
          {CHANNEL_PURPOSE[channel.type]}
          {typeof cutoff === "number" ? ` Nota mínima ${cutoff}.` : ""}
        </span>
      </span>
    </button>
  );
}

export function ChannelDialog({
  channel,
  isAdmin,
  onClose,
}: {
  channel: ChannelRow;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const toggleChannel = useToggleChannel();
  const updateConfig = useUpdateChannelConfig();
  const fields = CHANNEL_CONFIG_FIELDS[channel.type] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const value = getPath(channel.config, field.path);
      next[field.path] = typeof value === "number" ? String(value) : "";
    }
    return next;
  });

  const handleToggle = (enabled: boolean) => {
    toggleChannel.mutate(
      { id: channel.id, enabled },
      {
        onSuccess: () => {
          toast.success(`${CHANNEL_TYPE_LABELS[channel.type]} ${enabled ? "ligado" : "desligado"}`);
        },
        onError: (error) => {
          toast.error("Não foi possível alterar o canal", { description: error.message });
        },
      },
    );
  };

  const handleSave = () => {
    if (updateConfig.isPending) return;
    const config = JSON.parse(JSON.stringify(channel.config)) as Record<string, unknown>;
    for (const field of fields) {
      const raw = (values[field.path] ?? "").trim();
      if (raw === "") {
        deletePath(config, field.path);
        continue;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        toast.error(`Valor inválido em “${field.label}”`, {
          description: "Use um número ou deixe vazio para usar o padrão.",
        });
        return;
      }
      setPath(config, field.path, parsed);
    }
    updateConfig.mutate(
      { id: channel.id, config },
      {
        onSuccess: () => {
          toast.success(`Limites de ${CHANNEL_TYPE_LABELS[channel.type]} salvos`);
          onClose();
        },
        onError: (error) => {
          toast.error("Não foi possível salvar", { description: error.message });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-[10px] border border-[var(--via-border-soft)] bg-[var(--via-navy-04)]">
              <ChannelIcon type={channel.type} className="size-4" />
            </span>
            {CHANNEL_TYPE_LABELS[channel.type]}
          </DialogTitle>
          <DialogDescription>{CHANNEL_PURPOSE[channel.type]}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-[var(--via-radius-md)] border border-[var(--via-border-soft)] px-3 py-2.5">
          <div>
            <p className="text-sm text-[var(--via-text-primary)]">
              {channel.enabled ? "Ligado" : "Desligado"}
            </p>
            <p className="text-xs text-[var(--via-text-muted)]">
              {channel.enabled
                ? "A geração produz peças para este canal."
                : "Ligue para gerar peças neste canal."}
            </p>
          </div>
          <Switch
            checked={channel.enabled}
            onCheckedChange={handleToggle}
            disabled={!isAdmin || toggleChannel.isPending}
            aria-label={`Ligar ${CHANNEL_TYPE_LABELS[channel.type]}`}
          />
        </div>

        {isAdmin ? (
          <div className="space-y-4">
            <p className="text-xs text-[var(--via-text-muted)]">
              Limites: deixe vazio para usar o padrão do canal.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.path}
                  className={cn("space-y-1.5", field.path === "cutoff_score" && "sm:col-span-2")}
                >
                  <Label htmlFor={`channel-field-${field.path}`}>{field.label}</Label>
                  <Input
                    id={`channel-field-${field.path}`}
                    type="number"
                    value={values[field.path] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.path]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--via-text-muted)]">
            Só administradores alteram canais e limites.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateConfig.isPending}>
            {isAdmin ? "Cancelar" : "Fechar"}
          </Button>
          {isAdmin ? (
            <Button onClick={handleSave} disabled={updateConfig.isPending}>
              {updateConfig.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Salvar limites
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

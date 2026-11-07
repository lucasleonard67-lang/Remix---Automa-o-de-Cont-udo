import { Loader2, RotateCcw, X } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useUploadEditFile,
  type EditAttachment,
  type EditOp,
  type VideoEdit,
} from "@/hooks/use-video-edit";
import {
  buildOps,
  COLORS,
  CORNERS,
  defaultSpan,
  insertReady,
  PANEL_LIMITS,
  readPanel,
  spanLabel,
  type Insert,
  type PanelColor,
  type PanelCorner,
  type PanelValues,
} from "@/lib/edit-panel";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Painel de edição, embaixo do vídeo pronto. Ajustes e inserções são diretos:
// não passam pelo Claude e viram uma versão nova a partir do original.
// ---------------------------------------------------------------------------

const COLOR_LABEL: Record<PanelColor, string> = {
  none: "Original",
  neutral: "Neutra",
  warm: "Quente",
  cool: "Fria",
  punch: "Forte",
};
const CORNER_LABEL: Record<PanelCorner, string> = {
  tl: "Topo esquerdo",
  tr: "Topo direito",
  bl: "Base esquerda",
  br: "Base direita",
};
const POSITIONS = [
  { value: "top", label: "Em cima" },
  { value: "middle", label: "No meio" },
  { value: "bottom", label: "Embaixo" },
] as const;

const INSERT_NAME: Record<Insert["kind"], string> = {
  title: "Manchete",
  fact: "Dado na tela",
  image: "Imagem",
  split: "Tela dividida",
};

const FILE_ACCEPT = {
  image: "image/png,image/jpeg,image/webp",
  split: "video/mp4,video/quicktime,image/png,image/jpeg,image/webp",
  music: "audio/mpeg,audio/wav,audio/mp4,.m4a,.wav,.mp3",
} as const;

type FileSlot = keyof typeof FILE_ACCEPT;
type InsertDraft = Insert extends infer I
  ? I extends Insert
    ? Omit<I, "id" | "word_from" | "word_to">
    : never
  : never;

function ControlGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4" aria-label={title}>
      <h4 className="via-eyebrow">{title}</h4>
      {children}
    </section>
  );
}

function SliderControl({
  label,
  value,
  shown,
  limits,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  shown: string;
  limits: { min: number; max: number; step: number };
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-[var(--via-text-primary)]">{label}</span>
        <span className="text-sm tabular-nums text-[var(--via-text-muted)]">{shown}</span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        disabled={disabled}
        onValueChange={([next]) => onChange(Math.round(next * 100) / 100)}
      />
    </div>
  );
}

function SwitchControl({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm font-normal text-[var(--via-text-primary)]">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((option) => (
        <ChoiceChip
          key={option.value}
          selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </ChoiceChip>
      ))}
    </div>
  );
}

function Adjustments({
  values,
  set,
  hasSpeech,
  captionsBurned,
  hasMusic,
}: {
  values: PanelValues;
  set: (patch: Partial<PanelValues>) => void;
  hasSpeech: boolean;
  captionsBurned: boolean;
  hasMusic: boolean;
}) {
  return (
    <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
      <ControlGroup title="Voz e ritmo">
        {hasSpeech ? (
          <SliderControl
            label="Velocidade da voz"
            value={values.speed}
            shown={`${values.speed.toFixed(2).replace(".", ",")}x`}
            limits={PANEL_LIMITS.speed}
            onChange={(speed) => set({ speed })}
          />
        ) : null}
        {hasSpeech ? (
          <SwitchControl
            id="edit-trim"
            label="Cortar pausas"
            checked={values.trimOn}
            onChange={(trimOn) => set({ trimOn })}
          />
        ) : null}
        {hasSpeech && values.trimOn ? (
          <>
            <SliderControl
              label="Cortar pausas acima de"
              value={values.gapMs}
              shown={`${(values.gapMs / 1000).toFixed(2).replace(".", ",")} s`}
              limits={PANEL_LIMITS.gapMs}
              onChange={(gapMs) => set({ gapMs })}
            />
            <SliderControl
              label="Respiro em cada corte"
              value={values.padMs}
              shown={`${values.padMs} ms`}
              limits={PANEL_LIMITS.padMs}
              onChange={(padMs) => set({ padMs })}
            />
          </>
        ) : null}
        <SwitchControl
          id="edit-voice"
          label="Limpar a voz"
          checked={values.voiceClean}
          onChange={(voiceClean) => set({ voiceClean })}
        />
        {hasMusic ? (
          <SliderControl
            label="Volume da música"
            value={values.musicDb}
            shown={`${String(values.musicDb).replace("-", "−")} dB`}
            limits={PANEL_LIMITS.musicDb}
            onChange={(musicDb) => set({ musicDb })}
          />
        ) : null}
      </ControlGroup>

      <ControlGroup title="Imagem">
        <SwitchControl
          id="edit-zoom"
          label="Zoom nos cortes"
          checked={values.zoomOn}
          onChange={(zoomOn) => set({ zoomOn })}
        />
        {values.zoomOn ? (
          <SliderControl
            label="Força do zoom"
            value={values.zoom}
            shown={`+${Math.round((values.zoom - 1) * 100)}%`}
            limits={PANEL_LIMITS.zoom}
            onChange={(zoom) => set({ zoom })}
          />
        ) : null}
        <div className="space-y-2">
          <p className="text-sm text-[var(--via-text-primary)]">Cor</p>
          <Choices
            label="Cor"
            value={values.color}
            options={COLORS.map((value) => ({ value, label: COLOR_LABEL[value] }))}
            onChange={(color) => set({ color })}
          />
        </div>
      </ControlGroup>

      {hasSpeech && !captionsBurned ? (
        <ControlGroup title="Legenda">
          <SwitchControl
            id="edit-captions"
            label="Mostrar legenda"
            checked={values.captionsOn}
            onChange={(captionsOn) => set({ captionsOn })}
          />
          {values.captionsOn ? (
            <>
              <Choices
                label="Estilo da legenda"
                value={values.captionStyle}
                options={[
                  { value: "caps", label: "Maiúsculas" },
                  { value: "karaoke", label: "Normal" },
                ]}
                onChange={(captionStyle) => set({ captionStyle })}
              />
              <Choices
                label="Posição da legenda"
                value={values.captionPosition}
                options={POSITIONS}
                onChange={(captionPosition) => set({ captionPosition })}
              />
            </>
          ) : null}
        </ControlGroup>
      ) : null}

      <ControlGroup title="Marca">
        <SwitchControl
          id="edit-logo"
          label="Logo no canto"
          checked={values.logoOn}
          onChange={(logoOn) => set({ logoOn })}
        />
        {values.logoOn ? (
          <>
            <SliderControl
              label="Opacidade do logo"
              value={values.logoOpacity}
              shown={`${Math.round(values.logoOpacity * 100)}%`}
              limits={PANEL_LIMITS.logoOpacity}
              onChange={(logoOpacity) => set({ logoOpacity })}
            />
            <Choices
              label="Canto do logo"
              value={values.logoCorner}
              options={CORNERS.map((value) => ({ value, label: CORNER_LABEL[value] }))}
              onChange={(logoCorner) => set({ logoCorner })}
            />
          </>
        ) : null}
        <SwitchControl
          id="edit-outro"
          label="Encerramento com logo"
          checked={values.outroOn}
          onChange={(outroOn) => set({ outroOn })}
        />
        {values.outroOn ? (
          <>
            <SliderControl
              label="Duração do encerramento"
              value={values.outroSeconds}
              shown={`${values.outroSeconds.toFixed(1).replace(".", ",")} s`}
              limits={PANEL_LIMITS.outroSeconds}
              onChange={(outroSeconds) => set({ outroSeconds })}
            />
            <Input
              aria-label="Chamada do encerramento"
              placeholder="Chamada final (opcional)"
              maxLength={40}
              value={values.outroCta}
              onChange={(event) => set({ outroCta: event.target.value })}
            />
          </>
        ) : null}
      </ControlGroup>
    </div>
  );
}

function InsertRow({
  item,
  words,
  onChange,
  onRemove,
}: {
  item: Insert;
  words: VideoEdit["analysis"]["words"] & object;
  onChange: (patch: Partial<Insert>) => void;
  onRemove: () => void;
}) {
  const label = spanLabel(words, item);
  const name = INSERT_NAME[item.kind];
  return (
    <li className="space-y-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-[var(--via-text-primary)]">
          {name}
          {item.kind === "image" || item.kind === "split" ? (
            <span className="font-normal text-[var(--via-text-muted)]"> · {item.name}</span>
          ) : null}
        </p>
        <button
          type="button"
          aria-label={`Tirar ${name}`}
          className="inline-flex size-8 shrink-0 items-center justify-center text-[var(--via-text-muted)] hover:text-[var(--via-text-primary)]"
          onClick={onRemove}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {item.kind === "title" ? (
        <Input
          aria-label="Texto da manchete"
          placeholder="Texto da manchete"
          maxLength={90}
          value={item.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      ) : null}
      {item.kind === "fact" ? (
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr]">
          <Input
            aria-label="Número"
            placeholder="40%"
            maxLength={24}
            value={item.value}
            onChange={(event) => onChange({ value: event.target.value })}
          />
          <Input
            aria-label="O que o número mostra"
            placeholder="O que ele mostra"
            maxLength={90}
            value={item.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
          <Input
            aria-label="Fonte"
            placeholder="Fonte"
            maxLength={70}
            value={item.source}
            onChange={(event) => onChange({ source: event.target.value })}
          />
        </div>
      ) : null}

      {item.kind === "split" ? (
        <Choices
          label="Lado do material"
          value={item.side}
          options={[
            { value: "top", label: "Material em cima" },
            { value: "bottom", label: "Material embaixo" },
          ]}
          onChange={(side) => onChange({ side })}
        />
      ) : (
        <Choices
          label="Posição"
          value={item.position}
          options={
            item.kind === "image"
              ? [...POSITIONS, { value: "full", label: "Tela cheia" }]
              : POSITIONS
          }
          onChange={(position) => onChange({ position } as Partial<Insert>)}
        />
      )}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-[var(--via-text-muted)]">
            “{label.quote}”
          </span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--via-text-muted)]">
            {label.time}
          </span>
        </div>
        <Slider
          aria-label={`Trecho de ${name}`}
          value={[item.word_from, item.word_to]}
          min={0}
          max={Math.max(1, words.length - 1)}
          step={1}
          onValueChange={([word_from, word_to]) => onChange({ word_from, word_to })}
        />
      </div>
    </li>
  );
}

export function EditPanel({
  edit,
  composer,
  busy,
  canRevert,
  onApply,
  onRevert,
}: {
  edit: VideoEdit;
  composer: ReactNode;
  busy: boolean;
  canRevert: boolean;
  onApply: (ops: EditOp[], attachments: string[]) => void;
  onRevert: () => void;
}) {
  const words = useMemo(() => edit.analysis.words ?? [], [edit.analysis.words]);
  // versão desfeita não é ponto de partida
  const base = useMemo(
    () => (edit.status === "ready" ? (edit.plan?.ops ?? []) : []),
    [edit.status, edit.plan?.ops],
  );
  const initial = useMemo(() => readPanel(base, words.length), [base, words.length]);
  const [values, setValues] = useState(initial);
  const [files, setFiles] = useState<EditAttachment[]>([]);
  const [tab, setTab] = useState("adjust");
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const slot = useRef<FileSlot>("image");
  const upload = useUploadEditFile();

  const attachments = edit.analysis.attachments ?? [];
  const hasMusic = [...attachments, ...files].some((file) => file.kind === "audio");
  const hasSpeech = words.length > 0;
  const set = (patch: Partial<PanelValues>) => setValues((current) => ({ ...current, ...patch }));
  const setInserts = (change: (items: Insert[]) => Insert[]) =>
    setValues((current) => ({ ...current, inserts: change(current.inserts) }));
  const addInsert = (item: InsertDraft) =>
    setInserts((items) => {
      const after = items.at(-1)?.word_to;
      const span = defaultSpan(words, after === undefined ? 0 : after + 1);
      return [...items, { ...span, ...item, id: crypto.randomUUID() } as Insert];
    });

  const pick = (next: FileSlot) => {
    slot.current = next;
    if (picker.current) picker.current.accept = FILE_ACCEPT[next];
    picker.current?.click();
  };
  const receive = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const attachment = await upload.mutateAsync(file);
      const index = attachments.length + files.length;
      setFiles((current) => [...current, attachment]);
      if (slot.current === "image") {
        addInsert({
          kind: "image",
          attachment_index: index,
          name: attachment.name,
          position: "middle",
        });
      } else if (slot.current === "split") {
        addInsert({
          kind: "split",
          attachment_index: index,
          name: attachment.name,
          side: "bottom",
        });
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || files.length > 0;
  const ready = dirty && !uploading && values.inserts.every(insertReady);
  const apply = () =>
    onApply(
      buildOps(base, initial, values, { wordCount: words.length, hasMusic }),
      files.map((file) => file.path),
    );

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="adjust">Ajustes</TabsTrigger>
          <TabsTrigger value="insert">Inserir</TabsTrigger>
          <TabsTrigger value="ask">Pedir ao Claude</TabsTrigger>
        </TabsList>

        <TabsContent value="adjust" className="mt-5">
          <Adjustments
            values={values}
            set={set}
            hasSpeech={hasSpeech}
            captionsBurned={edit.analysis.captions_burned === true}
            hasMusic={hasMusic}
          />
        </TabsContent>

        <TabsContent value="insert" className="mt-5 space-y-3">
          <input
            ref={picker}
            type="file"
            hidden
            onChange={(event) => {
              void receive(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!hasSpeech}
              onClick={() => addInsert({ kind: "title", text: "", position: "top" })}
            >
              Manchete
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!hasSpeech}
              onClick={() =>
                addInsert({ kind: "fact", value: "", label: "", source: "", position: "middle" })
              }
            >
              Dado na tela
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!hasSpeech || uploading}
              onClick={() => pick("image")}
            >
              Imagem
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!hasSpeech || uploading}
              onClick={() => pick("split")}
            >
              Tela dividida
            </Button>
            {hasMusic ? null : (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={uploading}
                onClick={() => pick("music")}
              >
                Música
              </Button>
            )}
            {uploading ? (
              <Loader2
                className="size-4 animate-spin text-[var(--via-text-muted)]"
                aria-label="Enviando"
              />
            ) : null}
          </div>
          {hasSpeech ? null : (
            <p className="text-sm text-[var(--via-text-muted)]">
              Este vídeo não tem fala para marcar o momento.
            </p>
          )}
          {values.inserts.length ? (
            <ul className="divide-y divide-[var(--via-border-soft)]">
              {values.inserts.map((item) => (
                <InsertRow
                  key={item.id}
                  item={item}
                  words={words}
                  onChange={(patch) =>
                    setInserts((items) =>
                      items.map((other) =>
                        other.id === item.id ? ({ ...other, ...patch } as Insert) : other,
                      ),
                    )
                  }
                  onRemove={() =>
                    setInserts((items) => items.filter((other) => other.id !== item.id))
                  }
                />
              ))}
            </ul>
          ) : null}
        </TabsContent>

        <TabsContent value="ask" className="mt-5">
          {composer}
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--via-border-soft)] pt-4">
        {tab === "ask" ? null : (
          <Button size="sm" disabled={!ready || busy} onClick={apply}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Aplicar
          </Button>
        )}
        {dirty ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setValues(initial);
              setFiles([]);
            }}
          >
            Descartar
          </Button>
        ) : null}
        <span className="text-xs text-[var(--via-text-muted)]">O original não muda.</span>
        {canRevert ? (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onRevert}>
            <RotateCcw aria-hidden="true" />
            Desfazer edição
          </Button>
        ) : null}
      </div>
    </div>
  );
}

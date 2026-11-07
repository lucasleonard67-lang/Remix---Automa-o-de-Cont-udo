import { ImageOff, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "@/lib/toast";

import { StringListEditor } from "@/components/string-list-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignedUrl } from "@/hooks/use-storage";
import type { BrandKitContent } from "@/hooks/use-versioned-brand";
import { normalizeArt } from "@/lib/carousel-art";
import { ArtReview } from "@/components/brand/art-review";
import { useTweetCardBrand } from "@/hooks/use-tweet-card-brand";
import { supabase } from "@/integrations/supabase/client";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Formulário do Brand Kit (§8.4) — compartilhado entre /marca/brand-kit
// (VersionedEditorShell) e o passo 7 do onboarding.
// ---------------------------------------------------------------------------

export const DEFAULT_PALETTE: Record<string, string> = {
  primary: "#0B1B2B",
  secondary: "#1E3A5F",
  accent: "#D4AF37",
  background: "#FFFFFF",
  text: "#111111",
};

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function sanitizeBrandKitContent(content: BrandKitContent): BrandKitContent {
  const palette: Record<string, string> = {};
  for (const [token, color] of Object.entries(content.palette)) {
    const name = token.trim();
    if (name && color.trim()) palette[name] = color.trim();
  }
  return {
    palette,
    typography: {
      heading: content.typography.heading.trim(),
      body: content.typography.body.trim(),
    },
    logo_path: content.logo_path,
    negative_constraints: content.negative_constraints.map((item) => item.trim()).filter(Boolean),
    photo_paths: content.photo_paths.filter(Boolean),
    // O sanitize monta o objeto do zero (chave desconhecida é descartada de
    // propósito) — sem esta linha o vocabulário de arte sumiria no salvamento.
    art: normalizeArt(content.art),
  };
}

/** Upload para o bucket privado `brand-assets` (escrita restrita a admin via RLS). */
export async function uploadBrandAsset(file: File, folder: string): Promise<string> {
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from("brand-assets").upload(path, file);
  if (error) {
    throw new Error(
      /row-level security|policy/i.test(error.message)
        ? "Só administradores enviam arquivos. Peça a um administrador da conta."
        : `O envio falhou. ${humanizeError(error.message)}`,
    );
  }
  return path;
}

export interface BrandKitFormFieldsProps {
  content: BrandKitContent;
  patch: (partial: Partial<BrandKitContent>) => void;
  readOnly?: boolean;
}

export function BrandKitFormFields({ content, patch, readOnly = false }: BrandKitFormFieldsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paleta de cores</CardTitle>
          <CardDescription>Cores usadas nas artes e nas imagens geradas.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaletteEditor
            value={content.palette}
            onChange={(next) => patch({ palette: next })}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tipografia</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="typo-heading">Títulos</Label>
            <Input
              id="typo-heading"
              value={content.typography.heading}
              onChange={(event) =>
                patch({ typography: { ...content.typography, heading: event.target.value } })
              }
              placeholder="Ex.: Inter Bold"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="typo-body">Corpo</Label>
            <Input
              id="typo-body"
              value={content.typography.body}
              onChange={(event) =>
                patch({ typography: { ...content.typography, body: event.target.value } })
              }
              placeholder="Ex.: Inter Regular"
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo</CardTitle>
          <CardDescription>Fica guardado de forma privada, só para a sua conta.</CardDescription>
        </CardHeader>
        <CardContent>
          <LogoField
            logoPath={content.logo_path}
            onUploaded={(path) => patch({ logo_path: path })}
            onRemove={() => patch({ logo_path: null })}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fotos da marca</CardTitle>
          <CardDescription>
            Fotos da pessoa ou da marca usadas nas artes e imagens geradas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhotosField
            paths={content.photo_paths}
            onChange={(next) => patch({ photo_paths: next })}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arte do carrossel</CardTitle>
          <CardDescription>
            Composição, moldura, textura e tratamento de foto. Cores e fontes vêm dos campos acima.
            Vale para todo carrossel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArtBlock content={content} patch={patch} readOnly={readOnly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Restrições visuais</CardTitle>
          <CardDescription>O que nunca fazer no visual.</CardDescription>
        </CardHeader>
        <CardContent>
          <StringListEditor
            value={content.negative_constraints}
            onChange={(next) => patch({ negative_constraints: next })}
            placeholder="Ex.: nunca usar stock photo genérica de aperto de mão"
            disabled={readOnly}
            addLabel="Adicionar restrição"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arte — a prévia precisa da marca ATIVA (logo por signed URL, nome da
// persona), que vem de um hook; por isso o bloco é um componente e não um
// trecho solto dentro do formulário.
// ---------------------------------------------------------------------------

function ArtBlock({
  content,
  patch,
  readOnly,
}: {
  content: BrandKitContent;
  patch: (partial: Partial<BrandKitContent>) => void;
  readOnly: boolean;
}) {
  const brandAtiva = useTweetCardBrand();
  // A prévia tem que mostrar o que ESTÁ SENDO EDITADO, não o que já está
  // ativo: senão mexer na paleta acima não muda a arte aqui embaixo.
  const brand = {
    ...brandAtiva,
    palette: content.palette,
    typography: content.typography,
  };
  return (
    <ArtReview
      art={content.art}
      brand={brand}
      onChange={(delta) => patch({ art: { ...content.art, ...delta } })}
      readOnly={readOnly}
    />
  );
}

// ---------------------------------------------------------------------------
// Paleta
// ---------------------------------------------------------------------------

function PaletteEditor({
  value,
  onChange,
  readOnly,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  readOnly: boolean;
}) {
  const entries = Object.entries(value);

  const renameToken = (oldToken: string, rawNext: string) => {
    const nextToken = rawNext.trim();
    if (!nextToken || nextToken === oldToken) return;
    const next: Record<string, string> = {};
    for (const [token, color] of entries) {
      next[token === oldToken ? nextToken : token] = color;
    }
    onChange(next);
  };

  const setColor = (token: string, color: string) => onChange({ ...value, [token]: color });

  const removeToken = (token: string) => {
    const next = { ...value };
    delete next[token];
    onChange(next);
  };

  const addToken = () => {
    let name = "nova_cor";
    let suffix = 1;
    while (name in value) {
      suffix += 1;
      name = `nova_cor_${suffix}`;
    }
    onChange({ ...value, [name]: "#888888" });
  };

  if (entries.length === 0 && readOnly) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([token, color]) => (
        <PaletteRow
          key={token}
          token={token}
          color={color}
          readOnly={readOnly}
          onRename={(next) => renameToken(token, next)}
          onColorChange={(next) => setColor(token, next)}
          onRemove={() => removeToken(token)}
        />
      ))}
      {!readOnly ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={addToken}>
            <Plus aria-hidden="true" />
            Adicionar cor
          </Button>
          {entries.length === 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onChange({ ...DEFAULT_PALETTE })}
            >
              Usar paleta padrão
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PaletteRow({
  token,
  color,
  readOnly,
  onRename,
  onColorChange,
  onRemove,
}: {
  token: string;
  color: string;
  readOnly: boolean;
  onRename: (next: string) => void;
  onColorChange: (next: string) => void;
  onRemove: () => void;
}) {
  const [localToken, setLocalToken] = useState(token);

  return (
    <div className="flex items-center gap-2">
      <Input
        value={localToken}
        onChange={(event) => setLocalToken(event.target.value)}
        onBlur={() => onRename(localToken)}
        placeholder="nome (ex.: primary)"
        className="max-w-44"
        disabled={readOnly}
        aria-label="Nome da cor"
      />
      <input
        type="color"
        value={HEX_PATTERN.test(color) ? color : "#000000"}
        onChange={(event) => onColorChange(event.target.value)}
        disabled={readOnly}
        className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1 disabled:cursor-default"
        aria-label={`Cor ${token}`}
      />
      <Input
        value={color}
        onChange={(event) => onColorChange(event.target.value)}
        placeholder="#0B1B2B"
        className="max-w-32 font-mono text-xs"
        disabled={readOnly}
        aria-label={`Código hex da cor ${token}`}
      />
      {!readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onRemove}
          aria-label={`Remover cor ${token}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo e fotos (bucket brand-assets)
// ---------------------------------------------------------------------------

function AssetPreview({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const { data: url, isLoading, isError } = useSignedUrl("brand-assets", path);
  if (isLoading) return <Skeleton className={className ?? "h-24 w-24 rounded-md"} />;
  if (isError || !url) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-dashed border-border text-muted-foreground ${className ?? "h-24 w-24"}`}
      >
        <ImageOff className="size-5" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={`rounded-md border border-border object-contain ${className ?? "h-24 w-24"}`}
    />
  );
}

function LogoField({
  logoPath,
  onUploaded,
  onRemove,
  readOnly,
}: {
  logoPath: string | null;
  onUploaded: (path: string) => void;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadBrandAsset(file, "logo");
      onUploaded(path);
      toast.success("Logo enviado", {
        description: "Clique em “Salvar rascunho” para não perder a mudança.",
      });
    } catch (error) {
      toast.error("Não foi possível enviar o logo", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {logoPath ? (
        <AssetPreview path={logoPath} alt="Logo da marca" className="h-24 w-40" />
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum logo enviado (opcional).</p>
      )}
      {!readOnly ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload aria-hidden="true" />
            {uploading ? "Enviando…" : logoPath ? "Substituir" : "Enviar logo"}
          </Button>
          {logoPath ? (
            <Button type="button" variant="ghost" onClick={onRemove} disabled={uploading}>
              <Trash2 aria-hidden="true" />
              Remover
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PhotosField({
  paths,
  onChange,
  readOnly,
}: {
  paths: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        uploaded.push(await uploadBrandAsset(file, "photos"));
      }
      onChange([...paths, ...uploaded]);
      toast.success(uploaded.length === 1 ? "Foto enviada" : `${uploaded.length} fotos enviadas`, {
        description: "Clique em “Salvar rascunho” para não perder a mudança.",
      });
    } catch (error) {
      toast.error("Não foi possível enviar as fotos", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      {paths.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto enviada.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {paths.map((path) => (
            <div key={path} className="relative">
              <AssetPreview path={path} alt="Foto da marca" className="h-24 w-24" />
              {!readOnly ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute -right-2 -top-2 size-6 rounded-full"
                  onClick={() => onChange(paths.filter((item) => item !== path))}
                  aria-label="Remover foto"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {!readOnly ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload aria-hidden="true" />
            {uploading ? "Enviando…" : "Adicionar fotos"}
          </Button>
        </>
      ) : null}
    </div>
  );
}

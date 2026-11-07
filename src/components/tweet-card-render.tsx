import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";

import { ImageIcon } from "lucide-react";

import { TWEET_CARD_DISPLAY_SIZES, type TweetCardAspect } from "@/lib/render-export";

// ---------------------------------------------------------------------------
// TweetCardRender — render 100% determinístico (DOM + CSS puros, sem lib) do
// "print de tweet" usado como arte nos canais de card (docs/05 §4.2/§5).
// Estilos INLINE com cores explícitas de propósito: o export PNG
// (html-to-image) clona o node e cores em hex/rgb inline não dependem de
// variáveis CSS/tema do app — o mesmo card sai idêntico em qualquer tela.
// ---------------------------------------------------------------------------

export interface TweetCardBrand {
  name: string;
  /** @ real da conta conectada, sem a arroba. Sem conta, a arte não mostra @. */
  handle?: string | null;
  /** Signed URL do logo do brand kit ativo (bucket brand-assets). */
  logoUrl?: string | null;
  /** §8.4 — tokens de cor do brand kit ativo (chaves livres). */
  palette?: Record<string, string>;
  /** §8.4 — famílias tipográficas do brand kit ativo. */
  typography?: { heading?: string; body?: string };
}

export interface TweetCardRenderProps {
  text: string;
  brand: TweetCardBrand;
  aspect: TweetCardAspect;
  /** Imagem IA opcional exibida ABAIXO do texto (render de generate-image). */
  imageUrl?: string | null;
  /**
   * Como compor a imagem IA no card: 'inline' (bloco abaixo do texto, default)
   * ou 'background' (foto full-bleed atrás do texto, com scrim para leitura).
   * Sem imageUrl, o modo é ignorado.
   */
  imageMode?: "inline" | "background";
  /**
   * Fundo do card: 'plain' (cor chapada da paleta, default) ou 'brand'
   * (gradiente DETERMINÍSTICO derivado da paleta do brand kit — identidade
   * visual, zero aleatoriedade de IA). Com imageMode 'background' e foto
   * presente, a foto vence; senão o fundo de marca preenche o card e a foto
   * IA (se houver) fica no bloco inline.
   */
  background?: "plain" | "brand";
  /**
   * Mostra o bloco reservado da imagem IA quando a peça tem image_brief mas o
   * render ainda não existe. Excluído do PNG exportado (data-export-exclude).
   */
  imagePlaceholder?: boolean;
  className?: string;
  /** Ref do node exportável (passar a exportNodeToPng). */
  ref?: Ref<HTMLDivElement>;
}

// Tokens padrão do app (fallback quando o brand kit não define paleta).
const DEFAULT_BG = "#ffffff";
const DEFAULT_FG = "#111827";
const DEFAULT_ACCENT = "#2563eb";
const DEFAULT_HEADING_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DEFAULT_BODY_FONT = DEFAULT_HEADING_FONT;

function paletteToken(
  palette: Record<string, string> | undefined,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = palette?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

/** #rrggbb → [r,g,b]; null para valores fora do formato hex. */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Mistura determinística da cor com preto (amount 0..1). */
function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => Math.round(c * (1 - amount)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Luminância aproximada (0..255) para decidir texto claro × escuro. */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 255;
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Fundo de MARCA determinístico: gradiente escuro derivado da paleta do brand
 * kit (identidade visual — nada de foto IA "aleatória" atrás do texto). Base:
 * o background da paleta quando ele já é escuro; senão a cor primária/accent
 * (paleta clara ou vazia → gradiente profundo da cor da marca). Mesmo input ⇒
 * mesmo gradiente; texto SEMPRE branco sobre ele (o gradiente termina escuro).
 */
function brandBackgroundCss(bg: string, accent: string): string {
  const base = luminance(bg) > 180 ? accent : bg;
  return (
    `radial-gradient(120% 90% at 85% -10%, ${accent}33 0%, transparent 55%), ` +
    `linear-gradient(160deg, ${shade(base, 0.25)} 0%, ${shade(base, 0.55)} 55%, ${shade(base, 0.78)} 100%)`
  );
}

/** Handle sintético "@marca" derivado do nome (sem estado externo). */
function brandHandle(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `@${slug || "marca"}`;
}

/**
 * Tamanho de fonte auto-ajustável ao comprimento do texto (card 540px de
 * largura). Degraus fixos → determinístico (mesmo texto = mesmo tamanho).
 */
function autoFontSize(length: number, aspect: TweetCardAspect, hasImageBlock: boolean): number {
  let size: number;
  if (length <= 80) size = 34;
  else if (length <= 140) size = 30;
  else if (length <= 220) size = 26;
  else if (length <= 320) size = 23;
  else if (length <= 450) size = 20;
  else if (length <= 620) size = 18;
  else size = 16;
  if (hasImageBlock) size -= 4;
  // 1:1 tem ~20% menos altura que o 4:5 para o MESMO texto: com foto no bloco,
  // a fonte cede mais um degrau para texto e foto caberem juntos no quadrado.
  if (aspect === "1:1" && hasImageBlock) size -= 3;
  if (aspect === "9:16") size += 2;
  return Math.max(size, 14);
}

export function TweetCardRender({
  text,
  brand,
  aspect,
  imageUrl,
  imageMode = "inline",
  background = "plain",
  imagePlaceholder = false,
  className,
  ref,
}: TweetCardRenderProps) {
  const { width, height } = TWEET_CARD_DISPLAY_SIZES[aspect];

  const bg = paletteToken(brand.palette, ["background", "bg", "surface", "card"], DEFAULT_BG);
  const paletteFg = paletteToken(brand.palette, ["foreground", "text", "ink"], DEFAULT_FG);
  const accent = paletteToken(brand.palette, ["primary", "accent", "brand"], DEFAULT_ACCENT);
  const headingFont = brand.typography?.heading?.trim() || DEFAULT_HEADING_FONT;
  const bodyFont = brand.typography?.body?.trim() || DEFAULT_BODY_FONT;

  // Modo foto de fundo: full-bleed atrás do texto. Fundo de marca: gradiente
  // determinístico da paleta (identidade visual). Nos dois, texto SEMPRE
  // branco — o scrim/gradiente terminam escuros, legível independente da foto.
  const isBackground = imageMode === "background" && Boolean(imageUrl);
  const isBrandBg = !isBackground && background === "brand";
  const fg = isBackground || isBrandBg ? "#ffffff" : paletteFg;

  // A fonte encolhe para dar espaço à imagem — mas SÓ quando existe imagem de
  // verdade EM MODO INLINE. O placeholder tracejado é excluído do PNG
  // (data-export-exclude) e a foto de fundo não rouba área do texto.
  const hasImageBlock = Boolean(imageUrl) && !isBackground;
  const fontSize = autoFontSize(text.length, aspect, hasImageBlock);
  const handle = brandHandle(brand.name);
  const initial = (brand.name.trim().charAt(0) || "?").toUpperCase();
  const pad = aspect === "9:16" ? 56 : 44;

  // Escala o card fixo (determinístico) para caber no container da tela; o
  // node exportado (ref) permanece no tamanho base — o PNG não muda.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setScale(Math.min(1, container.clientWidth / width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [width]);

  const cardStyle: CSSProperties = {
    width,
    height,
    padding: pad,
    display: "flex",
    flexDirection: "column",
    backgroundColor: isBrandBg ? shade(luminance(bg) > 180 ? accent : bg, 0.55) : bg,
    ...(isBrandBg ? { backgroundImage: brandBackgroundCss(bg, accent) } : {}),
    color: fg,
    fontFamily: bodyFont,
    borderRadius: 0,
    overflow: "hidden",
    ...(isBackground ? { position: "relative" } : {}),
  };

  // Sombra sutil no texto do modo fundo — reforça a leitura sobre áreas claras
  // da foto sem depender do scrim sozinho.
  const backgroundTextShadow = isBackground ? "0 2px 12px rgba(0,0,0,0.55)" : undefined;

  return (
    <div ref={containerRef} className={className} style={{ width: "100%" }}>
      <div style={{ width: "100%", height: height * scale, overflow: "hidden" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <div ref={ref} style={cardStyle}>
            {isBackground && imageUrl ? (
              <>
                {/* Foto full-bleed atrás de tudo + scrim de leitura */}
                <img
                  src={imageUrl}
                  alt=""
                  crossOrigin="anonymous"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0.72) 100%)",
                  }}
                />
              </>
            ) : null}
            {/* Header — avatar + nome + handle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                ...(isBackground ? { position: "relative" } : {}),
              }}
            >
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt=""
                  crossOrigin="anonymous"
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    backgroundColor: accent,
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: headingFont,
                    fontSize: 26,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initial}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: headingFont,
                    fontSize: 20,
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  {brand.name}
                </p>
                <p style={{ margin: 0, fontSize: 15, opacity: 0.55, lineHeight: 1.3 }}>{handle}</p>
              </div>
            </div>

            {/* Corpo — texto do card + imagem opcional abaixo. 'safe center' +
                overflow hidden: conteúdo maior que o corpo NUNCA invade o
                header (o excesso é clipado embaixo, onde a foto encolhe). */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "safe center",
                overflow: "hidden",
                gap: 24,
                paddingTop: 28,
                paddingBottom: 28,
                ...(isBackground ? { position: "relative" } : {}),
              }}
            >
              <p
                style={{
                  margin: 0,
                  flexShrink: 0,
                  fontSize,
                  lineHeight: 1.35,
                  fontWeight: isBackground ? 600 : 500,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "break-word",
                  ...(backgroundTextShadow ? { textShadow: backgroundTextShadow } : {}),
                }}
              >
                {text}
              </p>
              {/* Imagem real vence o placeholder: o bloco tracejado (excluído
                  do PNG) só existe enquanto a imagem de IA não foi gerada.
                  Em modo fundo a foto já está atrás do texto — nada inline.
                  O wrapper tem base fixa (42% da altura) mas ENCOLHE quando o
                  texto é longo — o texto nunca perde espaço para a foto. */}
              {imageUrl && !isBackground ? (
                <div
                  style={{
                    height: height * 0.42,
                    minHeight: 72,
                    flexShrink: 1,
                    overflow: "hidden",
                    borderRadius: 16,
                  }}
                >
                  <img
                    src={imageUrl}
                    alt=""
                    crossOrigin="anonymous"
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              ) : imagePlaceholder ? (
                <div
                  data-export-exclude
                  style={{
                    width: "100%",
                    // Menor que a imagem real: é aviso de estado, não reserva de
                    // espaço — e não aparece no PNG.
                    height: height * 0.18,
                    flexShrink: 0,
                    borderRadius: 16,
                    border: `2px dashed ${accent}`,
                    opacity: 0.5,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    fontSize: 14,
                  }}
                >
                  <ImageIcon style={{ width: 24, height: 24 }} aria-hidden="true" />
                  Imagem ainda não gerada. Gere pelo menu ⋯ da peça
                </div>
              ) : null}
            </div>

            {/* Rodapé discreto */}
            <div style={isBackground ? { position: "relative" } : undefined}>
              <div
                style={{
                  height: 1,
                  backgroundColor: fg,
                  opacity: isBackground || isBrandBg ? 0.35 : 0.15,
                  marginBottom: 14,
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  opacity: isBackground || isBrandBg ? 0.85 : 0.5,
                  ...(backgroundTextShadow ? { textShadow: backgroundTextShadow } : {}),
                }}
              >
                <span>{handle}</span>
                <span>{brand.name}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

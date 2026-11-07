import { Bookmark, Link2, Send, UserPlus } from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";

import { TWEET_CARD_DISPLAY_SIZES, type TweetCardAspect } from "@/lib/render-export";
import type { TweetCardBrand } from "@/components/tweet-card-render";
import { DEFAULT_ART, type CarouselArt } from "@/lib/carousel-art";
import { artInk, contraste } from "@/lib/brand-ink";
import { loadBrandFonts } from "@/lib/brand-fonts";
import { boldKeyNumber, coverHeadline, splitSentences } from "@/lib/carousel-editorial";
import { fitsInMid } from "@/lib/carousel-fit";
import { bodyScale, splitSlideText, stripEmphasis, titleScale, toWords } from "@/lib/carousel-text";
import type { SlideCta, TweetCardSlide } from "@/hooks/use-content-pieces";

// ---------------------------------------------------------------------------
// CarouselSlideRender — CHASSI da arte de carrossel.
//
// Não tem estética própria e NÃO tem catálogo. Monta uma estrutura semântica
// fixa e a pinta com o design system DA MARCA:
//
//   MATÉRIA (brand_kit: paleta, tipografia, logo) → custom properties
//   FORMA   (brand_kit.art: vocabulário fechado)  → data-attributes
//
//   .via-slide[data-layout][data-frame][data-texture][data-photo-slot]…
//     ├─ .photo  (foto de IA, revelada conforme data-photo-grade)
//     ├─ .scrim
//     ├─ .deco   (textura e moldura)
//     └─ .pad
//         ├─ .top  → .eyebrow (marca) · .num
//         ├─ .mid  → .title (palavra a palavra) · .body
//         └─ .bot  → .handle · .pg
//
// O que existia antes era um seletor de temas: onze peles com hex e fonte
// literais no CSS, escolhidas peça a peça. A marca podia ter a paleta extraída
// do próprio site que a arte saía nas cores da pele. Aqui não há o que
// escolher na peça — a arte é a da marca.
//
// Duas restrições que NÃO podem ser afrouxadas:
//  1. a caixa tem tamanho FIXO (TWEET_CARD_DISPLAY_SIZES) e é escalada por
//     transform. O PNG rasteriza este mesmo node; se a largura viva variasse,
//     a arte exportada mudaria com o tamanho da janela;
//  2. tudo dentro é dimensionado em `cqw` sobre `container-type: inline-size`,
//     então a mesma arte serve o preview de 540px e o canvas de 1080px.
// ---------------------------------------------------------------------------

export interface CarouselSlideRenderProps {
  text: string;
  brand: TweetCardBrand;
  aspect: TweetCardAspect;
  /** Posição no deck (0 = capa). Decide o `data-kind`. */
  index: number;
  total: number;
  /** Foto do slide (o vocabulário da marca decide se e como usa). */
  imageUrl?: string | null;
  /** Slide do miolo promovido a foto pelo usuário. */
  photoPromoted?: boolean;
  /**
   * A imagem já traz a manchete tipografada (capa gerada como peça de arte).
   * Então o chassi NÃO desenha texto — a arte é a imagem inteira.
   */
  artRendered?: boolean;
  /** Vocabulário de arte da marca. Sem ele, o padrão sóbrio. */
  art?: CarouselArt;
  /**
   * Estrutura editorial do slide (manchete, parágrafos, foto ou gráfico) que o
   * gerador entrega no layout `editorial`. Sem ela, o chassi deriva do `text`.
   */
  slide?: Pick<TweetCardSlide, "title" | "paragraphs" | "visual" | "chart" | "role" | "cta">;
  /**
   * Peça que o chassi editorial desenha: carrossel (padrão), um quadro de
   * Stories (9:16: abertura, miolo, fecho) ou o card único do Post.
   */
  format?: "carousel" | "story" | "post";
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const FALLBACK_FONT =
  'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Papel do slide no deck — a arte muda de composição por aqui. */
export function slideKind(index: number, total: number): "cover" | "point" | "cta" {
  if (index === 0) return "cover";
  if (index === total - 1 && total > 1) return "cta";
  return "point";
}

/** Handle sintético "@marca" derivado do nome (sem estado externo). */
function brandHandle(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `@${slug || "marca"}`;
}

// ---------------------------------------------------------------------------
// Ajuste medido do texto.
//
// O degrau por comprimento não basta: o vocabulário de arte muda o corpo base
// (coluna vertical roda fino, colagem roda grande), então o MESMO texto cabe
// numa composição e estoura na outra. Aqui a arte é medida e o texto encolhe
// até caber (`--fit`), em px de LAYOUT — a escala do contêiner não muda o
// resultado, e por isso o preview e o PNG convergem para o mesmo valor.
// ---------------------------------------------------------------------------
const FIT_MIN = 0.34;
const FIT_STEP = 0.04;

function useFitText(ref: { current: HTMLDivElement | null }, deps: unknown[]): void {
  useLayoutEffect(() => {
    const slide = ref.current;
    if (!slide) return;
    if (!slide.querySelector(".mid")) return;

    // Sem a trava, o próprio ajuste redimensiona o título, o observer dispara
    // e o ajuste roda dentro de si mesmo.
    let ajustando = false;

    const ajustar = () => {
      if (ajustando) return;
      ajustando = true;
      try {
        let fit = 1;
        slide.style.setProperty("--fit", "1");
        // `fitsInMid` mede geometria dos quatro lados: `scrollHeight` é CEGO
        // para vazamento pela borda inicial, que é o que `center` e `flex-end`
        // produzem. Cada leitura força reflow, daí o passo grosso.
        while (!fitsInMid(slide) && fit > FIT_MIN) {
          fit = Math.round((fit - FIT_STEP) * 100) / 100;
          slide.style.setProperty("--fit", String(fit));
        }
      } finally {
        requestAnimationFrame(() => {
          ajustando = false;
        });
      }
    };

    // Primeira medição SÍNCRONA (useLayoutEffect): a arte nunca é pintada no
    // tamanho errado antes de encolher.
    ajustar();

    // As remedições, não: cada família da marca dispara um `loadingdone`, e
    // sem coalescer são várias rajadas de laço de reflow seguidas.
    let agendado = 0;
    const remedir = () => {
      if (agendado) return;
      agendado = requestAnimationFrame(() => {
        agendado = 0;
        ajustar();
      });
    };

    // A fonte da marca chega DEPOIS da primeira medição — medir com o fallback
    // e trocar por uma família mais larga é como a arte estoura só no export.
    const observer = new ResizeObserver(remedir);
    const title = slide.querySelector(".title");
    const body = slide.querySelector(".body");
    if (title) observer.observe(title);
    if (body) observer.observe(body);
    document.fonts?.addEventListener?.("loadingdone", remedir);

    return () => {
      if (agendado) cancelAnimationFrame(agendado);
      observer.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", remedir);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function CarouselSlideRender({
  text,
  brand,
  aspect,
  index,
  total,
  imageUrl,
  photoPromoted,
  artRendered = false,
  art = DEFAULT_ART,
  slide,
  format = "carousel",
  className,
  ref,
}: CarouselSlideRenderProps) {
  const { width, height } = TWEET_CARD_DISPLAY_SIZES[aspect];
  // o Post é um card só: miolo, nunca capa
  const kind = format === "post" ? "point" : slideKind(index, total);

  const displayFont = brand.typography?.heading?.trim() || FALLBACK_FONT;
  const bodyFont = brand.typography?.body?.trim() || displayFont;
  // O fundo é EIXO DA ARTE, não prop: uma prop separada duplicaria a fonte e
  // já deu nisso — o seletor de fundo na revisão não mudava nada porque o
  // chamador não repassava. Uma fonte só.
  const tinta = artInk(brand.palette, art.surface === "ink");

  // As famílias da marca são pedidas na primeira vez que a arte aparece. O
  // export chama `brandFontsReady` e ESPERA — aqui basta disparar.
  useEffect(() => {
    loadBrandFonts(displayFont, bodyFont);
  }, [displayFont, bodyFont]);

  // Foto: a capa sempre pede; o miolo só quando o usuário promoveu aquele
  // slide. O VOCABULÁRIO tem a última palavra — um sistema gráfico
  // (photo_slot 'none') não recebe a camada, e o ornamento é a arte.
  const querFoto = Boolean(imageUrl) && (kind === "cover" || photoPromoted === true);
  // A capa como PEÇA DE ARTE ignora o `photo_slot`: aquele eixo governa a
  // fotografia do miolo. Um design system gráfico (photo_slot 'none') continua
  // tendo capa — ela é que não é uma foto.
  const capaDeArte = artRendered && Boolean(imageUrl) && kind === "cover";
  const comFoto = capaDeArte || (querFoto && art.photo_slot !== "none");

  const { title, body } = splitSlideText(text);
  const palavras = toWords(title);
  const corpo = stripEmphasis(body);

  // Escala o card fixo para caber no container; o node exportado (ref) fica no
  // tamanho base — o PNG não muda com o tamanho da tela.
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
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

  // texto do botão do fecho na cor de destaque: branco quando contrasta, senão a tinta
  const onAccent = contraste(tinta.accent, "#ffffff") >= 3 ? "#ffffff" : tinta.ink;
  const slideStyle: CSSProperties = {
    width,
    height,
    ...tinta.vars,
    "--font-display": displayFont,
    "--font-body": bodyFont,
    "--title-scale": art.title_scale,
    "--t0": titleScale(title.length),
    "--b0": bodyScale(corpo.length),
    "--on-accent": onAccent,
  } as CSSProperties;

  const editorial = art.layout === "editorial";
  // o fecho do carrossel: a tese, o próximo passo e o botão (docs/carrossel-editorial.md)
  const fecho = editorial && format === "carousel" && slide?.role === "cta";
  useFitText(slideRef, [art, title, corpo, aspect, kind, comFoto, capaDeArte, slide]);

  return (
    <div ref={containerRef} className={className} style={{ width: "100%" }}>
      <div style={{ width: "100%", height: height * scale, overflow: "hidden" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <div
            ref={(node) => {
              slideRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) ref.current = node;
            }}
            className="via-slide"
            style={slideStyle}
            data-carousel-slide={index}
            data-kind={kind}
            data-photo={comFoto && !editorial ? "on" : "off"}
            data-art-rendered={capaDeArte ? "true" : "false"}
            data-cover-photo={editorial && kind === "cover" && imageUrl ? "on" : "off"}
            data-closing={fecho ? "on" : "off"}
            data-layout={art.layout}
            data-format={format}
            data-frame={art.frame}
            data-texture={art.texture}
            data-photo-slot={art.photo_slot}
            data-photo-grade={art.photo_grade}
            data-wordplay={art.wordplay}
            data-shadow={art.shadow}
            data-title-case={art.title_case}
            data-edge={art.edge}
            data-density={art.density}
            data-carousel-surface={art.surface}
          >
            {editorial ? (
              <EditorialContent
                text={text}
                slide={slide}
                kind={kind}
                format={format}
                brand={brand}
                imageUrl={imageUrl ?? null}
                photoPromoted={photoPromoted === true}
                capaDeArte={capaDeArte}
              />
            ) : null}
            {editorial ? null : comFoto ? (
              <>
                <div className="photo">
                  <img src={imageUrl ?? undefined} alt="" crossOrigin="anonymous" />
                </div>
                <div className="scrim" />
              </>
            ) : null}
            {editorial ? null : <div className="deco" aria-hidden="true" />}

            {/* Arte fechada: a manchete já está NA imagem. Desenhar o chassi
                por cima sairia manchete em dobro. Sem a marca (peça antiga ou
                recusa do modelo), o chassi desenha como sempre. */}
            {capaDeArte || editorial ? null : (
              <div className="pad">
                <header className="top">
                  <span className="eyebrow">
                    {brand.logoUrl ? (
                      <img className="mark" src={brand.logoUrl} alt="" crossOrigin="anonymous" />
                    ) : null}
                    {brand.name}
                  </span>
                  <span className="num">{String(index + 1).padStart(2, "0")}</span>
                </header>

                <div className="mid">
                  <h3 className="title">
                    {/* O espaço vai FORA do span: composições que pintam fundo em
                      cada palavra fariam do espaço uma tarja solta. Nó de texto
                      também não conta em nth-child, então a alternância por
                      palavra continua valendo. */}
                    {palavras.map((palavra, i) => (
                      <Fragment key={i}>
                        {i > 0 ? " " : null}
                        <span className={palavra.em ? "w em" : "w"}>{palavra.text}</span>
                      </Fragment>
                    ))}
                  </h3>
                  {corpo ? <p className="body">{corpo}</p> : null}
                </div>

                <footer className="bot">
                  <span className="handle">
                    {kind === "cover" ? "arraste →" : brandHandle(brand.name)}
                  </span>
                  <span className="pg">
                    {index + 1}/{total}
                  </span>
                </footer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout EDITORIAL — o padrão da casa (docs/carrossel-editorial.md).
//
// Fundamentos fixos, matéria da marca:
//   · capa: foto sangrada, véu escuro embaixo, assinatura da marca (avatar,
//     nome, @), manchete com a virada em negrito e "Arrasta pro lado →";
//   · miolo: fundo papel, margem lateral de 8,4% e o bloco CENTRADO na
//     vertical — manchete curta, parágrafos curtos com o número-chave em
//     negrito e, quando houver, UM apoio: foto 16:9 na largura do texto ou
//     gráfico de barras com a última barra na cor de destaque;
//   · sem cabeçalho, rodapé nem numeração: a página respira.
// Fontes e cores vêm do brand kit (--font-*, --ink, --paper, --accent).
// ---------------------------------------------------------------------------

/** `**negrito**` vira peso; o resto é texto corrido. */
function Emphasis({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((trecho, i) =>
          trecho.startsWith("**") && trecho.endsWith("**") && trecho.length > 4 ? (
            <strong key={i}>{trecho.slice(2, -2)}</strong>
          ) : (
            <Fragment key={i}>{trecho}</Fragment>
          ),
        )}
    </>
  );
}

/** Corpo sem estrutura → parágrafos de até duas frases (o ritmo do exemplo). */
function toParagraphs(body: string): string[] {
  const linhas = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length > 1) return linhas;
  const frases = splitSentences(linhas[0] ?? "");
  const saida: string[] = [];
  for (let i = 0; i < frases.length; i += 2) saida.push(frases.slice(i, i + 2).join(" "));
  return saida;
}

/**
 * Manchete do miolo a partir do texto corrido: a primeira frase quando cabe em
 * até três linhas; se for longa, corta na pausa (vírgula, dois-pontos) e o
 * resto vira o começo do corpo. Nunca repete texto nem corta com reticências.
 */
const MANCHETE_MAX = 95;
const PAUSA_MAX = 70;
function editorialSplit(text: string): { title: string; body: string } {
  const texto = stripEmphasis(text).replace(/\r\n?/g, "\n").trim();
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length > 1 && linhas[0].length <= MANCHETE_MAX) {
    return { title: linhas[0], body: linhas.slice(1).join("\n") };
  }
  const plano = linhas.join(" ");
  const frase = splitSentences(plano)[0] ?? plano;
  if (frase.length > MANCHETE_MAX) {
    let corte = -1;
    const re = /[,;:—–]\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(frase)) !== null) {
      if (m.index <= PAUSA_MAX && m.index >= 18) corte = m.index;
    }
    if (corte > 0) {
      const resto = plano.slice(corte + 1).trim();
      return {
        title: `${frase.slice(0, corte).trim()}.`,
        body: resto.charAt(0).toLocaleUpperCase("pt-BR") + resto.slice(1),
      };
    }
  }
  return { title: frase, body: plano.slice(frase.length).trim() };
}

function EditorialContent({
  text,
  slide,
  kind,
  format,
  brand,
  imageUrl,
  photoPromoted,
  capaDeArte,
}: {
  text: string;
  slide?: CarouselSlideRenderProps["slide"];
  kind: "cover" | "point" | "cta";
  format: NonNullable<CarouselSlideRenderProps["format"]>;
  brand: TweetCardBrand;
  imageUrl: string | null;
  photoPromoted: boolean;
  capaDeArte: boolean;
}) {
  if (kind === "cover") {
    const manchete = coverHeadline(
      slide?.paragraphs?.length ? slide.paragraphs.join(" ") : stripTitleBreak(text),
    );
    return (
      <>
        {imageUrl ? (
          <div className="photo">
            <img src={imageUrl} alt="" crossOrigin="anonymous" />
          </div>
        ) : null}
        {capaDeArte ? null : (
          <>
            <div className="scrim" />
            <div className="mid">
              <div className="byline">
                <span className="avatar">
                  {brand.logoUrl ? (
                    <img src={brand.logoUrl} alt="" crossOrigin="anonymous" />
                  ) : (
                    brand.name.slice(0, 1)
                  )}
                </span>
                <span className="who">
                  <span className="name">{brand.name}</span>
                  {/* só o @ real: um @ inventado do nome pode ser de outra pessoa */}
                  {brand.handle ? <span className="at">@{brand.handle}</span> : null}
                </span>
              </div>
              <p className="title">
                <Emphasis text={manchete} />
              </p>
              {/* story avança por toque: não inventar a seta */}
              {format === "story" ? null : <span className="cta">Arrasta pro lado →</span>}
            </div>
          </>
        )}
      </>
    );
  }

  if (format === "carousel" && slide?.role === "cta") {
    return <EditorialClosing slide={slide} brand={brand} />;
  }

  const derivado = editorialSplit(text);
  const titulo = slide?.title?.trim() || derivado.title;
  // peça do adapter (sem parágrafos): o negrito no número sai daqui
  const paragrafos = slide?.paragraphs?.length
    ? slide.paragraphs
    : toParagraphs(slide?.title ? text : derivado.body).map(boldKeyNumber);
  // foto promovida pela pessoa vence o `none` do escritor; o gráfico fica
  const visual =
    slide?.visual === "chart"
      ? "chart"
      : (imageUrl && photoPromoted) || slide?.visual === "photo"
        ? "photo"
        : "none";
  const chart = visual === "chart" ? slide?.chart : undefined;

  return (
    <div className="mid">
      {titulo ? <h3 className="title">{stripEmphasis(titulo)}</h3> : null}
      {paragrafos.length ? (
        <div className="body">
          {paragrafos.map((p, i) => (
            <p key={i}>
              <Emphasis text={p} />
            </p>
          ))}
        </div>
      ) : null}
      {visual === "photo" && imageUrl ? (
        <figure className="media">
          <img src={imageUrl} alt="" crossOrigin="anonymous" />
        </figure>
      ) : null}
      {chart && chart.bars.length > 0 ? <EditorialChart chart={chart} /> : null}
      {/* fecho do story: a marca assina de novo, pequena */}
      {format === "story" && kind === "cta" ? (
        <div className="byline byline--small">
          <span className="avatar">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="" crossOrigin="anonymous" />
            ) : (
              brand.name.slice(0, 1)
            )}
          </span>
          <span className="who">
            <span className="name">{brand.name}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fecho do carrossel — o último card, em tinta, como a capa fecha em preto.
// A tese em manchete; o próximo passo como uma mensagem da marca (balão, quando
// o canal é conversa) ou texto corrido; o botão do canal com o ícone (WhatsApp,
// Direct, site ou perfil), os dois botões que o Instagram oferece (salvar e
// compartilhar) e a assinatura da marca. Os botões não clicam: são a arte
// dizendo o que fazer. Cor e fonte vêm do brand kit; o verde é do WhatsApp.
// ---------------------------------------------------------------------------

const CTA_FALLBACK: SlideCta = { kind: "direct", label: "Mandar mensagem" };

/** Glifo oficial do WhatsApp (traço em currentColor), para o botão do fecho. */
function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </svg>
  );
}

function CtaIcon({ kind }: { kind: SlideCta["kind"] }) {
  if (kind === "whatsapp") return <WhatsAppMark />;
  if (kind === "site") return <Link2 aria-hidden="true" />;
  if (kind === "perfil") return <UserPlus aria-hidden="true" />;
  return <Send aria-hidden="true" />;
}

function EditorialClosing({
  slide,
  brand,
}: {
  slide: NonNullable<CarouselSlideRenderProps["slide"]>;
  brand: TweetCardBrand;
}) {
  const titulo = stripEmphasis(slide.title ?? "");
  const passo = slide.paragraphs?.find((p) => p.trim()) ?? "";
  const cta = slide.cta?.label ? slide.cta : CTA_FALLBACK;
  const conversa = cta.kind === "whatsapp" || cta.kind === "direct";
  return (
    <div className="mid">
      {titulo ? <h3 className="title">{titulo}</h3> : null}
      {passo ? (
        conversa ? (
          <div className="bubble">
            <p>
              <Emphasis text={passo} />
            </p>
            <span className="when">agora</span>
          </div>
        ) : (
          <div className="body">
            <p>
              <Emphasis text={passo} />
            </p>
          </div>
        )
      ) : null}
      <div className="tray">
        <span className={`btn btn--${cta.kind}`}>
          <CtaIcon kind={cta.kind} />
          <span>{cta.label}</span>
        </span>
        <span className="chips">
          <span className="chip">
            <Bookmark aria-hidden="true" />
            Salvar
          </span>
          <span className="chip">
            <Send aria-hidden="true" />
            Compartilhar
          </span>
        </span>
      </div>
      <div className="byline byline--small">
        <span className="avatar">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" crossOrigin="anonymous" />
          ) : (
            brand.name.slice(0, 1)
          )}
        </span>
        <span className="who">
          <span className="name">{brand.name}</span>
          {brand.handle ? <span className="at">@{brand.handle}</span> : null}
        </span>
      </div>
    </div>
  );
}

/** Título com quebra explícita vira uma linha só na capa. */
function stripTitleBreak(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").trim();
}

function EditorialChart({ chart }: { chart: NonNullable<TweetCardSlide["chart"]> }) {
  const max = Math.max(...chart.bars.map((b) => b.value), 1);
  const destaque = chart.highlight ?? chart.bars.length - 1;
  const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  return (
    <figure className="chart">
      <figcaption className="chart-label">{chart.label}</figcaption>
      <div className="bars">
        {chart.bars.map((bar, i) => (
          <div key={i} className={i === destaque ? "bar hi" : "bar"}>
            <span className="v">{fmt.format(bar.value)}</span>
            <span
              className="fill"
              style={{ "--h": Math.max(0.04, bar.value / max) } as CSSProperties}
            />
            <span className="k">{bar.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

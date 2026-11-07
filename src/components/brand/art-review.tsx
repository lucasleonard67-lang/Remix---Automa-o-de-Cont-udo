import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { CarouselSlideRender } from "@/components/carousel-slide-render";
import type { TweetCardBrand } from "@/components/tweet-card-render";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { EIXOS_DE_ARTE, type CarouselArt } from "@/lib/carousel-art";
import { brandFontsReady, fontesFaltando } from "@/lib/brand-fonts";

// ---------------------------------------------------------------------------
// Revisão guiada da ARTE — passo 3 do design system (docs/14 §12).
//
// Não é um catálogo de mundos prontos: é o vocabulário da marca, um eixo por
// vez, com prévia ao vivo pintada na PALETA E NAS FONTES DA MARCA. Trocar
// "textura" não troca a cor: a cor é da marca, sempre.
//
// A frase do Tiago que rege este componente: "vai com cautela pra criar esse
// fluxo, pra não ficar mil coisas na tela e ninguém saber o caminho a seguir.
// Tem que ser bem faseado, e a pessoa entender claramente qual caminho está
// seguindo." Por isso um eixo por cartão, na ordem em que a decisão importa.
// ---------------------------------------------------------------------------

const AMOSTRA =
  "Responder uma cotação em 11 dias parecia normal, até descobrirem que cada dia de atraso vinha do mesmo erro.";

export function ArtReview({
  art,
  brand,
  onChange,
  readOnly = false,
}: {
  art: CarouselArt;
  brand: TweetCardBrand;
  onChange: (patch: Partial<CarouselArt>) => void;
  readOnly?: boolean;
}) {
  const display = brand.typography?.heading?.trim();
  const body = brand.typography?.body?.trim();
  const [faltando, setFaltando] = useState<string[]>([]);

  // A tipografia da marca é texto livre escrito pela IA ou pelo usuário: um
  // nome que não existe no Google Fonts falha CALADO e a arte sai na fonte de
  // sistema. O lugar honesto de avisar é aqui, na revisão — não num toast no
  // meio do export.
  useEffect(() => {
    let vivo = true;
    void brandFontsReady(display, body).then(() => {
      if (vivo) setFaltando(fontesFaltando(display, body));
    });
    return () => {
      vivo = false;
    };
  }, [display, body]);

  return (
    // `@container` vai no ENVOLTÓRIO, não na grade: um elemento não consulta a
    // si próprio. Com os dois na mesma div, `@3xl:grid-cols` nunca valia (a
    // coluna ficava uma só) enquanto `@3xl:sticky` resolvia contra um
    // contêiner ancestral — e a prévia grudada flutuava por cima dos botões,
    // interceptando o clique. O e2e pegou isso antes de qualquer usuário.
    <div className="@container">
      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* Prévia grudada: a decisão só faz sentido vendo a arte mudar */}
        <div className="space-y-3 @3xl:sticky @3xl:top-[var(--via-sticky-top)] @3xl:max-h-[var(--via-sticky-max-h)] @3xl:self-start @3xl:overflow-y-auto @3xl:pr-1">
          <CarouselSlideRender
            text={AMOSTRA}
            brand={brand}
            aspect="4:5"
            index={0}
            total={6}
            art={art}
          />
          <p className="text-xs text-muted-foreground">
            Prévia da capa com as cores e as fontes da sua marca. Todo carrossel sai com este
            estilo.
          </p>
          {faltando.length > 0 ? (
            <Alert variant="destructive" data-testid="fontes-faltando">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>
                {faltando.length === 1 ? "A família" : "As famílias"}{" "}
                <strong>{faltando.join(", ")}</strong>{" "}
                {faltando.length === 1 ? "não foi encontrada" : "não foram encontradas"} no Google
                Fonts, então a arte usa uma fonte substituta. Corrija o nome em Tipografia.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="space-y-4" data-testid="eixos-de-arte">
          {EIXOS_DE_ARTE.map((eixo) => (
            <fieldset
              key={eixo.chave}
              className="rounded-xl border border-border bg-card p-4"
              disabled={readOnly}
            >
              <legend className="px-1 text-sm font-medium text-foreground">{eixo.titulo}</legend>
              {eixo.ajuda ? (
                <p className="mb-2.5 text-xs text-muted-foreground">{eixo.ajuda}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {eixo.opcoes.map((opcao) => {
                  const ativo = String(art[eixo.chave]) === opcao.valor;
                  return (
                    <button
                      key={opcao.valor}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      title={opcao.nota || undefined}
                      disabled={readOnly}
                      onClick={() =>
                        onChange({ [eixo.chave]: opcao.valor } as Partial<CarouselArt>)
                      }
                      data-testid={`arte-${eixo.chave}-${opcao.valor}`}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs transition",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        ativo
                          ? "border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary/25"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                    >
                      {opcao.rotulo}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </div>
  );
}

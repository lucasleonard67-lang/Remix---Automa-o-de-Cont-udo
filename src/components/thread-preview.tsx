import {
  BadgeCheck,
  BarChart3,
  Bookmark,
  Heart,
  MessageCircle,
  Repeat2,
  Upload,
} from "lucide-react";

import type { TweetCardBrand } from "@/components/tweet-card-render";
import { Card, CardContent } from "@/components/ui/card";
import { useSignedUrl } from "@/hooks/use-storage";

// ---------------------------------------------------------------------------
// Preview de X (Twitter) / Threads — a ANATOMIA de verdade.
//
// O que existia era um card genérico com o texto e uma lista numerada com barra
// à esquerda: não lembrava o X em nada. A queixa do Tiago (ponto 1 do plano) era
// exatamente essa — "precisa parecer um tweet de verdade e permitir imagens
// dentro do slide".
//
// Ficou como BLOQUEADO à espera de exemplos, mas isso foi cautela demais: a
// anatomia do X é pública e observável, não é material que só o cliente tem.
// Reproduzida aqui: avatar com a RÉGUA da thread ligando um post ao outro,
// nome + selo + @handle + separador + hora, corpo, mídia embutida com canto
// arredondado, e a barra de ações.
//
// As ações vêm SEM número de propósito. Métrica inventada num rascunho seria
// mentira desenhada — e post recém-publicado no X aparece assim mesmo, com os
// ícones zerados.
// ---------------------------------------------------------------------------

/** "@marca" derivado do nome, igual ao que o render de arte usa. */
function brandHandle(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `@${slug || "marca"}`;
}

function Avatar({ brand }: { brand: TweetCardBrand }) {
  if (brand.logoUrl) {
    return (
      <img src={brand.logoUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
      {(brand.name.charAt(0) || "?").toUpperCase()}
    </div>
  );
}

function AcoesDoPost() {
  return (
    <div
      className="flex max-w-md items-center justify-between pt-1 text-muted-foreground"
      aria-label="Ações do post (prévia, sem métricas)"
    >
      {[MessageCircle, Repeat2, Heart, BarChart3].map((Icone, i) => (
        <Icone key={i} className="size-[18px]" aria-hidden="true" />
      ))}
      <div className="flex items-center gap-4">
        <Bookmark className="size-[18px]" aria-hidden="true" />
        <Upload className="size-[18px]" aria-hidden="true" />
      </div>
    </div>
  );
}

function Post({
  brand,
  texto,
  hora,
  imageUrl,
  comRegua,
}: {
  brand: TweetCardBrand;
  texto: string;
  hora: string;
  imageUrl?: string | null;
  /** Liga este post ao seguinte com a régua vertical da thread. */
  comRegua: boolean;
}) {
  const handle = brandHandle(brand.name);
  return (
    <article className="flex gap-3">
      {/* Coluna do avatar: é ela que carrega a régua da thread. */}
      <div className="flex shrink-0 flex-col items-center">
        <Avatar brand={brand} />
        {comRegua ? <div className="mt-1 w-0.5 flex-1 rounded-full bg-border" /> : null}
      </div>

      <div className={comRegua ? "min-w-0 flex-1 pb-4" : "min-w-0 flex-1"}>
        <div className="flex flex-wrap items-center gap-x-1.5 text-sm leading-tight">
          <span className="font-semibold text-foreground">{brand.name}</span>
          <BadgeCheck
            className="size-4 shrink-0 fill-primary text-background"
            aria-label="verificado"
          />
          <span className="text-muted-foreground">{handle}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="text-muted-foreground">{hora}</span>
        </div>

        <p className="mt-1 whitespace-pre-wrap text-[15px] leading-normal text-foreground">
          {texto}
        </p>

        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="mt-3 max-h-96 w-full rounded-2xl border border-border object-cover"
          />
        ) : null}

        <div className="mt-3">
          <AcoesDoPost />
        </div>
      </div>
    </article>
  );
}

export function ThreadPreview({
  text,
  thread,
  brand,
  imagePath,
}: {
  text: string;
  thread: string[];
  brand: TweetCardBrand;
  /** Imagem de IA da peça (bucket `renders`) — entra DENTRO do primeiro post. */
  imagePath?: string | null;
}) {
  const imageUrl = useSignedUrl("renders", imagePath ?? null).data ?? null;
  const posts = [text, ...thread];

  return (
    <Card>
      <CardContent className="pt-6">
        {posts.map((texto, i) => (
          <Post
            key={i}
            brand={brand}
            texto={texto}
            // X mostra tempo relativo; a peça é rascunho, então "agora" no
            // primeiro e o mesmo instante nos demais (thread sai de uma vez).
            hora="agora"
            imageUrl={i === 0 ? imageUrl : null}
            comRegua={i < posts.length - 1}
          />
        ))}
      </CardContent>
    </Card>
  );
}

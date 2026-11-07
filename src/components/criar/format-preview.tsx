import { CarouselSlideRender } from "@/components/carousel-slide-render";
import { TweetCardRender, type TweetCardBrand } from "@/components/tweet-card-render";
import type { ChannelType } from "@/hooks/use-channels";
import type { CarouselArt } from "@/lib/carousel-art";
import { previewAspect } from "@/components/criar/formats";

// ---------------------------------------------------------------------------
// Amostra de cada formato pintada pelos MESMOS renderers da Biblioteca, no
// design system ativo da marca (paleta, fontes, vocabulário de arte). O texto
// é neutro de propósito: mostra a forma da peça, não promete conteúdo.
// A escolha de renderer espelha o detalhe da peça (/biblioteca/$pieceId):
// carrossel sempre no chassi; post/stories no chassi quando a arte é
// editorial, senão no card; texto (X, Threads, LinkedIn, Facebook) no card.
// ---------------------------------------------------------------------------

const SAMPLE_COVER =
  "3 erros de quem está começando\nO primeiro custa caro e quase ninguém percebe.";
const SAMPLE_STORY = "Você revisa antes de publicar?\nUm hábito simples que evita retrabalho.";
const SAMPLE_POST = "Feito é melhor que perfeito\nMas revisado é melhor que feito.";
const SAMPLE_SHORT =
  "A melhor ideia da semana não veio de uma reunião. Veio de ouvir o cliente por 10 minutos.";
const SAMPLE_LONG =
  "Passamos um mês medindo onde o time perdia tempo. A resposta não estava nas ferramentas: estava nas aprovações.";

export function FormatPreview({
  type,
  brand,
  art,
}: {
  type: ChannelType;
  brand: TweetCardBrand;
  art: CarouselArt;
}) {
  const aspect = previewAspect(type, art);
  const editorial = art.layout === "editorial";
  switch (type) {
    case "instagram_carousel":
      return (
        <CarouselSlideRender
          text={SAMPLE_COVER}
          brand={brand}
          aspect={aspect}
          index={0}
          total={6}
          art={art}
        />
      );
    case "instagram_stories":
    case "instagram_post": {
      const text = type === "instagram_stories" ? SAMPLE_STORY : SAMPLE_POST;
      return editorial ? (
        <CarouselSlideRender
          format={type === "instagram_stories" ? "story" : "post"}
          text={text}
          brand={brand}
          aspect={aspect}
          index={0}
          total={type === "instagram_stories" ? 4 : 1}
          art={art}
        />
      ) : (
        <TweetCardRender text={text} brand={brand} aspect={aspect} background="brand" />
      );
    }
    case "linkedin_post":
    case "facebook_post":
      return (
        <TweetCardRender text={SAMPLE_LONG} brand={brand} aspect={aspect} background="brand" />
      );
    default:
      return <TweetCardRender text={SAMPLE_SHORT} brand={brand} aspect={aspect} />;
  }
}

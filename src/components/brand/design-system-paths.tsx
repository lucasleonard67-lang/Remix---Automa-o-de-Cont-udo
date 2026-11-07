import { useMutation } from "@tanstack/react-query";
import { Globe, Loader2, Palette, Sliders, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { BrandKitContent } from "@/hooks/use-versioned-brand";
import { normalizeArt, type CarouselArt } from "@/lib/carousel-art";

// ---------------------------------------------------------------------------
// Escolha de UM caminho para montar o design system (ponto 12 do plano).
//
// A instrução foi explícita: "não pode ficar mil coisas na tela e ninguém saber
// o caminho a seguir; tem que ser bem faseado, e a pessoa entender claramente
// qual caminho está seguindo". Então este componente mostra SÓ a escolha —
// nenhuma configuração — e some assim que um caminho é seguido.
//
// Vive fora do wizard de propósito: brand kit é revisitado (Marca → Brand kit),
// e a capacidade de propor um design system não deveria ficar presa num passo
// de onboarding que se atravessa uma vez.
// ---------------------------------------------------------------------------

export type DesignSystemPath = "acervo" | "site" | "nicho" | "manual";

export interface DesignSystemDraft {
  palette?: Record<string, string>;
  typography?: { heading: string; body: string };
  negative_constraints?: string[];
  rationale?: string;
  /**
   * Vocabulário de ARTE proposto (composição, textura, foto…). Não é um id de
   * catálogo: são os eixos que a marca vai seguir, preenchidos com a paleta e
   * a tipografia dela.
   */
  art?: Partial<CarouselArt>;
}

const CAMINHOS: Array<{
  id: DesignSystemPath;
  titulo: string;
  descricao: string;
  icon: typeof Palette;
}> = [
  {
    id: "acervo",
    titulo: "Tenho material da marca",
    descricao: "A IA lê o que você já adicionou em Contexto e propõe cores e fontes.",
    icon: Palette,
  },
  {
    id: "site",
    titulo: "Tenho um site no ar",
    descricao: "Puxamos cores e fontes direto do seu site.",
    icon: Globe,
  },
  {
    id: "nicho",
    titulo: "Quero que a IA proponha",
    descricao: "A proposta parte da persona e da bandeira que você já preencheu.",
    icon: Wand2,
  },
  {
    id: "manual",
    titulo: "Quero escolher na mão",
    descricao: "Você preenche o formulário, sem proposta.",
    icon: Sliders,
  },
];

export function DesignSystemPaths({
  onEscolher,
  patch,
}: {
  /** Chamado quando o caminho conclui — `origem` nomeia o percurso na revisão. */
  onEscolher: (info: { caminho: DesignSystemPath; origem: string; rationale?: string }) => void;
  patch: (patch: Partial<BrandKitContent>) => void;
}) {
  const [url, setUrl] = useState("");
  const [emCurso, setEmCurso] = useState<DesignSystemPath | null>(null);

  const sugerir = useMutation({
    mutationFn: async (input: { source: DesignSystemPath; url?: string }) => {
      const { data, error } = await supabase.functions.invoke("brand-kit-suggest", {
        body: { source: input.source, ...(input.url ? { url: input.url } : {}) },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const corpo = ctx?.json ? await ctx.json().catch(() => null) : null;
        throw new Error(
          (corpo as { error?: { message?: string } } | null)?.error?.message ?? error.message,
        );
      }
      return data as { draft: DesignSystemDraft; origem: string };
    },
  });

  const seguir = (id: DesignSystemPath) => {
    if (id === "manual") {
      onEscolher({ caminho: "manual", origem: "escolhas manuais" });
      return;
    }
    setEmCurso(id);
    sugerir.mutate(
      { source: id, ...(id === "site" ? { url: url.trim() } : {}) },
      {
        onSuccess: ({ draft, origem }) => {
          // A proposta entra no editor como rascunho; ativar continua exigindo
          // confirmação explícita, como qualquer versão de marca.
          // UMA chamada só: cada `patch` mistura sobre o `content` do render
          // atual, então chamadas seguidas apagavam a anterior.
          // A proposta inclui a FORMA da arte (`art`), não só cor e tipo. Sem
          // ela o caminho "quero que a IA proponha" propunha tudo menos como a
          // marca se comporta na peça, e sobrava para o usuário.
          patch({
            ...(draft.palette ? { palette: draft.palette } : {}),
            ...(draft.typography ? { typography: draft.typography } : {}),
            ...(draft.art ? { art: normalizeArt(draft.art) } : {}),
            ...(draft.negative_constraints?.length
              ? { negative_constraints: draft.negative_constraints }
              : {}),
          });
          onEscolher({ caminho: id, origem, rationale: draft.rationale });
        },
        onError: (error) =>
          toast.error("Não foi possível montar a proposta", {
            description: `${error.message} Tente outro caminho ou preencha à mão.`,
          }),
        onSettled: () => setEmCurso(null),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">De onde vem o visual da sua marca?</h3>
        <p className="text-sm text-muted-foreground">
          Escolha um ponto de partida. Você revisa tudo antes de ativar.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" data-testid="caminhos-design-system">
        {CAMINHOS.map(({ id, titulo, descricao, icon: Icon }) => (
          <div key={id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">{titulo}</span>
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{descricao}</p>

            {id === "site" ? (
              <div className="space-y-1.5">
                <Label htmlFor="ds-url" className="text-xs">
                  Endereço do site
                </Label>
                <Input
                  id="ds-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://suamarca.com.br"
                />
              </div>
            ) : null}

            <Button
              variant={id === "manual" ? "outline" : "default"}
              size="sm"
              onClick={() => seguir(id)}
              disabled={sugerir.isPending || (id === "site" && !url.trim())}
            >
              {emCurso === id ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {id === "manual" ? "Preencher à mão" : "Gerar proposta"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Takeaway } from "@/lib/takeaways";
import type { ZernioPost } from "@/lib/zernio-analytics";
import { cn } from "@/lib/utils";

import { STAGGER_CLASS, staggerStyle } from "./motion";

// ---------------------------------------------------------------------------
// "Para fazer hoje": até 3 takeaways lado a lado, separados por fios (não
// cartões): título em peso 500, uma frase, UM botão. Só a primeira sugestão
// leva o botão navy (uma ação dominante); as outras ficam em texto. Vazio → o bloco não
// renderiza (quem chama decide); aqui só desenha o que recebeu.
// ---------------------------------------------------------------------------

export function Takeaways({
  items,
  onOpenPost,
}: {
  items: Takeaway[];
  onOpenPost: (post: ZernioPost) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="takeaways-title" className="space-y-3">
      <p id="takeaways-title" className="via-eyebrow">
        Para fazer hoje
      </p>
      <ol
        className={cn(
          "ce-takeaways grid gap-y-5 sm:gap-y-0",
          items.length === 1
            ? "sm:grid-cols-1"
            : items.length === 2
              ? "sm:grid-cols-2"
              : "sm:grid-cols-3",
        )}
        data-testid="takeaways"
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            className={cn("ce-takeaway flex flex-col gap-2 sm:pr-6", STAGGER_CLASS)}
            style={staggerStyle(index)}
          >
            <p className="text-sm font-medium leading-snug text-[var(--via-text-primary)]">
              {item.title}
            </p>
            <p className="text-sm leading-snug text-[var(--via-text-muted)]">{item.text}</p>
            <div className="mt-auto pt-1">
              {item.action.kind === "post" ? (
                <Button
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  onClick={() => item.action.kind === "post" && onOpenPost(item.action.post)}
                >
                  {item.action.label}
                  <ArrowRight aria-hidden="true" />
                </Button>
              ) : (
                <Button asChild size="sm" variant={index === 0 ? "default" : "outline"}>
                  <Link
                    to="/"
                    search={{
                      ...(item.action.brief ? { brief: item.action.brief } : {}),
                      ...(item.action.channel ? { channel: item.action.channel } : {}),
                    }}
                  >
                    {item.action.label}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

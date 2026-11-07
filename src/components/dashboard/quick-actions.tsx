import { AudioLines, Clapperboard, type LucideIcon, Plus, ScanFace, SquarePen } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { useFirstStepsVisible } from "@/components/dashboard/first-steps";
import { REVEAL_STAGGER_MS } from "@/components/dashboard/motion";
import { Button } from "@/components/ui/button";
import { ChoiceTileLink } from "@/components/ui/choice-tile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsAdmin } from "@/hooks/use-is-admin";

// ---------------------------------------------------------------------------
// Ação principal do Início: "Criar conteúdo" abre a escolha do que criar, e um
// toque leva direto ao fluxo. Vídeo é só de admin.
// ---------------------------------------------------------------------------

const CHOICES: Array<{
  id: string;
  to: "/criar" | "/videos/novo" | "/marca/avatares" | "/marca/vozes";
  label: string;
  line: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}> = [
  {
    id: "estatico",
    to: "/criar",
    label: "Conteúdo estático",
    line: "Post, carrossel, stories e texto",
    icon: SquarePen,
  },
  {
    id: "video",
    to: "/videos/novo",
    label: "Vídeo",
    line: "Reel, apresentador ou cenas",
    icon: Clapperboard,
    adminOnly: true,
  },
  {
    id: "avatar",
    to: "/marca/avatares",
    label: "Avatar",
    line: "Um apresentador para os vídeos",
    icon: ScanFace,
  },
  {
    id: "voz",
    to: "/marca/vozes",
    label: "Voz",
    line: "A voz que narra os vídeos",
    icon: AudioLines,
  },
];

export function QuickActions() {
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  // uma ação navy por tela: com o checklist aberto, o "Continuar" dele manda
  const setupVisible = useFirstStepsVisible();
  const choices = CHOICES.filter((choice) => isAdmin || !choice.adminOnly);

  return (
    <nav aria-label="Ações rápidas" data-testid="acoes-rapidas">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button data-testid="acao-conteudo" variant={setupVisible ? "outline" : "default"}>
            <Plus aria-hidden="true" /> Criar conteúdo
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="grid w-[min(34rem,calc(100vw-2rem))] gap-2.5 rounded-[var(--via-radius-lg)] p-2.5 sm:grid-cols-2"
          aria-label="O que você quer criar"
        >
          {choices.map(({ id, to, label, line, icon }, index) => (
            <ChoiceTileLink
              key={id}
              to={to}
              icon={icon}
              label={label}
              line={line}
              onPick={() => setOpen(false)}
              className="ce-reveal"
              style={{ "--ce-reveal-delay": `${index * REVEAL_STAGGER_MS}ms` } as CSSProperties}
              testId={`acao-${id}`}
            />
          ))}
        </PopoverContent>
      </Popover>
    </nav>
  );
}

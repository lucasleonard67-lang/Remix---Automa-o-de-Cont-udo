import { X } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// X no canto da capa, para excluir sem abrir o item. Fica fora do link ou botão
// do card, que precisa ter `group/capa` no pai; surge ao passar o mouse, e em
// tela de toque fica sempre à vista.
// ---------------------------------------------------------------------------

export function ExcluirNaCapa({
  nome,
  titulo,
  descricao,
  pendente,
  onExcluir,
}: {
  /** O que o leitor de tela anuncia: "Excluir {nome}". */
  nome: string;
  titulo: string;
  descricao: string;
  pendente: boolean;
  onExcluir: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Excluir ${nome}`}
        data-testid="excluir-capa"
        onClick={() => setAberto(true)}
        className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-full bg-white text-[var(--via-text-primary)] opacity-0 shadow-[var(--via-shadow-sm)] transition-opacity duration-[var(--via-dur)] focus-visible:opacity-100 focus-visible:shadow-[var(--via-shadow-focus)] focus-visible:outline-none group-hover/capa:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{titulo}</AlertDialogTitle>
            <AlertDialogDescription>{descricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendente}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onExcluir}
            >
              {pendente ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

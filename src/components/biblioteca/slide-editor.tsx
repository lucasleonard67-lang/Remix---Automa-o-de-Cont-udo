import { Link } from "@tanstack/react-router";
import { Loader2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PromptField } from "@/components/prompt/prompt-tools";
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
import { Button } from "@/components/ui/button";
import { useMcpTokens } from "@/hooks/use-mcp-tokens";
import { acessosDoClaude } from "@/lib/mcp-connector-state";
import {
  getAdaptedFields,
  useGenerateSlideImages,
  type ContentPiece,
} from "@/hooks/use-content-pieces";
import { pedidoFeito, useEditSlide, type EditSlideOutcome } from "@/hooks/use-edit-slide";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Pedido por slide: muda só a unidade aberta e mantém o desenho da casa.
// Quem escreve é o Claude da assinatura, quando a rotina está conectada: o
// pedido fica na peça e ele entrega pelo conector. Sem a rotina, a IA inclusa
// responde na hora. Foto nova entra pelo lote de fotos, só deste slide.
// ---------------------------------------------------------------------------

const PEDIDO_MAX = 1000;

/** Pedido gravado na peça à espera do Claude (edge edit-slide, pedir_ao_claude). */
interface PedidoPendente {
  index: number;
  instrucao: string;
  pedido_em: string;
  erro?: string;
}

export function SlideEditor({
  piece,
  index,
  unidade,
}: {
  piece: ContentPiece;
  index: number;
  /** "slide" ou "quadro". */
  unidade: string;
}) {
  const [pedido, setPedido] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmando, setConfirmando] = useState<"editar" | "desfazer" | null>(null);
  const edit = useEditSlide(piece.id);
  const fotos = useGenerateSlideImages();
  const tokens = useMcpTokens();
  // Conector conectado = o Claude da pessoa é quem edita, pela assinatura. É o único caminho.
  const claude = tokens.isLoading || acessosDoClaude(tokens.data ?? []).length > 0;

  const adapted = getAdaptedFields(piece);
  const lote = adapted.slide_images_job;
  const gerando = lote?.status === "running";
  const pilha = (piece.adapted_content.edicoes as Record<string, unknown[]> | undefined)?.[index];
  const pendenteDaPeca = piece.adapted_content.pedido_claude as PedidoPendente | undefined;
  const pendente = pendenteDaPeca && pendenteDaPeca.index === index ? pendenteDaPeca : null;
  // a peça tem um pedido só: aberto em outro slide, este espera
  const pendenteEmOutro =
    pendenteDaPeca && !pendenteDaPeca.erro && pendenteDaPeca.index !== index
      ? pendenteDaPeca
      : null;
  const foraDaRevisao = piece.status !== "draft";
  const pedidoValido = pedido.trim().length > 0;
  const ocupado = edit.isPending || gerando || busy;
  const Unidade = unidade === "quadro" ? "Quadro" : "Slide";

  // O Claude entregou: o pedido some da peça sem erro. Avisa uma vez.
  const haviaPedido = useRef<PedidoPendente | null>(null);
  const cancelei = useRef(false);
  useEffect(() => {
    const antes = haviaPedido.current;
    if (antes && !antes.erro && !pendente && !cancelei.current) {
      toast.success(`${Unidade} atualizado pelo seu Claude`, {
        description: "Confira a prévia antes de aprovar.",
      });
    }
    if (!pendente) cancelei.current = false;
    haviaPedido.current = pendente;
  }, [pendente, Unidade]);

  const aplicar = (confirmar: boolean) =>
    edit.mutate(
      { index, instruction: pedido.trim(), confirmar, pedirAoClaude: claude },
      {
        onSuccess: (resultado: EditSlideOutcome) => {
          setPedido("");
          if (pedidoFeito(resultado)) {
            toast.success("Pedido enviado ao seu Claude", {
              description: resultado.acordou
                ? "Ele escreve e o slide muda aqui em instantes."
                : "A rotina não respondeu agora. Ela pega o pedido na próxima vez que rodar.",
            });
            return;
          }
          toast.success(`${Unidade} atualizado`, {
            description: resultado.conferir.length
              ? `Confira antes de aprovar: ${resultado.conferir.join(", ")}`
              : undefined,
          });
          if (!resultado.gerar_foto) return;
          fotos.mutate(
            { pieceId: piece.id, slideIndexes: [index], composition: lote?.composition },
            { onError: (erro) => toast.error("Foto não gerada", { description: erro.message }) },
          );
        },
        onError: (erro) => toast.error("Não deu para editar", { description: erro.message }),
      },
    );

  const desfazer = (confirmar: boolean) =>
    edit.mutate(
      { index, desfazer: true, confirmar },
      {
        onSuccess: () => toast.success("Edição desfeita"),
        onError: (erro) => toast.error("Não deu para desfazer", { description: erro.message }),
      },
    );

  const cancelar = () => {
    cancelei.current = true;
    edit.mutate(
      { index, cancelar: true, confirmar: true },
      {
        onError: (erro) => {
          cancelei.current = false;
          toast.error("Não deu para cancelar", { description: erro.message });
        },
      },
    );
  };

  const pedir = (acao: "editar" | "desfazer") => {
    if (foraDaRevisao) setConfirmando(acao);
    else if (acao === "editar") aplicar(false);
    else desfazer(false);
  };

  return (
    <section aria-label={`Editar este ${unidade}`} className="space-y-2">
      <label
        htmlFor="pedido-do-slide"
        className="text-sm font-medium text-[var(--via-text-primary)]"
      >
        O que mudar neste {unidade}
      </label>

      {pendente ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-[var(--via-navy)] pl-3 text-sm"
          data-testid="pedido-pendente"
          aria-live="polite"
        >
          {pendente.erro ? null : (
            <Loader2
              className="size-4 animate-spin text-[var(--via-text-muted)]"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-[var(--via-text-primary)]">
              {pendente.erro ? "O seu Claude não atendeu" : "Com o seu Claude"}
            </span>
            <span className="block text-[var(--via-text-muted)]">
              {pendente.erro ?? `“${pendente.instrucao}”`}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={cancelar} disabled={edit.isPending}>
            {pendente.erro ? "Pedir de novo" : "Cancelar"}
          </Button>
        </div>
      ) : (
        <>
          <PromptField
            id="pedido-do-slide"
            value={pedido}
            onChange={setPedido}
            kind="slide"
            max={PEDIDO_MAX}
            rows={2}
            disabled={edit.isPending}
            onBusyChange={setBusy}
            placeholder="Ex.: troque a foto por uma prateleira cheia e encurte o texto"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              size="sm"
              onClick={() => pedir("editar")}
              disabled={!pedidoValido || ocupado || !claude || Boolean(pendenteEmOutro)}
            >
              {edit.isPending ? "Aplicando…" : `Aplicar neste ${unidade}`}
            </Button>
            {pilha?.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => pedir("desfazer")}
                disabled={ocupado}
              >
                <Undo2 aria-hidden="true" />
                Desfazer
              </Button>
            ) : null}
            <span className="text-xs text-[var(--via-text-muted)]">
              {pendenteEmOutro ? (
                `O seu Claude está no slide ${pendenteEmOutro.index + 1}. Este espera.`
              ) : claude ? (
                "Claude, pela sua assinatura · sem custo extra"
              ) : (
                <>
                  O seu Claude edita o slide.{" "}
                  <Link
                    to="/config"
                    hash="conectores-title"
                    className="underline-offset-4 hover:underline"
                  >
                    Conecte em Ajustes › Conectores
                  </Link>
                </>
              )}
            </span>
          </div>
        </>
      )}

      <AlertDialog
        open={confirmando !== null}
        onOpenChange={(aberto) => !aberto && setConfirmando(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mudar peça que já saiu da revisão?</AlertDialogTitle>
            <AlertDialogDescription>
              {piece.status === "published"
                ? "O post publicado não muda. Só a versão daqui é alterada."
                : `A arte final deste ${unidade} será feita de novo.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmando === "editar") aplicar(true);
                else desfazer(true);
                setConfirmando(null);
              }}
            >
              Mudar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

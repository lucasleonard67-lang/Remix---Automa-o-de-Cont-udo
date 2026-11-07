import { useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTEXT_KINDS,
  CONTEXT_KIND_LABELS,
  useCreateContextItem,
  type CaseMetadata,
  type ContextKind,
  type CreateContextItemInput,
} from "@/hooks/use-context-items";

type Mode = "text" | "file" | "url";

interface ContextItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

const INITIAL_CASE = {
  metricType: "brl" as CaseMetadata["metric_type"],
  metricValue: "",
  clientName: "",
  sector: "",
  quote: "",
  sourceUrl: "",
  objectionTags: "",
  citationPolicy: "anonymous" as CaseMetadata["citation_policy"],
};

/**
 * Cadastro de item do Conteúdo de Contexto (Sheet) — 3 modos: colar texto,
 * upload de arquivo (.txt/.md no MVP → bucket `context-files`) e URL de
 * referência. `kind = case` abre o formulário de metadata tipada (§8.5).
 * Após criar: `ingest-context {item_id}` + toast.
 */
export function ContextItemForm({ open, onOpenChange }: ContextItemFormProps) {
  const createItem = useCreateContextItem();

  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ContextKind>("transcript");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [caseMeta, setCaseMeta] = useState(INITIAL_CASE);

  const effectiveKind: ContextKind = mode === "url" ? "reference" : kind;
  const showCaseForm = mode !== "url" && kind === "case";

  const resetForm = () => {
    setMode("text");
    setTitle("");
    setKind("transcript");
    setTags("");
    setBody("");
    setFile(null);
    setSourceUrl("");
    setCaseMeta(INITIAL_CASE);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    if (selected && !title.trim()) {
      setTitle(selected.name.replace(/\.(txt|md)$/i, ""));
    }
  };

  const buildCaseMetadata = (): CaseMetadata | null => {
    const metricValue = Number(caseMeta.metricValue.replace(",", "."));
    if (!Number.isFinite(metricValue)) {
      toast.error("Métrica inválida", {
        description: "Use só números no valor da métrica, ex.: 47 ou 3.2.",
      });
      return null;
    }
    return {
      metric_type: caseMeta.metricType,
      metric_value: metricValue,
      client_name: caseMeta.clientName.trim() || null,
      sector: caseMeta.sector.trim(),
      source_url: caseMeta.sourceUrl.trim() || null,
      quote: caseMeta.quote.trim() || null,
      objection_tags: parseTags(caseMeta.objectionTags),
      citation_policy: caseMeta.citationPolicy,
    };
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createItem.isPending) return;

    if (mode === "text" && !body.trim()) {
      toast.error("Cole o texto do conteúdo antes de salvar.");
      return;
    }
    if (mode === "file" && !file) {
      toast.error("Selecione um arquivo .txt ou .md.");
      return;
    }
    if (mode === "url" && !sourceUrl.trim()) {
      toast.error("Cole o link da página.");
      return;
    }
    if (!title.trim()) {
      toast.error("Dê um título ao item. É assim que ele aparece na lista.");
      return;
    }
    if (showCaseForm && !caseMeta.sector.trim()) {
      toast.error("Informe o setor do case.");
      return;
    }

    const input: CreateContextItemInput = {
      title: title.trim(),
      kind: effectiveKind,
      tags: parseTags(tags),
    };
    if (mode === "text") input.body = body;
    if (mode === "file" && file) input.file = file;
    if (mode === "url") input.source_url = sourceUrl.trim();
    if (showCaseForm) {
      const metadata = buildCaseMetadata();
      if (!metadata) return;
      input.metadata = metadata as unknown as Record<string, unknown>;
    }

    createItem.mutate(input, {
      onSuccess: ({ ingestError }) => {
        if (ingestError) {
          toast.warning("Item criado, mas o processamento não começou", {
            description: `${ingestError} Abra o item e clique em “Processar de novo”.`,
          });
        } else {
          toast.success("Item adicionado", {
            description:
              "O status muda para “Pronto” quando o item estiver disponível para as gerações.",
          });
        }
        resetForm();
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error("Não foi possível criar o item", { description: error.message });
      },
    });
  };

  const kindSelect = (
    <div className="space-y-2">
      <Label>Tipo</Label>
      <Select value={kind} onValueChange={(value) => setKind(value as ContextKind)}>
        <SelectTrigger>
          <SelectValue placeholder="Tipo do conteúdo" />
        </SelectTrigger>
        <SelectContent>
          {CONTEXT_KINDS.map((value) => (
            <SelectItem key={value} value={value}>
              {CONTEXT_KIND_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  // Ao fechar, limpa o arquivo selecionado: o input nativo desmonta com o Sheet
  // e um File retido no estado ficaria invisível num reopen.
  const handleOpenChange = (next: boolean) => {
    if (!next) setFile(null);
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Novo item de Contexto</SheetTitle>
          <SheetDescription>
            O que você adicionar aqui dá voz e provas às peças geradas.
          </SheetDescription>
        </SheetHeader>

        {/* noValidate: a validação é feita em JS com as mensagens do app (toast do
            DS). Sem isso o balão nativo do Chrome bloqueia o submit e NENHUMA
            mensagem aparece quando o campo inválido está fora da viewport. */}
        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
          <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="text">Colar texto</TabsTrigger>
              <TabsTrigger value="file">Arquivo</TabsTrigger>
              <TabsTrigger value="url">Link</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-4 space-y-4">
              {kindSelect}
              <div className="space-y-2">
                <Label htmlFor="context-body">Conteúdo</Label>
                <Textarea
                  id="context-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Cole aqui a transcrição, post, documento…"
                  className="min-h-40"
                />
              </div>
            </TabsContent>

            <TabsContent value="file" className="mt-4 space-y-4">
              {kindSelect}
              <div className="space-y-2">
                <Label htmlFor="context-file">Arquivo</Label>
                <Input
                  id="context-file"
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={handleFileChange}
                />
                <p className="text-xs text-muted-foreground">Aceita arquivos .txt e .md.</p>
              </div>
            </TabsContent>

            <TabsContent value="url" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="context-url">Link da página</Label>
                <Input
                  id="context-url"
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://…"
                />
                <p className="text-xs text-muted-foreground">
                  O item entra como <span className="font-medium">Referência</span>, com o texto
                  extraído da página.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="context-title">Título</Label>
            <Input
              id="context-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Entrevista podcast — junho/2026"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-tags">Tags</Label>
            <Input
              id="context-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="separadas, por, vírgula"
            />
          </div>

          {showCaseForm ? (
            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">Dados do case</legend>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de métrica</Label>
                  <Select
                    value={caseMeta.metricType}
                    onValueChange={(value) =>
                      setCaseMeta((prev) => ({
                        ...prev,
                        metricType: value as CaseMetadata["metric_type"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brl">R$ (valor absoluto)</SelectItem>
                      <SelectItem value="multiple">Multiplicador (x)</SelectItem>
                      <SelectItem value="percent">Percentual (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-metric-value">Valor da métrica</Label>
                  <Input
                    id="case-metric-value"
                    inputMode="decimal"
                    value={caseMeta.metricValue}
                    onChange={(event) =>
                      setCaseMeta((prev) => ({ ...prev, metricValue: event.target.value }))
                    }
                    placeholder="1200000 · 3.2 · 47"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="case-client">Cliente (opcional)</Label>
                  <Input
                    id="case-client"
                    value={caseMeta.clientName}
                    onChange={(event) =>
                      setCaseMeta((prev) => ({ ...prev, clientName: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-sector">Setor</Label>
                  <Input
                    id="case-sector"
                    value={caseMeta.sector}
                    onChange={(event) =>
                      setCaseMeta((prev) => ({ ...prev, sector: event.target.value }))
                    }
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="case-quote">Citação do cliente (opcional)</Label>
                <Textarea
                  id="case-quote"
                  value={caseMeta.quote}
                  onChange={(event) =>
                    setCaseMeta((prev) => ({ ...prev, quote: event.target.value }))
                  }
                  className="min-h-20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="case-source">Link da fonte (opcional)</Label>
                <Input
                  id="case-source"
                  type="url"
                  value={caseMeta.sourceUrl}
                  onChange={(event) =>
                    setCaseMeta((prev) => ({ ...prev, sourceUrl: event.target.value }))
                  }
                  placeholder="https://…"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="case-objections">Objeções que responde</Label>
                  <Input
                    id="case-objections"
                    value={caseMeta.objectionTags}
                    onChange={(event) =>
                      setCaseMeta((prev) => ({ ...prev, objectionTags: event.target.value }))
                    }
                    placeholder="separadas, por, vírgula"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Política de citação</Label>
                  <Select
                    value={caseMeta.citationPolicy}
                    onValueChange={(value) =>
                      setCaseMeta((prev) => ({
                        ...prev,
                        citationPolicy: value as CaseMetadata["citation_policy"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="named">Pode citar o nome</SelectItem>
                      <SelectItem value="anonymous">Anônimo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </fieldset>
          ) : null}

          <Button type="submit" className="w-full" disabled={createItem.isPending}>
            {createItem.isPending ? "Salvando…" : "Adicionar ao Contexto"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

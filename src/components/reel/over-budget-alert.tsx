import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppSetting, useUpdateAppSetting } from "@/hooks/use-app-settings";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { formatUsd } from "@/lib/format-usd";
import { toast } from "@/lib/toast";

/**
 * Passou do limite do mês. O limite mora em `app_settings.video_budget.
 * monthly_cap_usd` (lido pela edge generate-video): admin muda aqui mesmo e a
 * estimativa é recalculada; quem não é admin pede a um administrador.
 */
export function OverBudgetAlert({ cap, afterSpend }: { cap: number; afterSpend: number }) {
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();
  const budget = useAppSetting<{ monthly_cap_usd?: number } & Record<string, unknown>>(
    "video_budget",
  );
  const update = useUpdateAppSetting();
  const [value, setValue] = useState(() => String(Math.ceil(afterSpend)));

  const parsed = Number(value.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed !== cap;

  const save = () => {
    if (!valid || update.isPending) return;
    update.mutate(
      { key: "video_budget", value: { ...(budget.data ?? {}), monthly_cap_usd: parsed } },
      {
        onSuccess: () => {
          toast.success(`Limite do mês: ${formatUsd(parsed)}`);
          void queryClient.invalidateQueries({ queryKey: ["video-estimate"] });
        },
        onError: (error) =>
          toast.error("Não foi possível salvar o limite", { description: error.message }),
      },
    );
  };

  return (
    <Alert variant="destructive">
      <TriangleAlert className="size-4" aria-hidden="true" />
      <AlertTitle>Passa do limite mensal</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {isAdmin
            ? "A geração será recusada. Aumente o limite ou espere o próximo mês."
            : "A geração será recusada. Peça a um administrador para aumentar o limite ou espere o próximo mês."}
        </p>
        {isAdmin ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="video-monthly-cap" className="text-xs">
                Novo limite (US$)
              </Label>
              <Input
                id="video-monthly-cap"
                type="number"
                min={1}
                step={1}
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="h-8 w-28 bg-background text-foreground"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!valid || update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Salvar novo limite
            </Button>
          </form>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

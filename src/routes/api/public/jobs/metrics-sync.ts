// Cron gerenciado (*/15 * * * *) → invoke_metrics_sync() → edge metrics-sync
// (com x-cron-secret do Vault). Lê o Zernio e grava as métricas diárias.
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/metrics-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("invoke_metrics_sync" as never);
        if (error) {
          return Response.json({ success: false, error: error.message }, { status: 500 });
        }
        return Response.json({ success: true });
      },
    },
  },
});

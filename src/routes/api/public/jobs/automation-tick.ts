// Cron gerenciado → invoke_automation_tick() → edge automation-tick (com x-cron-secret do Vault).
import { createFileRoute } from '@tanstack/react-router'
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth'

export const Route = createFileRoute('/api/public/jobs/automation-tick')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request)
        if (authFailure) return authFailure

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const { error } = await supabaseAdmin.rpc('invoke_automation_tick')
        if (error) {
          return Response.json({ success: false, error: error.message }, { status: 500 })
        }
        return Response.json({ success: true })
      },
    },
  },
})

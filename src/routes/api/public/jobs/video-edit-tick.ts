// Cron gerenciado → invoke_video_edit_tick() → edge video-edit (com x-cron-secret do Vault).
import { createFileRoute } from '@tanstack/react-router'
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth'

export const Route = createFileRoute('/api/public/jobs/video-edit-tick')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request)
        if (authFailure) return authFailure

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const { error } = await supabaseAdmin.rpc('invoke_video_edit_tick' as never)
        if (error) {
          return Response.json({ success: false, error: error.message }, { status: 500 })
        }
        return Response.json({ success: true })
      },
    },
  },
})

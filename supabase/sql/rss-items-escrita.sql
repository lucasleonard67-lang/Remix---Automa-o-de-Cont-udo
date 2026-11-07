-- A tela só marca item usado ou dispensado; o resto de rss_items é do serviço.
-- Idempotente. Aplicar pelo Lovable. A política de update continua, limitada por estas colunas.

revoke update on table public.rss_items from authenticated;
grant update (dismissed_at, used_in_job_id) on table public.rss_items to authenticated;

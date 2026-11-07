-- Dois pedidos iguais ao mesmo tempo no video_refazer viram um só. Idempotente.
-- Aplicar pelo Lovable. Falhado e cancelado saem do índice: pedir de novo continua valendo.

create unique index if not exists director_jobs_refaz_unico
  on public.director_jobs ((config->>'refaz_de'), md5(config#>>'{avatar_video,script}'))
  where config ? 'refaz_de' and status not in ('failed', 'canceled');

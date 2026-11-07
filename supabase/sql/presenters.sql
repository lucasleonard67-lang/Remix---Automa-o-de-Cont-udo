-- Apresentadores: cadastro único de quem aparece e fala nos vídeos.
--
-- COMO APLICAR: no Lovable, abra o chat do projeto e peça "rode este SQL no
-- banco" colando o arquivo inteiro (ou cole no SQL Editor do Supabase). Pode
-- rodar mais de uma vez: é idempotente e não apaga nada.
--
-- ORDEM DE PUBLICAÇÃO (obrigatória):
--   1. este SQL;
--   2. as edge functions: avatar-studio, director-advance, generate-video,
--      replicate-webhook, video-reconcile, assistant-chat (as três últimas
--      importam _shared alterados) — confira o número da versão de cada uma;
--   3. só então o front (git sync do Lovable).
-- Por quê: o front novo grava em brief.identity_id ids de brand_avatars
-- (Apresentadores). O director-advance antigo só procura em
-- director_identities, não reconhece esses ids e falha o job. Pelo mesmo
-- motivo, o front novo chama migrate_identities e manda photo_paths/avatar_id
-- null, que as edges antigas não entendem.
--
-- Base: public.brand_avatars (docs/11-video-replicate.md §2.2). A pessoa é
-- cadastrada uma vez; cada motor de vídeo (Higgsfield, Replicate) é preparado
-- sob demanda e o resultado fica em provider_refs, por exemplo:
--   {"higgsfield": {"status": "ready", "element_id": "…", "media_ids": ["…"],
--                   "error": null, "requested_at": "…", "claimed_at": "…"}}
-- director_identities continua existindo (legado, só leitura); a ação
-- migrate_identities do avatar-studio copia cada linha para cá com o MESMO id.
--
-- Nenhuma função nova, nenhum grant/revoke e nenhuma tabela nova na publicação
-- do Realtime → o seed-instancia.sql não muda.

-- Gênero do apresentador: escolhe a voz padrão da narração quando ele não tem
-- voz própria. Nulo = o roteiro decide.
alter table public.brand_avatars add column if not exists gender text;

do $$ begin
  alter table public.brand_avatars
    add constraint brand_avatars_gender_check
    check (gender is null or gender in ('female', 'male'));
exception when duplicate_object then null; end $$;

-- provider_refs nunca nulo: o cron do diretor filtra por provider_refs->higgsfield.
update public.brand_avatars set provider_refs = '{}'::jsonb where provider_refs is null;
alter table public.brand_avatars alter column provider_refs set default '{}'::jsonb;

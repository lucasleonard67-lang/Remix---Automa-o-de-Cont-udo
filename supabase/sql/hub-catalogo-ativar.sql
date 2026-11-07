-- hub-catalogo-ativar.sql — liga as linhas que dependem do renderer novo
-- ($list, {{duration_ms}} em _shared/video-catalog.ts, frente B).
-- Aplicar SÓ DEPOIS do deploy das edges com esse renderer; antes disso o
-- objeto {"$list": …} iria cru para o Replicate e daria 422.
-- Idempotente.
update public.video_models set active = true
 where (capability, model_id) in (
   ('scene_i2v', 'alibaba/happyhorse-1.1'),
   ('music',     'elevenlabs/music'));
update public.video_models set notes = 'Até 9 imagens: keyframe e fotos do apresentador numa lista só.'
 where capability = 'scene_i2v' and model_id = 'alibaba/happyhorse-1.1';
update public.video_models set notes = 'Trilha instrumental de 5 a 300 s.'
 where capability = 'music' and model_id = 'elevenlabs/music';

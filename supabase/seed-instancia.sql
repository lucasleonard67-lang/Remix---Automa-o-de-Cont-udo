-- ============================================================================
-- seed-instancia.sql — semeia uma instância NOVA (pós-Remix)
-- ============================================================================
-- GERADO por scripts/gerar-seed-instancia.py — não edite à mão.
--
-- O Remix do Lovable clona o SCHEMA (tabelas, colunas, índices, constraints,
-- funções, policies, triggers de `public`) e para aí. Três classes de coisa
-- ficam para trás, e este arquivo repõe as três, EM ORDEM DE MIGRATION:
--
--   1. DADO semeado por migration
--   2. PRIVILÉGIO — os GRANT/REVOKE. Sem eles a instância nasce com o grant
--      padrão do Supabase (EXECUTE para anon em TODAS as funções de public), o
--      que reabre 16 funções que as migrations fecham. Uma delas é
--      `get_vault_secret`, SECURITY DEFINER e sem checagem no corpo: qualquer
--      um com a chave publishable lê o Vault inteiro por
--      POST /rest/v1/rpc/get_vault_secret. Isto NÃO aparece em nenhuma tela.
--   3. REALTIME — o `alter publication supabase_realtime add table`. O
--      `replica identity full` migra; a filiação na publicação, não. Sem isto a
--      publicação nasce com ZERO tabelas e a UI nunca atualiza sozinha.
--
-- Ainda ficam de fora, e estão no runbook (docs/15-runbook-remix.md): o trigger
-- `on_auth_user_created` (bloco 1 abaixo), os cron jobs e o `instance_url`
-- (scripts/pos-remix.sql) e os segredos do Vault (passo humano).
--
-- Tudo aqui é IDEMPOTENTE: rodar duas vezes não duplica nem sobrescreve.
-- Depois de rodar, confira com scripts/verificar-instancia.sql.
--
-- A ORDEM IMPORTA duas vezes: o catálogo de vídeo tem índice único de um
-- primário por capability (o UPDATE que despromove precisa cair entre os
-- INSERTs), e cada GRANT de exceção vem logo depois do REVOKE que o precede.
-- Rode o arquivo do começo ao fim, sem reordenar.
-- ============================================================================

-- ── 1. O gatilho que o Remix perde ───────────────────────────────────────────
-- Sem ele ninguém vira admin ao se cadastrar e a instância nasce sem dono.
-- (A função handle_new_user vem no Remix; o trigger em auth.users, não.)

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. Dado, privilégio e Realtime, em ordem de migration ────────────────────


-- 202607290003_identity.sql · revoke public.has_any_admin
revoke all on function public.has_any_admin() from public;

-- 202607290003_identity.sql · grant public.has_any_admin
grant execute on function public.has_any_admin() to anon, authenticated;

-- 202607290004_settings_and_templates.sql · insert public.app_settings
insert into public.app_settings (key, value) values
  ('ai_providers', '{
    "router":          {"driver": "lovable-gateway", "model": "google/gemini-2.5-flash"},
    "generator":       {"driver": "lovable-gateway", "model": "google/gemini-2.5-pro"},
    "judge":           {"driver": "lovable-gateway", "model": "google/gemini-2.5-pro"},
    "voice_extractor": {"driver": "lovable-gateway", "model": "google/gemini-2.5-pro"},
    "embeddings":      {"driver": "lovable-gateway", "model": "google/gemini-embedding-001"},
    "image":           {"driver": "lovable-gateway", "model": "google/gemini-2.5-flash-image"}
  }'::jsonb),
  ('onboarding', '{
    "current_step": 1, "completed_steps": [], "minimum_viable": false,
    "completed": false, "brand_name": null, "niche_template_slug": null
  }'::jsonb),
  ('engine_defaults', '{"max_rewrites": 2, "angle_options": 4, "watchdog_stale_minutes": 10}'::jsonb),
  ('flags', '{}'::jsonb)
on conflict (key) do nothing;

-- 202607290004_settings_and_templates.sql · insert public.niche_templates
insert into public.niche_templates (slug, name, description, payload) values
  ('criador-b2b', 'Criador B2B',
   'Criador de conteúdo B2B: autoridade técnica, opinião forte, provas de negócio.',
   $json$
   {
     "guardrails_preset": {
       "banned_punctuation": ["—", "!!", "...", "?!"],
       "banned_words": ["revolucionário", "disruptivo", "game changer", "imperdível", "segredo", "hack definitivo", "alavancar sinergias", "mindset vencedor"],
       "banned_metaphors": ["surfar a onda", "pensar fora da caixa", "vestir a camisa", "jogar o jogo do mercado"],
       "banned_ctas": ["corre lá", "link na bio!!", "não perca essa oportunidade", "garanta sua vaga agora"],
       "allowed_ctas": ["comenta o que você faria diferente", "salva para revisar antes da próxima decisão", "compartilha com quem toca a operação", "me chama para conversar sobre o seu caso"],
       "dosage_rules": {"signature_lexicon_max_per_piece": 2, "emoji_max": 1, "hashtag_policy": "metadata_only"}
     },
     "archetypes": [
       {"name": "Operador que documenta", "description": "Fala do que executa no dia a dia; a autoridade vem de mostrar o processo real, com números e bastidores, não de se declarar especialista."},
       {"name": "Analista contrarian", "description": "Pega um consenso do mercado e desmonta com dados e experiência própria; discorda com elegância e sempre propõe uma alternativa concreta."},
       {"name": "Mentor pragmático", "description": "Traduz decisões complexas de negócio em critérios simples e acionáveis; escreve para o leitor decidir, não para impressionar."}
     ],
     "hook_families": [
       {"name": "Erro caro", "pattern": "O erro de {tema} que custou {valor ou resultado} e o que faríamos diferente", "example": "O erro de precificação que custou R$ 40 mil em um trimestre e o critério que passamos a usar depois."},
       {"name": "Consenso invertido", "pattern": "Todo mundo repete que {consenso}. Na prática, {contraponto com prova}.", "example": "Todo mundo repete que é preciso postar todo dia. Na prática, 2 peças fortes por semana geraram mais pipeline que 30 medianas."},
       {"name": "Bastidor com número", "pattern": "Como {resultado com número} em {contexto}: o processo por trás", "example": "Como fechamos 6 contratos B2B em 90 dias com conteúdo: o funil por trás, etapa por etapa."}
     ],
     "editorial_stance": "Opinião forte sustentada por prova de negócio: cada peça defende uma tese com número, caso ou bastidor real. Zero jargão corporativo e zero motivacional vazio; escreve como operador que executa, para leitores que decidem.",
     "strategy_hints": {
       "theses": [
         "Autoridade B2B se constrói com prova pública de trabalho, não com frequência de postagem",
         "Conteúdo que ensina o critério de decisão vende mais do que conteúdo que ensina o passo a passo",
         "Distribuição é responsabilidade de quem escreve: peça boa sem ângulo claro não existe"
       ],
       "enemy": "O guru de LinkedIn que recicla frases de efeito sem nunca ter operado um negócio",
       "safe_list": ["bastidores de projetos e decisões", "análise de movimentos do mercado", "processos comerciais e de conteúdo", "erros próprios com aprendizado"],
       "icp": {
         "perfil": "Fundadores, executivos e especialistas B2B que vendem serviço ou software de ticket alto e precisam de autoridade para gerar demanda",
         "desejos": ["ser reconhecido como referência no nicho", "gerar pipeline qualificado sem depender só de anúncio", "transformar experiência acumulada em ativo de marca"]
       },
       "cta_repertoire": ["comenta o que você faria diferente", "salva para revisar antes da próxima decisão", "me chama para conversar sobre o seu caso"]
     }
   }
   $json$::jsonb),
  ('consultoria-financeira', 'Consultoria Financeira',
   'Consultorias e assessorias financeiras: números, compliance de linguagem, confiança.',
   $json$
   {
     "guardrails_preset": {
       "banned_punctuation": ["—", "!!", "...", "?!"],
       "banned_words": ["rentabilidade garantida", "lucro certo", "risco zero", "dinheiro fácil", "fique rico", "oportunidade única", "imperdível", "milagre financeiro"],
       "banned_metaphors": ["dinheiro trabalhando enquanto você dorme", "galinha dos ovos de ouro", "aposta certeira"],
       "banned_ctas": ["invista agora antes que acabe", "últimas vagas!!", "clique e comece a lucrar"],
       "allowed_ctas": ["agende um diagnóstico da sua carteira", "baixe o material e revise seus números", "comente qual cenário você quer ver analisado", "compartilhe com quem cuida do caixa"],
       "dosage_rules": {"signature_lexicon_max_per_piece": 1, "emoji_max": 0, "hashtag_policy": "none"}
     },
     "archetypes": [
       {"name": "Conselheiro técnico", "description": "Explica decisões financeiras com método e números verificáveis; nunca promete retorno, sempre mostra o raciocínio e os riscos envolvidos."},
       {"name": "Tradutor de cenário", "description": "Converte macroeconomia e noticiário em impacto prático na vida financeira do leitor, sem alarmismo e sem euforia."},
       {"name": "Guardião de patrimônio", "description": "Fala de proteção, sucessão e disciplina de longo prazo; a autoridade vem da prudência, não da promessa."}
     ],
     "hook_families": [
       {"name": "Custo da inércia", "pattern": "Quanto custa continuar {comportamento}: o cálculo que ninguém faz", "example": "Quanto custa deixar a reserva parada no lugar errado: o cálculo que fizemos para um cliente com R$ 200 mil em conta."},
       {"name": "Mito com número", "pattern": "{Crença comum} parece seguro. Os números mostram outra coisa.", "example": "Imóvel na planta parece investimento seguro. Os números de 10 anos mostram outra coisa."},
       {"name": "Decisão em cenário", "pattern": "Com {cenário atual}, o que fazer com {ativo ou caixa}: critérios, não dicas", "example": "Com juros em dois dígitos, o que fazer com o caixa da empresa: os critérios que usamos com clientes, não dicas genéricas."}
     ],
     "editorial_stance": "Educação financeira com rigor e compliance de linguagem: nenhuma promessa de retorno, todo número com fonte e contexto, riscos sempre explícitos. Tom de conselheiro que protege o patrimônio do leitor, nunca de vendedor de oportunidade.",
     "strategy_hints": {
       "theses": [
         "Planejamento financeiro é gestão de decisões, não venda de produtos",
         "Quem entende o próprio risco não cai em promessa de retorno",
         "Consistência de longo prazo vence qualquer tese quente do momento"
       ],
       "enemy": "O vendedor de oportunidade que promete retorno garantido e esconde o risco na letra miúda",
       "safe_list": ["planejamento e organização financeira", "leitura de cenário com fontes", "educação sobre classes de ativos e riscos", "cases anonimizados com autorização"],
       "icp": {
         "perfil": "Empresários e profissionais liberais com patrimônio em construção que buscam decisões financeiras seguras e assessoria de confiança",
         "desejos": ["proteger e multiplicar patrimônio com segurança", "parar de decidir por impulso ou por dica de influencer", "ter um plano claro de longo prazo"]
       },
       "cta_repertoire": ["agende um diagnóstico da sua carteira", "comente qual cenário você quer ver analisado"]
     }
   }
   $json$::jsonb),
  ('clinica-saude', 'Clínica de Saúde',
   'Clínicas e profissionais de saúde: educação, ética de claims, prova social cuidadosa.',
   $json$
   {
     "guardrails_preset": {
       "banned_punctuation": ["—", "!!", "...", "?!"],
       "banned_words": ["cura garantida", "milagroso", "resultado definitivo", "tratamento infalível", "rejuvenesça 10 anos", "sem nenhum risco", "promoção de procedimento"],
       "banned_metaphors": ["corpo dos sonhos", "antes e depois chocante", "virar outra pessoa"],
       "banned_ctas": ["última chance de agendar!!", "promoção só hoje", "garanta seu procedimento com desconto"],
       "allowed_ctas": ["agende uma avaliação para entender o seu caso", "envie sua dúvida que respondemos nos próximos conteúdos", "salve para mostrar na sua próxima consulta", "compartilhe com quem precisa dessa informação"],
       "dosage_rules": {"signature_lexicon_max_per_piece": 1, "emoji_max": 1, "hashtag_policy": "metadata_only"}
     },
     "archetypes": [
       {"name": "Educador clínico", "description": "Explica condições, tratamentos e prevenção em linguagem acessível, sempre dentro do que a evidência sustenta e a ética profissional permite."},
       {"name": "Desmistificador", "description": "Corrige informações erradas que circulam nas redes sobre saúde, com fonte e sem ridicularizar quem acreditou nelas."},
       {"name": "Cuidador próximo", "description": "Humaniza a clínica: mostra bastidores, equipe e a experiência do paciente, com consentimento e prova social cuidadosa."}
     ],
     "hook_families": [
       {"name": "Sinal ignorado", "pattern": "{Sintoma ou hábito} parece inofensivo. Quando investigar de verdade", "example": "Dor de cabeça frequente parece rotina. Veja quando ela merece investigação de verdade."},
       {"name": "Mito de saúde", "pattern": "{Crença popular}: o que a evidência realmente diz", "example": "Estalar os dedos causa artrose? O que a evidência realmente diz."},
       {"name": "Por dentro da consulta", "pattern": "O que avaliamos em {consulta ou exame} e por que cada etapa importa", "example": "O que avaliamos em uma consulta de check-up e por que cada etapa importa."}
     ],
     "editorial_stance": "Educação em saúde com ética de claims: nenhuma promessa de resultado, prova social apenas com consentimento, linguagem acolhedora e acessível. Autoridade construída por clareza e cuidado, respeitando as normas dos conselhos profissionais.",
     "strategy_hints": {
       "theses": [
         "Paciente bem informado decide melhor e adere melhor ao tratamento",
         "Confiança em saúde se constrói com transparência, não com promessa",
         "Prevenção bem comunicada vale mais que procedimento bem vendido"
       ],
       "enemy": "O marketing de saúde sensacionalista que promete resultado e trata paciente como cliente de balcão",
       "safe_list": ["educação sobre condições e tratamentos", "prevenção e hábitos saudáveis", "bastidores éticos da clínica", "respostas a dúvidas frequentes"],
       "icp": {
         "perfil": "Pacientes e famílias da região que pesquisam saúde online antes de escolher onde e com quem se tratar",
         "desejos": ["entender o próprio caso sem sustos", "confiar na equipe antes de agendar", "cuidar da saúde com orientação séria"]
       },
       "cta_repertoire": ["agende uma avaliação para entender o seu caso", "envie sua dúvida que respondemos nos próximos conteúdos"]
     }
   }
   $json$::jsonb),
  ('infoproduto', 'Infoproduto',
   'Criadores de infoprodutos: narrativa de transformação, provas de alunos, anti-hype.',
   $json$
   {
     "guardrails_preset": {
       "banned_punctuation": ["—", "!!", "...", "?!"],
       "banned_words": ["renda passiva garantida", "método infalível", "fique rico rápido", "fórmula secreta", "do zero aos milhões", "vagas se esgotando", "só hoje", "imperdível"],
       "banned_metaphors": ["vida dos sonhos", "sair da matrix", "destravar sua mente milionária"],
       "banned_ctas": ["corre que as vagas estão acabando!!", "clica no link antes que o preço suba", "garanta agora ou se arrependa"],
       "allowed_ctas": ["responde aqui: qual dessas travas é a sua", "salva esse passo a passo para aplicar essa semana", "me manda mensagem com a palavra-chave para receber o material", "compartilha com alguém travado nisso"],
       "dosage_rules": {"signature_lexicon_max_per_piece": 2, "emoji_max": 2, "hashtag_policy": "metadata_only"}
     },
     "archetypes": [
       {"name": "Professor generoso", "description": "Entrega método de verdade no conteúdo gratuito; a oferta é a continuação natural, com acompanhamento e profundidade, nunca um pedágio."},
       {"name": "Aluno-prova", "description": "Constrói a narrativa de transformação com casos reais de alunos: contexto, esforço e resultado com número, sempre com autorização."},
       {"name": "Anti-guru", "description": "Desmonta as promessas infladas do próprio mercado; vende expectativa realista e processo, o que gera confiança de longo prazo."}
     ],
     "hook_families": [
       {"name": "Transformação com contexto", "pattern": "{Aluno ou perfil} saiu de {ponto A} para {ponto B} em {tempo}: o que fez a diferença", "example": "Uma aluna professora saiu de 0 para 40 alunos pagantes em 4 meses: o que fez a diferença não foi anúncio."},
       {"name": "Trava real", "pattern": "Você não está travado por falta de {causa aparente}. Está travado por {causa real}.", "example": "Você não está travado por falta de tempo. Está travado por não ter um critério de prioridade."},
       {"name": "Método aberto", "pattern": "O passo a passo de {resultado} que ensino dentro do curso, aberto aqui", "example": "O passo a passo de validação de ideia que ensino no curso, aberto aqui em 5 etapas."}
     ],
     "editorial_stance": "Narrativa de transformação com anti-hype: promessa realista, prova de aluno com contexto e autorização, método entregue de verdade no conteúdo gratuito. Vende processo e acompanhamento, nunca atalho.",
     "strategy_hints": {
       "theses": [
         "Transformação real tem contexto, esforço e prazo, e é isso que gera prova",
         "Conteúdo gratuito generoso é o melhor filtro para atrair o aluno certo",
         "Anti-hype é posicionamento: expectativa realista vende menos hoje e retém muito mais amanhã"
       ],
       "enemy": "O lançador de promessa inflada que vende atalho e desaparece depois do pagamento",
       "safe_list": ["método e bastidores do produto", "casos de alunos com autorização", "erros e aprendizados do próprio negócio", "críticas ao hype do mercado"],
       "icp": {
         "perfil": "Pessoas que querem aprender uma habilidade ou construir renda com um negócio digital e já se frustraram com promessas infladas",
         "desejos": ["resultado realista com passo a passo claro", "acompanhamento de quem já fez", "não cair em mais uma promessa vazia"]
       },
       "cta_repertoire": ["responde aqui: qual dessas travas é a sua", "me manda mensagem com a palavra-chave para receber o material"]
     }
   }
   $json$::jsonb)
on conflict (slug) do nothing;

-- 202607290006_channels.sql · insert public.channels
insert into public.channels (type, enabled, config) values
  ('instagram_stories', false, '{
    "aspect_ratio": "9:16",
    "frames": {"min": 3, "max": 6},
    "render_template": "frames",
    "cutoff_score": 7
  }'::jsonb),
  ('instagram_carousel', false, '{
    "aspect_ratio": "4:5",
    "slides": {"min": 7, "max": 10},
    "slide_max_chars": 280,
    "caption_max_chars": 2200,
    "render_template": "tweet-card",
    "cutoff_score": 8
  }'::jsonb),
  ('instagram_post', false, '{
    "aspect_ratio": ["4:5", "1:1"],
    "text_max_chars": 280,
    "caption_max_chars": 2200,
    "render_template": "tweet-card",
    "cutoff_score": 8
  }'::jsonb),
  ('x_post', false, '{
    "text_max_chars": 280,
    "thread_max_posts": 4,
    "cutoff_score": 8
  }'::jsonb),
  ('threads_post', false, '{
    "text_max_chars": 500,
    "thread_max_posts": 4,
    "cutoff_score": 8
  }'::jsonb),
  ('linkedin_post', false, '{
    "text_max_chars": 3000,
    "structure": ["hook", "contexto", "lista", "insight", "ponte", "cta"],
    "cutoff_score": 9
  }'::jsonb),
  ('facebook_post', false, '{
    "text_max_chars": 5000,
    "cutoff_score": 8
  }'::jsonb)
on conflict (type) do nothing;

-- 202607290008_generation.sql · realtime public.generation_jobs
alter table public.generation_jobs replica identity full;

-- 202607290008_generation.sql · realtime public.content_pieces
alter table public.content_pieces replica identity full;

-- 202607290008_generation.sql · realtime public.generation_jobs
do $$ begin
  alter publication supabase_realtime add table public.generation_jobs;
exception when duplicate_object then null; end $$;

-- 202607290008_generation.sql · realtime public.content_pieces
do $$ begin
  alter publication supabase_realtime add table public.content_pieces;
exception when duplicate_object then null; end $$;

-- 202607290009_storage.sql · insert storage.buckets
insert into storage.buckets (id, name, public)
values
  ('context-files', 'context-files', false),
  ('brand-assets', 'brand-assets', false),
  ('renders', 'renders', false)
on conflict (id) do nothing;


-- 202607290010_vault_functions.sql · revoke public.store_vault_secret
revoke all on function public.store_vault_secret(text, text) from public, anon;

-- 202607290010_vault_functions.sql · grant public.store_vault_secret
grant execute on function public.store_vault_secret(text, text) to authenticated, service_role;

-- 202607290010_vault_functions.sql · revoke public.get_vault_secret
revoke all on function public.get_vault_secret(text) from public, anon, authenticated;

-- 202607290010_vault_functions.sql · grant public.get_vault_secret
grant execute on function public.get_vault_secret(text) to service_role;

-- 202607290011_watchdog_cron.sql · revoke public.mark_stale_jobs_failed
revoke all on function public.mark_stale_jobs_failed() from public, anon, authenticated;

-- 202607290011_watchdog_cron.sql · grant public.mark_stale_jobs_failed
grant execute on function public.mark_stale_jobs_failed() to service_role;

-- 202607300012_fix_invite_privilege_escalation.sql · revoke public.pending_invites
revoke all on public.pending_invites from anon, authenticated;

-- 202607300013_rate_limit.sql · insert public.app_settings
insert into public.app_settings (key, value) values
  ('rate_limits', '{
    "generate-content":  {"max": 30,  "window_minutes": 60},
    "regenerate-piece":  {"max": 30,  "window_minutes": 60},
    "generate-image":    {"max": 20,  "window_minutes": 60},
    "ingest-context":    {"max": 60,  "window_minutes": 60},
    "search-context":    {"max": 120, "window_minutes": 60}
  }'::jsonb)
on conflict (key) do nothing;

-- 202607300013_rate_limit.sql · revoke public.consume_rate_limit
revoke all on function public.consume_rate_limit(uuid, text) from public, anon, authenticated;

-- 202607300013_rate_limit.sql · grant public.consume_rate_limit
grant execute on function public.consume_rate_limit(uuid, text) to service_role;

-- 202607300013_rate_limit.sql · revoke public.purge_old_usage_events
revoke all on function public.purge_old_usage_events() from public, anon, authenticated;

-- 202607300013_rate_limit.sql · grant public.purge_old_usage_events
grant execute on function public.purge_old_usage_events() to service_role;

-- 202607300014_claim_context_ingest.sql · revoke public.claim_context_ingest
revoke all on function public.claim_context_ingest(uuid, integer) from public, anon, authenticated;

-- 202607300014_claim_context_ingest.sql · grant public.claim_context_ingest
grant execute on function public.claim_context_ingest(uuid, integer) to service_role;

-- 202607310015_web_research_and_slide_images.sql · revoke public.mark_stale_jobs_failed
revoke all on function public.mark_stale_jobs_failed() from public, anon, authenticated;

-- 202607310015_web_research_and_slide_images.sql · grant public.mark_stale_jobs_failed
grant execute on function public.mark_stale_jobs_failed() to service_role;

-- 202607310015_web_research_and_slide_images.sql · insert public.app_settings
insert into public.app_settings (key, value)
values (
  'web_search',
  '{"enabled": true, "provider": "auto", "max_results": 5}'::jsonb
)
on conflict (key) do nothing;

-- 202607310015_web_research_and_slide_images.sql · update public.app_settings
update public.app_settings
   set value = value || '{"generate-image": {"max": 60, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits'
   and (value -> 'generate-image' ->> 'max')::int is distinct from 60;

-- 202607310015_web_research_and_slide_images.sql · revoke public.merge_piece_adapted_content
revoke all on function public.merge_piece_adapted_content(uuid, jsonb) from public, anon;

-- 202607310015_web_research_and_slide_images.sql · grant public.merge_piece_adapted_content
grant execute on function public.merge_piece_adapted_content(uuid, jsonb) to authenticated, service_role;

-- 202607310015_web_research_and_slide_images.sql · revoke public.claim_slide_images_batch
revoke all on function public.claim_slide_images_batch(uuid, jsonb, integer) from public, anon, authenticated;

-- 202607310015_web_research_and_slide_images.sql · grant public.claim_slide_images_batch
grant execute on function public.claim_slide_images_batch(uuid, jsonb, integer) to service_role;

-- 202607310017_editorial_append.sql · revoke public.append_editorial_use
revoke all on function public.append_editorial_use(jsonb, integer) from public, anon, authenticated;

-- 202607310017_editorial_append.sql · grant public.append_editorial_use
grant execute on function public.append_editorial_use(jsonb, integer) to service_role;

-- 202608130019_publishing.sql · realtime public.published_posts
alter table public.published_posts replica identity full;

-- 202608130019_publishing.sql · realtime public.published_posts
do $$ begin
  alter publication supabase_realtime add table public.published_posts;
exception when duplicate_object then null; end $$;

-- 202608130019_publishing.sql · insert public.app_settings
insert into public.app_settings (key, value)
values ('zernio', '{"profile_id": null, "webhook_id": null, "timezone": "America/Sao_Paulo"}'::jsonb)
on conflict (key) do nothing;

-- 202608130019_publishing.sql · update public.app_settings
update public.app_settings
   set value = value || '{"zernio-publish": {"max": 30, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits'
   and not (value ? 'zernio-publish');

-- 202608130019_publishing.sql · update public.app_settings
update public.app_settings
   set value = value || '{"zernio-read": {"max": 120, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits'
   and not (value ? 'zernio-read');

-- 202608140020_rss_radar.sql · insert public.app_settings
insert into public.app_settings (key, value)
values ('radar', '{"fetch_enabled": true}'::jsonb)
on conflict (key) do nothing;

-- 202608140021_rss_fetch_cron.sql · gera segredo de cron se ausente
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'RSS_CRON_SECRET') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'RSS_CRON_SECRET');
  end if;
end $$;

-- 202608140021_rss_fetch_cron.sql · revoke public.invoke_fetch_rss
revoke all on function public.invoke_fetch_rss() from public, anon, authenticated;

-- 202608140021_rss_fetch_cron.sql · grant public.invoke_fetch_rss
grant execute on function public.invoke_fetch_rss() to service_role;

-- 202608170023_video_pipeline.sql · insert public.channels
insert into public.channels (type, enabled, config)
values ('instagram_reel', false, '{
  "aspect_ratio": "9:16",
  "resolution": "720p",
  "cutoff_score": 8,
  "target_duration_s": 30,
  "max_scenes": 6
}'::jsonb)
on conflict (type) do nothing;

-- 202608170023_video_pipeline.sql · realtime public.video_projects
alter table public.video_projects replica identity full;

-- 202608170023_video_pipeline.sql · realtime public.video_projects
do $$ begin
  alter publication supabase_realtime add table public.video_projects;
exception when duplicate_object then null; end $$;

-- 202608170023_video_pipeline.sql · realtime public.video_scenes
alter table public.video_scenes replica identity full;

-- 202608170023_video_pipeline.sql · realtime public.video_scenes
do $$ begin
  alter publication supabase_realtime add table public.video_scenes;
exception when duplicate_object then null; end $$;

-- 202608170023_video_pipeline.sql · revoke public.reorder_video_scenes
revoke all on function public.reorder_video_scenes(uuid, uuid[]) from public, anon, authenticated;

-- 202608170023_video_pipeline.sql · grant public.reorder_video_scenes
grant execute on function public.reorder_video_scenes(uuid, uuid[]) to service_role;

-- 202608170023_video_pipeline.sql · revoke public.video_month_spend_usd
revoke all on function public.video_month_spend_usd() from public, anon;

-- 202608170023_video_pipeline.sql · grant public.video_month_spend_usd
grant execute on function public.video_month_spend_usd() to authenticated, service_role;

-- 202608170023_video_pipeline.sql · revoke public.mark_stale_video_predictions_failed
revoke all on function public.mark_stale_video_predictions_failed() from public, anon, authenticated;

-- 202608170023_video_pipeline.sql · grant public.mark_stale_video_predictions_failed
grant execute on function public.mark_stale_video_predictions_failed() to service_role;

-- 202608170023_video_pipeline.sql · gera segredo de cron se ausente
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'VIDEO_CRON_SECRET') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'VIDEO_CRON_SECRET');
  end if;
end $$;

-- 202608170023_video_pipeline.sql · revoke public.invoke_video_reconcile
revoke all on function public.invoke_video_reconcile() from public, anon, authenticated;

-- 202608170023_video_pipeline.sql · grant public.invoke_video_reconcile
grant execute on function public.invoke_video_reconcile() to service_role;

-- 202608170023_video_pipeline.sql · update public.app_settings
update public.app_settings
   set value = value || '{"video-scene": {"max": 30, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits' and not (value ? 'video-scene');

-- 202608170023_video_pipeline.sql · update public.app_settings
update public.app_settings
   set value = value || '{"video-project": {"max": 5, "window_minutes": 1440}}'::jsonb
 where key = 'rate_limits' and not (value ? 'video-project');

-- 202608170023_video_pipeline.sql · update public.app_settings
update public.app_settings
   set value = value || '{"avatar-studio": {"max": 10, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits' and not (value ? 'avatar-studio');

-- 202608170023_video_pipeline.sql · insert public.app_settings
insert into public.app_settings (key, value) values ('video_budget', '{
  "monthly_cap_usd": 100,
  "max_download_mb": 200,
  "max_total_duration_s": 60
}'::jsonb) on conflict (key) do nothing;

-- 202608170023_video_pipeline.sql · insert public.app_settings
insert into public.app_settings (key, value) values ('video_defaults', '{
  "resolution": "720p",
  "aspect_ratio": "9:16",
  "tts_bitrate": 128000,
  "voice_id": "Portuguese_CalmLeader",
  "language_boost": "Portuguese",
  "target_duration_s": 30,
  "max_scenes": 6
}'::jsonb) on conflict (key) do nothing;

-- 202608170024_video_models_seed.sql · insert public.video_models
insert into public.video_models
  (capability, model_id, kind, version_hash, cost, limits, input_template,
   fallback_model_id, is_primary, last_validated_at, notes)
values

-- ── TTS ──────────────────────────────────────────────────────────────────────
-- Output é só a URI (sem duração) — a duração sai de bytes*8/bitrate, por isso o
-- bitrate é fixado no template (mp3 CBR). Vozes pt-BR: prefixo Portuguese_*.
('tts', 'minimax/speech-02-hd', 'official',
 'b2c687e53557eee08b35b59620f88750671e97b9a91f351ea6797ac838a0773d',
 '{"unit":"per_1k_chars","usd":0.10}'::jsonb,
 '{"languages":["Portuguese"],"audio_formats":["mp3","wav","flac","pcm"],
   "bitrates":[32000,64000,128000,256000]}'::jsonb,
 '{"text":"{{text}}","voice_id":"{{voice_id}}","language_boost":"{{language_boost}}",
   "audio_format":"mp3","bitrate":"{{bitrate}}","sample_rate":32000,"channel":"mono",
   "emotion":"neutral","speed":1.0}'::jsonb,
 'minimax/speech-2.8-hd', true, now(),
 'Verificado: language_boost inclui Portuguese; output = URI sem duracao.'),

('tts', 'minimax/speech-2.8-hd', 'official',
 '0e4b9c04c2cc34e0d36468f6efc05c4e71835e9acbf1c249a0d8a1a903384c9b',
 '{"unit":"per_1k_chars","usd":0.10}'::jsonb,
 '{"languages":["Portuguese"]}'::jsonb,
 '{"text":"{{text}}","voice_id":"{{voice_id}}","language_boost":"{{language_boost}}",
   "audio_format":"mp3","bitrate":"{{bitrate}}","sample_rate":32000,"channel":"mono",
   "emotion":"neutral","speed":1.0}'::jsonb,
 null, false, now(),
 'Schema identico ao 02-hd. Fallback direto.'),

-- ── Keyframe / identidade do avatar ──────────────────────────────────────────
-- image_input aceita array de referencias: e o que da o MESMO avatar em N cenas.
('keyframe', 'google/nano-banana-2', 'official',
 'd1be8b5fc0931a253d417e12a484ac01ee9ccbc6daffd4792151377d5e5ff55f',
 '{"unit":"per_image","usd":0.08}'::jsonb,
 '{"aspect_ratios":["9:16","1:1","16:9"],"resolutions":["1K","2K","4K"],"max_refs":14}'::jsonb,
 '{"prompt":"{{prompt}}","image_input":"{{reference_urls}}","aspect_ratio":"9:16",
   "resolution":"1K","output_format":"png"}'::jsonb,
 'google/nano-banana-pro', true, now(),
 'Verificado: image_input (array) + aspect_ratio 9:16.'),

('keyframe', 'google/nano-banana-pro', 'official',
 '93f55bfdbdfd4a62e16bf861729bcfa9e8fd9b0325fb218cbc4dd138ecc87cc7',
 '{"unit":"per_image","usd":0.14}'::jsonb,
 '{"aspect_ratios":["9:16"],"resolutions":["1K","2K","4K"],"max_refs":14}'::jsonb,
 '{"prompt":"{{prompt}}","image_input":"{{reference_urls}}","aspect_ratio":"9:16",
   "resolution":"1K","output_format":"png"}'::jsonb,
 null, false, now(), null),

('avatar_identity', 'google/nano-banana-2', 'official',
 'd1be8b5fc0931a253d417e12a484ac01ee9ccbc6daffd4792151377d5e5ff55f',
 '{"unit":"per_image","usd":0.08}'::jsonb,
 '{"aspect_ratios":["9:16"],"max_refs":14}'::jsonb,
 '{"prompt":"{{prompt}}","image_input":"{{reference_urls}}","aspect_ratio":"9:16",
   "resolution":"1K","output_format":"png"}'::jsonb,
 'black-forest-labs/flux-kontext-pro', true, now(), null),

('avatar_identity', 'black-forest-labs/flux-kontext-pro', 'official',
 '897a70f5a7dbd8a0611413b3b98cf417b45f266bd595c571a22947619d9ae462',
 '{"unit":"per_image","usd":0.04}'::jsonb,
 '{"aspect_ratios":["match_input_image","9:16"]}'::jsonb,
 '{"prompt":"{{prompt}}","input_image":"{{keyframe_url}}",
   "aspect_ratio":"match_input_image","output_format":"png"}'::jsonb,
 null, false, now(),
 'Edita preservando o rosto — retoque sem drift de identidade.'),

-- ── Avatar falante ───────────────────────────────────────────────────────────
-- Só image+audio: a DURAÇÃO SAI DO ÁUDIO, sem probe. Até 60s por take.
('talking_avatar', 'veed/fabric-1.0', 'official',
 '21b8969754f69b351c76ca49e4f1b10a88b162433a36cbcc9849ff64bbee6283',
 '{"unit":"per_second","usd":0.15}'::jsonb,
 '{"max_duration_s":60,"resolutions":["480p","720p"],"duration_from":"audio"}'::jsonb,
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","resolution":"{{resolution}}"}'::jsonb,
 'prunaai/p-video-avatar', true, now(),
 'Verificado: required [image, audio], sem parametro de duracao.'),

('talking_avatar', 'prunaai/p-video-avatar', 'official',
 '8a54bb678ef43a7a40950731bad3f33f4ac904267fecebd2186c826a6da6f5a5',
 '{"unit":"per_second","usd":0.025}'::jsonb,
 '{"duration_from":"audio"}'::jsonb,
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}"}'::jsonb,
 null, false, now(), 'Fallback de custo.'),

('talking_avatar', 'bytedance/omni-human', 'official',
 '566f1b03016969ac39e242c1ae4a39034686ca8850fc3dba83dceaceb96f74b2',
 '{"unit":"per_second","usd":0.14}'::jsonb,
 '{"duration_from":"audio"}'::jsonb,
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}"}'::jsonb,
 null, false, now(), 'Corpo/gesto — mais expressivo que talking head puro.'),

-- ── Cenas ────────────────────────────────────────────────────────────────────
-- seedance tem duração CONTÍNUA 4-12 → casa com a duração do áudio.
-- kling só aceita 5 ou 10 (enum) → o motor escolhe o menor bucket >= áudio.
('scene_i2v', 'bytedance/seedance-1-lite', 'official',
 '6e47dd83529ee0599c68f274f225635080e4fd218360a85e2a3a78396d388b73',
 '{"unit":"per_second","usd":0.036}'::jsonb,
 '{"duration_min":4,"duration_max":12,"aspect_ratios":["9:16"],
   "resolutions":["480p","720p","1080p"]}'::jsonb,
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}",
   "resolution":"{{resolution}}","aspect_ratio":"9:16"}'::jsonb,
 'kwaivgi/kling-v2.5-turbo-pro', true, now(),
 'Verificado: duracao continua 4-12s (unico da lista que casa com o audio).'),

('scene_i2v', 'kwaivgi/kling-v2.5-turbo-pro', 'official',
 'a3ccc39250a72749ced345996ec06d96d1d032b1a1369f45f3b9f654324036b5',
 '{"unit":"per_second","usd":0.07}'::jsonb,
 '{"durations":[5,10],"aspect_ratios":["9:16"]}'::jsonb,
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}",
   "aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}"}'::jsonb,
 null, false, now(), 'Duracao DISCRETA {5,10}.'),

('scene_i2v', 'minimax/hailuo-2.3', 'official',
 '23a02633b5a44780345a59d4d43f8bd510efa239c56f08f29639ff24fa6615e1',
 '{"unit":"per_second","usd":0.06}'::jsonb,
 '{"durations":[6,10],"resolutions":["768p","1080p"],"aspect_from":"image"}'::jsonb,
 '{"prompt":"{{prompt}}","first_frame_image":"{{keyframe_url}}","duration":"{{duration_int}}",
   "resolution":"768p"}'::jsonb,
 null, false, now(), 'Sem aspect_ratio: segue o AR da imagem (mandar keyframe 9:16).'),

('scene_t2v', 'bytedance/seedance-1-lite', 'official',
 '6e47dd83529ee0599c68f274f225635080e4fd218360a85e2a3a78396d388b73',
 '{"unit":"per_second","usd":0.036}'::jsonb,
 '{"duration_min":4,"duration_max":12,"aspect_ratios":["9:16"],
   "resolutions":["480p","720p","1080p"]}'::jsonb,
 '{"prompt":"{{prompt}}","duration":"{{duration_int}}","resolution":"{{resolution}}",
   "aspect_ratio":"9:16"}'::jsonb,
 'pixverse/pixverse-v6', true, now(), null),

('scene_t2v', 'pixverse/pixverse-v6', 'official',
 '1f6e2dbe1aec42acbb902f4c51785a57d4e0c0bb5e9fb3b430cedddd4a2cbc11',
 '{"unit":"per_second","usd":0.09}'::jsonb,
 '{"durations":[5,8,10,15],"aspect_ratios":["9:16"],
   "resolutions":["360p","540p","720p","1080p"]}'::jsonb,
 '{"prompt":"{{prompt}}","duration":"{{duration_int}}","quality":"720p",
   "aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}"}'::jsonb,
 null, false, now(), null),

-- ── Lipsync pós (fora do caminho principal do MVP; fica pronto no catálogo) ──
('lipsync_post', 'sync/lipsync-2', 'official',
 '4f8dc3cfda4ff844a6158ac347d21fcd025210f6dad4b16265fc53074ee4f77f',
 '{"unit":"per_second","usd":0.04}'::jsonb,
 '{"sync_modes":["loop","bounce","cut_off","silence","remap"]}'::jsonb,
 '{"video":"{{video_url}}","audio":"{{audio_url}}","sync_mode":"cut_off"}'::jsonb,
 null, true, now(), 'sync_mode trata descasamento de duracao explicitamente.'),

-- ── Utilitários de montagem (community: version_hash PINNADO) ────────────────
-- Atenção: fofr/toolkit devolve ARRAY de URIs (os demais devolvem string).
('util_normalize', 'fofr/toolkit', 'community',
 '19711d11c243800f08364ba9ae9078f54874f21363ba445dabdbf082b5d69565',
 '{"unit":"per_run","usd":0.0004}'::jsonb,
 '{"output":"array"}'::jsonb,
 '{"task":"convert_input_to_mp4","input_file":"{{video_url}}"}'::jsonb,
 null, true, now(),
 'Converte container/codec. NAO reescala nem corta — por isso resolucao fixa no projeto.'),

('util_concat', 'bfirsh/concatenate-videos', 'community',
 '03c0802dc63ff01bb16f967f9ce4d7a784cbb697e9e7a593dd5f08bb83807ced',
 '{"unit":"per_run","usd":0.002}'::jsonb,
 '{}'::jsonb,
 '{"videos":"{{reference_urls}}"}'::jsonb,
 null, true, now(), null),

('util_audio_merge', 'lucataco/video-audio-merge', 'community',
 '8c3d57c9c9a1aaa05feabafbcd2dff9f68a5cb394e54ec020c1c2dcc42bde109',
 '{"unit":"per_run","usd":0.002}'::jsonb,
 '{"duration_modes":["video","audio"]}'::jsonb,
 '{"video_file":"{{video_url}}","audio_file":"{{audio_url}}","duration_mode":"audio",
   "replace_audio":true,"video_codec":"h264","audio_codec":"aac","output_format":"mp4"}'::jsonb,
 null, true, now(),
 'duration_mode=audio garante que a fala nao e cortada.')

on conflict (capability, model_id) do nothing;

-- 202608170027_video_models_required_inputs.sql · update public.video_models
update public.video_models set required_inputs = v.req
from (values
  ('minimax/speech-02-hd',                array['text']),
  ('minimax/speech-2.8-hd',               array['text']),
  ('google/nano-banana-2',                array['prompt']),
  ('google/nano-banana-pro',              array['prompt']),
  ('black-forest-labs/flux-kontext-pro',  array['prompt']),
  ('veed/fabric-1.0',                     array['image','audio']),
  ('prunaai/p-video-avatar',              array['image']),
  ('bytedance/omni-human',                array['image','audio']),
  ('bytedance/seedance-1-lite',           array['prompt']),
  ('kwaivgi/kling-v2.5-turbo-pro',        array['prompt']),
  ('minimax/hailuo-2.3',                  array['prompt']),
  ('pixverse/pixverse-v6',                array['prompt']),
  ('sync/lipsync-2',                      array['video','audio']),
  ('fofr/toolkit',                        array['task','input_file']),
  ('bfirsh/concatenate-videos',           array['videos']),
  ('lucataco/video-audio-merge',          array[]::text[])
) as v(model_id, req)
where public.video_models.model_id = v.model_id;

-- 202608180028_decupagem.sql · update public.app_settings
update public.app_settings
   set value = jsonb_set(value, '{video-scene}', '{"max": 120, "window_minutes": 60}'::jsonb)
 where key = 'rate_limits';

-- 202608180028_decupagem.sql · update public.app_settings
update public.app_settings
   set value = value || '{"shots_per_beat_max": 3, "shot_min_s": 1.6}'::jsonb
 where key = 'video_defaults'
   and not (value ? 'shots_per_beat_max');

-- 202608180029_catalogo_qualidade.sql · update public.video_models
update public.video_models set is_primary = false where capability in ('scene_i2v', 'scene_t2v');

-- 202608180029_catalogo_qualidade.sql · insert public.video_models
insert into public.video_models
  (capability, model_id, kind, version_hash, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, last_validated_at, notes)
values
('scene_i2v','bytedance/seedance-2.0','official',null,
 '{"unit":"per_second","usd":0.14}'::jsonb,
 '{"duration_min":4,"duration_max":15,"aspect_ratios":["9:16"],
   "resolutions":["480p","720p","1080p","4k"],"native_size":"1080x1920"}'::jsonb,
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}",
   "resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}'::jsonb,
 array['prompt'],
 'kwaivgi/kling-v2.5-turbo-pro', true, now(),
 'Duracao CONTINUA e saida nativa 1080x1920. Modelo de duracao discreta deixa ate 4,4s de imagem muda por plano.')
on conflict (capability, model_id) do update
  set is_primary=true, input_template=excluded.input_template, limits=excluded.limits,
      required_inputs=excluded.required_inputs, cost=excluded.cost,
      fallback_model_id=excluded.fallback_model_id, notes=excluded.notes;

-- 202608180029_catalogo_qualidade.sql · update public.video_models
update public.video_models set is_primary = true
 where capability = 'scene_t2v' and model_id = 'pixverse/pixverse-v6';

-- 202608180029_catalogo_qualidade.sql · update public.video_models
update public.video_models set is_primary = false where capability = 'util_normalize';

-- 202608180029_catalogo_qualidade.sql · insert public.video_models
insert into public.video_models
  (capability, model_id, kind, version_hash, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, last_validated_at, notes)
values
('util_normalize', 'bytedance/video-upscaler', 'official', null,
 '{"unit":"per_second","usd":0.05}'::jsonb,
 '{"resolutions":["480p","540p","720p","1080p"],"fps":[24,30,60]}'::jsonb,
 '{"video":"{{video_url}}","target_resolution":"1080p","target_fps":24,
   "scene":"aigc","processing_type":"standard"}'::jsonb,
 array['video'],
 'fofr/toolkit', true, now(),
 'Normaliza TAMANHO e FPS de todo plano antes do concat. Sem isto o concat adota a dimensao do primeiro clipe e CORTA o enquadramento aprovado dos demais.')
on conflict (capability, model_id) do update
  set is_primary = true,
      input_template = excluded.input_template,
      required_inputs = excluded.required_inputs,
      cost = excluded.cost,
      notes = excluded.notes;

-- supabase/sql/video-catalog-precos.sql (acrescentado à mão: a origem é sql/, não migrations/)
-- ── #3 Aleph-2 ───────────────────────────────────────────────────────────────
insert into public.video_models
  (capability, model_id, kind, cost, limits, input_template, is_primary, active, required_inputs, notes)
values
  ('scene_v2v', 'runwayml/aleph-2', 'official',
   '{"unit":"per_second","usd":0.336}'::jsonb,
   '{"duration_min":2,"duration_max":30,"max_duration_s":30,"max_bytes":16777216}'::jsonb,
   '{"video":"{{video_url}}","prompt":"{{prompt}}"}'::jsonb,
   true, true, array['video','prompt'],
   'Melhorar um vídeo meu: estilo, cena e personagem preservando fala e movimento. Vídeo de 2 a 30 s e menor que 16 MB.')
on conflict (capability, model_id) do update
  set input_template = excluded.input_template,
      limits = excluded.limits,
      required_inputs = excluded.required_inputs,
      notes = excluded.notes;

-- ── Trocar pessoa: capability própria (person_swap) ─────────────────────────
-- prunaai/p-video-replace (README do Replicate, 2026-10-29): video + images
-- (1 a 3 fotos da pessoa), instruction_prompt opcional, resolution 720p|1080p,
-- save_audio para manter a fala original. Cobra por segundo de saída:
-- 720p US$ 0,03 · 1080p US$ 0,06. O enquadramento segue o vídeo de origem.
insert into public.video_models
  (capability, model_id, kind, cost, limits, input_template, is_primary, active, required_inputs, notes)
values
  ('person_swap', 'prunaai/p-video-replace', 'official',
   '{"unit":"per_second","usd":0.06,"by_resolution":{"720p":0.03,"1080p":0.06}}'::jsonb,
   '{"resolutions":["720p","1080p"],"max_refs":3}'::jsonb,
   '{"video":"{{video_url}}","images":"{{reference_urls}}","instruction_prompt":"{{prompt}}",
     "resolution":"{{resolution}}","save_audio":true}'::jsonb,
   true, true, array['video','images'],
   'Trocar pessoa: a pessoa das fotos (1 a 3) no lugar da do vídeo, mesmo movimento, câmera e fala.')
on conflict (capability, model_id) do update
  set cost = excluded.cost, limits = excluded.limits, input_template = excluded.input_template,
      required_inputs = excluded.required_inputs, notes = excluded.notes;

-- ── #4 #16 #18 preços oficiais ──────────────────────────────────────────────
update public.video_models set cost =
  '{"unit":"per_second","usd":0.45,"by_resolution":{"480p":0.08,"720p":0.18,"1080p":0.45,"4k":1.00}}'::jsonb
 where model_id = 'bytedance/seedance-2.0';
update public.video_models set cost =
  '{"unit":"per_second","usd":0.072,"by_resolution":{"480p":0.018,"720p":0.036,"1080p":0.072}}'::jsonb
 where model_id = 'bytedance/seedance-1-lite';
update public.video_models set cost =
  '{"unit":"per_second","usd":0.15,"by_resolution":{"480p":0.08,"720p":0.15}}'::jsonb,
  limits = '{"max_duration_s":60,"resolutions":["480p","720p"],"duration_from":"audio"}'::jsonb
 where model_id = 'veed/fabric-1.0';
update public.video_models set cost =
  '{"unit":"per_second","usd":0.045,"by_resolution":{"720p":0.025,"1080p":0.045}}'::jsonb,
  limits = '{"resolutions":["720p","1080p"],"duration_from":"audio"}'::jsonb,
  input_template = '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","resolution":"{{resolution}}"}'::jsonb,
  version_hash = null,
  required_inputs = array['image','audio']
 where model_id = 'prunaai/p-video-avatar';
update public.video_models set cost = '{"unit":"per_second","usd":0.0069}'::jsonb
 where model_id = 'bytedance/video-upscaler';
update public.video_models set cost = '{"unit":"per_second","usd":0.05}'::jsonb
 where model_id = 'sync/lipsync-2';
update public.video_models set cost = '{"unit":"per_image","usd":0.15}'::jsonb
 where model_id = 'google/nano-banana-pro';
update public.video_models set cost = '{"unit":"per_image","usd":0.067}'::jsonb
 where model_id = 'google/nano-banana-2';

-- ── #12 OmniHuman: teto de 15 s ─────────────────────────────────────────────
update public.video_models
   set limits = '{"duration_from":"audio","max_duration_s":15}'::jsonb
 where model_id = 'bytedance/omni-human';

-- ── #19 Hailuo: 768p fixo (6 s = US$ 0,28; 10 s = US$ 0,56) ─────────────────
update public.video_models
   set limits = '{"durations":[6,10],"resolutions":["768p"],"aspect_from":"image"}'::jsonb,
       cost = '{"unit":"per_second","usd":0.0467}'::jsonb
 where model_id = 'minimax/hailuo-2.3';

-- hub-catalogo.sql (2026-10-29) · catálogo do hub completo (docs/hub-full-plano.md, frente A)
-- ── 1. Colunas ──────────────────────────────────────────────────────────────
alter table public.video_models add column if not exists provider text not null default 'replicate';
alter table public.video_models add column if not exists tier text;
alter table public.video_models add column if not exists experience text[] not null default '{}';
alter table public.video_models add column if not exists label text;
alter table public.video_models add column if not exists retired_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'video_models_tier_check') then
    alter table public.video_models
      add constraint video_models_tier_check check (tier is null or tier in ('default','top','alt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'video_models_provider_check') then
    alter table public.video_models
      add constraint video_models_provider_check
      check (provider in ('replicate','heygen','higgsfield','elevenlabs'));
  end if;
end $$;

create index if not exists video_models_experience_idx on public.video_models using gin (experience);

-- Se a instância nasceu com check/enum em capability, ele precisa aceitar as
-- capabilities novas (no schema da docs/11 a coluna é text livre).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.video_models'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%capability%'
  loop
    execute format('alter table public.video_models drop constraint %I', c.conname);
  end loop;
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'video_models' and column_name = 'capability')
     = 'USER-DEFINED' then
    alter table public.video_models alter column capability type text using capability::text;
  end if;
end $$;

-- ── 2. Linhas novas ─────────────────────────────────────────────────────────
insert into public.video_models
  (capability, model_id, kind, provider, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, active, tier, experience, label, notes)
values
-- Cenas (scene_i2v). Áudio nativo sempre desligado: a narração vem do TTS.
('scene_i2v','kwaivgi/kling-v4.0','official','replicate',
 '{"unit":"per_second","usd":0.157,"by_resolution":{"720p":0.157,"1080p":0.235}}',
 '{"duration_min":3,"duration_max":30,"resolutions":["720p","1080p"],"max_refs":4}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","reference_images":"{{reference_urls}}","duration":"{{duration_int}}","resolution":"{{resolution}}"}',
 array['prompt'], null, false, true, 'top', array['scenes','presenter_in_scenes'], 'Kling 4.0',
 'Duração contínua de 3 a 30 s. Aceita o keyframe e as fotos do apresentador juntos.'),
('scene_i2v','google/veo-3.1','official','replicate',
 '{"unit":"per_second","usd":0.20}',
 '{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspect_ratios":["9:16"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}',
 array['prompt'], null, false, true, 'top', array['scenes'], 'Veo 3.1',
 'Visual de cinema. Cenas de 4, 6 ou 8 s.'),
('scene_i2v','google/veo-3.1-fast','official','replicate',
 '{"unit":"per_second","usd":0.10}',
 '{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspect_ratios":["9:16"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'Veo 3.1 Fast',
 'Veo mais rápido e pela metade do preço. Cenas de 4, 6 ou 8 s.'),
('scene_i2v','alibaba/wan-3','official','replicate',
 '{"unit":"per_second","usd":0.05,"by_resolution":{"480p":0.025,"720p":0.05,"1080p":0.10}}',
 '{"duration_min":2,"duration_max":30,"resolutions":["480p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","negative_prompt":"{{negative_prompt}}"}',
 array['prompt'], null, false, true, 'alt', array['scenes'], 'Wan 3',
 'O mais barato com duração contínua de 2 a 30 s.'),
('scene_i2v','bytedance/seedance-1.5-pro','official','replicate',
 '{"unit":"per_second","usd":0.026,"by_resolution":{"480p":0.013,"720p":0.026,"1080p":0.06}}',
 '{"duration_min":2,"duration_max":12,"resolutions":["480p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}',
 array['prompt'], null, false, true, 'alt', array['scenes'], 'Seedance 1.5 Pro',
 'Seedance econômico, cenas de 2 a 12 s.'),
('scene_i2v','vidu/q3-pro','official','replicate',
 '{"unit":"per_second","usd":0.15,"by_resolution":{"540p":0.07,"720p":0.15,"1080p":0.16}}',
 '{"duration_min":1,"duration_max":16,"resolutions":["540p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'Vidu Q3 Pro',
 'Cenas de 1 a 16 s.'),
('scene_i2v','kwaivgi/kling-v3-video','official','replicate',
 '{"unit":"per_second","usd":0.224}',
 '{"duration_min":3,"duration_max":15}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}","mode":"pro","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'Kling 3.0',
 'Modo pro (1080p) fixo até o renderer mapear resolução para modo.'),
('scene_i2v','pixverse/pixverse-v6-max','official','replicate',
 '{"unit":"per_second","usd":0.11,"by_resolution":{"720p":0.11,"1080p":0.22}}',
 '{"durations":[5,8,10,15],"resolutions":["720p","1080p"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","quality":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio_switch":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'PixVerse 6 Max',
 'Cenas de 5, 8, 10 ou 15 s.'),
('scene_i2v','lightricks/ltx-2.3-pro','official','replicate',
 '{"unit":"per_second","usd":0.08,"by_resolution":{"1080p":0.08,"2k":0.16,"4k":0.32}}',
 '{"durations":[6,8,10],"resolutions":["1080p","2k","4k"]}',
 '{"task":"image_to_video","prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'LTX 2.3 Pro',
 '1080p barato; também 2K e 4K. Cenas de 6, 8 ou 10 s.'),
('scene_i2v','runwayml/gen-4.5','official','replicate',
 '{"unit":"per_second","usd":0.12}',
 '{"durations":[5,10]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","aspect_ratio":"9:16"}',
 array['prompt'], null, false, true, null, array['scenes'], 'Runway Gen-4.5',
 'Cenas de 5 ou 10 s.'),
('scene_i2v','luma/ray-3.2','official','replicate',
 '{"unit":"per_second","usd":0.06,"by_resolution":{"540p":0.03,"720p":0.06,"1080p":0.24}}',
 '{"durations":[5],"resolutions":["540p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":5,"resolution":"{{resolution}}"}',
 array['prompt'], null, false, true, null, array['scenes'], 'Luma Ray 3.2',
 'Cenas de 5 s.'),
('scene_i2v','alibaba/happyhorse-1.1','official','replicate',
 '{"unit":"per_second","usd":0.14,"by_resolution":{"720p":0.14,"1080p":0.18}}',
 '{"duration_min":3,"duration_max":15,"resolutions":["720p","1080p"]}',
 '{"prompt":"{{prompt}}","images":{"$list":["keyframe_url","reference_urls"]},"duration":"{{duration_int}}","resolution":"{{resolution}}"}',
 array['prompt'], null, false, false, null, array['scenes','presenter_in_scenes'], 'HappyHorse 1.1',
 'Espera o renderer ($list): o keyframe vai como lista.'),

-- Apresentador falante (talking_avatar). A duração sai do áudio.
('talking_avatar','prunaai/p-video-2-pro-avatar','official','replicate',
 '{"unit":"per_second","usd":0.06,"by_resolution":{"480p":0.02,"768p":0.04,"1080p":0.06,"2k":0.08,"4k":0.12}}',
 '{"duration_from":"audio","max_duration_s":180,"resolutions":["480p","768p","1080p","2k","4k"]}',
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","resolution":"{{resolution}}","prompt":"{{prompt}}"}',
 array['image','audio'], null, false, true, 'top', array['photo_presenter','presenter_in_scenes'], 'P-Video 2 Pro Avatar',
 'Sua foto fala o áudio, até 3 min.'),
('talking_avatar','bytedance/omni-human-1.5','official','replicate',
 '{"unit":"per_second","usd":0.16}',
 '{"duration_from":"audio","max_duration_s":15}',
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","prompt":"{{prompt}}"}',
 array['image','audio'], null, false, true, 'top', array['photo_presenter','presenter_in_scenes'], 'OmniHuman 1.5',
 'Corpo e gestos. Fala de até 15 s (a qualidade cai depois).'),

-- Remake: estilo e cenário (scene_v2v)
('scene_v2v','kwaivgi/kling-v4.0','official','replicate',
 '{"unit":"per_second","usd":0.141,"by_resolution":{"720p":0.094,"1080p":0.141}}',
 '{"duration_min":3,"duration_max":30,"max_bytes":314572800,"resolutions":["720p","1080p"]}',
 '{"prompt":"{{prompt}}","base_video":"{{video_url}}","reference_images":"{{reference_urls}}","resolution":"{{resolution}}"}',
 array['prompt'], null, false, true, 'default', array['restyle'], 'Kling 4.0',
 'Vídeo de 3 a 30 s, até 300 MB. Mantém a duração.'),
('scene_v2v','wan-video/wan-2.7-videoedit','official','replicate',
 '{"unit":"per_second","usd":0.10}',
 '{"duration_min":2,"duration_max":10,"resolutions":["720p","1080p"]}',
 '{"video":"{{video_url}}","prompt":"{{prompt}}","reference_image":"{{reference_url}}","resolution":"{{resolution}}","audio_setting":"origin"}',
 array['video','prompt'], null, false, true, 'alt', array['restyle'], 'Wan 2.7 Edit',
 'Barato, para vídeos de até 10 s. Mantém o áudio.'),

-- Remake: trocar pessoa
('person_swap','wan-video/wan-2.2-animate-replace','official','replicate',
 '{"unit":"per_second","usd":0.05}',
 '{"max_refs":1}',
 '{"video":"{{video_url}}","character_image":"{{reference_url}}","resolution":"720","merge_audio":true}',
 array['video','character_image'], null, false, true, 'alt', array['person_swap'], 'Wan 2.2 Replace',
 'Econômico: 1 foto, 720p, mantém o áudio.'),

-- Fala: lipsync e TTS
('lipsync_post','heygen/lipsync-precision','official','replicate',
 '{"unit":"per_second","usd":0.0667}',
 '{}',
 '{"video":"{{video_url}}","audio":"{{audio_url}}","enable_dynamic_duration":true}',
 array['video','audio'], 'heygen/lipsync-speed', false, true, 'default', array['change_speech'], 'HeyGen Lipsync Precision',
 'O mesmo lipsync do Remake, pelo Replicate.'),
('lipsync_post','heygen/lipsync-speed','official','replicate',
 '{"unit":"per_second","usd":0.0333}',
 '{}',
 '{"video":"{{video_url}}","audio":"{{audio_url}}","enable_dynamic_duration":true}',
 array['video','audio'], null, false, true, 'alt', array['change_speech'], 'HeyGen Lipsync Speed',
 'Metade do preço, mais rápido.'),
('lipsync_post','sync/react-1','official','replicate',
 '{"unit":"per_second","usd":0.167}',
 '{}',
 '{"video":"{{video_url}}","audio":"{{audio_url}}","model_mode":"face","emotion":"neutral","sync_mode":"cut_off"}',
 array['video','audio'], null, false, true, 'top', array['change_speech'], 'Sync React-1',
 'Refaz o rosto com expressão.'),
('tts','minimax/speech-2.8-turbo','official','replicate',
 '{"unit":"per_1k_chars","usd":0.06}',
 '{"languages":["Portuguese"],"audio_formats":["mp3"],"bitrates":[32000,64000,128000,256000]}',
 '{"text":"{{text}}","voice_id":"{{voice_id}}","language_boost":"{{language_boost}}","audio_format":"mp3","bitrate":"{{bitrate}}","sample_rate":32000,"channel":"mono","emotion":"neutral","speed":1.0}',
 array['text'], null, false, true, 'alt', array['change_speech'], 'MiniMax 2.8 Turbo',
 'Voz mais barata.'),

-- Legendas (stt)
('stt','elevenlabs/scribe-v2','official','replicate',
 '{"unit":"per_second","usd":0.0000611}',
 '{}',
 '{"audio":"{{audio_url}}","language_code":"{{language_code}}","timestamps_granularity":"word","tag_audio_events":false}',
 array['audio'], null, true, true, 'default', array['captions'], 'ElevenLabs Scribe v2',
 'Transcrição com tempo por palavra. US$ 0,22 por hora.'),

-- Trilha (music)
('music','stability-ai/stable-audio-2.5','official','replicate',
 '{"unit":"per_run","usd":0.20}',
 '{"duration_min":1,"duration_max":190}',
 '{"prompt":"{{prompt}}","duration":"{{duration_int}}"}',
 array['prompt'], null, true, true, 'default', array['music'], 'Stable Audio 2.5',
 'Trilha instrumental de 1 a 190 s.'),
('music','elevenlabs/music','official','replicate',
 '{"unit":"per_second","usd":0.0083}',
 '{"duration_min":5,"duration_max":300}',
 '{"prompt":"{{prompt}}","music_length_ms":"{{duration_ms}}","force_instrumental":true}',
 array['prompt'], null, false, false, 'top', array['music'], 'ElevenLabs Music',
 'Espera o renderer ({{duration_ms}}).'),

-- Reenquadrar / upscale
('util_reframe','luma/reframe-video','official','replicate',
 '{"unit":"per_second","usd":0.06}',
 '{"duration_max":10}',
 '{"video":"{{video_url}}","aspect_ratio":"9:16"}',
 array['video'], null, true, true, 'default', array['reframe_upscale'], 'Luma Reframe',
 'Vídeo 16:9 vira 9:16. Até 10 s.'),

-- HeyGen (preço NÃO VERIFICADO; o body é o de POST /v3/videos e /v3/video-agents)
('avatar_video','heygen/avatar-iv','official','heygen',
 '{"unit":"per_second","usd":0.05,"verified":false}',
 '{"max_chars":5000,"max_duration_s":600,"resolutions":["720p","1080p"]}',
 '{"type":"avatar","avatar_id":"{{avatar_id}}","script":"{{text}}","voice_id":"{{voice_id}}","audio_url":"{{audio_url}}","aspect_ratio":"9:16","resolution":"{{resolution}}","engine":{"type":"avatar_iv"}}',
 array['avatar_id'], null, true, true, 'default', array['avatar_script','photo_presenter','digital_twin'], 'HeyGen Avatar IV',
 'Avatar fala o roteiro (até 5.000 caracteres). Serve para biblioteca, foto e clone.'),
('avatar_video','heygen/avatar-v','official','heygen',
 '{"unit":"per_second","usd":0.12,"verified":false}',
 '{"max_chars":5000,"max_duration_s":600,"resolutions":["720p","1080p"]}',
 '{"type":"avatar","avatar_id":"{{avatar_id}}","script":"{{text}}","voice_id":"{{voice_id}}","audio_url":"{{audio_url}}","aspect_ratio":"9:16","resolution":"{{resolution}}","engine":{"type":"avatar_v"}}',
 array['avatar_id'], null, false, true, 'top', array['avatar_script','digital_twin'], 'HeyGen Avatar V',
 'Maior fidelidade. Só nos avatares que aceitam este motor.'),
('avatar_video','heygen/avatar-iii','official','heygen',
 '{"unit":"per_second","usd":0,"verified":false}',
 '{"max_chars":5000,"max_duration_s":600,"resolutions":["720p","1080p","4k"]}',
 '{}',
 array['avatar_id'], null, false, true, null, array['digital_twin'], 'HeyGen Avatar III',
 'Clone em 4K. O body sai do builder do motor; a linha serve para custo e rótulo.'),
('video_agent','heygen/video-agent','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":10000}',
 '{"mode":"generate","prompt":"{{prompt}}","avatar_id":"{{avatar_id}}","voice_id":"{{voice_id}}","orientation":"portrait"}',
 array['prompt'], null, true, true, 'default', array['idea_to_video'], 'HeyGen Video Agent',
 'Uma ideia vira um vídeo pronto, com a marca.'),
('translate','heygen/video-translation','official','heygen',
 '{"unit":"per_second","usd":0,"verified":false}',
 '{}',
 '{"video_url":"{{video_url}}","mode":"speed"}',
 array['video_url'], null, true, true, 'default', array['translate'], 'HeyGen Tradução',
 'Cobra pela duração do vídeo de origem.')
on conflict (capability, model_id) do update
  set kind = excluded.kind, provider = excluded.provider, cost = excluded.cost,
      limits = excluded.limits, input_template = excluded.input_template,
      required_inputs = excluded.required_inputs, fallback_model_id = excluded.fallback_model_id,
      active = excluded.active, tier = excluded.tier, experience = excluded.experience,
      label = excluded.label, notes = excluded.notes;

-- ── 3. Linhas que já existem: tier, experiência, rótulo ─────────────────────
update public.video_models v set tier = x.tier, experience = x.experience, label = x.label
from (values
  ('scene_i2v',     'bytedance/seedance-2.0',     'default', array['scenes'],                              'Seedance 2.0'),
  ('talking_avatar','veed/fabric-1.0',            'alt',     array['photo_presenter','presenter_in_scenes'], 'Fabric 1.0'),
  ('scene_v2v',     'runwayml/aleph-2',           'top',     array['restyle'],                             'Runway Aleph 2'),
  ('person_swap',   'prunaai/p-video-replace',    'default', array['person_swap'],                         'P-Video Replace'),
  ('tts',           'minimax/speech-02-hd',       'default', array['change_speech'],                       'MiniMax 02 HD'),
  ('tts',           'minimax/speech-2.8-hd',      'top',     array['change_speech'],                       'MiniMax 2.8 HD'),
  ('util_normalize','bytedance/video-upscaler',   'default', array['reframe_upscale'],                     'ByteDance Upscaler'),
  ('keyframe',      'google/nano-banana-2',       null,      array[]::text[],                              'Nano Banana 2'),
  ('keyframe',      'google/nano-banana-pro',     null,      array[]::text[],                              'Nano Banana Pro')
) as x(capability, model_id, tier, experience, label)
where v.capability = x.capability and v.model_id = x.model_id;

-- O Remake usa o Aleph como primário hoje; o hub sugere o Kling 4.0, mas a troca
-- de primário fica para quando o Kling v2v for testado de verdade (A/B).

-- ── 4. Primários e fallbacks ────────────────────────────────────────────────
-- TTS: o primário continua o 02-hd (é o caminho que funciona hoje; trocar
-- muda a voz de todo vídeo novo). O 2.8-hd aparece como "top" no hub; virar
-- primário só depois de um teste real com o OK do Samuel.
-- Lipsync: o HeyGen precision entra no lugar do lipsync-2. Nenhum código
-- resolve lipsync_post hoje (o Remake chama a API HeyGen direto): sem efeito
-- no que roda.
update public.video_models set is_primary = false where capability = 'lipsync_post' and model_id = 'sync/lipsync-2';
update public.video_models set is_primary = true  where capability = 'lipsync_post' and model_id = 'heygen/lipsync-precision';
-- Cenas: o fallback do Seedance 2.0 passa a ser o Kling 4.0 (duração contínua).
update public.video_models set fallback_model_id = 'kwaivgi/kling-v4.0'
 where capability = 'scene_i2v' and model_id = 'bytedance/seedance-2.0';
-- Fabric: fallback para a v2 pro do P-Video Avatar.
update public.video_models set fallback_model_id = 'prunaai/p-video-2-pro-avatar'
 where capability = 'talking_avatar' and model_id = 'veed/fabric-1.0';

-- ── 5. Aposentadas (active=false, sem apagar) ───────────────────────────────
update public.video_models v set active = false, is_primary = false, tier = null,
       experience = '{}', retired_reason = x.reason
from (values
  ('scene_i2v',     'bytedance/seedance-1-lite',    'Mais caro e mais antigo que o Seedance 1.5 Pro.'),
  ('scene_t2v',     'bytedance/seedance-1-lite',    'Texto → vídeo sem uso no motor.'),
  ('scene_t2v',     'pixverse/pixverse-v6',         'Texto → vídeo sem uso no motor.'),
  ('scene_i2v',     'kwaivgi/kling-v2.5-turbo-pro', 'Só 5 ou 10 s: sobram segundos mudos. Substituto: Kling 4.0.'),
  ('scene_i2v',     'minimax/hailuo-2.3',           'Só 6 ou 10 s, preso em 768p e cobrado por vídeo.'),
  ('talking_avatar','bytedance/omni-human',         'A qualidade cai depois de 15 s. Substituto: OmniHuman 1.5.'),
  ('talking_avatar','prunaai/p-video-avatar',       'Substituído pelo P-Video 2 Pro Avatar.'),
  ('lipsync_post',  'sync/lipsync-2',               'Sem uso. Substituto: HeyGen Lipsync Precision.')
) as x(capability, model_id, reason)
where v.capability = x.capability and v.model_id = x.model_id;

-- Ninguém aponta para uma linha aposentada.
update public.video_models set fallback_model_id = null
 where fallback_model_id in (
   select model_id from public.video_models r
    where r.active = false and r.retired_reason is not null
      and r.capability = public.video_models.capability);

-- avatar-create.sql (2026-10-30) · custo de criar avatar no HeyGen
insert into public.video_models
  (capability, model_id, kind, provider, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, active, tier, experience, label, notes)
values
('avatar_create','heygen/avatar-photo','official','heygen',
 '{"unit":"per_run","usd":1,"verified":false}',
 '{"max_bytes":52428800}', '{}', array['file'],
 null, true, true, null, array['photo_presenter'], 'Foto vira avatar',
 '1 foto frontal, luz uniforme, cabeça inteira, 1 pessoa.'),
('avatar_create','heygen/avatar-digital-twin','official','heygen',
 '{"unit":"per_run","usd":1,"verified":false}',
 '{"duration_min":15,"duration_max":600,"max_bytes":209715200}', '{}', array['file'],
 null, false, true, null, array['digital_twin'], 'Clone (Digital Twin)',
 'Vídeo de ~2 min falando para a câmera, sem música. Pede consentimento gravado.'),
('avatar_create','heygen/avatar-prompt','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":1000,"max_refs":3}', '{}', array['prompt'],
 null, false, true, null, array['avatar_script'], 'Avatar por descrição',
 'Apresentador sintético a partir de uma descrição (até 1.000 caracteres).'),
('avatar_create','heygen/avatar-look','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":1000}', '{}', array['avatar_id','prompt'],
 null, false, true, null, array['avatar_script','photo_presenter','digital_twin'], 'Novo visual',
 'Mesmo apresentador com outra roupa ou cenário.')
on conflict (capability, model_id) do update
  set kind = excluded.kind, provider = excluded.provider, cost = excluded.cost,
      limits = excluded.limits, required_inputs = excluded.required_inputs,
      tier = excluded.tier, experience = excluded.experience,
      label = excluded.label, notes = excluded.notes;

-- voice-create.sql (2026-10-30) · catálogo do construtor de voz
insert into public.video_models
  (capability, model_id, kind, provider, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, active, tier, experience, label, notes)
values
('voice_create','elevenlabs/voice-clone-instant','official','elevenlabs',
 '{"unit":"per_run","usd":0,"verified":false,"note":"vaga do plano Starter+"}',
 '{"duration_min":10,"duration_ideal":90,"duration_max":180}', '{}', array['audio'],
 'heygen/voice-clone-instant', true, true, 'default', array['own_voice'], 'Minha voz (ElevenLabs)',
 'Grave ou envie de 10 s a 3 min falando; o ideal é 1min30. Usa uma vaga de voz do plano.'),
('voice_create','heygen/voice-clone-instant','official','heygen',
 '{"unit":"per_run","usd":0,"verified":true,"note":"grátis no preview"}',
 '{"duration_max":180,"max_bytes":104857600,"daily":20}', '{}', array['audio'],
 null, false, true, 'alt', array['own_voice'], 'Minha voz (HeyGen)',
 'Clone instantâneo grátis durante o preview. Usa só os 3 primeiros minutos.'),
('voice_create','elevenlabs/voice-design','official','elevenlabs',
 '{"unit":"per_1k_chars","usd":0,"verified":false}',
 '{"max_chars":1000,"min_chars":20,"previews":3}', '{}', array['prompt'],
 null, false, true, 'default', array['voice_design'], 'Voz por descrição (ElevenLabs)',
 'Descreva a voz (20 a 1.000 caracteres) e ouça 3 opções.'),
('voice_create','heygen/voice-design','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":1000,"previews":3}', '{}', array['prompt'],
 null, false, true, 'alt', array['voice_design'], 'Voz por descrição (HeyGen)',
 'Descreva a voz e ouça até 3 opções.'),
('voice_create','elevenlabs/voice-library','official','elevenlabs',
 '{"unit":"per_run","usd":0,"verified":true,"note":"sem vaga; exige Creator"}',
 '{}', '{}', array[]::text[],
 null, false, true, 'default', array['voice_library'], 'Biblioteca de vozes',
 'Vozes prontas da comunidade ElevenLabs. Não usa vaga; exige o plano Creator.'),
('voice_create','elevenlabs/voice-clone-pro','official','elevenlabs',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"duration_min":1800}', '{}', array['audio'],
 null, false, false, 'top', array['pro_voice'], 'Clone profissional',
 'Pede 30 min ou mais de gravação limpa. Ainda não disponível.'),
('tts','heygen/voice-1-turbo-free','official','heygen',
 '{"unit":"per_1k_chars","usd":0,"verified":true,"until":"2026-11-30"}',
 '{"max_chars":5000,"rpm":30}', '{}', array['text'],
 null, false, false, 'alt', array['narration'], 'HeyGen Voice Turbo',
 'Narração com a voz clonada no HeyGen. Grátis até 30/11/2026; 30 pedidos por minuto.')
on conflict (capability, model_id) do update
  set kind = excluded.kind, provider = excluded.provider, cost = excluded.cost,
      limits = excluded.limits, required_inputs = excluded.required_inputs,
      fallback_model_id = excluded.fallback_model_id,
      tier = excluded.tier, experience = excluded.experience,
      label = excluded.label, notes = excluded.notes;

-- 202608210030_director_jobs.sql · realtime public.director_jobs
alter table public.director_jobs replica identity full;

-- 202608210030_director_jobs.sql · realtime public.director_jobs
do $$ begin
  alter publication supabase_realtime add table public.director_jobs;
exception when duplicate_object then null; end $$;

-- 202608210030_director_jobs.sql · revoke public.claim_director_job
revoke all on function public.claim_director_job(text) from public;

-- 202608210030_director_jobs.sql · grant public.claim_director_job
grant execute on function public.claim_director_job(text) to authenticated;

-- 202608210031_director_edge.sql · revoke public.invoke_director_advance
revoke all on function public.invoke_director_advance() from public, anon, authenticated;

-- 202608210031_director_edge.sql · grant public.invoke_director_advance
grant execute on function public.invoke_director_advance() to service_role;

-- 202608260033_identities.sql · realtime public.director_identities
alter table public.director_identities replica identity full;

-- 202608260033_identities.sql · realtime public.director_identities
do $$ begin
  alter publication supabase_realtime add table public.director_identities;
exception when duplicate_object then null; end $$;

-- 202608290035_retrieval_fts.sql · grant public.search_context_items_fts
grant execute on function public.search_context_items_fts(text, int, public.context_kind[], text[], text[])
  to authenticated, service_role;

-- 20260829153912_9473d129-b942-4444-948d-b932f244204a.sql · grant public.search_context_items_fts
grant execute on function public.search_context_items_fts(text, int, public.context_kind[], text[], text[]) to authenticated, service_role;

-- 202608300036_account_formats.sql · insert public.app_settings
insert into public.app_settings (key, value)
values ('zernio_account_formats', '{}'::jsonb)
on conflict (key) do nothing;

-- 202608300037_automacao.sql · revoke public.invoke_automation_tick
revoke all on function public.invoke_automation_tick() from public, anon, authenticated;

-- 202608300037_automacao.sql · grant public.invoke_automation_tick
grant execute on function public.invoke_automation_tick() to service_role;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · insert public.app_settings
insert into public.app_settings (key, value)
values ('zernio_account_formats', '{}'::jsonb)
on conflict (key) do nothing;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · grant public.mcp_tokens
grant select, insert, update, delete on public.mcp_tokens to authenticated;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · grant public.mcp_tokens
grant all on public.mcp_tokens to service_role;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · grant public.automation_triggers
grant select, insert, update, delete on public.automation_triggers to authenticated;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · grant public.automation_triggers
grant all on public.automation_triggers to service_role;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · grant public.automation_runs
grant select on public.automation_runs to authenticated;

-- 20260830201803_3479a6eb-f271-4328-966e-98f5b86c40d2.sql · grant public.automation_runs
grant all on public.automation_runs to service_role;

-- 20260830215344_7d51022d-0dc3-44fa-9adf-6867750d0eee.sql · revoke public.invoke_automation_tick
revoke all on function public.invoke_automation_tick() from public, anon, authenticated;

-- 20260830215344_7d51022d-0dc3-44fa-9adf-6867750d0eee.sql · grant public.invoke_automation_tick
grant execute on function public.invoke_automation_tick() to service_role;

-- 202608310039_capa_modelo_de_imagem.sql · update public.app_settings
update public.app_settings
   set value = jsonb_set(value, '{image,model}', '"google/gemini-3-pro-image-preview"'::jsonb)
 where key = 'ai_providers'
   and value -> 'image' ->> 'model' = 'google/gemini-2.5-flash-image';

-- brand-voices.sql (2026-10-30) · vozes da marca (construtor de voz)
create table if not exists public.brand_voices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  provider text not null check (provider in ('elevenlabs', 'heygen')),
  -- null só enquanto o clone HeyGen é criado (a linha nasce antes, para a Idempotency-Key)
  provider_voice_id text,
  source text not null check (source in ('clone', 'design', 'library', 'pasted', 'twin')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error text,
  gender text check (gender is null or gender in ('female', 'male')),
  language text not null default 'pt',
  sample_path text,
  preview_path text,
  -- criada por nós: só estas são apagadas no provedor
  owned boolean not null default false,
  consent_at timestamptz,
  consent_by uuid references auth.users(id) on delete set null,
  is_default boolean not null default false,
  -- tentativa da Idempotency-Key na HeyGen (voice:<id>:<attempt>)
  attempt integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.brand_voices
    add constraint brand_voices_clone_consent
    check (source <> 'clone' or consent_at is not null);
exception when duplicate_object then null; end $$;

-- no máximo uma voz padrão
create unique index if not exists brand_voices_one_default
  on public.brand_voices (is_default) where is_default;

-- a mesma voz do provedor não entra duas vezes
create unique index if not exists brand_voices_provider_voice
  on public.brand_voices (provider, provider_voice_id) where provider_voice_id is not null;

create index if not exists brand_voices_created_idx on public.brand_voices (created_at desc);

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.brand_voices'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger brand_voices_set_updated_at
      before update on public.brand_voices
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.brand_voices enable row level security;

drop policy if exists "brand_voices_read" on public.brand_voices;
create policy "brand_voices_read"
  on public.brand_voices for select
  to authenticated
  using (true);

-- Sem policy de escrita para authenticated/anon: só service_role (ignora RLS).
revoke all on table public.brand_voices from public, anon;
grant select on table public.brand_voices to authenticated;
grant all on table public.brand_voices to service_role;

comment on table public.brand_voices is
  'Vozes da marca (construtor de voz). Escrita só pelo avatar-studio; is_default = voz padrão dos vídeos.';

-- hub-examples.sql (2026-10-30) · chave dos vídeos de exemplo do hub
insert into public.app_settings (key, value) values ('hub_examples', '{}'::jsonb)
on conflict (key) do nothing;

-- ── video-edit-setting.sql · chave "Claude edita antes de entregar" ─────────
insert into public.app_settings (key, value)
values ('video_edit', '{"auto": false}'::jsonb)
on conflict (key) do nothing;

-- ── video-edits.sql · edições do "Aprimorar com IA" (docs/motor-de-edicao.md §11.1) ──
create table if not exists public.video_edits (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('job', 'path')),
  source_id uuid references public.director_jobs(id) on delete cascade,
  source_path text not null,
  status text not null default 'analyzing'
    check (status in ('analyzing', 'suggested', 'queued', 'rendering', 'checking', 'ready', 'failed', 'reverted')),
  analysis jsonb not null default '{}',
  -- { ops: Op[] } já resolvidas (os ajustes de um clique mexem aqui)
  plan jsonb,
  artifacts jsonb not null default '{}',
  output_path text,
  qa jsonb,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  -- true = aplicada sozinha pela chave "Claude edita antes de entregar"
  auto boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_edits_source_idx
  on public.video_edits (source_id, created_at desc);

create index if not exists video_edits_active_idx
  on public.video_edits (status) where status in ('analyzing', 'queued', 'rendering', 'checking');

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.video_edits'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger video_edits_set_updated_at
      before update on public.video_edits
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.video_edits enable row level security;

drop policy if exists "video_edits_admin_read" on public.video_edits;
create policy "video_edits_admin_read"
  on public.video_edits for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Sem policy de escrita para authenticated/anon: só service_role (ignora RLS).
revoke all on table public.video_edits from public, anon;
grant select on table public.video_edits to authenticated;
grant all on table public.video_edits to service_role;

alter table public.video_edits replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.video_edits;
exception when duplicate_object then null; end $$;

comment on table public.video_edits is
  'Edições do "Aprimorar com IA". Escrita só pela edge video-edit; o original nunca é apagado. cost_usd entra no teto do mês ao lado de video_month_spend_usd().';

-- Watchdog do "Aprimorar com IA" (supabase/sql/video-edits.sql); o cron vem do pos-remix.sql.
create or replace function public.mark_stale_video_edits_failed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.video_edits
     set status = 'failed',
         error = 'A edição parou no meio. O vídeo original continua igual. Tente de novo.',
         claimed_by = null
   where status in ('analyzing', 'queued', 'rendering', 'checking')
     and updated_at < now() - interval '20 minutes';
$$;

revoke all on function public.mark_stale_video_edits_failed() from public, anon, authenticated;
grant execute on function public.mark_stale_video_edits_failed() to service_role;

-- ── mcp-oauth.sql ──────────────────────────────
-- OAuth do conector MCP: "Conectar" no Claude abre a tela de autorização do app.
-- Idempotente. Aplicar pelo Lovable. O token emitido entra em mcp_tokens, então
-- continua aparecendo na lista de acessos e pode ser revogado por lá.
--
-- Só service_role acessa: a edge mcp-server valida tudo. O código guarda só o hash.

create table if not exists public.mcp_oauth_clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  client_id uuid not null references public.mcp_oauth_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  created_by uuid references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;

revoke all on table public.mcp_oauth_clients from public, anon, authenticated;
revoke all on table public.mcp_oauth_codes from public, anon, authenticated;
grant all on table public.mcp_oauth_clients to service_role;
grant all on table public.mcp_oauth_codes to service_role;

-- ── google-drive.sql · materiais no Google Drive (docs/google-drive.md). O agendamento
-- do tick é HTTP schedule gerenciado em /api/public/jobs/google-drive-tick. ──
create table if not exists public.drive_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  kind text not null default 'documento',
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'purged', 'restoring', 'kept', 'gone')),
  -- por que o arquivo fica no nosso storage (status = 'kept')
  reason text,
  size_bytes bigint not null default 0,
  mime_type text,
  md5 text,
  source_etag text,
  source_updated_at timestamptz,
  drive_file_id text,
  drive_link text,
  -- dono da cópia: permissionId e e-mail da conta Google que recebeu o arquivo
  drive_account text,
  drive_email text,
  -- upload resumável: a sessão sobrevive de um tick para o outro
  session_uri text,
  uploaded_bytes bigint not null default 0,
  hash_state jsonb,
  -- volta ao storage (TUS)
  tus_url text,
  archived_at timestamptz,
  purged_at timestamptz,
  restored_at timestamptz,
  last_used_at timestamptz,
  attempts integer not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path)
);

create index if not exists drive_files_work_idx
  on public.drive_files (status, next_try_at, size_bytes desc);

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.drive_files'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger drive_files_set_updated_at
      before update on public.drive_files
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.drive_files enable row level security;

drop policy if exists "drive_files_admin_read" on public.drive_files;
create policy "drive_files_admin_read"
  on public.drive_files for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on table public.drive_files from public, anon, authenticated;
grant select (
  id, bucket, path, kind, status, reason, size_bytes, mime_type, md5, drive_file_id, drive_link,
  drive_email, archived_at, purged_at, restored_at, last_used_at, attempts, last_error,
  created_at, updated_at
) on public.drive_files to authenticated;
grant all on table public.drive_files to service_role;

comment on table public.drive_files is
  'Registro dos arquivos copiados para o Google Drive. O arquivo mora no Drive; o storage guarda só o que ainda está em uso.';

insert into public.app_settings (key, value)
values ('google_drive_archive', '{"purge": false}'::jsonb)
on conflict (key) do nothing;

-- director_state agora guarda access token e verifier do PKCE. O front não lê esta
-- tabela: fica só para o service role, e docs/google-drive.md tem a consulta que confere.
alter table public.director_state enable row level security;
revoke all on table public.director_state from public, anon, authenticated;
grant all on table public.director_state to service_role;

-- ── Trava de geração ─────────────────────────────────────────────────────────

create or replace function public.google_drive_required()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  conexao jsonb;
begin
  if coalesce(public.get_vault_secret('GOOGLE_CLIENT_ID'), '') = ''
     or coalesce(public.get_vault_secret('GOOGLE_CLIENT_SECRET'), '') = '' then
    return false;
  end if;
  select value into conexao from public.director_state where key = 'google_drive';
  return conexao is null
    or coalesce((conexao ->> 'connected')::boolean, false) is not true
    or coalesce((conexao ->> 'broken')::boolean, false) is true;
end
$$;

revoke all on function public.google_drive_required() from public, anon, authenticated;
grant execute on function public.google_drive_required() to service_role;

-- O front insere vídeo novo direto em director_jobs (RLS): a trava precisa morar aqui.
-- Só INSERT: job em andamento segue, e Retomar é UPDATE.
create or replace function public.director_jobs_require_drive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.google_drive_required() then
    raise exception 'drive_required' using hint = 'Conecte o Google Drive para gerar.';
  end if;
  return new;
end
$$;

revoke all on function public.director_jobs_require_drive() from public, anon, authenticated;

drop trigger if exists director_jobs_require_drive on public.director_jobs;
create trigger director_jobs_require_drive
  before insert on public.director_jobs
  for each row execute function public.director_jobs_require_drive();

-- ── Refresh token no Vault ───────────────────────────────────────────────────
-- store_vault_secret exige JWT de admin. Quem conclui o OAuth é a edge, com service
-- role, na volta do Google, sem sessão: estas duas existem só para esse nome fixo.

create or replace function public.google_drive_store_refresh(_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  segredo uuid;
begin
  select id into segredo from vault.secrets where name = 'GOOGLE_DRIVE_REFRESH_TOKEN';
  if segredo is null then
    perform vault.create_secret(_value, 'GOOGLE_DRIVE_REFRESH_TOKEN');
  else
    perform vault.update_secret(segredo, _value);
  end if;
end
$$;

revoke all on function public.google_drive_store_refresh(text) from public, anon, authenticated;
grant execute on function public.google_drive_store_refresh(text) to service_role;

-- ── Leitura do storage ───────────────────────────────────────────────────────
-- O schema storage não sai pelo PostgREST. Candidatos vêm do maior para o menor, e
-- também volta o que mudou no storage depois de copiado (mesmo caminho, novo render).

create or replace function public.google_drive_candidates(
  _buckets text[], _min_size bigint, _min_age interval, _limit integer
)
returns table (
  bucket text, path text, size_bytes bigint, mime_type text, etag text,
  source_updated_at timestamptz, known boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id,
         o.name,
         (o.metadata ->> 'size')::bigint,
         o.metadata ->> 'mimetype',
         o.metadata ->> 'eTag',
         coalesce(o.updated_at, o.created_at),
         f.id is not null
  from storage.objects o
  left join public.drive_files f on f.bucket = o.bucket_id and f.path = o.name
  where o.bucket_id = any (_buckets)
    and (o.metadata ->> 'size')::bigint >= _min_size
    and coalesce(o.updated_at, o.created_at) < now() - _min_age
    and (
      f.id is null
      or (
        f.status in ('uploaded', 'purged', 'kept', 'gone')
        and f.source_updated_at is distinct from coalesce(o.updated_at, o.created_at)
      )
    )
  order by (o.metadata ->> 'size')::bigint desc
  limit _limit
$$;

revoke all on function public.google_drive_candidates(text[], bigint, interval, integer) from public, anon, authenticated;
grant execute on function public.google_drive_candidates(text[], bigint, interval, integer) to service_role;

-- Quantos objetos este papel enxerga. Zero aqui com arquivos na API do storage quer
-- dizer permissão, não bucket vazio: a varredura avisa na tela.
create or replace function public.google_drive_objects_seen(_buckets text[])
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from storage.objects o where o.bucket_id = any (_buckets)
$$;

revoke all on function public.google_drive_objects_seen(text[]) from public, anon, authenticated;
grant execute on function public.google_drive_objects_seen(text[]) to service_role;

create or replace function public.google_drive_object(_bucket text, _path text)
returns table (size_bytes bigint, mime_type text, etag text, source_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype', o.metadata ->> 'eTag',
         coalesce(o.updated_at, o.created_at)
  from storage.objects o
  where o.bucket_id = _bucket and o.name = _path
$$;

revoke all on function public.google_drive_object(text, text) from public, anon, authenticated;
grant execute on function public.google_drive_object(text, text) to service_role;

create or replace function public.google_drive_stats()
returns table (saved_bytes bigint, saved_files bigint, drive_files bigint, waiting_files bigint, failing_files bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(size_bytes) filter (where status = 'purged'), 0)::bigint,
         count(*) filter (where status = 'purged'),
         count(*) filter (where status in ('uploaded', 'purged', 'restoring')),
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'pending' and attempts > 0)
  from public.drive_files
$$;

revoke all on function public.google_drive_stats() from public, anon, authenticated;
grant execute on function public.google_drive_stats() to service_role;

-- "7 dias sem uso" de um arquivo devolvido. Exceção deliberada: authenticated pode
-- chamar, porque abrir um vídeo na tela também é uso. Só carimba last_used_at, em
-- quem já tem cópia no Drive; não lê nem devolve nada.
create or replace function public.google_drive_touch(_bucket text, _path text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.drive_files
     set last_used_at = now()
   where bucket = _bucket and path = _path and status = 'uploaded'
$$;

revoke all on function public.google_drive_touch(text, text) from public, anon, authenticated;
grant execute on function public.google_drive_touch(text, text) to authenticated, service_role;

-- ── Tick ─────────────────────────────────────────────────────────────────────
-- Mesmo guard do video-edit: x-cron-secret com VIDEO_CRON_SECRET; a edge valida por
-- dentro e exige `verify_jwt = false`. Com trabalho na fila roda a cada minuto; sem
-- fila, procura arquivos novos a cada 15 minutos. Sem Drive conectado, não chama.

create or replace function public.invoke_google_drive_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  secret text;
  request_id bigint;
begin
  if not exists (
    select 1 from public.director_state
    where key = 'google_drive'
      and coalesce((value ->> 'connected')::boolean, false)
      and not coalesce((value ->> 'broken')::boolean, false)
  ) then
    return 0;
  end if;
  if extract(minute from now())::integer % 15 <> 0
     and not exists (select 1 from public.drive_files where status = 'pending' and next_try_at <= now()) then
    return 0;
  end if;
  select value ->> 'url' into base_url from public.app_settings where key = 'instance_url';
  secret := public.get_vault_secret('VIDEO_CRON_SECRET');
  if base_url is null or base_url = '' or secret is null or secret = '' then
    raise log 'invoke_google_drive_tick: instance_url ou VIDEO_CRON_SECRET ausente.';
    return 0;
  end if;
  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/google-drive',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end
$$;

revoke all on function public.invoke_google_drive_tick() from public, anon, authenticated;
grant execute on function public.invoke_google_drive_tick() to service_role;

-- ── rss-items-escrita.sql · a tela só marca item usado ou dispensado. ──
revoke update on table public.rss_items from authenticated;
grant update (dismissed_at, used_in_job_id) on table public.rss_items to authenticated;

-- ============================================================================

-- auth-primeiro-admin.sql (2026-11-04) · fecha o cadastro aberto (has_any_admin e handle_new_user de volta à regra)

create or replace function public.has_any_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where role = 'admin');
$$;

-- exceção documentada: o /login precisa saber se já existe admin (só um boolean)
revoke all on function public.has_any_admin() from public;
grant execute on function public.has_any_admin() to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _invited_role text;
begin
  -- Serializa a decisão "primeiro usuário" contra signups concorrentes
  perform pg_advisory_xact_lock(hashtext('handle_new_user_first_admin'));

  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;

  if not exists (select 1 from public.user_roles where role = 'admin') then
    -- Primeiro usuário do banco vira admin (primeiro acesso pós-Remix)
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
    on conflict (user_id, role) do nothing;
  else
    -- Já existe admin: só entra quem tem convite em pending_invites, que só o
    -- servidor grava (invite-user, service_role; anon/authenticated sem acesso).
    -- NUNCA ler o papel de raw_user_meta_data: quem se cadastra preenche esse
    -- campo e virava admin com data.role = 'admin' (202607300012; regrediu em 04/11).
    select pi.role::text into _invited_role
      from public.pending_invites pi
     where pi.email = lower(new.email);

    if _invited_role is null then
      raise exception 'signup direto desabilitado: novos usuários entram apenas por convite de um admin';
    end if;

    insert into public.user_roles (user_id, role)
    values (new.id, _invited_role::public.app_role)
    on conflict (user_id, role) do nothing;

    -- convite usado uma vez só
    delete from public.pending_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- a função é SECURITY DEFINER: ninguém a chama por RPC, só o gatilho
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- vault-fechado.sql (2026-11-04) · o store-secret só grava com o cofre fechado

create or replace function public.vault_fechado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not has_function_privilege('anon', 'public.get_vault_secret(text)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.get_vault_secret(text)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.store_vault_secret(text, text)', 'EXECUTE');
$$;

-- regra 1 do AGENTS.md: função nova em public nasce aberta; fecha e dá só ao mínimo
revoke all on function public.vault_fechado() from public, anon, authenticated;
grant execute on function public.vault_fechado() to service_role;

-- papeis-de-usuario.sql (2026-11-04) · o admin promove e rebaixa pela tela; o último admin não sai

-- escrita em user_roles só por admin (as políticas podem já existir pela
-- migration de identidade; recriar é idempotente)
drop policy if exists "user_roles_insert_admin" on public.user_roles;
create policy "user_roles_insert_admin"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "user_roles_update_admin" on public.user_roles;
create policy "user_roles_update_admin"
  on public.user_roles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "user_roles_delete_admin" on public.user_roles;
create policy "user_roles_delete_admin"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- o último admin não sai: nem por update, nem por delete
create or replace function public.user_roles_keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if (select count(*) from public.user_roles where role = 'admin' and user_id <> old.user_id) = 0 then
      raise exception 'a instância precisa de ao menos um administrador';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- regra 1 do AGENTS.md: função nova em public nasce aberta; gatilho não precisa de EXECUTE
revoke all on function public.user_roles_keep_one_admin() from public, anon, authenticated;

drop trigger if exists user_roles_keep_one_admin on public.user_roles;
create trigger user_roles_keep_one_admin
  before update or delete on public.user_roles
  for each row execute function public.user_roles_keep_one_admin();

-- roteiro-pedidos.sql (2026-11-04)
-- roteiro-pedidos.sql (2026-11-04) · pedidos de escrita pelo Claude da assinatura.
--
-- A pessoa escreve do jeito dela num campo da tela Vídeos e pede "Escrever com o
-- seu Claude". O pedido fica aqui com o tipo (roteiro, ideia, briefing_cenas,
-- fala, cena, pessoa), o contexto (campo, modelo, limite, duração) e a rotina
-- do Claude dela lê pelo conector (roteiro_pedidos), escreve no formato que o
-- modelo exige e entrega (roteiro_entregar). A tela acompanha por Realtime.
--
-- Reúne as migrations 0019–0023 (a tabela nunca entrou no seed: um Remix nascia
-- sem ela) e acrescenta tipo, contexto e saida.

create table if not exists public.roteiro_pedidos (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'aberto'
    check (status in ('aberto', 'entregue', 'cancelado', 'falhou')),
  briefing text not null,
  referencias jsonb not null default '[]',
  claim jsonb,
  roteiro text,
  plano jsonb,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roteiro_pedidos add column if not exists andamento jsonb;
alter table public.roteiro_pedidos add column if not exists conversa jsonb not null default '[]';
alter table public.roteiro_pedidos add column if not exists aguardando_pessoa boolean not null default false;
-- o que o Claude escreve: roteiro (com plano), ideia, briefing_cenas, fala, cena, pessoa
alter table public.roteiro_pedidos add column if not exists tipo text not null default 'roteiro';
-- { alvo, ferramenta, modelo, max, segundos, formato, apresentador, voz }
alter table public.roteiro_pedidos add column if not exists contexto jsonb not null default '{}';
-- entrega estruturada dos tipos curtos (briefing_cenas, cena, pessoa)
alter table public.roteiro_pedidos add column if not exists saida jsonb;

create index if not exists roteiro_pedidos_abertos_idx
  on public.roteiro_pedidos (created_at) where status = 'aberto';

-- um pedido aberto por pessoa × tipo × campo: o segundo clique mostra o primeiro
create unique index if not exists roteiro_pedidos_um_por_campo
  on public.roteiro_pedidos (created_by, tipo, coalesce(contexto->>'alvo', ''))
  where status = 'aberto';

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.roteiro_pedidos'::regclass and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger roteiro_pedidos_set_updated_at
      before update on public.roteiro_pedidos
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.roteiro_pedidos enable row level security;

drop policy if exists "roteiro_pedidos_read" on public.roteiro_pedidos;
create policy "roteiro_pedidos_read"
  on public.roteiro_pedidos for select
  to authenticated
  using (created_by = auth.uid());

-- escrita só pelas edges (service role); a tela pede por roteiro-pedido
revoke insert, update, delete on public.roteiro_pedidos from anon, authenticated;

alter table public.roteiro_pedidos replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.roteiro_pedidos;
exception when duplicate_object then null; end $$;

-- seguranca-05-11.sql — auditoria de segurança de 05/11/2026 (régua das conferências
-- do Diego). Idempotente. Vale para toda instância: está também no fim do
-- seed-instancia.sql, para o remix nascer certo.

-- ── 1. Peças: quem não é admin não aprova, não publica, não agenda e não mexe em
--       peça aprovada. Antes, a policy de UPDATE era `true` para qualquer logado.
--       SECURITY INVOKER: a regra roda como quem chama (auth.uid() da sessão);
--       o servidor (service_role, sem auth.uid()) e as rotinas passam.
create or replace function public.content_pieces_guarda_papel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or public.has_role(auth.uid(), 'admin') then
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'published') then
    raise exception 'Só administradores aprovam ou publicam peças.' using errcode = '42501';
  end if;
  if new.scheduled_at is distinct from old.scheduled_at then
    raise exception 'Só administradores agendam peças.' using errcode = '42501';
  end if;
  if new.audit is distinct from old.audit then
    raise exception 'A auditoria da peça é feita pelo servidor.' using errcode = '42501';
  end if;
  if old.status in ('approved', 'published')
     and (new.adapted_content is distinct from old.adapted_content
          or new.core_content is distinct from old.core_content) then
    raise exception 'Peça aprovada só muda com um administrador.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists content_pieces_guarda_papel on public.content_pieces;
create trigger content_pieces_guarda_papel
  before update on public.content_pieces
  for each row execute function public.content_pieces_guarda_papel();

-- ── 2. renders: quem não é admin só envia arquivo para peça em rascunho ou reprovada
drop policy if exists renders_insert_authenticated on storage.objects;
create policy renders_insert_authenticated on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'renders'
    and exists (
      select 1 from public.content_pieces p
       where (p.id)::text = (storage.foldername(objects.name))[1]
         and (public.has_role(auth.uid(), 'admin') or p.status in ('draft', 'rejected'))
    )
  );

-- ── 3. google_drive_touch: só admin (tela) ou servidor adiam o arquivamento
create or replace function public.google_drive_touch(_bucket text, _path text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    return;
  end if;
  update public.drive_files set last_used_at = now()
   where bucket = _bucket and path = _path and status = 'uploaded';
end;
$$;

-- ── 4. has_role: visitante não testa se um id é admin (as policies rodam como authenticated)
revoke execute on function public.has_role(uuid, public.app_role) from anon, public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

-- ── 5. Cota: ação sem teto cadastrado passa a ter o padrão (30 por hora), em vez de
--       nenhum; assistente e briefing de vídeo ganham teto próprio.
create or replace function public.consume_rate_limit(_user_id uuid, _action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cfg     jsonb;
  _max     integer;
  _window  integer;
  _used    integer;
  _oldest  timestamptz;
begin
  select value -> _action into _cfg
    from public.app_settings
   where key = 'rate_limits';

  _max    := coalesce((_cfg ->> 'max')::integer, 30);
  _window := coalesce((_cfg ->> 'window_minutes')::integer, 60);

  select count(*)::integer, min(created_at)
    into _used, _oldest
    from public.usage_events
   where user_id = _user_id
     and action = _action
     and created_at > now() - make_interval(mins => _window);

  if _used >= _max then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (_oldest + make_interval(mins => _window)) - now()))::integer)
    );
  end if;

  insert into public.usage_events (user_id, action) values (_user_id, _action);
  return jsonb_build_object('allowed', true, 'remaining', _max - _used - 1);
end;
$$;
revoke all on function public.consume_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text) to service_role;

insert into public.app_settings (key, value)
values ('rate_limits', '{"assistant-chat": {"max": 60, "window_minutes": 60}, "video-brief": {"max": 30, "window_minutes": 60}}'::jsonb)
on conflict (key) do update
  set value = excluded.value || public.app_settings.value;

-- ============================================================================
-- FIM DO SEED — 145 statements (99 gerados pelo script + 46 dos blocos de 04/11 em diante)
--
-- Este rodapé é sentinela. Se o arquivo que você abriu NÃO termina aqui, ele
-- chegou TRUNCADO (já aconteceu num Remix real) — não adianta rodar o pedaço:
-- pegue a cópia íntegra do projeto template antes de continuar.

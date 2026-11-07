// _shared/types.ts — tipos canônicos compartilhados do motor editorial.
// Fontes: docs/07-contratos-backend.md §2 e §6; docs/04-modelo-de-dados.md §8.1-§8.8.
// Estes shapes são o contrato dos jsonb do banco (o banco não valida shape; o motor
// valida — structured outputs no LLM + validação nas edge functions). Espelhados no
// frontend nos hooks (src/hooks/use-generation-jobs.ts, use-content-pieces.ts).
//
// Módulo PURO: só tipos + constantes. Sem imports de runtime.

import type { AspectRatio } from './render-spec.ts';

/**
 * Versão do motor editorial (prompts + funil + auditoria). Carimbada em cada peça
 * gerada (content_pieces.engine_version) e usada na chave de cache de prompt —
 * bump invalida o prefixo cacheado (06-arquitetura-ia.md §7; 08-estrategia-template.md).
 */
export const ENGINE_VERSION = '0.1.0';

// ── Enums espelhados do banco ────────────────────────────────────────────────

/** Canais — valores idênticos ao enum channel_type do banco. */
export type ChannelType =
  | 'instagram_stories'
  | 'instagram_carousel'
  | 'instagram_post'
  | 'x_post'
  | 'threads_post'
  | 'linkedin_post'
  | 'facebook_post'
  | 'instagram_reel';

export const CHANNEL_TYPES: readonly ChannelType[] = [
  'instagram_stories',
  'instagram_carousel',
  'instagram_post',
  'x_post',
  'threads_post',
  'linkedin_post',
  'facebook_post',
  'instagram_reel',
] as const;

/** Estados do job — idênticos ao enum job_status do banco. */
export type JobStatus =
  | 'created' | 'classifying' | 'awaiting_angle' | 'retrieving' | 'researching'
  | 'generating' | 'linting' | 'grounding' | 'judging' | 'rewriting'
  | 'adapting' | 'awaiting_review' | 'done' | 'failed' | 'cancelled';

/** Tipos de item de contexto — valores idênticos ao enum context_kind do banco. */
export type ContextKind =
  | 'transcript' | 'post' | 'document' | 'reference' | 'case' | 'offer';

// ── Saída do Roteador (generation_jobs.classification) ───────────────────────

export type AngleOption = { id: string; title: string; hook: string; rationale?: string };

export type Classification = {
  format: string | null;           // null = ambíguo
  channel_types: ChannelType[];    // canais alvo inferidos ou pedidos
  thesis: string | null;           // tese da marca que a peça sustenta
  angles: AngleOption[];           // 3-4 opções quando needs_angle_choice
  context_query: string;           // query para o retrieval
  context_filters?: { kinds?: ContextKind[]; tags?: string[] };
  needs_angle_choice: boolean;     // ÚNICO gatilho do estado awaiting_angle
};

// ── Pesquisa web (generation_jobs.web_research) ──────────────────────────────
// Etapa `researching` da saga: busca informação fresca na internet sobre a pauta
// e materializa o resultado como context_item (kind 'reference', tag 'pesquisa-web')
// — assim o digest entra em context_ids e o grounding/proof/retomada funcionam
// sem caso especial. Este jsonb é o REGISTRO da etapa (UI/timeline), não a fonte.

export type WebSearchProvider = 'tavily' | 'firecrawl' | 'openai';

export type WebResearchSource = {
  url: string;
  title: string;
  snippet?: string;                // trecho literal retornado pelo provedor
  published?: string;              // data de publicação quando o provedor informa
};

export type WebResearch = {
  requested: boolean;              // o usuário pediu pesquisa web neste job
  provider?: WebSearchProvider;    // driver efetivamente usado
  query?: string;                  // query enviada ao provedor
  item_id?: string;                // context_item materializado com o digest
  sources?: WebResearchSource[];
  searched_at?: string;
  skipped?: 'unavailable' | 'error';  // pulada sem matar o job (degradação graciosa)
  error?: string;                  // detalhe quando skipped = 'error'
  /**
   * Provedores que falharam ANTES do que respondeu (modo 'auto' percorre a
   * ordem). Sem isto, uma instância cujo primeiro provedor está sem cota
   * degradava em silêncio e ninguém via por quê.
   */
  attempts?: { provider: WebSearchProvider; error: string }[];
};

// ── Núcleo gerado pelo Gerador (content_pieces.core_content) ─────────────────

export type CoreContent = {
  idea: string;
  hook: { visual: string; written: string; spoken?: string };
  funnel_blocks: { layer: number; name: string; content: string }[];  // camadas 1-8 do funil narrativo
  proof: { claim: string; context_item_id: string | null; source_url?: string };
  verify_flags: string[];          // pendências marcadas [VERIFICAR: ...]
  cta: string;
  image_brief: string | null;      // brief para imagem IA, quando o formato pedir
};
// O grounding exige proof.context_item_id ∈ generation_jobs.context_ids;
// se null, a claim numérica vira flag em verify_flags.

// ── Resultado de auditoria (content_pieces.audit) — chips na UI ──────────────

export type Audit = {
  linter: {                            // Classe 1 — determinístico, sem LLM
    passed: boolean;
    violations: { rule: string; match: string; position?: number; severity: 'error' | 'warn' }[];
  };
  grounding: {                         // Classe 2 — diff contra o contexto selecionado
    passed: boolean;
    checked: { claim: string; source_item_id: string | null; status: 'ok' | 'divergent' | 'missing' }[];
    flagged: { claim: string; reason: string; replaced_with?: string }[];
  };
  judge: {                             // Classe 3 — LLM-as-judge, CHAMADA SEPARADA
    verdict: 'approve' | 'rewrite';
    score: number;                 // 0-10, comparado ao cutoff_score do canal
    rules: { rule: 'novidade' | 'aplicabilidade' | 'proprietario' | 'narrativa'; passed: boolean; note?: string }[];
    voice_pass: boolean;
    bridge_logical: boolean;
    diagnosis: string[];           // alimenta a reescrita
  };
};

/**
 * Diagnóstico estruturado consolidado que o runner monta para o Gerador no loop
 * de reescrita (06-arquitetura-ia.md §4.4). Cada tentativa é função pura de novo:
 * mesmo envelope de altitude + este diagnóstico, nunca histórico de conversa.
 */
export type RewriteDiagnosis = {
  attempt: number;
  failures: Array<
    | { class: 'linter'; violations: Audit['linter']['violations'] }
    | { class: 'grounding'; flagged: Audit['grounding']['flagged'] }
    | { class: 'judge'; diagnosis: string[] }
  >;
};

// ── Saída dos adapters (content_pieces.adapted_content) ──────────────────────
// União discriminada por channel_type (07-contratos-backend.md §6; 04 §8.6).

/** Gráfico de barras do slide editorial — só com números que vieram do contexto. */
export type SlideChart = {
  label: string;                         // legenda em caixa alta: "vendas por ano, em R$ milhões"
  bars: { label: string; value: number }[];
  highlight?: number;                    // índice da barra em destaque (padrão: a última)
};

/** Botão do fecho do carrossel: por onde a pessoa age depois de ler. */
export type SlideCta = {
  kind: 'whatsapp' | 'direct' | 'site' | 'perfil';
  label: string;                         // "Chamar no WhatsApp", 2 a 4 palavras
};

export type TweetCardSlide = {
  index: number;                         // slides SEMPRE indexados (0-based)
  text: string;                          // texto principal do card
  /** Fecho do carrossel (último slide): a tese, o próximo passo e o botão. */
  role?: 'cta';
  cta?: SlideCta;
  /** Editorial: manchete curta do slide (a capa usa `paragraphs`). */
  title?: string;
  /** Editorial: parágrafos curtos; **negrito** marca o número ou a frase-chave. */
  paragraphs?: string[];
  /** Editorial: o apoio visual do slide — foto 16:9, gráfico ou só texto. */
  visual?: 'photo' | 'chart' | 'none';
  chart?: SlideChart;
  image_brief?: string;                  // brief da imagem IA do slide (gerado na direção de arte)
  image_path?: string;                   // foto IA do slide no bucket renders (generate-image scope 'slides')
  /**
   * Slide do MIOLO promovido a foto pelo usuário. A regra da casa é miolo em
   * fundo sólido — sem esta marca, carrosséis antigos (que têm foto em todos os
   * slides, de quando o lote gerava tudo) voltariam a exibi-las todas.
   * A capa não precisa da marca: ela sempre usa a foto.
   */
  photo_promoted?: boolean;
  /**
   * A imagem deste slide JÁ TRAZ a manchete tipografada (capa gerada como peça
   * de arte fechada). Só o servidor escreve, e só quando a imagem voltou de
   * verdade — quando true, o chassi para de desenhar texto por cima, senão
   * sairia manchete em dobro.
   *
   * O default false é o que segura peça antiga e recusa do modelo: sem a marca,
   * o chassi desenha como sempre desenhou e o slide nunca sai em branco.
   */
  cover_art_rendered?: boolean;
};

/**
 * Como a foto compõe com o card: 'background' = full-bleed atrás do texto
 * (fundo LIMPO de marca — atmosfera, espaço negativo, baixo detalhe);
 * 'inline' = bloco abaixo do texto (cena rica/detalhada aguenta).
 * A direção de arte e o prompt de imagem variam com este alvo.
 */
export type SlideImageComposition = 'background' | 'inline';

/**
 * Progresso do batch de fotos por slide (generate-image scope 'slides').
 * Gravado em adapted_content.slide_images_job e atualizado a cada imagem —
 * o frontend acompanha via Realtime (UPDATE em content_pieces).
 */
export type SlideImagesJob = {
  status: 'running' | 'done' | 'error';
  total: number;
  done: number;
  composition?: SlideImageComposition;   // alvo de composição do batch
  style_bible?: string;                  // direção de arte comum (consistência do carrossel)
  /** Direção da CAPA (sujeito nomeado + manchete tipografada NA imagem). */
  cover_art?: { subject: string; headline: string; art_direction: string };
  started_at: string;
  ended_at?: string;
  error?: string;
  failed_indexes?: number[];             // slides cuja imagem falhou (retry pontual)
};

/** Arte final exportada por slide (PNG do card no bucket renders). */
export type SlideRender = { index: number; path: string };

export type StoryFrame = {
  index: number;                         // frames SEMPRE indexados (0-based)
  role: 'gancho' | 'desenvolvimento' | 'cta';
  text: string;
  /** Editorial: manchete curta do frame (o gancho usa `paragraphs`). */
  title?: string;
  /** Editorial: parágrafos curtos; **negrito** marca o número ou a frase-chave. */
  paragraphs?: string[];
  /** Editorial: o apoio visual do frame — foto, gráfico ou só texto. */
  visual?: 'photo' | 'chart' | 'none';
  chart?: SlideChart;
  image_brief?: string;                  // brief da imagem IA do frame (direção de arte)
  image_path?: string;                   // foto IA do frame no bucket renders (scope 'slides')
  /** Frame que nasceu com foto pedida pelo editorial (`visual: 'photo'`). */
  photo_promoted?: boolean;
};

/** Beat do roteiro de Reel: a unidade EDITORIAL (auditada), distinta da cena de produção. */
export type ReelBeat = {
  index: number;
  role: 'gancho' | 'desenvolvimento' | 'cta';
  /** Texto que será FALADO — vira narração da cena e input do TTS. */
  narration: string;
  /** Sugestão de texto na tela. Armazenado; nada renderiza legenda no MVP. */
  on_screen_text?: string;
  /** Estimativa editorial (palavras/2,5). A duração-verdade vem do áudio do TTS. */
  duration_target_s: number;
};

export type AdaptedContent =
  | { channel_type: 'instagram_carousel'; slides: TweetCardSlide[]; caption: string;
      slide_images_job?: SlideImagesJob; slide_renders?: SlideRender[] }
  | { channel_type: 'instagram_post';     card: TweetCardSlide; caption: string;
      slide_images_job?: SlideImagesJob }
  | { channel_type: 'instagram_stories';  frames: StoryFrame[];
      slide_images_job?: SlideImagesJob; slide_renders?: SlideRender[] }
  | { channel_type: 'x_post';             text: string; thread?: string[]; caption?: string; image_brief?: string }
  | { channel_type: 'threads_post';       text: string; thread?: string[]; caption?: string; image_brief?: string }
  | { channel_type: 'linkedin_post';
      blocks: { hook: string; contexto: string; lista: string[]; insight: string; ponte: string; cta: string };
      text: string;                      // serialização final dos blocks
      image_brief?: string }
  | { channel_type: 'facebook_post';     text: string; image_brief?: string }
  | { channel_type: 'instagram_reel';
      script: {
        target_duration_s: number;
        beats: ReelBeat[];
        /** Gancho VISUAL do funil (camada 1) — direção de câmera da abertura.
         *  Não é fala: alimenta o visual da primeira cena, nunca o TTS. */
        visual_hook?: string;
      };
      caption: string;
      /** Ponteiro do mp4 montado — escrito pelo pipeline de vídeo, NUNCA pelo adapter. */
      video?: { path: string; duration_s: number; project_id: string;
                resolution: string; generated_at: string } };

// ── channels.config — overrides por instância ────────────────────────────────
// Defaults canônicos vivem no código do adapter (_shared/adapters/) e são
// espelhados no seed (04-modelo-de-dados.md §12.1); config só guarda overrides.

export type ChannelConfig = {
  aspect_ratio?: AspectRatio | AspectRatio[];
  slides?: { min: number; max: number };       // carrossel
  frames?: { min: number; max: number };       // stories
  slide_max_chars?: number;
  caption_max_chars?: number;
  text_max_chars?: number;
  thread_max_posts?: number;
  render_template?: 'tweet-card' | 'frames' | 'image-caption';
  structure?: string[];                        // linkedin: ordem dos blocos
  cutoff_score?: number;                       // override da nota de corte do juiz
  target_duration_s?: number;                  // reel: duração alvo do roteiro (soma dos beats)
  max_scenes?: number;                         // reel: teto de beats/cenas do roteiro
};

// ── brand_persona.content — contrato de voz (9 seções) (04 §8.1) ─────────────

export type PersonaContent = {
  // 1. identity — quem fala: nome, papel, posicionamento em 1 parágrafo
  identity: {
    name: string;
    role: string;            // ex.: "fundador e estrategista de M&A"
    positioning: string;     // parágrafo de posicionamento
    audience: string;        // para quem fala
  };

  // 2. credenciais[] — provas de autoridade, SEMPRE com fonte (regra dura de grounding)
  credenciais: Array<{
    claim: string;           // ex.: "R$ 120M transacionados em 2024"
    source: string;          // context_item id, URL ou descrição verificável
  }>;

  // 3. worldview — visão de mundo / teses que a voz defende
  worldview: {
    summary: string;
    theses: string[];        // alinhadas com brand_strategy.content.theses
  };

  // 4. tone_principles — princípios de tom (como soa)
  tone_principles: string[];

  // 5. signature_lexicon — vocabulário assinatura com DOSAGEM (máx 1-2 por peça)
  signature_lexicon: Array<{
    term: string;
    usage: string;           // quando/como usar
    max_per_piece: number;   // default 1; teto global 2
  }>;

  // 6. calibration_heuristics — heurísticas de ajuste fino
  calibration_heuristics: string[];

  // banlist — REFERÊNCIA à fonte única (guardrails ativa); sem conteúdo próprio
  banlist: { ref: 'guardrails' };

  // 7. opinioes — posições explícitas (combustível da análise proprietária)
  opinioes: Array<{
    topic: string;
    stance: string;          // a opinião, em uma frase citável
  }>;

  // 8. voice_checklist — checklist final de conformidade de voz (usado pelo juiz)
  voice_checklist: string[];

  // 9. reference_examples — exemplos calibradores (bom vs ruim)
  reference_examples: {
    good: Array<{ text: string; why: string }>;
    bad: Array<{ text: string; why: string }>;
  };
};

// ── brand_strategy.content — bandeira (04 §8.2) ──────────────────────────────

export type StrategyContent = {
  brand_promise: string;         // a promessa central da marca
  theses: string[];              // teses/bandeiras que o conteúdo defende
  enemy: string;                 // o "inimigo" narrativo (status quo combatido)
  safe_list: string[];           // territórios seguros de assunto
  icp: {
    perfil: string;              // quem é o cliente ideal
    desejos: string[];           // o que ele quer
  };
  editorial_stance: string;      // postura editorial
  content_mix: Record<string, number>;  // proporção por tipo de conteúdo
  cta_repertoire: string[];      // repertório de CTAs da marca (subconjunto de allowed_ctas)
};

// ── guardrails.content — fonte única de regras duras (04 §8.3) ───────────────

export type GuardrailsContent = {
  banned_punctuation: string[];        // ex.: ["—", "!!", "..."]
  banned_words: string[];
  banned_metaphors: string[];
  banned_ctas: string[];
  allowed_ctas: string[];
  channel_scope_overrides: Partial<Record<ChannelType, {
    banned_words?: string[];           // regras adicionais por canal (aditivas)
    allowed_ctas?: string[];
  }>>;
  qa_rubric: {                         // pesos/instruções extras para o juiz
    [rule: string]: string;
  };
  approval_threshold: {                // nota de corte por canal (juiz)
    default: number;                   // escala 0-10
    per_channel?: Partial<Record<ChannelType, number>>;
  };
  dosage_rules: {
    signature_lexicon_max_per_piece: number;   // teto global (default 2)
    emoji_max?: number;
    hashtag_policy?: 'none' | 'metadata_only';
  };
};

// ── brand_kit.content — identidade visual (04 §8.4) ──────────────────────────

export type BrandKitContent = {
  palette: Record<string, string>;   // tokens de cor, ex.: { primary: "#0B1B2B" }
  typography: {
    heading: string;                 // família/peso para títulos
    body: string;
  };
  logo_path: string | null;          // ref no bucket brand-assets
  negative_constraints: string[];    // o que NUNCA fazer visualmente
  photo_paths: string[];             // fotos da marca/pessoa (bucket brand-assets)
};

// ── context_items.metadata para kind = 'case' (04 §8.5) ──────────────────────

export type CaseMetadata = {
  metric_type: 'brl' | 'multiple' | 'percent'; // ranking de força: R$ > multiplicador > %
  metric_value: number;                        // ex.: 1200000 (brl) | 3.2 (multiple) | 47 (percent)
  client_name: string | null;
  sector: string;
  source_url: string | null;
  quote: string | null;                        // citação literal do cliente
  objection_tags: string[];                    // objeções que o case responde
  citation_policy: 'named' | 'anonymous';      // pode citar o nome ou não
};

// ── generation_jobs.timings — telemetria por etapa (04 §8.7; 06 §9) ──────────

export type StageTiming = {
  started_at: string;
  ended_at: string;
  ms: number;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd_est?: number;
  attempts?: number;
};

export type Timings = Partial<Record<
  'classifying' | 'retrieving' | 'researching' | 'generating' | 'linting' | 'grounding'
  | 'judging' | 'rewriting' | 'adapting',
  StageTiming
>> & {
  totals?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd_est: number;
    attempts: number;
    wall_ms: number;
  };
};

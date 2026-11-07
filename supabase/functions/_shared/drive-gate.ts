// _shared/drive-gate.ts — sem Google Drive conectado, ninguém gera material novo.
//
// Regra do dono do produto. Quem decide é o banco (google_drive_required): o bloqueio
// só liga quando GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET existem no Vault, e conexão
// caída conta como desconectada. O insert direto do front em director_jobs é barrado
// por trigger, com a mesma função.
//
// Fica livre o que não cria mídia: ver, baixar, publicar e terminar job em andamento.
// O teste drive-gate_test.ts lê as functions: ação nova sem classificar reprova.
//
// Se o SQL ainda não foi aplicado, a RPC não existe e nada bloqueia. Falhar aberto é
// de propósito: trava de produto não pode parar a produção por erro de infraestrutura.

import { errorResponse } from './cors.ts';

export const DRIVE_REQUIRED = 'drive_required';
export const DRIVE_REQUIRED_MESSAGE = 'Conecte o Google Drive para gerar. Seus materiais ficam lá.';

/** `*` = a function inteira. Lista = só estas ações. */
export const GATED_ENTRY_POINTS = {
  'generate-content': '*',
  'regenerate-piece': '*',
  'generate-image': '*',
  'video-brief': '*',
  'generate-video': ['create_storyboard', 'start_production', 'regenerate_scene'],
  'video-remake': ['upload_url', 'scene_edit'],
  'video-edit': ['suggest', 'plan', 'upload_url', 'external_open', 'external_apply', 'external_render', 'apply'],
  'avatar-studio': [
    'create', 'generate_identity', 'bootstrap_from_photo', 'preview_voice', 'heygen_photo_avatar', 'heygen_twin',
    'heygen_prompt_avatar', 'heygen_new_look', 'heygen_voice_preview', 'voice_upload_url', 'voice_clone', 'voice_design',
    'voice_design_save', 'voice_library_add', 'voice_import',
  ],
  'mcp-server': [
    'gerar_conteudo', 'carrossel_criar', 'carrossel_fotos', 'fotos_gerar', 'arte_enviar', 'video_abrir', 'video_anexar', 'video_aplicar', 'video_refazer', 'video_render',
    'video_criar', 'video_melhorar', 'avatar_criar', 'voz_criar', 'imagem_gerar',
  ],
} as const satisfies Record<string, '*' | readonly string[]>;

export type GatedFunction = keyof typeof GATED_ENTRY_POINTS;

/** Ações que seguem sem Drive, com o motivo. O teste exige que toda ação esteja num dos dois lados. */
export const FREE_ACTIONS: Record<string, readonly string[]> = {
  'generate-video': ['setup', 'validate_catalog', 'update_scene', 'reorder_scenes', 'estimate', 'approve_keyframes', 'assemble', 'cancel'],
  'video-remake': ['voice_check', 'voice_lookup', 'scene_edit_options', 'scene_undo'],
  'video-edit': ['external_budget', 'external_deliver', 'status', 'revert', 'probe', 'tick'],
  'avatar-studio': [
    'list_voices', 'update', 'set_default', 'archive', 'migrate_identities', 'heygen_looks', 'heygen_voices', 'heygen_group_voice',
    'heygen_consent_link', 'heygen_status', 'heygen_brand_kit', 'heygen_look_templates', 'heygen_delete', 'voice_options',
    'voice_library', 'voice_status', 'voice_set_default', 'voice_delete',
  ],
  'mcp-server': [
    'video_listar', 'conteudo_pedidos', 'artes_pendentes', 'video_pedidos', 'video_ver', 'video_entregar', 'marca_ler', 'acervo_buscar', 'pecas_listar', 'carrossel_ver', 'acervo_adicionar',
    'o_que_posso_fazer', 'video_andamento', 'avatar_biblioteca', 'avatar_estado', 'voz_biblioteca',
    // pedidos ao Claude da pessoa: texto, andamento e conversa; nada aqui cria mídia
    'roteiro_pedidos', 'roteiro_andamento', 'roteiro_mensagem', 'roteiro_entregar',
    'slide_pedidos', 'slide_entregar', 'video_mensagem', 'montagem_pedidos', 'montagem_entregar',
  ],
};

/** Fora da trava de propósito, para constar: nenhuma delas guarda mídia nova. */
export const EXEMPT_FUNCTIONS: Record<string, string> = {
  'delete-content': 'exclui, não gera mídia',
  'edit-slide': 'Muda texto de peça que já existe; foto nova passa por generate-image.',
  'resume-job': 'Continua job que já existe.',
  'director-advance': 'Motor de jobs em andamento.',
  'director-plan': 'Plano de um job que já existe.',
  'director-publish': 'Publicação.',
  'zernio-proxy': 'Publicação.',
  'tone-gate': 'Amostras de texto da calibragem da marca, no onboarding.',
  'brand-autopilot': 'Monta a marca no onboarding; só texto.',
  'prompt-assist': 'Melhora o texto do pedido.',
  'assistant-chat': 'Só leitura.',
  'brand-kit-suggest': 'Sugere texto e cor da marca.',
  'extract-voice': 'Extrai a voz da marca em texto.',
  'competitor-sync': 'Lê posts públicos de concorrentes.',
  'ingest-context': 'Material que a pessoa enviou ao Acervo; não é geração.',
  'search-context': 'Busca.',
  'fetch-rss': 'Lê fontes do Radar.',
  'invite-user': 'Conta de usuário.',
  'roteiro-pedido': 'Pedido de texto ao Claude da pessoa; quem gera mídia depois passa pela trava.',
  'metrics-sync': 'Métricas.',
  'provider-credits': 'Saldo dos provedores.',
  'store-secret': 'Grava as chaves, inclusive as do Google.',
  'replicate-webhook': 'Termina produção em andamento.',
  'video-reconcile': 'Termina produção em andamento.',
  'zernio-webhook': 'Publicação.',
  'higgsfield-oauth': 'Conexão.',
  'google-drive': 'É a saída da trava.',
  'drive-hub': 'Conector central da saída da trava.',
};

/** Automáticos: pulam em silêncio em vez de devolver erro. Ver automation-tick e sweepAuto. */
export const GATED_AUTOMATIONS = ['automation-tick', 'video-edit:sweepAuto'] as const;

/** Inserts que o trigger director_jobs_require_drive barra, venham de onde vierem. */
export const GATED_BY_TRIGGER = ['director_jobs'] as const;

/** Toda function do repositório tem de estar num destes lados; o teste confere. */
export const COVERED_FUNCTIONS = [
  ...Object.keys(GATED_ENTRY_POINTS),
  ...Object.keys(EXEMPT_FUNCTIONS),
  'automation-tick',
];

export function gatedAction(fn: GatedFunction, action?: string | null): boolean {
  const rule: '*' | readonly string[] = GATED_ENTRY_POINTS[fn];
  return rule === '*' || (rule as readonly string[]).includes(action ?? '');
}

type GateClient = {
  rpc(name: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** true só quando o banco confirma que falta o Drive. Erro de consulta não bloqueia. */
export async function driveRequired(service: unknown): Promise<boolean> {
  try {
    const { data, error } = await (service as GateClient).rpc('google_drive_required');
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Resposta 412 para devolver antes de qualquer custo; null quando pode seguir. */
export async function requireDrive(service: unknown, fn: GatedFunction, action?: string | null): Promise<Response | null> {
  if (!gatedAction(fn, action)) return null;
  if (!(await driveRequired(service))) return null;
  return errorResponse(412, DRIVE_REQUIRED, DRIVE_REQUIRED_MESSAGE, { integration: 'google_drive' });
}

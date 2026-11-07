// _shared/assistant-tools.ts — ferramentas de LEITURA compartilhadas entre o
// assistente do app (assistant-chat) e o conector MCP (mcp-server).
//
// Tudo aqui é somente leitura. O cliente passado decide o alcance: o
// assistente usa o client DO USUÁRIO (RLS vale), o MCP usa service role.
// Nenhuma ferramenta aprova, agenda ou publica — isso continua na interface.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { hybridSearch } from './retrieval.ts';

export type Client = SupabaseClient;

// ── marca_ler ────────────────────────────────────────────────────────────────

// as regras (guardrails) vivem na tabela `guardrails`; sem ela o Claude escrevia sem as proibições da marca
const BRAND_TABLES = ['brand_persona', 'brand_strategy', 'guardrails', 'brand_kit'] as const;

/** Versão ativa de cada área da marca (persona, bandeira, regras, identidade visual). */
export async function lerMarca(client: Client): Promise<Record<string, unknown>> {
  const partes: Record<string, unknown> = {};
  for (const tabela of BRAND_TABLES) {
    const { data } = await client
      .from(tabela)
      .select('content, version')
      .eq('status', 'active')
      .maybeSingle();
    if (data) partes[tabela] = data;
  }
  return partes;
}

// ── acervo_buscar ────────────────────────────────────────────────────────────

export interface AchadoAcervo {
  id: string;
  titulo: string;
  tipo: string;
  trecho: string;
}

/** Busca híbrida no Contexto da marca (a mesma retrieval da geração). */
export async function buscarAcervo(consulta: string, limite = 8): Promise<AchadoAcervo[]> {
  const q = consulta.trim();
  if (!q) return [];
  const n = Math.min(Math.max(Number(limite) || 8, 1), 20);
  const achados = await hybridSearch(q, undefined, n, { excludeTags: ['pesquisa-web'] });
  return achados.map((a) => ({
    id: a.item_id,
    titulo: a.title,
    tipo: a.kind,
    trecho: a.content.slice(0, 900),
  }));
}

// ── pecas_listar ─────────────────────────────────────────────────────────────

export const PIECE_STATUSES = ['draft', 'approved', 'published', 'rejected', 'archived'] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

export interface PecaResumo {
  id: string;
  canal: string;
  status: string;
  criada_em: string;
  agendada_para: string | null;
  ideia: string | null;
}

export async function listarPecas(
  client: Client,
  opts: { status?: string; limite?: number } = {},
): Promise<PecaResumo[]> {
  const status = (PIECE_STATUSES as readonly string[]).includes(String(opts.status))
    ? (opts.status as PieceStatus)
    : 'draft';
  const limite = Math.min(Math.max(Number(opts.limite) || 10, 1), 50);
  const { data } = await client
    .from('content_pieces')
    .select('id, channel_type, status, created_at, scheduled_at, core_content')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limite);
  const pecas = (data ?? []) as Array<{
    id: string;
    channel_type: string;
    status: string;
    created_at: string;
    scheduled_at: string | null;
    core_content: { hook?: { written?: string }; idea?: string } | null;
  }>;
  return pecas.map((p) => ({
    id: p.id,
    canal: p.channel_type,
    status: p.status,
    criada_em: p.created_at,
    agendada_para: p.scheduled_at,
    ideia: p.core_content?.hook?.written ?? p.core_content?.idea ?? null,
  }));
}

// ── estado_conta ─────────────────────────────────────────────────────────────

/** Nomes que `store-secret status` consulta — a mesma lista, só para leitura de presença. */
const SECRET_NAMES = [
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
  'FIRECRAWL_API_KEY',
  'ZERNIO_API_KEY',
  'REPLICATE_API_TOKEN',
  'ELEVEN_API_KEY',
] as const;

/** Nome visível de cada integração, como aparece em Config → Integrações. */
const INTEGRACAO_POR_SEGREDO: Record<(typeof SECRET_NAMES)[number], string> = {
  OPENAI_API_KEY: 'OpenAI',
  TAVILY_API_KEY: 'Tavily',
  FIRECRAWL_API_KEY: 'Firecrawl',
  ZERNIO_API_KEY: 'Zernio',
  REPLICATE_API_TOKEN: 'Replicate',
  ELEVEN_API_KEY: 'ElevenLabs',
};

export interface EstadoConta {
  onboarding: {
    concluido: boolean;
    minimo_viavel: boolean;
    passo_atual: number | null;
    passos_concluidos: number[];
    nome_da_marca: string | null;
  } | null;
  marca: Record<'persona' | 'bandeira' | 'regras' | 'identidade_visual', boolean>;
  contexto_itens: number;
  pecas_em_revisao: number;
  pecas_aprovadas_sem_data: number;
  pecas_agendadas: number;
  geracoes_com_falha: Array<{ id: string; criada_em: string; erro: string | null }>;
  geracoes_em_andamento: number;
  canais_ligados: string[];
  integracoes_configuradas: string[];
  automacao: Record<string, unknown> | null;
}

// Builder do PostgREST sem o tipo exato: o client aqui é genérico (sem Database)
// e o encadeamento de filtros muda por chamada.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente do Supabase sem tipos gerados no Deno
type Filtro = (q: any) => PromiseLike<{ count: number | null }>;

async function contar(client: Client, tabela: string, filtro: Filtro): Promise<number> {
  const base = client.from(tabela).select('id', { count: 'exact', head: true });
  const { count } = await filtro(base);
  return count ?? 0;
}

/**
 * Fotografia da conta para o assistente orientar o próximo passo.
 * `user` = client do usuário (RLS). `service` = só para a presença de segredos
 * no Vault (nomes, nunca valores) — o schema vault não é exposto ao usuário.
 */
export async function estadoConta(user: Client, service: Client): Promise<EstadoConta> {
  const { data: settings } = await user
    .from('app_settings')
    .select('key, value')
    .in('key', ['onboarding', 'brand_autopilot']);
  const porChave = new Map((settings ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value]));

  const onb = porChave.get('onboarding') as Record<string, unknown> | undefined;
  const onboarding = onb
    ? {
        concluido: onb.completed === true,
        minimo_viavel: onb.minimum_viable === true,
        passo_atual: typeof onb.current_step === 'number' ? onb.current_step : null,
        passos_concluidos: Array.isArray(onb.completed_steps)
          ? (onb.completed_steps as unknown[]).filter((n): n is number => typeof n === 'number')
          : [],
        nome_da_marca: typeof onb.brand_name === 'string' ? onb.brand_name : null,
      }
    : null;

  const marca = await lerMarca(user);

  const [emRevisao, aprovadasSemData, agendadas, itens, emAndamento] = await Promise.all([
    contar(user, 'content_pieces', (q) => q.eq('status', 'draft')),
    contar(user, 'content_pieces', (q) => q.eq('status', 'approved').is('scheduled_at', null)),
    contar(user, 'content_pieces', (q) => q.eq('status', 'approved').not('scheduled_at', 'is', null)),
    contar(user, 'context_items', (q) => q.eq('status', 'ready')),
    contar(user, 'generation_jobs', (q) =>
      q.not('status', 'in', '(done,failed,cancelled,awaiting_review)'),
    ),
  ]);

  const { data: falhas } = await user
    .from('generation_jobs')
    .select('id, created_at, error')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: canais } = await user.from('channels').select('type').eq('enabled', true);

  const integracoes: string[] = [];
  for (const name of SECRET_NAMES) {
    const { data, error } = await service.rpc('get_vault_secret', { _name: name });
    if (!error && typeof data === 'string' && data.length > 0) {
      integracoes.push(INTEGRACAO_POR_SEGREDO[name]);
    }
  }

  return {
    onboarding,
    marca: {
      persona: 'brand_persona' in marca,
      bandeira: 'brand_strategy' in marca,
      regras: 'guardrails' in marca,
      identidade_visual: 'brand_kit' in marca,
    },
    contexto_itens: itens,
    pecas_em_revisao: emRevisao,
    pecas_aprovadas_sem_data: aprovadasSemData,
    pecas_agendadas: agendadas,
    geracoes_com_falha: ((falhas ?? []) as Array<{ id: string; created_at: string; error: string | null }>).map(
      (f) => ({ id: f.id, criada_em: f.created_at, erro: f.error ? f.error.slice(0, 300) : null }),
    ),
    geracoes_em_andamento: emAndamento,
    canais_ligados: ((canais ?? []) as Array<{ type: string }>).map((c) => c.type),
    integracoes_configuradas: integracoes,
    automacao: (porChave.get('brand_autopilot') as Record<string, unknown> | undefined) ?? null,
  };
}

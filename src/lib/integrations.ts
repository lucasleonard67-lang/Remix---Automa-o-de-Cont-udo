// Catálogo das integrações: o que cada serviço faz pelo usuário, quando ele vai
// precisar dele e o que é pedido para conectar. É a fonte única da grade de
// integrações (onboarding, Ajustes → IA e Ajustes → Integrações): texto e campos
// moram aqui, a tela só desenha.

import type { BrandName } from "@/lib/brands";
import type { StorableSecretName } from "@/hooks/use-app-settings";

export type IntegrationId =
  | "lovable"
  | "openai"
  | "xai"
  | "tavily"
  | "firecrawl"
  | "zernio"
  | "higgsfield"
  | "google_drive"
  | "claude_routine"
  | "elevenlabs"
  | "replicate"
  | "heygen"
  | "claude_editor"
  | "render_worker"
  | "apify";

export interface IntegrationField {
  name: StorableSecretName;
  label: string;
  placeholder: string;
  /** Mascarado na tela e nunca lido de volta. */
  secret: boolean;
  /** Pode ficar em branco (ex.: ID da voz). */
  optional?: boolean;
  help?: string;
}

export interface Integration {
  id: IntegrationId;
  brand: BrandName;
  name: string;
  /** Uma linha: o que o usuário ganha com ele. */
  purpose: string;
  /** Quando ele vai precisar — aparece no modal. */
  when: string;
  /** builtin = já vem ligado · key = cola a chave · oauth = autoriza no site · drive = Google Drive. */
  kind: "builtin" | "key" | "oauth" | "drive";
  fields?: IntegrationField[];
  /** Onde pegar a chave. */
  keyUrl?: string;
  /** Aviso ou próximo passo depois de conectar. */
  note?: string;
  /** Só fica pronto quando estes também estão ligados. */
  requires?: IntegrationId[];
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "lovable",
    brand: "lovable",
    name: "Lovable AI",
    purpose: "Gera texto e imagem sem configurar nada.",
    when: "Já está ligado. Custa até 8× mais do que usar a sua própria chave de IA; para pagar menos, conecte OpenAI ou Grok. O Claude trabalha pelo conector, com a sua assinatura.",
    kind: "builtin",
  },
  {
    id: "claude_routine",
    brand: "anthropic",
    name: "Claude · assinatura",
    purpose:
      "Atende os pedidos do produto pela sua assinatura: roteiro, conversa, slides, carrossel, arte e montagem de vídeo.",
    when: "Sem isto, os pedidos ficam esperando. Ligue uma vez: cada pedido e cada resposta sua chamam o seu Claude na hora.",
    kind: "key",
    fields: [
      {
        name: "CLAUDE_ROUTINE_URL",
        label: "Endereço da rotina",
        placeholder: "https://api.anthropic.com/v1/claude_code/routines/…/fire",
        secret: false,
      },
      {
        name: "CLAUDE_ROUTINE_TOKEN",
        label: "Token da rotina",
        placeholder: "sk-ant-oat01-…",
        secret: true,
      },
    ],
    keyUrl: "https://claude.ai/code/routines",
    note:
      "Em claude.ai › Code › Routines, abra a rotina (ou crie uma com o conector content-engine e o texto “atenda os pedidos abertos”) › Edit › na linha Trigger clique em + › API. " +
      "Copie o Fire URL para o endereço e clique em Generate token para o token: ele aparece uma vez só.",
  },
  {
    id: "openai",
    brand: "openai",
    name: "OpenAI",
    purpose: "Alternativa para texto, imagem e pesquisa web.",
    when: "Quando preferir o GPT ou quiser gerar imagens com a sua conta.",
    kind: "key",
    fields: [{ name: "OPENAI_API_KEY", label: "Chave de API", placeholder: "sk-…", secret: true }],
    keyUrl: "https://platform.openai.com/api-keys",
    note: "Depois, escolha “OpenAI” em Ajustes → IA para as etapas que quiser.",
  },
  {
    id: "xai",
    brand: "xai",
    name: "Grok (xAI)",
    purpose: "Sua chave da xAI para gerar e avaliar textos com o Grok.",
    when: "Quando preferir o Grok. Só texto: embeddings e imagens ficam com outro provedor.",
    kind: "key",
    fields: [{ name: "XAI_API_KEY", label: "Chave de API", placeholder: "xai-…", secret: true }],
    keyUrl: "https://console.x.ai",
    note: "Depois, escolha “Grok (xAI)” em Ajustes → IA para as etapas que quiser.",
  },
  {
    id: "tavily",
    brand: "tavily",
    name: "Tavily",
    purpose: "Pesquisa na web antes de gerar a peça.",
    when: "Quando marcar “pesquisar na web” ao criar uma peça.",
    kind: "key",
    fields: [
      { name: "TAVILY_API_KEY", label: "Chave de API", placeholder: "tvly-…", secret: true },
    ],
    keyUrl: "https://app.tavily.com/home",
  },
  {
    id: "firecrawl",
    brand: "firecrawl",
    name: "Firecrawl",
    purpose: "Pesquisa na web lendo a página inteira.",
    when: "Quando quiser mais material de cada fonte na pesquisa web.",
    kind: "key",
    fields: [
      { name: "FIRECRAWL_API_KEY", label: "Chave de API", placeholder: "fc-…", secret: true },
    ],
    keyUrl: "https://www.firecrawl.dev/app/api-keys",
  },
  {
    id: "apify",
    brand: "apify",
    name: "Apify",
    purpose: "Opcional. Lê os perfis dos concorrentes no Instagram, com métricas.",
    when: "Quando quiser comparar seus resultados com o mercado. Gasta créditos da sua conta Apify.",
    kind: "key",
    fields: [
      { name: "APIFY_TOKEN", label: "Token de API", placeholder: "apify_api_…", secret: true },
    ],
    keyUrl: "https://console.apify.com/account/integrations",
    note: "Depois, no Dashboard → Mercado, adicione os concorrentes.",
  },
  {
    id: "zernio",
    brand: "zernio",
    name: "Zernio",
    purpose: "Publica e agenda as peças nas redes.",
    when: "Quando quiser publicar direto da Biblioteca. Sem ele, as peças ficam prontas aqui para você copiar.",
    kind: "key",
    fields: [{ name: "ZERNIO_API_KEY", label: "Chave de API", placeholder: "sk_…", secret: true }],
    keyUrl: "https://zernio.com",
    note: "Depois, conecte suas contas (Instagram, TikTok…) em Ajustes → Integrações.",
  },
  {
    id: "google_drive",
    brand: "google_drive",
    name: "Google Drive",
    purpose: "Guarda seus materiais no seu Drive.",
    when: "Seus vídeos e imagens ficam no seu Drive. Ainda não disponível: entra quando o hub tiver as chaves do Google.",
    kind: "drive",
    keyUrl: "https://console.cloud.google.com/apis/credentials",
    fields: [
      {
        name: "GOOGLE_CLIENT_ID",
        label: "ID do cliente",
        placeholder: "….apps.googleusercontent.com",
        secret: false,
      },
      {
        name: "GOOGLE_CLIENT_SECRET",
        label: "Chave secreta do cliente",
        placeholder: "Cole a chave secreta",
        secret: true,
      },
    ],
  },
  {
    id: "higgsfield",
    brand: "higgsfield",
    name: "Higgsfield",
    purpose: "Modelos de vídeo do Higgsfield.",
    // a chave ainda não gera: o vídeo de cenas usa o Replicate e o Claude (fase 2 no AGENTS.md)
    when: "A geração pela chave está chegando. Enquanto isso, o vídeo de cenas usa o Replicate e o seu Claude.",
    // chave igual às outras integrações (o login do Higgsfield recusa *.lovable.app)
    kind: "key",
    fields: [
      {
        name: "HIGGSFIELD_API_KEY",
        label: "Chave da API",
        placeholder: "id:segredo",
        secret: true,
        help: "No Higgsfield, em API Keys. Cole o ID e o segredo juntos, separados por dois-pontos.",
      },
    ],
    keyUrl: "https://console.higgsfield.ai",
  },
  {
    id: "elevenlabs",
    brand: "elevenlabs",
    name: "ElevenLabs",
    purpose: "Narração em voz para os vídeos.",
    when: "Quando o vídeo tiver fala. Sem ele, os Reels saem sem narração.",
    kind: "key",
    fields: [
      {
        name: "ELEVEN_API_KEY",
        label: "Chave de API",
        placeholder: "sk_…",
        secret: true,
        help: "No painel da ElevenLabs, em Perfil → API Keys.",
      },
      {
        name: "ELEVEN_VOICE_ID",
        label: "ID da voz",
        placeholder: "yxcG28bYeAMra6K4nj10",
        secret: false,
        optional: true,
        help: "Voz clonada ou da biblioteca. Em branco, usa uma voz padrão em português.",
      },
    ],
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  {
    id: "heygen",
    brand: "heygen",
    name: "HeyGen",
    purpose: "Troca a fala e traduz vídeos com a boca sincronizada.",
    when: "Quando for melhorar um vídeo com fala nova ou tradução. Gasta créditos da sua conta HeyGen.",
    kind: "key",
    fields: [
      {
        name: "HEYGEN_API_KEY",
        label: "Chave de API",
        placeholder: "Cole a chave da HeyGen",
        secret: true,
        help: "No painel da HeyGen, em API Keys.",
      },
    ],
    keyUrl: "https://platform.heygen.com/api-keys",
  },
  {
    id: "replicate",
    brand: "replicate",
    name: "Replicate",
    purpose: "Outros modelos de vídeo e imagem.",
    when: "Quando quiser gerar com modelos alternativos. Gasta créditos da sua conta Replicate.",
    kind: "key",
    fields: [
      { name: "REPLICATE_API_TOKEN", label: "Token de API", placeholder: "r8_…", secret: true },
    ],
    keyUrl: "https://replicate.com/account/api-tokens",
    note: "Depois, em Ajustes → Integrações: configure o webhook e verifique os modelos.",
  },
  {
    id: "claude_editor",
    brand: "anthropic",
    name: "Claude · editor de vídeo",
    purpose:
      "Edita e monta os vídeos pelo seu Claude: cortes, legenda, tela dividida, títulos e som.",
    when: "Pela rotina do Claude ligada em “Claude · assinatura”. O pedido fica na fila até ela atender; sem precisar de outro serviço.",
    kind: "builtin",
  },
  {
    id: "render_worker",
    brand: "modal",
    name: "Render de vídeo",
    purpose: "Coloca títulos, cards, tela dividida e música no vídeo.",
    when: "Quando pedir efeitos de motion no “Editar com Claude”. O serviço roda na sua conta da Modal.",
    kind: "key",
    fields: [
      {
        name: "RENDER_WORKER_URL",
        label: "Endereço do worker",
        placeholder: "https://….modal.run",
        secret: false,
      },
      {
        name: "RENDER_WORKER_TOKEN",
        label: "Token",
        placeholder: "Token ID.Token Secret",
        secret: true,
      },
    ],
    keyUrl: "https://modal.com/settings",
  },
];

export const INTEGRATION_BY_ID: Record<IntegrationId, Integration> = Object.fromEntries(
  INTEGRATIONS.map((item) => [item.id, item]),
) as Record<IntegrationId, Integration>;

// "claude_routine" (endereço + token) fica fora da tela: o Claude da assinatura
// entra pelo conector "Conectar ao Claude", no fim de Integrações.
export const AI_INTEGRATION_IDS: IntegrationId[] = [
  "lovable",
  "openai",
  "xai",
  "tavily",
  "firecrawl",
];

/**
 * Motor de edição publicado? Falso esconde o card "Claude · editor de vídeo".
 * Para religar: publique a edge `video-edit` com os SQLs `video-edits.sql` e
 * `video-edit-setting.sql` e troque para true. A faixa "Aprimorar com IA" volta
 * sozinha com a tabela.
 */
export const VIDEO_EDIT_LIVE = true;

/**
 * Algo já dispara a edição automática? Falso esconde "Claude edita antes de
 * entregar": a chave grava, mas nada a lê até alguém chamar `tick` da edge
 * `video-edit` por agendamento (docs/hub-motor-contratos.md §11.7).
 */
export const VIDEO_EDIT_AUTO_LIVE = false;

/** Grupos na ordem em que aparecem (onboarding e Ajustes → Integrações). */
export const INTEGRATION_GROUPS: { title: string; ids: IntegrationId[] }[] = [
  { title: "Inteligência", ids: [...AI_INTEGRATION_IDS, "apify"] },
  {
    title: "Vídeo e voz",
    ids: [
      "higgsfield",
      "elevenlabs",
      "replicate",
      "heygen",
      ...(VIDEO_EDIT_LIVE ? (["claude_editor"] as const) : []),
    ],
  },
  { title: "Publicação", ids: ["zernio"] },
];

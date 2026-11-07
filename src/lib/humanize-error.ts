// Tradutor de erro para a tela. Mensagens chegam de três lugares — envelope
// das edge functions, erros do Supabase (Auth/PostgREST, em inglês) e o campo
// `error` gravado em jobs/cenas/publicações — e várias vazam jargão interno,
// erro de rede do runtime ou JSON de provedor. Aqui elas viram português com o
// próximo passo. Mensagens que já estão boas passam intactas (só os termos
// internos são trocados).
//
// PADRÃO DE TODA MENSAGEM DE ERRO DO APP (heurística 9 de Nielsen):
//   1. o que aconteceu, em português simples, do ponto de vista de quem usa;
//   2. o que fazer agora (conferir o endereço, tentar de novo, chamar o admin);
//   3. nunca código, URL de API, stack, JSON ou inglês.
// Toda mensagem de erro que vai para a tela passa por humanizeError — toast
// (o `toast.error` do app já faz isso), texto inline, alerta ou erro gravado.

const GENERIC =
  "Algo falhou do nosso lado. Tente de novo em instantes; se continuar, avise o administrador.";

/** Por código do envelope `{ error: { code } }` — vale mais que o texto quando o texto é técnico. */
const BY_CODE: Record<string, string> = {
  unauthorized: "Sua sessão expirou. Entre de novo para continuar.",
  forbidden: "Só administradores podem fazer isso. Peça a um administrador da conta.",
  internal_error: GENERIC,
  internal: GENERIC,
  drive_required: "Conecte o Google Drive para gerar. Seus materiais ficam lá.",
  brand_reading:
    "A marca ainda está sendo lida. Espere a leitura terminar para criar peças com a voz nova.",
  zernio_not_configured:
    "O Zernio ainda não está conectado. Salve a chave de API em Ajustes → Integrações.",
  replicate_not_configured:
    "O Replicate ainda não está conectado. Um administrador precisa salvar o token em Ajustes → Integrações.",
};

/** Sem crédito o produto para e avisa: a mesma frase para todo provedor. */
const semCredito = (onde: string) =>
  `Falhou por falta de créditos ${onde}. Para retomar, coloque créditos na conta.`;

/** Erros em inglês do Supabase Auth/PostgREST e de rede. */
const BY_PATTERN: [RegExp, string][] = [
  [/drive_required/, "Conecte o Google Drive para gerar. Seus materiais ficam lá."],
  // antes de todos: "MCP generate_image: out of credits" também casa com erro do Higgsfield
  [/out of credits|higgsfield.*sem cr[ée]ditos/i, semCredito("no Higgsfield")],
  [/replicate.*sem cr[ée]dito/i, semCredito("no Replicate")],
  [/heygen.*sem cr[ée]ditos/i, semCredito("no HeyGen")],
  [/elevenlabs.*cr[ée]ditos.*acabaram/i, semCredito("no ElevenLabs")],
  [
    /insufficient (credits|balance|funds)|payment required|not enough credits|quota exceeded/i,
    semCredito("nesse serviço"),
  ],
  // produção de vídeo: erros internos do Diretor que chegavam crus à tela
  [
    /^MCP [a-z_]+: /i,
    'O Higgsfield recusou um passo da produção. Confira a conexão e os créditos em Ajustes → Integrações e clique em "Retomar produção".',
  ],
  [
    /budget_exceeded/i,
    "A produção parou no teto de créditos do Higgsfield definido para este vídeo. Aumente o teto ou retome para continuar.",
  ],
  [
    /ausente do vault/i,
    "Falta uma chave de integração. Confira Ajustes → Integrações e retome a produção.",
  ],
  // store-secret publicado não conhece a chave nova: versão velha no servidor
  [
    /fora da allowlist/i,
    "Este servidor ainda não aceita essa chave: a versão atual da integração não foi publicada. Peça ao administrador para publicar a função store-secret e tente de novo.",
  ],
  // Higgsfield recusa o endereço de retorno: a conexão publicada está velha
  [
    /registro do client falhou|invalid_redirect_uri|not in the trusted list/i,
    "O Higgsfield recusou o endereço de retorno desta conexão. A versão atual da integração ainda não foi publicada: peça ao administrador para publicar a função higgsfield-oauth e tente de novo.",
  ],
  // rede do runtime (Deno/Node), quando vaza da edge function
  [
    /error sending request|client error \(connect\)|connection (refused|reset|closed)|econnrefused|econnreset|socket hang up|fetch failed/i,
    "Não conseguimos falar com o serviço agora. Tente de novo em instantes.",
  ],
  [
    /timed? ?out|timeout|aborterror|signal (is|has been) aborted/i,
    "O serviço demorou demais para responder. Tente de novo em instantes.",
  ],
  [
    /certificate|ssl|tls handshake|invalid peer/i,
    "A conexão segura com o serviço falhou. Tente de novo; se repetir, confira o endereço.",
  ],
  [
    /invalid api key|incorrect api key|invalid (access )?token|api key (is )?(invalid|missing)/i,
    "A chave de API foi recusada. Confira a chave em Ajustes → Integrações.",
  ],
  [
    /unexpected token|is not valid json|json\.parse|unexpected end of json/i,
    "O serviço respondeu algo que não entendemos. Tente de novo em instantes.",
  ],
  [/invalid login credentials/i, "E-mail ou senha incorretos. Confira e tente de novo."],
  [
    /email not confirmed/i,
    "Seu e-mail ainda não foi confirmado. Abra o link que enviamos e tente de novo.",
  ],
  [
    /user already registered|already been registered/i,
    "Este e-mail já tem conta. Use “Entrar” ou “Esqueci minha senha”.",
  ],
  [/password should be at least (\d+)/i, "A senha precisa ter pelo menos $1 caracteres."],
  [/new password should be different/i, "A nova senha precisa ser diferente da atual."],
  [
    /rate limit|too many requests/i,
    "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
  ],
  [/jwt expired|invalid jwt|refresh token/i, "Sua sessão expirou. Entre de novo para continuar."],
  [
    /row-level security|permission denied|violates.*policy/i,
    "Você não tem permissão para isso. Peça a um administrador da conta.",
  ],
  [/duplicate key value/i, "Isso já existe. Recarregue a página para ver a versão atual."],
  // falha do HeyGen ao processar (inclui quando ele não consegue BAIXAR o
  // nosso vídeo/áudio): fica antes do padrão de rede, que confundia isso com
  // "sem internet" do lado de quem usa
  [
    /paid_plan_required|can_not_use_instant_voice_cloning/i,
    "O plano do ElevenLabs não inclui clonar voz. Assine o Starter ou escolha outra voz.",
  ],
  [
    /duration_mismatch/i,
    "A fala nova não cabe no tempo do vídeo (o HeyGen aceita até 15% de diferença). Ajuste a fala ao tamanho do vídeo e crie de novo.",
  ],
  [
    /^A HeyGen não conseguiu .*(fetch|download|baixar|access|url)/i,
    'O HeyGen não conseguiu baixar o vídeo ou o áudio desta produção. Confira se o vídeo é MP4 (H.264) de até 30 s e clique em "Retomar produção"; veja o motivo em Detalhe técnico.',
  ],
  [
    /^A HeyGen não conseguiu/i,
    "O HeyGen recusou esta produção. Veja o motivo em Detalhe técnico e retome.",
  ],
  // só o erro do PRÓPRIO navegador (frase inteira): um texto de provedor que
  // contém "failed to fetch" não é falta de internet de quem usa
  [
    /^(TypeError: )?(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/i,
    "Sem conexão com o servidor. Confira sua internet e tente de novo.",
  ],
  [/edge function returned a non-2xx/i, GENERIC],
  // provedores de vídeo/voz (texto cru que fica gravado no job)
  [
    /max \d+ concurrent job/i,
    "O Higgsfield está no limite de gerações simultâneas. Espere a atual terminar; a produção continua sozinha.",
  ],
  // estados da geração (resume-job)
  [
    /estado (terminal|não retomável)/i,
    "Esta geração já terminou e não pode ser retomada. Gere de novo em Criar.",
  ],
  [
    /ainda em processamento/i,
    "Esta geração ainda está rodando. Espere alguns minutos antes de tentar de novo.",
  ],
  [/aguardando revisão humana/i, "Esta geração já está pronta. Revise as peças na Biblioteca."],
];

const PROVIDER_NAMES: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  higgsfield: "Higgsfield",
  replicate: "Replicate",
  heygen: "HeyGen",
  zernio: "Zernio",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/** Termos internos que vazam em mensagens que, fora isso, estão boas. */
const TERMS: [RegExp, string][] = [
  // artigo junto: "o job" vira "a geração", não "o geração"
  [/\bO jobs? de (geração|regeneração)/g, "A geração"],
  [/\bo jobs? de (geração|regeneração)/g, "a geração"],
  [/\bO job\b/g, "A geração"],
  [/\bo job\b/g, "a geração"],
  [/\bum job\b/g, "uma geração"],
  [/\bUm job\b/g, "Uma geração"],
  [/\bJobs de (geração|regeneração)/g, "Gerações"],
  [/\bjobs de (geração|regeneração)/g, "gerações"],
  [/\bJob de (geração|regeneração)/g, "Geração"],
  [/\bjob de (geração|regeneração)/g, "geração"],
  [/\bJobs\b/g, "Gerações"],
  [/\bJob\b/g, "Geração"],
  [/\bjobs\b/g, "gerações"],
  [/\bjob\b/g, "geração"],
  [/gate de tom/gi, "teste de tom"],
  [/acervo de contexto|\bacervo\b/gi, "Contexto"],
  [/itens do corpus/gi, "itens selecionados"],
  [/\bcorpus\b/gi, "textos selecionados"],
  [/Brand kit/gi, "Identidade visual"],
  [/\bkeyframes?\b/gi, "quadros"],
  [/\bstoryboard\b/gi, "roteiro de cenas"],
  [/\bAPI keys?\b/gi, "chave de API"],
  [/ no Vault\b/g, ""],
  [/ do Vault\b/g, ""],
  [/\/config\/usuarios/g, "Ajustes → Usuários"],
  [/\/criar\b/g, "Início"],
  [/nesta instância/g, "nesta conta"],
];

function translateTerms(text: string): string {
  return TERMS.reduce((acc, [rx, to]) => acc.replace(rx, to), text);
}

/**
 * Converte uma mensagem crua em texto para o usuário.
 * `code` é o código do envelope da edge function, quando houver.
 */
export function humanizeError(message: string | null | undefined, code?: string | null): string {
  const raw = (message ?? "").trim();
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (!raw) return GENERIC;

  // endereço que não existe: diz qual, para a pessoa conferir a digitação
  if (
    /dns error|lookup address|name or service not known|enotfound|no such host|nodename nor servname/i.test(
      raw,
    )
  ) {
    const host = raw.match(/https?:\/\/(?:www\.)?([^/\s)]+)/i)?.[1];
    return host
      ? `Não encontramos o endereço ${host}. Confira se está digitado certo.`
      : "Não encontramos esse endereço. Confira se está digitado certo.";
  }

  for (const [rx, to] of BY_PATTERN) {
    const m = raw.match(rx);
    if (m) return to.replace("$1", m[1] ?? "");
  }

  // JSON cru de provedor ("elevenlabs 401: {...}", "HTTP 500 {...}")
  const provider = raw.match(/^([\w .-]{2,30}?)\s*(?:HTTP\s*)?(\d{3})\s*:?\s*[{[]/i);
  if (provider) {
    const raw_name = provider[1].trim();
    const name = PROVIDER_NAMES[raw_name.toLowerCase()] ?? raw_name;
    const n = Number(provider[2]);
    if (n === 401 || n === 403)
      return `O ${name} recusou a chave de API. Confira a chave em Ajustes → Integrações.`;
    if (n === 402) return semCredito(`no ${name}`);
    if (n === 429) return `O ${name} pediu uma pausa. Espere alguns minutos e tente de novo.`;
    if (n >= 500) return `O ${name} está instável agora. Tente de novo em instantes.`;
    return `O ${name} não aceitou o pedido. Tente de novo; se repetir, confira a integração em Ajustes → Integrações.`;
  }

  // código HTTP solto ("status 503", "HTTP 404") sem mensagem útil
  const status = raw.match(/\b(?:status|http|code)\s*:?\s*(\d{3})\b/i)?.[1];
  if (status && /^[\w\s:().-]*$/.test(raw)) {
    const n = Number(status);
    if (n === 404) return "Não encontramos o que você pediu. Recarregue a página e tente de novo.";
    if (n === 429) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
    if (n === 401 || n === 403)
      return "O acesso foi recusado. Confira a conexão em Ajustes → Integrações ou entre de novo.";
    if (n >= 500) return "O serviço está instável agora. Tente de novo em instantes.";
  }

  // Mensagens de banco/Postgres e stack traces não ajudam ninguém
  if (
    /\b(relation|column|constraint|syntax error|null value|PGRST\d+|TypeError|ReferenceError)\b/.test(
      raw,
    )
  ) {
    return GENERIC;
  }

  // texto técnico em inglês que não caiu em nenhum caso acima: frase genérica
  if (looksEnglish(raw)) return GENERIC;

  const text = translateTerms(raw);
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** Inglês técnico (sem marca de português) não vai para a tela. */
function looksEnglish(text: string): boolean {
  const portuguese = /[ãõçáéíóúâêôà]|\b(não|para|com|uma?|seu|sua|ou|está|foi|tente|confira)\b/i;
  const english =
    /\b(the|failed|error|invalid|cannot|can't|could not|unable|request|response|undefined|null|missing|not found|denied|is not|does not)\b/i;
  return english.test(text) && !portuguese.test(text);
}

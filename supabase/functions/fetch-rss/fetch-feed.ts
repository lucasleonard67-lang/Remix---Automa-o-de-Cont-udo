// fetch-rss/fetch-feed.ts — baixa UM feed e devolve itens ou um motivo de erro
// em português, pronto para a tela. A busca passa pelo safeFetch
// (_shared/link-reader.ts): só endereço público, com DNS conferido em cada
// salto. Feed pode ser http://, mas nunca de rede interna.
//
// Diagnóstico das falhas vistas com G1/O Globo:
// - Os portais da Globo respondem 4xx a user-agent "de robô" sem Accept.
//   Mandamos cabeçalhos de leitor de feed convencional (UA + Accept RSS/XML +
//   Accept-Language) — a mesma receita que Feedly/NetNewsWire usam.
// - O feed do G1 tem ~400 KB e o de O Globo ~480 KB; cada item traz HTML
//   inteiro. Lemos o corpo em stream com teto (MAX_BYTES) em vez de `.text()`
//   sem limite, e cortamos no teto em vez de falhar.
// - Redirecionamento 301 (`/rss/` → `/rss.xml`) é seguido, salto a salto; se o
//   destino não for XML (página de bloqueio, HTML), o erro diz isso em vez de
//   "Bad request".

import { BlockedUrlError, safeFetch } from '../_shared/link-reader.ts';
import { decodeFeedBody, looksLikeFeed, parseFeed, type FeedItem } from './parse.ts';

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_BYTES = 3 * 1024 * 1024;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (compatible; ContentEngine-Radar/2.0; +https://viverdeia.ai) FeedFetcher',
  Accept:
    'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
  'Cache-Control': 'no-cache',
};

export type FetchFeedOk = {
  ok: true;
  items: FeedItem[];
  feedTitle: string | null;
  finalUrl: string;
  bytes: number;
  truncated: boolean;
};

export type FetchFeedFail = {
  ok: false;
  /** Código curto para log/telemetria (não vai para a tela). */
  code:
    | 'invalid_url'
    | 'not_public'
    | 'timeout'
    | 'network'
    | 'http_4xx'
    | 'http_5xx'
    | 'blocked'
    | 'not_feed'
    | 'empty'
    | 'parse';
  /** Motivo em pt-BR com próximo passo — gravado em rss_feeds.last_error. */
  reason: string;
  status?: number;
};

export type FetchFeedResult = FetchFeedOk | FetchFeedFail;

export async function fetchFeed(url: string): Promise<FetchFeedResult> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('proto');
  } catch {
    return {
      ok: false,
      code: 'invalid_url',
      reason: 'O endereço não é uma URL válida. Confira se começa com https:// e salve de novo.',
    };
  }

  let res: Response;
  let finalUrl: string;
  try {
    ({ response: res, url: finalUrl } = await fetchWithRetry(parsed.toString()));
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      return {
        ok: false,
        code: 'not_public',
        reason: 'Este endereço não é público. Use o link do feed aberto na internet.',
      };
    }
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (/timeout|TimeoutError|aborted/i.test(msg)) {
      return {
        ok: false,
        code: 'timeout',
        reason: `O site não respondeu em ${Math.round(FETCH_TIMEOUT_MS / 1000)} segundos. Tentamos de novo na próxima atualização.`,
      };
    }
    if (/dns|getaddrinfo|ENOTFOUND|name resolution|failed to lookup/i.test(msg)) {
      return {
        ok: false,
        code: 'network',
        reason: 'O endereço do site não foi encontrado. Confira a URL do feed.',
      };
    }
    if (/certificate|tls|ssl/i.test(msg)) {
      return {
        ok: false,
        code: 'network',
        reason: 'O certificado de segurança do site falhou. Tente a versão http:// ou outro feed do mesmo site.',
      };
    }
    return {
      ok: false,
      code: 'network',
      reason: 'Não deu para conectar ao site. Tentamos de novo na próxima atualização.',
    };
  }

  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    const status = res.status;
    if (status === 401 || status === 403 || status === 429) {
      return {
        ok: false,
        code: 'blocked',
        status,
        reason:
          status === 429
            ? 'O site limitou nossas consultas por enquanto (muitas em pouco tempo). A próxima atualização tenta de novo.'
            : `O site bloqueou o acesso automático ao feed (código ${status}). Procure outro endereço de RSS do mesmo site.`,
      };
    }
    if (status === 404 || status === 410) {
      return {
        ok: false,
        code: 'http_4xx',
        status,
        reason: `Este feed não existe mais neste endereço (código ${status}). Abra o site e copie o link de RSS atual.`,
      };
    }
    if (status >= 400 && status < 500) {
      return {
        ok: false,
        code: 'http_4xx',
        status,
        reason: `O site recusou o pedido (código ${status}). Confira o endereço do feed; se estiver certo, o site pode estar bloqueando leitores automáticos.`,
      };
    }
    return {
      ok: false,
      code: 'http_5xx',
      status,
      reason: `O site está com problema do lado dele (código ${status}). A próxima atualização tenta de novo.`,
    };
  }

  const { bytes, truncated } = await readLimited(res, MAX_BYTES);
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      code: 'empty',
      reason: 'O site respondeu sem conteúdo. Confira se o endereço é mesmo o do feed RSS.',
    };
  }

  const text = decodeFeedBody(bytes, res.headers.get('content-type'));
  if (!looksLikeFeed(text)) {
    return {
      ok: false,
      code: 'not_feed',
      reason:
        'Este endereço devolve uma página comum, não um feed RSS. Procure no site o link “RSS” ou “Feed” e use esse.',
    };
  }

  let items: FeedItem[];
  let feedTitle: string | null;
  try {
    const parsedFeed = parseFeed(text);
    items = parsedFeed.items;
    feedTitle = parsedFeed.title;
  } catch {
    return {
      ok: false,
      code: 'parse',
      reason: 'O feed veio num formato que não conseguimos ler. Avise o administrador com o endereço.',
    };
  }

  if (items.length === 0) {
    return {
      ok: false,
      code: 'empty',
      reason: 'O feed abriu, mas não tem nenhuma notícia com título e link. Pode estar vazio ou num formato incomum.',
    };
  }

  return { ok: true, items, feedTitle, finalUrl, bytes: bytes.byteLength, truncated };
}

async function fetchWithRetry(url: string, attempts = 2): Promise<{ response: Response; url: string }> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await safeFetch(url, { headers: HEADERS, timeoutMs: FETCH_TIMEOUT_MS });
    } catch (err) {
      // endereço interno não melhora na segunda tentativa
      if (err instanceof BlockedUrlError) throw err;
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Lê o corpo até `limit` bytes; o resto é descartado (feed grande não derruba a coleta). */
async function readLimited(res: Response, limit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf.subarray(0, limit), truncated: buf.byteLength > limit };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > limit) {
      chunks.push(value.subarray(0, limit - total));
      total = limit;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { bytes: out, truncated };
}

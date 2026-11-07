import { readFileSync } from "node:fs";

import type { Page, Route } from "@playwright/test";
import dotenv from "dotenv";

import type { ContentPiece, PieceStatus } from "../../src/hooks/use-content-pieces";

// Biblioteca sem banco: sessão falsa e todo o tráfego do Supabase respondido no
// navegador. Nada aqui alcança produção, nem a conexão do Realtime. Marca e
// textos são inventados; não copie dado de cliente para cá.

export type Formato = ContentPiece["channel_type"];

export const FORMATOS: Formato[] = [
  "instagram_carousel",
  "instagram_post",
  "instagram_stories",
  "instagram_reel",
  "x_post",
  "threads_post",
  "linkedin_post",
  "facebook_post",
];

export const MARCA_COM_EMOJI = "Café & Código ☕🚀";
export const TEXTO_COM_EMOJI = "Três hábitos 🧠✨ que mudam sua semana 👩🏽‍💻";

const LONGO = Array.from(
  { length: 40 },
  (_, i) => `Frase ${i + 1} de um texto bem maior do que qualquer capa aguenta mostrar.`,
).join(" ");
export const TEXTO_LONGO = `Texto muito longo para testar corte. ${LONGO}`;
export const PALAVRA_SEM_ESPACO = `https://exemplo.test/${"caminho-sem-espaco-".repeat(12)}fim`;

type Arte = "com" | "sem" | "falha";

interface Opcoes {
  arte?: Arte;
  texto?: string;
  status?: PieceStatus;
  agendada?: boolean;
  /** PNG final por slide, em `adapted_content.slide_renders`. */
  renders?: boolean;
}

const idDaPeca = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const caminho = (n: number, arte: Arte, ext = "png") =>
  `pecas/${arte === "falha" ? "quebrada" : "ok"}/${n}.${ext}`;

function conteudo(formato: Formato, n: number, texto: string, arte: Arte) {
  const imagem = arte === "sem" ? {} : { image_path: caminho(n, arte) };
  const foto = (i: number) => (arte === "sem" ? {} : { image_path: caminho(n * 100 + i, arte) });
  switch (formato) {
    case "instagram_carousel":
      return {
        channel_type: formato,
        caption: `Legenda. ${texto}`,
        slides: [0, 1, 2, 3].map((i) => ({
          index: i,
          text: i ? `Slide ${i + 1}. ${texto}` : texto,
          ...foto(i),
        })),
      };
    case "instagram_post":
      return {
        channel_type: formato,
        caption: `Legenda. ${texto}`,
        card: { index: 0, text: texto },
        ...imagem,
      };
    case "instagram_stories":
      return {
        channel_type: formato,
        frames: (["gancho", "desenvolvimento", "cta"] as const).map((role, i) => ({
          index: i,
          role,
          text: i ? `Quadro ${i + 1}. ${texto}` : texto,
          ...foto(i),
        })),
      };
    case "instagram_reel":
      return {
        channel_type: formato,
        script: {
          target_duration_s: 30,
          beats: [{ index: 0, role: "gancho", narration: texto, duration_target_s: 30 }],
        },
        ...(arte === "sem"
          ? {}
          : {
              video: {
                path: caminho(n, arte, "mp4"),
                duration_s: 2,
                project_id: "projeto-teste",
                resolution: "720x1280",
                generated_at: "2026-10-01T12:00:00.000Z",
              },
            }),
      };
    case "x_post":
    case "threads_post":
      return {
        channel_type: formato,
        text: texto,
        thread: [texto, `Continuação. ${texto}`, "Fim do fio."],
        ...imagem,
      };
    case "linkedin_post":
      return {
        channel_type: formato,
        text: texto,
        blocks: {
          hook: texto,
          contexto: "Contexto do post.",
          lista: ["Primeiro ponto", "Segundo ponto"],
          insight: "O aprendizado do post.",
          ponte: "A ligação com o próximo passo.",
          cta: "Conte como é por aí.",
        },
        ...imagem,
      };
    default:
      return { channel_type: formato, text: texto, ...imagem };
  }
}

function peca(n: number, formato: Formato, opcoes: Opcoes = {}): ContentPiece {
  const { arte = "com", status = "draft", agendada = false } = opcoes;
  const texto = opcoes.texto ?? `Peça ${n}: como organizar a semana de conteúdo`;
  const criada = new Date(Date.UTC(2026, 9, 28, 12) - n * 3_600_000).toISOString();
  return {
    id: idDaPeca(n),
    job_id: "00000000-0000-4000-9000-000000000001",
    channel_type: formato,
    core_content: {
      idea: texto,
      hook: { visual: "", written: texto },
      funnel_blocks: [],
      proof: { claim: "", context_item_id: null },
      verify_flags: [],
      cta: "Salve para depois.",
      image_brief: null,
    },
    adapted_content: {
      ...conteudo(formato, n, texto, arte),
      ...(opcoes.renders
        ? {
            slide_renders: [0, 1, 2, 3].map((i) => ({
              index: i,
              path: `pecas/final/${n}-${i}.png`,
            })),
          }
        : {}),
    },
    render_path: null,
    audit: {},
    status,
    scheduled_at: agendada ? "2026-11-20T15:00:00.000Z" : null,
    persona_version: 1,
    strategy_version: 1,
    guardrails_version: 1,
    brand_kit_version: 1,
    engine_version: "teste",
    context_ids: [],
    created_at: criada,
    updated_at: criada,
  };
}

/** Peças nomeadas para o teste achar o card pelo id, sem depender da ordem. */
export const IDS = {
  formatos: FORMATOS.map((_, i) => idDaPeca(i + 1)),
  semArte: FORMATOS.map((_, i) => idDaPeca(i + 11)),
  imagemFalha: [21, 22, 23, 24, 25].map(idDaPeca),
  longos: [31, 32, 33, 34].map(idDaPeca),
  semEspaco: idDaPeca(35),
  emoji: idDaPeca(41),
  pngEmRevisao: idDaPeca(42),
  pngAprovada: idDaPeca(43),
  arquivada: idDaPeca(62),
};

/** Quantas peças cada aba tem no cenário padrão. */
export const POR_ABA = {
  "Em revisão": 28,
  Aprovadas: 4,
  Agendadas: 3,
  Publicadas: 3,
  Rejeitadas: 3,
  Arquivadas: 3,
};

/** Formatos, estados e casos ruins. */
export function pecasDeTeste(): ContentPiece[] {
  const quebrados: Formato[] = [
    "instagram_carousel",
    "instagram_post",
    "instagram_stories",
    "instagram_reel",
    "x_post",
  ];
  const estados: Opcoes[] = [
    { status: "approved" },
    { status: "approved", agendada: true },
    { status: "published" },
    { status: "rejected" },
    { status: "archived" },
  ];
  return [
    ...FORMATOS.map((formato, i) => peca(i + 1, formato)),
    ...FORMATOS.map((formato, i) => peca(i + 11, formato, { arte: "sem" })),
    ...quebrados.map((formato, i) => peca(i + 21, formato, { arte: "falha" })),
    peca(31, "instagram_carousel", { texto: TEXTO_LONGO }),
    peca(32, "instagram_post", { texto: TEXTO_LONGO, arte: "sem" }),
    peca(33, "x_post", { texto: TEXTO_LONGO, arte: "sem" }),
    peca(34, "linkedin_post", { texto: TEXTO_LONGO, arte: "sem" }),
    peca(35, "facebook_post", { texto: PALAVRA_SEM_ESPACO, arte: "sem" }),
    peca(41, "threads_post", { texto: TEXTO_COM_EMOJI, arte: "sem" }),
    peca(42, "instagram_carousel", { renders: true }),
    peca(43, "instagram_carousel", { renders: true, status: "approved" }),
    ...estados.flatMap((estado, e) =>
      [0, 1, 2].map((i) => peca(50 + e * 3 + i, FORMATOS[(e + i) % FORMATOS.length], estado)),
    ),
  ];
}

/** 60 peças na aba padrão: um terço sem arte, para a rolagem medir os dois caminhos. */
export function pecasEmVolume(total = 60): ContentPiece[] {
  return Array.from({ length: total }, (_, i) =>
    peca(100 + i, FORMATOS[i % FORMATOS.length], { arte: i % 3 === 2 ? "sem" : "com" }),
  );
}

// --- Supabase no navegador ---------------------------------------------------

const ANTES = Math.floor(Date.now() / 1000);
const USUARIO = {
  id: "00000000-0000-4000-a000-000000000001",
  email: "teste@exemplo.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
};

const base64url = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString("base64url");

function sessao() {
  const expira = ANTES + 86_400;
  const access_token = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({
    sub: USUARIO.id,
    exp: expira,
    role: "authenticated",
  })}.teste`;
  return {
    access_token,
    refresh_token: "teste",
    token_type: "bearer",
    expires_in: 86_400,
    expires_at: expira,
    user: USUARIO,
  };
}

const chaveDaSessao = () => {
  const ref = dotenv.parse(readFileSync(".env")).VITE_SUPABASE_PROJECT_ID;
  return `sb-${ref}-auth-token`;
};

/** A imagem varia pelo caminho: grade de capas iguais esconderia desalinhamento. */
function imagemFalsa(caminhoDoArquivo: string) {
  const soma = [...caminhoDoArquivo].reduce((total, c) => total + c.charCodeAt(0), 0);
  const tom = (soma * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${tom} 35% 72%)"/><stop offset="1" stop-color="hsl(${(tom + 40) % 360} 40% 38%)"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><circle cx="760" cy="420" r="260" fill="#ffffff" opacity=".18"/></svg>`;
}

type Linha = Record<string, unknown>;

function casa(valor: unknown, filtro: string): boolean {
  const negado = filtro.startsWith("not.");
  const regra = negado ? filtro.slice(4) : filtro;
  const ponto = regra.indexOf(".");
  const op = regra.slice(0, ponto);
  const alvo = regra.slice(ponto + 1);
  const texto = valor === null || valor === undefined ? null : String(valor);
  const resultado = (() => {
    if (op === "is") return alvo === "null" ? texto === null : texto === alvo;
    if (op === "eq") return texto === alvo;
    if (op === "neq") return texto !== alvo;
    if (op === "in")
      return alvo
        .slice(1, -1)
        .split(",")
        .includes(texto ?? "");
    if (texto === null) return false;
    if (op === "gte") return texto >= alvo;
    if (op === "gt") return texto > alvo;
    if (op === "lte") return texto <= alvo;
    if (op === "lt") return texto < alvo;
    return true;
  })();
  return negado ? !resultado : resultado;
}

const SEM_FILTRO = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

function filtrar(linhas: Linha[], busca: URLSearchParams): Linha[] {
  const achadas = linhas.filter((linha) =>
    [...busca].every(([coluna, filtro]) => SEM_FILTRO.has(coluna) || casa(linha[coluna], filtro)),
  );
  const [coluna, sentido] = (busca.get("order") ?? "").split(".");
  if (!coluna) return achadas;
  const fator = sentido === "desc" ? -1 : 1;
  return [...achadas].sort((a, b) => fator * String(a[coluna]).localeCompare(String(b[coluna])));
}

export interface InstalarOpcoes {
  pecas?: ContentPiece[];
  marca?: string;
  /** Segura as imagens para mostrar o estado de carregamento. */
  atrasoDaImagemMs?: number;
}

export interface SupabaseFalso {
  /** Escritas em tabela (PATCH, POST, DELETE). As funções ficam de fora: o shell as lê por POST. */
  escritas: string[];
  /** Arquivos baixados do Storage, para provar qual imagem a capa usou. */
  baixados: Set<string>;
  /** Tabelas sem dado na fixture: se a galeria depender de uma, ela aparece aqui. */
  semDado: Set<string>;
}

/** Chame antes do primeiro `page.goto`. Use com `storageState` vazio no teste. */
export async function instalarBiblioteca(
  page: Page,
  opcoes: InstalarOpcoes = {},
): Promise<SupabaseFalso> {
  const { pecas = pecasDeTeste(), marca = MARCA_COM_EMOJI, atrasoDaImagemMs = 0 } = opcoes;
  const falso: SupabaseFalso = { escritas: [], baixados: new Set(), semDado: new Set() };
  const tabelas: Record<string, Linha[]> = {
    content_pieces: pecas as unknown as Linha[],
    brand_persona: [{ id: "p", status: "active", content: { identity: { name: marca } } }],
    brand_kit: [{ id: "k", status: "active", content: {} }],
    brand_strategy: [{ id: "s", status: "active", content: {} }],
    mcp_tokens: [
      {
        id: "t",
        name: "Claude",
        hint: "abcd",
        revoked_at: null,
        last_used_at: "2026-11-01T12:00:00.000Z",
        created_at: "2026-10-01T12:00:00.000Z",
      },
    ],
    guardrails: [{ id: "g", status: "active", content: {} }],
    channels: [{ id: "c", type: "instagram_carousel", enabled: true, name: "Carrossel" }],
    app_settings: [
      { key: "onboarding", value: { completed: true, minimum_viable: true, brand_name: marca } },
    ],
    user_roles: [{ user_id: USUARIO.id, role: "admin" }],
  };

  const contexto = page.context();
  await contexto.addInitScript(
    ([chave, valor]) => localStorage.setItem(chave, valor),
    [chaveDaSessao(), JSON.stringify(sessao())],
  );
  await contexto.routeWebSocket(/supabase\.co/, () => undefined);

  await contexto.route(/supabase\.co\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "*",
      "access-control-allow-headers": req.headers()["access-control-request-headers"] ?? "*",
      "access-control-expose-headers": "content-range",
    };
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.startsWith("/auth/v1/user")) return json(USUARIO);
    if (url.pathname.startsWith("/auth/v1/token")) return json(sessao());
    if (url.pathname.startsWith("/auth/")) return json({});

    if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      const [bucket, ...resto] = url.pathname.replace("/storage/v1/object/sign/", "").split("/");
      const arquivo = resto.join("/");
      if (req.method() === "POST" && !arquivo) {
        const { paths = [] } = (req.postDataJSON() ?? {}) as { paths?: string[] };
        return json(
          paths.map((path) => ({
            path,
            error: null,
            signedURL: `/object/sign/${bucket}/${path}?token=teste`,
          })),
        );
      }
      if (req.method() === "POST") {
        return json({ signedURL: `/object/sign/${bucket}/${arquivo}?token=teste` });
      }
      falso.baixados.add(arquivo);
      if (atrasoDaImagemMs) await new Promise((fim) => setTimeout(fim, atrasoDaImagemMs));
      if (arquivo.includes("quebrada")) return json({ error: "not_found" }, 400);
      if (arquivo.endsWith(".mp4")) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: "video/mp4",
          body: Buffer.from(REEL_MP4, "base64"),
        });
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: "image/svg+xml",
        body: imagemFalsa(arquivo),
      });
    }

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      if (url.pathname.endsWith("/has_role") || url.pathname.endsWith("/has_any_admin")) {
        return json(true);
      }
      return json({ completed: true, minimum_viable: true });
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      const tabela = url.pathname.replace("/rest/v1/", "");
      if (!["GET", "HEAD"].includes(req.method())) {
        falso.escritas.push(`${req.method()} ${tabela}`);
        return json([{ id: url.searchParams.get("id")?.replace("eq.", "") ?? "novo" }]);
      }
      if (!tabelas[tabela]) falso.semDado.add(tabela);
      const linhas = filtrar(tabelas[tabela] ?? [], url.searchParams).map((linha) =>
        (url.searchParams.get("select") ?? "").includes("job:")
          ? { ...linha, job: { timings: {} } }
          : linha,
      );
      if (req.method() === "HEAD" || (req.headers().prefer ?? "").includes("count=exact")) {
        return route.fulfill({
          status: 200,
          headers: {
            ...cors,
            "content-range": `0-${Math.max(linhas.length - 1, 0)}/${linhas.length}`,
          },
          contentType: "application/json",
          body: req.method() === "HEAD" ? "" : JSON.stringify(linhas),
        });
      }
      if ((req.headers().accept ?? "").includes("vnd.pgrst.object")) {
        return linhas[0]
          ? json(linhas[0])
          : json({ code: "PGRST116", message: "0 linhas", details: null, hint: null }, 406);
      }
      return json(linhas);
    }

    if (url.pathname.startsWith("/functions/v1/")) {
      return json({});
    }
    return json({});
  });

  return falso;
}

// Reel de 2 s, 180x320, gerado com ffmpeg: quadrado claro em movimento sobre azul.
const REEL_MP4 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQFbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9" +
  "AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAgAAAzB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAA" +
  "AAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAALQAAAFAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAA" +
  "AAEAAAfQAAAIAAABAAAAAAKobWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAA" +
  "AAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACU21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5m" +
  "AAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAhNzdGJsAAAAw3N0c2QAAAAAAAAAAQAAALNhdmMxAAAAAAAAAA" +
  "EAAAAAAAAAAAAAAAAAAAAAALQBQABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAA" +
  "GP//AAAAOWF2Y0MBZAAV/+EAG2dkABWscgRDAp5/ARAAAAMAEAAAAwFA8WLYRgEAB2joQ4KSyLD9+PgAAAAAEHBhc3" +
  "AAAAABAAAAAQAAABRidHJ0AAAAAAAAH8AAAAAAAAAAGHN0dHMAAAAAAAAAAQAAABQAAAQAAAAAFHN0c3MAAAAAAAAA" +
  "AQAAAAEAAACIY3R0cwAAAAAAAAAPAAAABgAACAAAAAABAAAMAAAAAAEAAAQAAAAAAQAACAAAAAABAAAUAAAAAAEAAA" +
  "gAAAAAAQAAAAAAAAABAAAEAAAAAAEAAAwAAAAAAQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAA" +
  "AAEAAAgAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAUAAAAAQAAAGRzdHN6AAAAAAAAAAAAAAAUAAADNgAAADwAAAA0AA" +
  "AAQgAAAEgAAABaAAAAVQAAAC8AAABDAAAAewAAACoAAAAtAAAAJAAAAFsAAAA6AAAAVQAAADwAAAAmAAAAKQAAADQA" +
  "AAAUc3RjbwAAAAAAAAABAAAENQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAA" +
  "AAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAAAIZnJlZQAAB/htZGF0AAAC" +
  "sQYF//+t3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IE" +
  "FWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAt" +
  "IG9wdGlvbnM6IGNhYmFjPTEgcmVmPTE2IGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMzMgbWU9dW1oIHN1Ym" +
  "1lPTEwIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MjQgY2hyb21hX21lPTEgdHJl" +
  "bGxpcz0yIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS" +
  "0yIHRocmVhZHM9MTAgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBp" +
  "bnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz04IGJfcHlyYW1pZD" +
  "0yIGJfYWRhcHQ9MiBiX2JpYXM9MCBkaXJlY3Q9MyB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50" +
  "PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NjAgcmM9Y3" +
  "JmIG1idHJlZT0xIGNyZj0zNi4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0x" +
  "LjQwIGFxPTE6MS4wMACAAAAAfWWIgQAH//5tC8yxysmR2s3brVEshGnUhCAR8wJEl2u8DPSgQGmiGAAGCAF5LJOpk/" +
  "xQGemhGXzAoON8RAFPIU1gFPjUhxM2yhg3Z8tNYkryO90mraRHbrcaqAbBhU88y3U2avwCL01m+Cgqn1lwUvH1joEi" +
  "QMzDoH0jxJgRAAAAOEGaCC2If/+HAAh63hRzsHdKfIt+wARvZG4oX5Ksf8Y8PAZ4riTmpsWPfPihxodo11CncxKZCd" +
  "LgAAAAMEGaEEvwIGTKYQ//hwAIjy9iWt50xD0Zi9hz52dsmZcvF0+YY9proGNJGM3bbpdiBQAAAD5BmhhpPAgeTKYE" +
  "P/+HAAtj0oaHdHEoVx8gWHpIPXrAdP08aNP6ec3fd8cYg6ryQAVGkLkBO2tvV1/SxFwPUAAAAERBmiCJfAgfkymAQQ" +
  "/kQAVrXusjnuAC0TUs5TyXxWWkZ5H4nqHk56VDMfCpwWiWNjKkw61rLaiI0VgIb8pjjz4oDcJO3wAAAFZBmiipvAgf" +
  "5MpgBBD/5EAHPui8tmELJEUAAunYlXMOP85vmygCx/beg3GEQsqPnG9J0EQvZEuPRCgRfvdpoHdaUPf0z1gsJVp9Ia" +
  "t+zOj4thFEBi7FgQAAAFFBmjDp/Agf+TKYAEEP5EAS3dMElpwAC43DI5YDAb5VueP0PxsD/RuWq2G2shvEv4pOAr7c" +
  "y2dlCmtQHFmbC7PelTgtxLbYHbSAK20kMhqG0wkAAAArAZ44xNIb/wjbKZ9rs6DHuRqDKqFeEXLZkTQKmqwTe22x8D" +
  "iuEZvdz0V6ZwAAAD9BmjkIjwIH/5MpgAEEP+RAG+k94h9WVgy8uElUFeLdc4RRujyFseDP0wjoQNx82F/Q4Uu/ZRgF" +
  "UexBoTPRDsAAAAB3QZpBiJ8CB//kymAAEP+HAQCKAib7pABpbXLMZfBwIGElew0U9J5jK8wD5iJH5fHesCNNLaHv44" +
  "0hl0102Qlf3AfnYVParOJz5CFcVBnnje0d7fi8kvF057dyICB7khumVgd7N6tw9y71blObdXlPPcX1l0buBtAAAAAm" +
  "QZ5JRERDvxAhCN4h4bIT8rHhmss4eYTdPoXfpXkTUgtquKGGqsEAAAApAZ5RJEIhvxDTXa6vpTjts4Lizugp7EEJjl" +
  "kSMzsQS0jdkFQYVWpTptoAAAAgAZ5RbEyG/xGmhNrFCL+INqfJsSVXKJX348+3Y7VN5PgAAABXQZpRyL1AgLX/+TKY" +
  "AABDvwAByo1KCxjDtaTbkdZss+l6t0McADgUZ2WCNeFBByuJcCmxB7/tnJSk2W+/TlgbVDi/f2KIj9XHrStLWZNegl" +
  "7kxUPO+4KBAAAANgGeWaRUhv8Rj+ADgdr6uWOFVpQwB4FWAiq6V+kstOubve9RKGsPVs856O+OheYr4FhwOCSnwQAA" +
  "AFFBmlpIzwIFLX/+TKYAAAQ3/wACO53F1wRXDtiAIRXcNoF/QAQAFMg3zhfNcsABD8l+clvfk6Fbo0syKKvHAVxxKi" +
  "GIn378Ikzy2qazgD/qnoEAAAA4QZ5iBFxDfwnP8AGyARUNu/DCJ0eW4e05iY877HBpzuHsfU/9T46Ll3y3FTL0lGKi" +
  "yZP8INDCjnsAAAAiAZ5p7FohvwnMwABLTfEZnoXlzDtKFUAMX+4gjVeG+7RjHgAAACUBnmosZIb/A9bQCJTr/4SSfh" +
  "5lO7v1tsQ34HrfY0eR8BqBHKChAAAAMEGaamjtQIC1S1//kymAAAAQ3wAAWzHiLYdVrwRlvI3cY187+au7YjRHPTAr" +
  "sgf4QA==";

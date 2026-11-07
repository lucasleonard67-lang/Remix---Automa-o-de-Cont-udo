// ---------------------------------------------------------------------------
// Entidades HTML → texto.
//
// MEDIDO no Radar: as descrições dos feeds chegavam com "avan&ccedil;o",
// "&ldquo;assistente&rdquo;", "informa&ccedil;&otilde;es" — em quase todos os
// 2.933 itens. O parser do RSS decodificava só as cinco entidades de XML
// (&amp; &lt; &gt; &quot; &apos;), e feed brasileiro vem cheio das NOMEADAS do
// HTML porque a descrição é um fragmento de HTML dentro do XML.
//
// Tabela explícita em vez do truque do `textarea.innerHTML`: este código roda
// no SSR também, e um decodificador que depende do DOM devolveria a string
// crua no servidor e o texto certo no cliente — divergência de hidratação.
// ---------------------------------------------------------------------------

const NOMEADAS: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // pontuação tipográfica: é o que mais aparece em título de portal
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  bull: "•",
  deg: "°",
  euro: "€",
  pound: "£",
  cent: "¢",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  // acentuação do português
  aacute: "á",
  agrave: "à",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  ccedil: "ç",
  ntilde: "ñ",
  Aacute: "Á",
  Agrave: "À",
  Acirc: "Â",
  Atilde: "Ã",
  Eacute: "É",
  Ecirc: "Ê",
  Iacute: "Í",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Uacute: "Ú",
  Ccedil: "Ç",
};

/**
 * Decodifica entidades HTML (nomeadas, decimais e hexadecimais) e remove tags.
 *
 * `&amp;` é resolvido em DUAS passadas de propósito: feed republicado costuma
 * vir duplamente codificado (`&amp;ccedil;`), e uma passada só deixaria
 * `&ccedil;` na tela.
 */
export function decodeHtmlEntities(entrada: string | null | undefined): string {
  if (!entrada) return "";
  const passada = (texto: string) =>
    texto
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => cod(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec) => cod(Number(dec)))
      .replace(/&([a-zA-Z]+);/g, (m, nome) => NOMEADAS[nome] ?? m);
  return passada(passada(entrada));
}

function cod(ponto: number): string {
  return Number.isFinite(ponto) && ponto > 0 && ponto <= 0x10ffff
    ? String.fromCodePoint(ponto)
    : "";
}

/** Texto limpo de um trecho de HTML: sem tag, sem entidade, sem espaço duplo. */
export function htmlParaTexto(entrada: string | null | undefined): string {
  return decodeHtmlEntities(entrada)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

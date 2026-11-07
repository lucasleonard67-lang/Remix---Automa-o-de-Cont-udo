// ---------------------------------------------------------------------------
// Dólares para a tela, em pt-BR ("US$ 1,20"). Uma função só para o app inteiro.
//
// Decisão de casas: 2 casas a partir de um centavo; abaixo de US$ 0,01 (e acima
// de zero) 4 casas, para o valor não virar "US$ 0,00". Antes havia duas versões
// — a do catálogo usava 3 casas abaixo de US$ 1 ("US$ 0,864"), boa para preço
// por segundo e ruim num total de recibo; a do Reel sempre usou 2 casas abaixo
// de US$ 1 e continua assim (nenhuma tela do Reel muda de casas). Preço por
// segundo tem a sua própria função, `formatUsdRate`.
// ---------------------------------------------------------------------------

/** Total em dólares: "US$ 0,86", "US$ 3,00"; frações de centavo com 4 casas. */
export function formatUsd(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "US$ 0,00";
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  return `US$ ${amount.toFixed(digits).replace(".", ",")}`;
}

/** Preço por segundo do catálogo: "US$ 0,036/s" (3 casas abaixo de US$ 1). */
export function formatUsdRate(perSecond: number): string {
  if (!Number.isFinite(perSecond)) return "US$ 0,00/s";
  const digits = perSecond > 0 && perSecond < 0.01 ? 4 : perSecond < 1 ? 3 : 2;
  return `US$ ${perSecond.toFixed(digits).replace(".", ",")}/s`;
}

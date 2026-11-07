// _shared/segredo-igual.ts — compara segredo (x-cron-secret, chave de serviço) em
// tempo constante: `===` sai no primeiro caractere diferente e o tempo de
// resposta vaza quanto do segredo bateu. Vazio nunca é igual.

export function segredoIgual(enviado: unknown, esperado: unknown): boolean {
  if (typeof enviado !== 'string' || typeof esperado !== 'string') return false;
  if (!enviado || !esperado) return false;
  const a = new TextEncoder().encode(enviado);
  const b = new TextEncoder().encode(esperado);
  // percorre sempre o tamanho do esperado, para o tamanho também não vazar cedo
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diferenca |= (a[i] ?? 0) ^ b[i];
  return diferenca === 0;
}

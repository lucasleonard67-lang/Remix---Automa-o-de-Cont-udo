// _shared/fala.ts — o texto que vai para a voz. Sigla lida letra a letra soa
// estranho; a legenda e o roteiro na tela continuam como foram escritos.
// Sem "IA": aparece em nome de marca e a voz já lê bem.

const POR_EXTENSO: Record<string, string> = {
  EUA: 'Estados Unidos',
  UE: 'União Europeia',
  ONU: 'Organização das Nações Unidas',
  OMS: 'Organização Mundial da Saúde',
  FMI: 'Fundo Monetário Internacional',
  PIB: 'Produto Interno Bruto',
  RH: 'Recursos Humanos',
  TI: 'Tecnologia da Informação',
};

const SIGLAS = new RegExp(`(?<![\\p{L}\\p{N}])(?:${Object.keys(POR_EXTENSO).join('|')})(?![\\p{L}\\p{N}])`, 'gu');

export const falaPorExtenso = (texto: string) => texto.replace(SIGLAS, (sigla) => POR_EXTENSO[sigla]);

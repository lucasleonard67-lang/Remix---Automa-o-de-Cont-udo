// _shared/brand-source-files.ts — escolhe, numa lista de caminhos (árvore de
// um repositório ou conteúdo de um ZIP), os arquivos que descrevem um design
// system, na ordem em que pesam para a proposta. Puro, sem rede e sem Deno:
// testado no vitest em src/lib/brand-source-files.test.ts.
//
// Ordem: llms.txt → tokens → tailwind → tema/CSS global → README e docs de
// design → CSS de pastas de estilo. Pastas geradas ou de terceiros ficam fora.

const IGNORAR =
  /(^|\/)(node_modules|dist|build|out|\.next|\.git|vendor|coverage|__tests__|tests?|e2e|storybook-static|public\/brand\/marcas)\//i;

const PASTAS_DE_DOC = /(^|\/)(docs?|references?|referencias|guias?|guidelines?|brand|marca|design)\//i;
const PASTAS_DE_ESTILO = /(^|\/)(css|styles?|theme|tokens|design-system|design-tokens)\//i;

/** Nota de um caminho; null quando o arquivo não ajuda. Menor = mais cedo. */
export function notaDoArquivo(path: string): number | null {
  if (IGNORAR.test(path)) return null;
  const nome = (path.split('/').pop() ?? '').toLowerCase();
  const ext = nome.includes('.') ? nome.slice(nome.lastIndexOf('.') + 1) : '';
  const semExt = ext ? nome.slice(0, -(ext.length + 1)) : nome;
  const raiz = !path.includes('/');

  if (nome === 'llms.txt' || nome === 'llms-full.txt') return 0;
  if (/tokens?/.test(semExt) && ['css', 'json', 'scss', 'js', 'ts', 'cjs', 'mjs'].includes(ext)) return 1;
  if (/^tailwind\.(config|preset)/.test(nome)) return 2;
  if (/^(theme|themes|variables|globals?|index|styles?|app|base|main|root|colors?|cores|palette|fonts?|typography)$/.test(semExt)
    && ['css', 'scss', 'json', 'js', 'ts', 'cjs', 'mjs'].includes(ext)) return 3;
  if (ext === 'md' || ext === 'mdx' || ext === 'txt') {
    if (raiz && /^readme/.test(semExt)) return 4;
    if (/design|brand|marca|identidade|style|estilo|fundamento|token|cores?|tipografia|typography|skill|claude|agents/.test(semExt)) return 5;
    if (PASTAS_DE_DOC.test(path)) return 5;
    return null;
  }
  if ((ext === 'css' || ext === 'scss') && PASTAS_DE_ESTILO.test(path)) return 6;
  return null;
}

export interface SelecaoOpcoes {
  /** Só caminhos dentro desta pasta (sem barra no fim). */
  base?: string;
  /** Teto de arquivos devolvidos. */
  max?: number;
}

/** Caminhos que valem a leitura, do mais ao menos importante; raso antes de fundo. */
export function selecionarArquivos(paths: string[], opts: SelecaoOpcoes = {}): string[] {
  const base = (opts.base ?? '').replace(/^\/+|\/+$/g, '');
  const max = opts.max ?? 12;
  const prefixo = base ? `${base}/` : '';
  const avaliados: Array<{ path: string; nota: number; profundidade: number }> = [];
  for (const bruto of paths) {
    const path = bruto.replace(/^\/+/, '');
    if (prefixo && !path.startsWith(prefixo)) continue;
    const relativo = prefixo ? path.slice(prefixo.length) : path;
    const nota = notaDoArquivo(relativo);
    if (nota === null) continue;
    avaliados.push({ path, nota, profundidade: relativo.split('/').length });
  }
  avaliados.sort((a, b) => a.nota - b.nota || a.profundidade - b.profundidade || a.path.localeCompare(b.path));
  return avaliados.slice(0, max).map((a) => a.path);
}

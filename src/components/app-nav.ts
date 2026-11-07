import {
  ChartLine,
  CircleHelp,
  Clapperboard,
  Home,
  Library,
  Palette,
  RadioTower,
  Settings,
  SquarePen,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Menu lateral: nove itens, dois níveis no máximo. Os subitens aparecem
// quando a rota está dentro do pai. Rotas antigas que saíram do menu
// (/identidades, /diretor) continuam vivas como redirect. Ordem dos grupos do
// kit: uso principal → cadastros → conta (Ajuda) → Administração (só admin).
// ---------------------------------------------------------------------------

export interface NavChild {
  title: string;
  to: string;
  /** Busca fixa do link (ex.: aba de Ajustes). */
  search?: Record<string, string>;
}

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
  children?: readonly NavChild[];
  /** Outros prefixos que acendem este item (rotas sem entrada própria). */
  aliases?: readonly string[];
  /** Rótulo do grupo na sidebar; é também o eyebrow das telas do item. */
  group: NavGroupLabel;
}

export type NavGroupLabel = "Produção" | "Inteligência" | "Identidade" | "Conta" | "Administração";

export const NAV_ITEMS: readonly NavItem[] = [
  { title: "Início", to: "/", icon: Home, group: "Produção" },
  // /criar/$jobId (acompanhar uma geração) acende Criar pelo prefixo
  { title: "Criar", to: "/criar", icon: SquarePen, group: "Produção" },
  { title: "Biblioteca", to: "/biblioteca", icon: Library, group: "Produção" },
  { title: "Vídeos", to: "/videos", icon: Clapperboard, group: "Produção" },
  { title: "Radar", to: "/radar", icon: RadioTower, group: "Inteligência" },
  { title: "Desempenho", to: "/desempenho", icon: ChartLine, group: "Inteligência" },
  {
    title: "Marca",
    to: "/marca",
    icon: Palette,
    group: "Identidade",
    children: [
      { title: "Contexto", to: "/contexto" },
      { title: "Canais", to: "/marca/canais" },
      { title: "Apresentadores", to: "/marca/avatares" },
      { title: "Vozes", to: "/marca/vozes" },
    ],
  },
  // para todo mundo; Ajustes (só admin) vem depois, em Administração
  { title: "Ajuda", to: "/ajuda", icon: CircleHelp, group: "Conta" },
];

/** Só admin. */
export const ADMIN_ITEMS: readonly NavItem[] = [
  {
    title: "Ajustes",
    to: "/config",
    icon: Settings,
    group: "Administração",
    // As seções de Ajustes ficam no menu da própria tela (SettingsLayout do
    // kit); a sidebar não repete o mesmo menu. Automação mora lá dentro.
    // /autorizar-claude: a autorização do conector também é coisa de Ajustes
    aliases: ["/automacao", "/autorizar-claude"],
  },
];

const ALL_ITEMS = [...NAV_ITEMS, ...ADMIN_ITEMS];

function matches(to: string, pathname: string): boolean {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Item de primeiro nível ativo: o que contém a rota — pelo próprio prefixo ou
 * pelo de um subitem (/contexto acende "Marca").
 */
export function activeNavTo(pathname: string): string | null {
  const parents = ALL_ITEMS.filter(
    (item) =>
      matches(item.to, pathname) ||
      (item.aliases ?? []).some((alias) => matches(alias, pathname)) ||
      (item.children ?? []).some((c) => matches(c.to, pathname)),
  );
  return parents.sort((a, b) => b.to.length - a.to.length)[0]?.to ?? null;
}

/**
 * Subitem ativo dentro do pai: o de prefixo MAIS LONGO que casa com a rota;
 * entre subitens do mesmo caminho, decide a busca (aba).
 */
export function activeChildTo(
  item: NavItem,
  pathname: string,
  search: Record<string, unknown>,
): NavChild | null {
  const hits = (item.children ?? []).filter((c) => matches(c.to, pathname));
  if (hits.length === 0) return null;
  const exact = hits.find(
    (c) => c.search && Object.entries(c.search).every(([k, v]) => search[k] === v),
  );
  if (exact) return exact;
  // caminho batendo sem busca: só acende se o pai não é o mesmo caminho
  const byPath = hits.filter((c) => !c.search).sort((a, b) => b.to.length - a.to.length)[0];
  return byPath ?? null;
}

/** Itens agrupados como na sidebar, na ordem em que aparecem. */
export function navGroups(items: readonly NavItem[]): { label: NavGroupLabel; items: NavItem[] }[] {
  const groups: { label: NavGroupLabel; items: NavItem[] }[] = [];
  for (const item of items) {
    const group = groups.find((g) => g.label === item.group);
    if (group) group.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

/** Eyebrow da tela: o grupo da sidebar a que a rota pertence. */
export function sectionGroup(pathname: string): NavGroupLabel | null {
  const to = activeNavTo(pathname);
  return ALL_ITEMS.find((i) => i.to === to)?.group ?? null;
}

/** Nome da seção para a barra do celular: o subitem quando há, senão o pai. */
export function sectionTitle(
  pathname: string,
  search: Record<string, unknown> = {},
): string | null {
  const to = activeNavTo(pathname);
  const item = ALL_ITEMS.find((i) => i.to === to);
  if (!item) return null;
  return activeChildTo(item, pathname, search)?.title ?? item.title;
}

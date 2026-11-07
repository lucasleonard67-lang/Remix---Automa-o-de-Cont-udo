import type { ZernioAccount } from "@/hooks/use-zernio";
import { formatNumber, latestFollowers, type FollowerSeries } from "@/lib/zernio-analytics";

import { platformLabel } from "./motion";
import { PlatformMark } from "./shared";

// Trilho das contas conectadas: ícone da rede + @ + seguidores. Uma linha,
// sem moldura — é a legenda do que o módulo inteiro está medindo.
export function ConnectedAccounts({
  accounts,
  followers,
}: {
  accounts: ZernioAccount[];
  followers: FollowerSeries[];
}) {
  if (!accounts.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-7 gap-y-3" aria-label="Contas conectadas">
      {accounts.map((account) => {
        // a série pode ter ficado com o id da outra autorização da mesma conta
        const series =
          followers.find((s) => s.accountId === account.accountId) ??
          followers.find(
            (s) =>
              s.platform === account.platform &&
              !!account.username &&
              s.username?.toLowerCase() === account.username.toLowerCase(),
          );
        const total = series ? latestFollowers(series) : null;
        const handle = account.username ? `@${account.username}` : account.name;
        return (
          <li key={account.accountId} className="flex items-center gap-2.5 text-sm">
            <PlatformMark platform={account.platform} label />
            <span className="font-medium text-[var(--via-text-primary)]">{handle}</span>
            <span className="text-[var(--via-text-muted)] tabular-nums">
              {total === null ? "—" : `${formatNumber(total)} seguidores`}
            </span>
            <span className="sr-only">{platformLabel(account.platform)}</span>
          </li>
        );
      })}
    </ul>
  );
}

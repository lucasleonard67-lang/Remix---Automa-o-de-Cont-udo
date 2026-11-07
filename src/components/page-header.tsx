import type { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";

import { sectionGroup } from "@/components/app-nav";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Ações à direita: no máximo um botão navy, o resto em outline ou texto. */
  children?: ReactNode;
}

/** Rótulo acima do h1: o mesmo grupo da sidebar. */
export function PageEyebrow() {
  const { pathname } = useLocation();
  const group = sectionGroup(pathname);
  if (!group) return null;
  return (
    <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--via-text-muted)]">
      {group}
    </p>
  );
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <PageEyebrow />
        <h1 className="text-3xl text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

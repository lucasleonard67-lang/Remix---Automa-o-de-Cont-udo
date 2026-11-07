import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronRight, Flag, Mic, Palette, Share2, ShieldAlert, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { useAvatars } from "@/hooks/use-avatars";
import { useBrandVoices } from "@/hooks/use-voices";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useChannels } from "@/hooks/use-channels";
import {
  useActiveVersion,
  useDraftVersion,
  type VersionedBrandTable,
} from "@/hooks/use-versioned-brand";

export const Route = createFileRoute("/_app/marca/")({
  component: BrandHubPage,
});

const VERSIONED_AREAS: Array<{
  table: VersionedBrandTable;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
}> = [
  {
    table: "brand_persona",
    title: "Persona",
    description: "Tom, vocabulário, opiniões e exemplos.",
    to: "/marca/persona",
    icon: UserRound,
  },
  {
    table: "brand_strategy",
    title: "Bandeira",
    description: "O que a marca defende: promessa, teses e cliente ideal.",
    to: "/marca/bandeira",
    icon: Flag,
  },
  {
    table: "guardrails",
    title: "Regras da marca",
    description: "O que nunca escrever, CTAs permitidos e nota mínima para aprovar.",
    to: "/marca/guardrails",
    icon: ShieldAlert,
  },
  {
    table: "brand_kit",
    title: "Identidade visual",
    description: "Cores, fontes, logo, fotos e a arte do carrossel.",
    to: "/marca/brand-kit",
    icon: Palette,
  },
];

function BrandHubPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Marca"
        description="Defina como a marca fala, o que defende e como aparece. Toda peça segue a versão ativa de cada área."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VERSIONED_AREAS.map((area) => (
          <VersionedAreaCard key={area.table} {...area} />
        ))}
        <ChannelsAreaCard />
        <AvatarsAreaCard />
        <VoicesAreaCard />
      </div>
    </div>
  );
}

function AreaCard({
  title,
  description,
  to,
  icon: Icon,
  status,
}: {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  status: ReactNode;
}) {
  return (
    <Link to={to} className="group block h-full">
      <Card className="h-full transition-colors group-hover:bg-[var(--via-navy-06)]">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            <ChevronRight
              className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          <div className="flex flex-wrap gap-1.5 pt-1">{status}</div>
        </CardHeader>
      </Card>
    </Link>
  );
}

function VersionedAreaCard({
  table,
  title,
  description,
  to,
  icon,
}: (typeof VERSIONED_AREAS)[number]) {
  const activeQuery = useActiveVersion(table);
  const draftQuery = useDraftVersion(table);

  const isLoading = activeQuery.isLoading || draftQuery.isLoading;
  const active = activeQuery.data ?? null;
  const draft = draftQuery.data ?? null;

  let status: ReactNode;
  if (isLoading) {
    status = <Skeleton className="h-5 w-32" />;
  } else if (!active && !draft) {
    status = (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        não configurado
      </Badge>
    );
  } else {
    status = (
      <>
        {active ? (
          <Badge className="font-medium">
            v{active.version} ativa · {format(new Date(active.updated_at), "dd/MM/yyyy")}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            nenhuma versão ativa
          </Badge>
        )}
        {draft ? (
          <Badge variant="secondary" className="font-normal">
            rascunho em edição
          </Badge>
        ) : null}
      </>
    );
  }

  return <AreaCard title={title} description={description} to={to} icon={icon} status={status} />;
}

function ChannelsAreaCard() {
  const channelsQuery = useChannels();
  const channels = channelsQuery.data ?? [];
  const enabledCount = channels.filter((channel) => channel.enabled).length;

  const status = channelsQuery.isLoading ? (
    <Skeleton className="h-5 w-32" />
  ) : enabledCount > 0 ? (
    <Badge className="font-medium">
      {enabledCount} de {channels.length} canais ativos
    </Badge>
  ) : (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      nenhum canal ativo
    </Badge>
  );

  return (
    <AreaCard
      title="Canais"
      description="Onde a marca publica e os limites de cada formato."
      to="/marca/canais"
      icon={Share2}
      status={status}
    />
  );
}

/** Apresentadores — cadastro único de quem aparece e fala nos vídeos. */
function AvatarsAreaCard() {
  const avatars = useAvatars("active");
  const list = avatars.data ?? [];
  const padrao = list.find((avatar) => avatar.is_default);

  const status = avatars.isLoading ? (
    <Skeleton className="h-5 w-28" />
  ) : padrao ? (
    <Badge variant="secondary" className="font-normal">
      padrão: {padrao.name}
    </Badge>
  ) : (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      nenhum avatar
    </Badge>
  );

  return (
    <AreaCard
      title="Apresentadores"
      description="Quem aparece e fala nos seus vídeos."
      to="/marca/avatares"
      icon={UserRound}
      status={status}
    />
  );
}

/** Vozes — quem narra os vídeos; uma é a padrão. */
function VoicesAreaCard() {
  const voices = useBrandVoices();
  const list = voices.data ?? [];
  const padrao = list.find((voice) => voice.is_default);

  const status = voices.isLoading ? (
    <Skeleton className="h-5 w-28" />
  ) : padrao ? (
    <Badge variant="secondary" className="font-normal">
      padrão: {padrao.name}
    </Badge>
  ) : (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {list.length ? `${list.length} ${list.length === 1 ? "voz" : "vozes"}` : "nenhuma voz"}
    </Badge>
  );

  return (
    <AreaCard
      title="Vozes"
      description="Quem narra os vídeos."
      to="/marca/vozes"
      icon={Mic}
      status={status}
    />
  );
}

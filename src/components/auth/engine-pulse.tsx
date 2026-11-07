import {
  BadgeCheck,
  CalendarClock,
  Check,
  type LucideIcon,
  Radar,
  Swords,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { BrandIcon } from "@/components/brand-icon";
import type { BrandName } from "@/lib/brands";

// ---------------------------------------------------------------------------
// Ilustração viva da entrada: "um dia do motor". Os cinco módulos contam a
// mesma história com números de UMA marca de exemplo que fecham entre si:
// uma pauta chega do Radar, a peça fica pronta (a barra de hoje sobe), passa
// na revisão (um quadrado aprovado entra na grade), é agendada e publicada nas
// redes (cada rede ganha ✓ e alcance), e o alcance e o engajamento contra o
// mercado sobem por causa dela. Cada etapa acende o módulo que ela afeta; a
// notificação da etapa conta o que aconteceu. Três peças por ciclo, depois o
// mural recomeça. Com movimento reduzido, mostra o fim do ciclo parado.
// Dados ilustrativos — nunca vêm do banco (a página é pública).
// ---------------------------------------------------------------------------

const STEP_MS = 2000;
const STEPS_PER_PIECE = 5;

/** Glifos pretos: sobre o navy entram em branco, como nos temas escuros oficiais. */
const MONO_ON_NAVY: BrandName[] = ["tiktok", "threads", "x"];

const PECAS: Array<{ kind: string; reach: Record<BrandName, number> }> = [
  {
    kind: "Carrossel",
    reach: { instagram: 2140, tiktok: 860, threads: 410, facebook: 330 } as Record<
      BrandName,
      number
    >,
  },
  {
    kind: "Reel",
    reach: { instagram: 3870, tiktok: 8420, threads: 290, facebook: 640 } as Record<
      BrandName,
      number
    >,
  },
  {
    kind: "Post",
    reach: { instagram: 1760, tiktok: 520, threads: 980, facebook: 450 } as Record<
      BrandName,
      number
    >,
  },
];
const CYCLE = PECAS.length * STEPS_PER_PIECE;

const REDES: Array<{ brand: BrandName; name: string }> = [
  { brand: "instagram", name: "Instagram" },
  { brand: "tiktok", name: "TikTok" },
  { brand: "threads", name: "Threads" },
  { brand: "facebook", name: "Facebook" },
];

// ── Alcance: 30 dias de uma marca que começou a usar o motor no dia 9 ──────
/** Primeiro dia com o motor (marca "começou aqui" no gráfico). */
const INICIO = 9;
/** Contas alcançadas por dia. Os dias 27–29 são as três peças do ciclo. */
const ALCANCE_DIA = [
  640, 590, 720, 610, 680, 560, 700, 650, 620, 980, 1120, 2010, 1240, 1310, 2380, 1420, 1500, 1580,
  2760, 1690, 1740, 2920, 1830, 1900, 3150, 1990, 2060,
  // peças do ciclo (somadas ao dia quando publicam)
  3380, 3620, 3940,
];
/** Dias com publicação (pontos na curva). */
const PUBLICOU = [11, 14, 18, 21, 24];
const DIAS_BASE = 27;

// ── Engajamento: você × média de 6 concorrentes (Mercado), em % ─────────────
const VOCE = [
  2.4, 2.5, 2.3, 2.6, 2.4, 2.5, 2.6, 2.4, 2.5, 2.9, 3.3, 3.6, 3.8, 4.1, 4.4, 4.5, 4.8, 5.0, 5.3,
  5.4, 5.6, 5.9, 6.0, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8,
];
const MERCADO = [
  2.9, 3.0, 2.8, 2.9, 3.0, 2.9, 2.8, 3.0, 2.9, 2.9, 3.0, 2.8, 2.9, 3.0, 2.9, 2.8, 2.9, 3.0, 2.9,
  2.9, 3.0, 2.8, 2.9, 2.9, 3.0, 2.9, 2.9, 2.8, 2.9, 2.9,
];

// ── Semana: peças criadas nos últimos 7 dias, hoje recebe as do ciclo ───────
const SEMANA = [
  { day: "Sex", base: 4 },
  { day: "Sáb", base: 2 },
  { day: "Dom", base: 2 },
  { day: "Seg", base: 5 },
  { day: "Ter", base: 4 },
  { day: "Qua", base: 5 },
  { day: "Hoje", base: 3 },
];

// ── Revisão: grade de 50 peças; uma foi ajustada, o resto passou de primeira ─
const GRADE = 50;
const AJUSTADA = 23;

type Etapa = {
  icon?: LucideIcon;
  brand?: BrandName;
  title: (kind: string) => string;
  detail: string;
};
const ETAPAS: Etapa[] = [
  { icon: Radar, title: () => "Pauta nova no Radar", detail: "tendência do seu setor, hoje" },
  { icon: BadgeCheck, title: (kind) => `${kind} pronto`, detail: "com a voz da sua marca" },
  { icon: BadgeCheck, title: () => "Revisado", detail: "dentro das regras da marca" },
  {
    icon: CalendarClock,
    title: () => "Agendado para 18:00",
    detail: "melhor horário do público",
  },
  { brand: "instagram", title: () => "Publicado em 4 redes", detail: "o alcance já está subindo" },
];
/** Etapa → módulo que ela acende (índice no mural). */
const ACENDE: Record<number, number[]> = { 1: [1], 2: [2], 3: [4], 4: [4, 0, 3] };

/** Lugares dos avisos (ver .ce-pulse-toast--N): faixas acima e abaixo do mural. */
const TOAST_SLOTS = 4;

export function EnginePulse({ className }: { className?: string }) {
  const tick = useTick(STEP_MS, CYCLE - 1);
  const t = tick % CYCLE;
  const peca = Math.floor(t / STEPS_PER_PIECE);
  const etapa = t % STEPS_PER_PIECE;
  const atual = PECAS[peca];

  // quantas peças do ciclo já passaram por cada etapa
  const prontas = peca + (etapa >= 1 ? 1 : 0);
  const revisadas = peca + (etapa >= 2 ? 1 : 0);
  const publicadas = peca + (etapa >= 4 ? 1 : 0);

  const dias = DIAS_BASE + publicadas;
  const alcance = useAnimatedNumber(sum(ALCANCE_DIA.slice(0, dias)));
  const voce = VOCE[dias - 1];
  const mercado = MERCADO[dias - 1];
  const vezes = useAnimatedNumber(voce / mercado);
  const crescimento = Math.round(
    (sum(ALCANCE_DIA.slice(dias - 7, dias)) / sum(ALCANCE_DIA.slice(0, 7)) - 1) * 100,
  );

  const semana = SEMANA.map((d, i) => (i === SEMANA.length - 1 ? d.base + prontas : d.base));
  const totalSemana = sum(semana);
  const preenchidas = 47 + revisadas;
  const aprovadas = preenchidas - 1;

  const acesos = new Set(ACENDE[etapa] ?? []);
  const avisos = [tick - 1, tick].filter((n) => n >= 0);
  const lit = (i: number) => (acesos.has(i) ? tick : null);

  return (
    <div className={`ce-pulse${className ? ` ${className}` : ""}`} aria-hidden="true">
      <div key={Math.floor(tick / CYCLE)} className="ce-pulse-wall">
        <Module
          index={0}
          wide
          lit={lit(0)}
          icon={TrendingUp}
          label="Mais alcance com a mesma equipe"
          number={Math.round(alcance).toLocaleString("pt-BR")}
          source="contas alcançadas · 1–30 out"
          delta={`+${crescimento}%`}
        >
          <ReachChart dias={dias} />
        </Module>

        <Module
          index={1}
          lit={lit(1)}
          icon={Zap}
          label="A semana pronta em minutos"
          number={String(totalSemana)}
          source="peças criadas · 7 dias"
        >
          <div className="ce-pulse-week">
            {semana.map((n, i) => (
              <div
                key={SEMANA[i].day}
                className="ce-pulse-week-day"
                data-today={i === semana.length - 1 || undefined}
              >
                <span
                  className="ce-pulse-week-bar"
                  style={{ "--h": n / 8, "--i": i } as CSSProperties}
                >
                  <span className="ce-pulse-week-n">{n}</span>
                </span>
                <span className="ce-pulse-week-label">{SEMANA[i].day}</span>
              </div>
            ))}
          </div>
        </Module>

        <Module
          index={2}
          lit={lit(2)}
          icon={BadgeCheck}
          label="Sempre com a voz da marca"
          number={`${Math.round((aprovadas / preenchidas) * 100)}%`}
          source="aprovadas de primeira"
        >
          <div className="ce-pulse-grid50">
            {Array.from({ length: GRADE }, (_, i) => (
              <span
                key={i}
                data-state={i >= preenchidas ? "empty" : i === AJUSTADA ? "fixed" : "ok"}
                data-new={(etapa === 2 && i === preenchidas - 1) || undefined}
              />
            ))}
          </div>
          <p className="ce-pulse-caption">
            {aprovadas} de {preenchidas} peças · 1 ajustada
          </p>
        </Module>

        <Module
          index={3}
          lit={lit(3)}
          icon={Swords}
          label="Na frente da concorrência"
          number={`${vezes.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`}
          source="o engajamento do mercado"
        >
          <MarketChart dias={dias} voce={voce} mercado={mercado} />
        </Module>

        <Module
          index={4}
          lit={lit(4)}
          label="Todas as redes num clique"
          number={atual.kind}
          source="hoje · 18:00"
        >
          <ul className="ce-pulse-redes">
            {REDES.map((rede, i) => (
              <RedeRow
                key={rede.brand}
                index={i}
                brand={rede.brand}
                name={rede.name}
                etapa={etapa}
                peca={peca}
                reach={atual.reach[rede.brand]}
              />
            ))}
          </ul>
        </Module>
      </div>

      {avisos.map((n) => {
        const passo = ETAPAS[(n % CYCLE) % STEPS_PER_PIECE];
        const kind = PECAS[Math.floor((n % CYCLE) / STEPS_PER_PIECE)].kind;
        return (
          <div
            key={n}
            className={`ce-pulse-glass ce-pulse-toast ce-pulse-toast--${n % TOAST_SLOTS}`}
            data-leaving={n < tick || undefined}
          >
            <span className="ce-pulse-toast-net">
              {passo.brand ? (
                <BrandIcon name={passo.brand} className="size-4" />
              ) : passo.icon ? (
                <passo.icon className="size-4 text-[var(--via-brand-blue)]" aria-hidden="true" />
              ) : null}
            </span>
            <span className="ce-pulse-toast-value">{passo.title(kind)}</span>
            <span className="ce-pulse-toast-label">{passo.detail}</span>
          </div>
        );
      })}
    </div>
  );
}

function Module({
  index,
  wide = false,
  lit,
  icon: Icon,
  label,
  number,
  source,
  delta,
  children,
}: {
  index: number;
  wide?: boolean;
  /** pulso que acendeu o módulo agora (null = apagado); a chave reinicia o brilho */
  lit: number | null;
  icon?: LucideIcon;
  label: string;
  number: string;
  source: string;
  delta?: string;
  children: ReactNode;
}) {
  return (
    // a célula recebe o foco do hover; o vidro dentro dela guarda a animação de entrada
    <div className={`ce-pulse-cell${wide ? " ce-pulse-cell--wide" : ""}`}>
      <div
        className={`ce-pulse-glass ce-pulse-module${wide ? " ce-pulse-module--wide" : ""}`}
        style={{ "--m": index } as CSSProperties}
      >
        {lit !== null ? <span key={lit} className="ce-pulse-lit" /> : null}
        <div className="ce-pulse-module-head">
          {Icon ? <Icon className="ce-pulse-module-icon" aria-hidden="true" /> : null}
          <span className="ce-pulse-module-label">{label}</span>
          {delta ? <span className="ce-pulse-delta">{delta}</span> : null}
        </div>
        <p className="ce-pulse-number">{number}</p>
        <p className="ce-pulse-source">{source}</p>
        <div className="ce-pulse-viz">{children}</div>
      </div>
    </div>
  );
}

/**
 * Uma rede no módulo "Todas as redes": muda a cada etapa da peça — na fila,
 * adaptando ao formato da rede, pronta, agendada, publicada — e, publicada,
 * o alcance conta de 0 e segue subindo de leve enquanto a peça roda.
 */
const REDE_STATUS = ["queue", "adapting", "ready", "scheduled", "done"] as const;
const REDE_LABEL: Record<(typeof REDE_STATUS)[number], string> = {
  queue: "na fila",
  adapting: "adaptando",
  ready: "pronta",
  scheduled: "18:00",
  done: "",
};

function RedeRow({
  index,
  brand,
  name,
  etapa,
  peca,
  reach,
}: {
  index: number;
  brand: BrandName;
  name: string;
  etapa: number;
  peca: number;
  reach: number;
}) {
  const status = REDE_STATUS[etapa];
  const shown = useAnimatedNumber(status === "done" ? reach : 0, 1100);
  return (
    <li data-status={status} style={{ "--i": index } as CSSProperties}>
      <BrandIcon
        name={brand}
        tone={MONO_ON_NAVY.includes(brand) ? "mono" : "brand"}
        className="size-3 text-white"
      />
      <span className="ce-pulse-redes-name">{name}</span>
      {status === "done" ? (
        <span key={`${peca}-done`} className="ce-pulse-redes-result">
          <Check className="size-3" aria-hidden="true" />+{formatK(Math.round(shown))}
        </span>
      ) : (
        <span key={`${peca}-${status}`} className="ce-pulse-redes-wait">
          {REDE_LABEL[status]}
        </span>
      )}
    </li>
  );
}

/** Alcance diário em área; pontos onde houve publicação; marca do início com o motor. */
function ReachChart({ dias }: { dias: number }) {
  const max = Math.max(...ALCANCE_DIA) * 1.08;
  const x = (i: number) => (i / (ALCANCE_DIA.length - 1)) * 320;
  const y = (v: number) => 72 - (v / max) * 72;
  const pts = ALCANCE_DIA.slice(0, dias);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(dias - 1).toFixed(1)} 72 L0 72 Z`;
  const marcas = [
    ...PUBLICOU,
    ...Array.from({ length: dias - DIAS_BASE }, (_, i) => DIAS_BASE + i),
  ];
  return (
    <div className="ce-pulse-plot">
      <svg viewBox="0 0 320 72" className="ce-pulse-chart" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ce-pulse-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--subido-blue)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--subido-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[18, 36, 54].map((gy) => (
          <line key={gy} x1="0" x2="320" y1={gy} y2={gy} className="ce-pulse-grid" />
        ))}
        <path d={area} fill="url(#ce-pulse-fill)" className="ce-pulse-area" />
        <path d={line} className="ce-pulse-line" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* HTML por cima do SVG esticado: ponto e rótulo não deformam */}
      <span className="ce-pulse-start" style={{ left: `${(x(INICIO) / 320) * 100}%` }}>
        começou aqui
      </span>
      {marcas.map((d) => (
        <span
          key={d}
          className="ce-pulse-pub"
          data-new={d >= DIAS_BASE || undefined}
          style={{ left: `${(x(d) / 320) * 100}%`, top: `${(y(ALCANCE_DIA[d]) / 72) * 100}%` }}
        />
      ))}
      <div className="ce-pulse-axis">
        <span>1 out</span>
        <span>30 out</span>
      </div>
    </div>
  );
}

/** Você × mercado: duas linhas; a sua cruza a do mercado depois do início. */
function MarketChart({ dias, voce, mercado }: { dias: number; voce: number; mercado: number }) {
  const max = 7.5;
  const x = (i: number) => (i / (VOCE.length - 1)) * 160;
  const y = (v: number) => 44 - (v / max) * 44;
  const path = (s: number[]) =>
    s
      .slice(0, dias)
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");
  const fmt = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%`;
  return (
    <div className="ce-pulse-market-wrap">
      <svg viewBox="0 0 160 44" className="ce-pulse-market" preserveAspectRatio="none">
        <path
          d={path(MERCADO)}
          className="ce-pulse-market-them"
          vectorEffect="non-scaling-stroke"
        />
        <path d={path(VOCE)} className="ce-pulse-market-you" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ce-pulse-legend">
        <span data-you>Você {fmt(voce)}</span>
        <span>Mercado {fmt(mercado)}</span>
      </div>
    </div>
  );
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function formatK(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : String(value);
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Pulso da história: soma 1 a cada `ms`. Com movimento reduzido fica parado em
 * `still` (o fim do ciclo, com tudo publicado).
 */
function useTick(ms: number, still: number): number {
  const [tick, setTick] = useState(() => (prefersReducedMotion() ? still : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return tick;
}

/**
 * Número que anda até o valor novo (ease-out cúbico). Na primeira vez conta
 * de 0 — é a entrada do módulo; depois só percorre a diferença.
 */
function useAnimatedNumber(target: number, duration = 900): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion()) return setValue(target);
    let frame = 0;
    const origin = from.current;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const next = origin + (target - origin) * (1 - Math.pow(1 - k, 3));
      from.current = next;
      setValue(next);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

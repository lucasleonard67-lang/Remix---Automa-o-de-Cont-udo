import { BrandIcon } from "@/components/brand-icon";
import type { BrandName } from "@/lib/brands";

// ---------------------------------------------------------------------------
// Conjunto das redes que o Zernio conecta, em poços de ícone do kit, com um
// flutuar lento (só transform; para em prefers-reduced-motion). Decorativo:
// a frase e o botão ao lado dizem o que fazer; os nomes vão no aria-label.
// ---------------------------------------------------------------------------

const NETWORKS: Array<{ name: BrandName; label: string; offset: string; delay: string }> = [
  { name: "instagram", label: "Instagram", offset: "translateY(6px)", delay: "0s" },
  { name: "tiktok", label: "TikTok", offset: "translateY(-6px)", delay: "-1.4s" },
  { name: "x", label: "X", offset: "translateY(2px)", delay: "-2.8s" },
  { name: "threads", label: "Threads", offset: "translateY(-4px)", delay: "-4.2s" },
  { name: "facebook", label: "Facebook", offset: "translateY(5px)", delay: "-5.6s" },
];

export function NetworkCluster() {
  return (
    <ul
      className="flex items-center justify-center gap-3"
      role="img"
      aria-label={`Redes: ${NETWORKS.map((n) => n.label).join(", ")}`}
    >
      {NETWORKS.map((network) => (
        <li
          key={network.name}
          aria-hidden="true"
          className="ce-float"
          style={{ transform: network.offset, animationDelay: network.delay }}
        >
          <span className="ce-tile-well !size-12 !rounded-[14px]">
            <BrandIcon name={network.name} className="size-6" />
          </span>
        </li>
      ))}
    </ul>
  );
}

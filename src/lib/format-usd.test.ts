import { describe, expect, it } from "vitest";

import { formatUsd, formatUsdRate } from "./format-usd";

describe("formatUsd (total)", () => {
  it("2 casas a partir de um centavo — inclusive abaixo de US$ 1 (regra do Reel)", () => {
    expect(formatUsd(0.864)).toBe("US$ 0,86");
    expect(formatUsd(0.07)).toBe("US$ 0,07");
    expect(formatUsd(3)).toBe("US$ 3,00");
    expect(formatUsd(12.5)).toBe("US$ 12,50");
  });

  it("fração de centavo não vira zero: 4 casas", () => {
    expect(formatUsd(0.005)).toBe("US$ 0,0050");
    expect(formatUsd(0.0001)).toBe("US$ 0,0001");
  });

  it("vazio, zero e não-número viram US$ 0,00", () => {
    expect(formatUsd(null)).toBe("US$ 0,00");
    expect(formatUsd(undefined)).toBe("US$ 0,00");
    expect(formatUsd(0)).toBe("US$ 0,00");
    expect(formatUsd(Number.NaN)).toBe("US$ 0,00");
  });
});

describe("formatUsdRate (preço por segundo)", () => {
  it("3 casas abaixo de US$ 1, com o sufixo /s", () => {
    expect(formatUsdRate(0.036)).toBe("US$ 0,036/s");
    expect(formatUsdRate(0.14)).toBe("US$ 0,140/s");
    expect(formatUsdRate(1.5)).toBe("US$ 1,50/s");
    expect(formatUsdRate(0.004)).toBe("US$ 0,0040/s");
  });
});

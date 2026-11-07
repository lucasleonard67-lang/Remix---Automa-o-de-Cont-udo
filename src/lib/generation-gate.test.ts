import { describe, expect, it } from "vitest";

import {
  DIRECTOR_UNITS,
  ENGINE_REASON,
  NO_PRICE,
  allBlockedReason,
  basisLabel,
  billableSeconds,
  directorDurationPlan,
  estimateFromCatalog,
  fitDirectorDuration,
  noPriceShort,
  optionUsd,
  rankOptions,
  recommendEngine,
  resolveRanked,
  sceneSeconds,
  selectionFallbackReason,
  unitBillableSeconds,
  type GateOption,
  type GateSignals,
} from "./generation-gate";
import { modelNote } from "./model-notes";

// Catálogo de hoje (supabase/seed-instancia.sql) — ids, preços e `limits` reais.
const lite: GateOption = {
  engine: "replicate",
  id: "bytedance/seedance-1-lite",
  label: "Seedance 1 Lite",
  detail: "US$ 0,036/s · 4–12 s",
  usdPerSecond: 0.036,
  maxSeconds: 12,
  durationMode: "continuous",
  capability: "scene_i2v",
  isDefault: false,
};
const seedance2: GateOption = {
  engine: "replicate",
  id: "bytedance/seedance-2.0",
  label: "Seedance 2.0",
  detail: "US$ 0,140/s · 4–15 s",
  usdPerSecond: 0.14,
  maxSeconds: 15,
  durationMode: "continuous",
  capability: "scene_i2v",
  isDefault: true,
};
const kling: GateOption = {
  engine: "replicate",
  id: "kwaivgi/kling-v2.5-turbo-pro",
  label: "Kling v2.5 Turbo Pro",
  detail: "US$ 0,070/s · 5 ou 10 s",
  usdPerSecond: 0.07,
  maxSeconds: 10,
  durationMode: "discrete",
  durations: [5, 10],
  capability: "scene_i2v",
  isDefault: false,
};
const hailuo: GateOption = {
  engine: "replicate",
  id: "minimax/hailuo-2.3",
  label: "Hailuo 2.3",
  detail: "US$ 0,060/s · 6 ou 10 s",
  usdPerSecond: 0.06,
  maxSeconds: 10,
  durationMode: "discrete",
  durations: [6, 10],
  capability: "scene_i2v",
  isDefault: false,
};
// sem `limits` no catálogo: modo de duração desconhecido — sem nota de bloco, sem bônus de contínuo
const unknownMode: GateOption = {
  engine: "replicate",
  id: "acme/mystery",
  label: "Mystery",
  detail: "US$ 0,090/s",
  usdPerSecond: 0.09,
  maxSeconds: null,
  isDefault: false,
};
const hfStudio: GateOption = {
  engine: "higgsfield",
  id: "cinematic_studio_3_0",
  label: "Cinema Studio 3.0",
  detail: "até 15 s por cena",
  usdPerSecond: null,
  maxSeconds: 15,
  isDefault: true,
};
const hfVideo2: GateOption = {
  engine: "higgsfield",
  id: "cinematic_studio_video_v2",
  label: "Cinema Studio Video 2",
  detail: "até 12 s por cena",
  usdPerSecond: null,
  maxSeconds: 12,
  isDefault: false,
};
const premium: GateOption = {
  engine: "replicate",
  id: "acme/premium-v1",
  label: "Premium V1",
  detail: "US$ 0,300/s · 4–20 s",
  usdPerSecond: 0.3,
  maxSeconds: 20,
  durationMode: "continuous",
  isDefault: false,
};
// voz (cobra por letra) + ElevenLabs sem preço no catálogo
const minimax: GateOption = {
  engine: "replicate",
  id: "minimax/speech-02-hd",
  label: "Speech 02 HD",
  detail: "US$ 0,10/1k letras",
  usdPerSecond: null,
  usdPer1kChars: 0.1,
  maxSeconds: null,
  capability: "tts",
  isDefault: true,
};
const eleven: GateOption = {
  engine: "elevenlabs",
  id: "elevenlabs",
  label: "Voz da marca",
  detail: "",
  usdPerSecond: null,
  maxSeconds: null,
  isDefault: false,
};
// quadro (cobra por imagem)
const banana: GateOption = {
  engine: "replicate",
  id: "google/nano-banana-2",
  label: "Nano Banana 2",
  detail: "US$ 0,08/imagem",
  usdPerSecond: null,
  usdPerImage: 0.08,
  maxSeconds: null,
  capability: "keyframe",
  isDefault: true,
};

const seven = [lite, seedance2, kling, hailuo, unknownMode, hfStudio, hfVideo2];

const base: GateSignals = {
  hasPresenter: false,
  durationSeconds: 24,
  scenes: 5,
  isDraft: false,
  connected: { higgsfield: "on", replicate: "on" },
};

const order = (rows: ReturnType<typeof rankOptions>) => rows.map((r) => r.option.id);
const badges = (rows: ReturnType<typeof rankOptions>) =>
  Object.fromEntries(rows.filter((r) => r.badge).map((r) => [r.option.id, r.badge]));

describe("recommendEngine (motor)", () => {
  it("sem apresentador → Replicate; com apresentador e Higgsfield não desconectado → Higgsfield", () => {
    expect(recommendEngine(seven, base)).toEqual({
      engine: "replicate",
      reason: ENGINE_REASON.replicate,
    });
    expect(recommendEngine(seven, { ...base, hasPresenter: true })?.engine).toBe("higgsfield");
    expect(
      recommendEngine(seven, {
        ...base,
        hasPresenter: true,
        connected: { higgsfield: "off", replicate: "on" },
      })?.engine,
    ).toBe("replicate");
  });

  it("desconectado nunca; sem verificação não bloqueia; nada conectado → null", () => {
    expect(
      recommendEngine(seven, { ...base, connected: { higgsfield: "on", replicate: "off" } })
        ?.engine,
    ).toBe("higgsfield");
    expect(
      recommendEngine(seven, {
        ...base,
        connected: { higgsfield: "loading", replicate: "unknown" },
      })?.engine,
    ).toBe("replicate");
    expect(
      recommendEngine(seven, { ...base, connected: { higgsfield: "off", replicate: "off" } }),
    ).toBeNull();
  });
});

describe("rankOptions (a lista única)", () => {
  it("Recomendada no topo, com preço por preço crescente, sem preço depois", () => {
    const rows = rankOptions(seven, base);
    expect(order(rows)).toEqual([
      seedance2.id, // Recomendada
      lite.id, // 0,036
      hailuo.id, // 0,06
      kling.id, // 0,07
      unknownMode.id, // 0,09
      hfStudio.id, // sem preço
      hfVideo2.id,
    ]);
    // melhor qualidade = Seedance 2.0 = Recomendada → sem segundo selo; blocos e modo
    // desconhecido nunca levam selo
    expect(badges(rows)).toEqual({ [seedance2.id]: "recommended", [lite.id]: "cheapest" });
  });

  it("rascunho (só quadros): a Recomendada vira a contínua mais barata; a cara vira Melhor qualidade", () => {
    const rows = rankOptions([lite, seedance2, premium], { ...base, isDraft: true });
    expect(badges(rows)).toEqual({ [lite.id]: "recommended", [premium.id]: "best" });
    expect(order(rows)[0]).toBe(lite.id);
  });

  it("três contínuas com preço: Mais barato · Recomendado (padrão) · Melhor qualidade", () => {
    const rows = rankOptions([lite, seedance2, premium], base);
    expect(badges(rows)).toEqual({
      [lite.id]: "cheapest",
      [seedance2.id]: "recommended",
      [premium.id]: "best",
    });
  });

  it("cada linha tem sublinha, teto e status", () => {
    const rows = rankOptions(seven, base);
    const rec = rows[0];
    expect(rec.note).toBe(
      "Sem segundos mudos no fim; mantém o rosto do apresentador. Até 15 s por cena.",
    );
    expect(rec.estimate).toEqual({
      kind: "catalog",
      maxUsd: 0.14 * 24,
      dependsOn: "depende de 24 s de cena · 5 cenas",
    });
    expect(rec.status).toBe("on");
    const hf = rows.find((r) => r.option.id === hfStudio.id)!;
    expect(hf.estimate).toEqual({
      kind: "none",
      reason: "cobrado em créditos na sua conta Higgsfield",
    });
    expect(noPriceShort("higgsfield")).toBe("sem estimativa · créditos Higgsfield");
    expect(noPriceShort("replicate")).toBe("sem preço no catálogo");
  });

  it("blocos: cada cena paga o bloco seguinte (5 cenas de 5 s no Kling = 5 × 5 s; 6 s → 10 s)", () => {
    const rows = rankOptions(seven, base);
    const k = rows.find((r) => r.option.id === kling.id)!;
    // 24 s / 5 = 5 s por cena → bloco 5 → 5 × 5 × 0,07
    expect(k.estimate).toEqual({
      kind: "catalog",
      maxUsd: 0.07 * 5 * 5,
      dependsOn: "depende de 24 s de cena · 5 cenas",
    });
    expect(k.note).toBe("Cobra em blocos de 5 ou 10 s: uma fala de 6 s paga 10.");
    // 30 s / 5 = 6 s por cena → bloco 10
    expect(billableSeconds(kling, 6)).toBe(10);
    expect(optionUsd(kling, { ...base, durationSeconds: 30 })).toBeCloseTo(0.07 * 10 * 5, 10);
    // Hailuo 6/10: 5 s por cena → 6; 7 → 10; 12 → 10 (maior bloco)
    expect(billableSeconds(hailuo, 5)).toBe(6);
    expect(billableSeconds(hailuo, 7)).toBe(10);
    expect(billableSeconds(hailuo, 12)).toBe(10);
    // contínuo não arredonda
    expect(billableSeconds(lite, 6)).toBe(6);
  });

  it("sem base (0 s / 0 letras / 0 imagens) a linha fica sem valor", () => {
    const rows = rankOptions(seven, { ...base, durationSeconds: 0 });
    expect(rows.find((r) => r.option.id === seedance2.id)?.estimate).toBeNull();
    // sem preço continua avisando quem cobra
    expect(rows.find((r) => r.option.id === hfStudio.id)?.estimate?.kind).toBe("none");
    expect(rankOptions([minimax], { ...base, chars: 0 })[0].estimate).toBeNull();
    expect(rankOptions([banana], { ...base, scenes: undefined, images: 0 })[0].estimate).toBeNull();
  });

  it("quadros cobram por imagem (uma por cena)", () => {
    const rows = rankOptions([banana], base);
    expect(rows[0].estimate).toEqual({
      kind: "catalog",
      maxUsd: 0.08 * 5,
      dependsOn: "depende de 5 imagens",
    });
    expect(rows[0].badge).toBe("recommended");
  });

  it("apresentador fixo: Higgsfield recomendado no topo, mesmo sem preço; extremos de preço ganham selo", () => {
    const rows = rankOptions(seven, { ...base, hasPresenter: true });
    expect(rows[0].option.id).toBe(hfStudio.id);
    expect(badges(rows)).toEqual({
      [hfStudio.id]: "recommended",
      [lite.id]: "cheapest",
      [seedance2.id]: "best",
    });
  });

  it("desconectado vai para o fim, sem selo", () => {
    const rows = rankOptions(seven, { ...base, connected: { higgsfield: "off", replicate: "on" } });
    expect(order(rows).slice(-2)).toEqual([hfStudio.id, hfVideo2.id]);
    expect(rows.at(-1)?.status).toBe("off");
    expect(rows.find((r) => r.option.engine === "higgsfield")?.badge).toBeNull();
  });

  it("duração: quem não aguenta a cena fica desabilitado, depois das válidas do grupo", () => {
    // 70 s / 5 = 14 s por cena: Lite (12), Kling (10), Hailuo (10), Cinema 2 (12) caem
    const rows = rankOptions(seven, { ...base, durationSeconds: 70 });
    const blocked = rows.filter((r) => r.blocked).map((r) => r.option.id);
    expect(blocked).toEqual(expect.arrayContaining([lite.id, kling.id, hailuo.id, hfVideo2.id]));
    expect(rows.find((r) => r.option.id === lite.id)?.blocked).toBe(
      "faz até 12 s; a cena pede 14 s",
    );
    const priced = rows.filter((r) => r.option.usdPerSecond != null).map((r) => r.option.id);
    expect(priced.slice(0, 2)).toEqual([seedance2.id, unknownMode.id]);
  });

  it("1 opção: só ela, Recomendada", () => {
    const rows = rankOptions([lite], base);
    expect(rows).toHaveLength(1);
    expect(rows[0].badge).toBe("recommended");
  });

  it("regra da tarefa: voz da marca (ElevenLabs) recomendada quando conectada; MiniMax é o Mais barato", () => {
    const signals: GateSignals = {
      ...base,
      chars: 320,
      connected: { replicate: "on", elevenlabs: "on" },
    };
    const rows = rankOptions([minimax, eleven], signals, { preferredId: "elevenlabs" });
    expect(order(rows)).toEqual([eleven.id, minimax.id]);
    expect(badges(rows)).toEqual({ [eleven.id]: "recommended", [minimax.id]: "cheapest" });
    expect(rows[0].estimate).toEqual({ kind: "none", reason: "cobrado na sua conta ElevenLabs" });
    expect(rows[1].estimate).toEqual({
      kind: "catalog",
      maxUsd: 0.1 * 0.32,
      dependsOn: "depende de 320 letras",
    });
    expect(noPriceShort("elevenlabs")).toBe("sem estimativa · conta ElevenLabs");
  });

  it("regra da tarefa: ElevenLabs desconectada → MiniMax recomendada e ElevenLabs no fim", () => {
    const rows = rankOptions(
      [minimax, eleven],
      { ...base, chars: 320, connected: { replicate: "on", elevenlabs: "off" } },
      { preferredId: "elevenlabs" },
    );
    expect(order(rows)).toEqual([minimax.id, eleven.id]);
    expect(badges(rows)).toEqual({ [minimax.id]: "recommended" });
  });
});

describe("resolveRanked / selectionFallbackReason", () => {
  it("sem escolha, A é a Recomendada; com Comparar duas, B é a próxima válida", () => {
    const rows = rankOptions(seven, base);
    expect(resolveRanked(rows, { a: null, b: null }, false).a?.option.id).toBe(seedance2.id);
    const both = resolveRanked(rows, { a: null, b: null }, true);
    expect(both.a?.option.id).toBe(seedance2.id);
    expect(both.b?.option.id).toBe(lite.id);
  });

  it("escolhas explícitas valem; B nunca repete A", () => {
    const rows = rankOptions(seven, base);
    const r = resolveRanked(rows, { a: kling.id, b: kling.id }, true);
    expect(r.a?.option.id).toBe(kling.id);
    expect(r.b?.option.id).toBe(seedance2.id);
  });

  it("escolha explícita que deixou de aguentar a duração cai na Recomendada e explica", () => {
    const signals = { ...base, durationSeconds: 70 };
    const rows = rankOptions(seven, signals);
    const selection = { a: lite.id, b: null };
    expect(resolveRanked(rows, selection, false).a?.option.id).toBe(seedance2.id);
    expect(selectionFallbackReason(rows, selection, sceneSeconds(signals))).toBe(
      "Este modelo faz até 12 s. Para 14 s, use Seedance 2.0.",
    );
    expect(selectionFallbackReason(rows, { a: seedance2.id, b: null }, 14)).toBeNull();
  });

  it("todas bloqueadas por duração: A nulo e motivo com o que fazer", () => {
    // 90 s em 3 cenas = 30 s por cena: nenhum modelo aguenta
    const signals = { ...base, durationSeconds: 90, scenes: 3 };
    const rows = rankOptions([lite, seedance2, kling, hfStudio], signals);
    expect(rows.every((r) => r.blocked)).toBe(true);
    expect(resolveRanked(rows, { a: lite.id, b: null }, true)).toEqual({ a: null, b: null });
    expect(allBlockedReason(rows, sceneSeconds(signals))).toBe(
      "Nenhum modelo faz cenas de 30 s. Reduza a duração ou aumente o nº de cenas.",
    );
    expect(allBlockedReason(rankOptions(seven, base), 5)).toBeNull();
    expect(allBlockedReason([], 5)).toBeNull();
  });

  it("NO_PRICE: uma tabela, frase longa para a base e curta para a lista", () => {
    expect(NO_PRICE.higgsfield.long).toBe("cobrado em créditos na sua conta Higgsfield");
    expect(noPriceShort("heygen")).toBe(NO_PRICE.heygen.short);
  });

  it("desconectado pode ser escolhido (o CTA vira Conectar)", () => {
    const rows = rankOptions(seven, { ...base, connected: { higgsfield: "off", replicate: "on" } });
    expect(resolveRanked(rows, { a: hfStudio.id, b: null }, false).a?.status).toBe("off");
  });
});

describe("sceneSeconds / basisLabel", () => {
  it("arredonda para cima e nunca fica abaixo de 1", () => {
    expect(sceneSeconds({ durationSeconds: 24, scenes: 5 })).toBe(5);
    expect(sceneSeconds({ durationSeconds: 70, scenes: 5 })).toBe(14);
    expect(sceneSeconds({ durationSeconds: 0, scenes: 3 })).toBe(1);
  });

  it("base por segundos, letras ou imagens", () => {
    expect(basisLabel(base)).toBe("depende de 24 s de cena · 5 cenas");
    expect(basisLabel({ ...base, chars: 120 }, minimax)).toBe("depende de 120 letras");
    expect(basisLabel({ ...base, images: 1 }, banana)).toBe("depende de 1 imagem");
  });
});

describe("estimateFromCatalog", () => {
  it("teto = preço por segundo × segundos de cena", () => {
    expect(estimateFromCatalog(lite, null, base)).toEqual({
      kind: "catalog",
      maxUsd: 0.036 * 24,
      dependsOn: "depende de 24 s de cena · 5 cenas",
    });
  });

  it("Comparar duas: A + B = Total, B = primeiro trecho, teto = min(máximo do B, total) no bloco", () => {
    const estimate = estimateFromCatalog(seedance2, kling, { ...base, durationSeconds: 60 });
    if (!estimate || estimate.kind !== "catalog") throw new Error("esperava catálogo");
    // B: Kling faz até 10 s → bloco 10
    expect(estimate.parts).toEqual({ a: 0.14 * 60, b: 0.07 * 10 });
    expect(estimate.dependsOn).toBe(
      "depende de 60 s de cena · 5 cenas · gera o primeiro trecho nos dois modelos",
    );
  });

  it("sem preço: avisa em quem cobra, nunca inventa número; sem base: null", () => {
    expect(estimateFromCatalog(hfStudio, null, base)).toEqual({
      kind: "none",
      reason: "cobrado em créditos na sua conta Higgsfield",
    });
    expect(estimateFromCatalog(lite, hfStudio, base)?.kind).toBe("none");
    expect(estimateFromCatalog(null, null, base)?.kind).toBe("none");
    expect(estimateFromCatalog(lite, null, { ...base, durationSeconds: 0 })).toBeNull();
  });

  it("voz: por 1k letras", () => {
    expect(estimateFromCatalog(minimax, null, { ...base, chars: 500 })).toEqual({
      kind: "catalog",
      maxUsd: 0.05,
      dependsOn: "depende de 500 letras",
    });
  });
});

describe("modelNote", () => {
  it("frase do modelo + limite; genérico por capacidade quando não há frase", () => {
    expect(modelNote(lite, "scene_i2v")).toBe("Movimento mais simples. Até 12 s por cena.");
    expect(modelNote({ id: "x/novo", maxSeconds: null }, "scene_v2v")).toBe(
      "Refaz o vídeo mantendo o movimento.",
    );
    expect(modelNote({ id: "x/novo", maxSeconds: 8, durationMode: "discrete" }, "scene_i2v")).toBe(
      "Gera a cena em vídeo a partir do quadro.",
    );
  });
});

describe("cobrança por unidade (Diretor)", () => {
  const units = { ...base, units: DIRECTOR_UNITS };

  it("cada cena paga fala + 1 s, com piso de 4 s", () => {
    // 24 s / 5 cenas = 4,8 s → ceil(5,8) = 6 s por clipe
    expect(unitBillableSeconds(seedance2, units)).toBe(6);
    expect(optionUsd(seedance2, units)).toBeCloseTo(0.14 * 6 * 5);
    // 8 s / 5 cenas = 1,6 s → 3 s, sobe para o piso de 4 s
    expect(unitBillableSeconds(lite, { ...units, durationSeconds: 8 })).toBe(4);
  });

  it("blocos sobem depois da folga: 4,8 s + 1 s → bloco de 10 s no Kling", () => {
    expect(unitBillableSeconds(kling, units)).toBe(10);
    expect(unitBillableSeconds(kling, { ...units, durationSeconds: 20 })).toBe(5);
  });

  it("a base diz o que é cobrado", () => {
    expect(basisLabel(units, seedance2)).toBe("depende de 24 s de cena · 5 cenas · cobra 5 × 6 s");
  });

  it("sem `units` o cálculo antigo continua (Reel, Remake)", () => {
    expect(optionUsd(seedance2, base)).toBeCloseTo(0.14 * 24);
  });
});

describe("duração do Diretor pelo modelo", () => {
  it("blocos: um total por bloco, para a fala + 1 s cair no bloco", () => {
    const plan = directorDurationPlan(kling, 5);
    expect(plan).toEqual({
      kind: "blocks",
      blocks: [
        { seconds: 5, total: 20 },
        { seconds: 10, total: 45 },
      ],
    });
    expect(fitDirectorDuration(plan, 24)).toBe(20);
    expect(fitDirectorDuration(plan, 40)).toBe(45);
  });

  it("faixa: até o máximo do modelo por cena, dentro de 8–90 s", () => {
    const plan = directorDurationPlan(lite, 3);
    expect(plan).toEqual({ kind: "range", min: 8, max: 36, perSceneMax: 12 });
    expect(fitDirectorDuration(plan, 60)).toBe(36);
    expect(fitDirectorDuration(plan, 2)).toBe(8);
    expect(fitDirectorDuration(plan, Number.NaN)).toBe(24);
    expect(directorDurationPlan(null, 5)).toEqual({
      kind: "range",
      min: 8,
      max: 90,
      perSceneMax: null,
    });
  });
});

import { describe, expect, it } from "vitest";

import { PRICE_TBD } from "@/lib/heygen-avatar";
import {
  analyzeVoice,
  encodeWav,
  formatClock,
  rmsDb,
  scriptBlockAt,
  voiceCostLabel,
  voiceIssues,
  voiceRowFor,
  type VoiceAnalysis,
} from "@/lib/voice-recording";

const RATE = 8000;

/** fala sintética: seno com a amplitude dada, com trechos de silêncio */
function signal(seconds: number, amp: number, silentEvery = 0, noise = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const silent = silentEvery > 0 && Math.floor(t / silentEvery) % 2 === 1;
    const n = noise ? (Math.random() * 2 - 1) * noise : 0;
    out[i] = (silent ? 0 : amp * Math.sin(2 * Math.PI * 220 * t)) + n;
  }
  return out;
}

const good: VoiceAnalysis = {
  seconds: 90,
  clipRatio: 0,
  speechDb: -20,
  noiseDb: -70,
  silenceRatio: 0.1,
};

describe("encodeWav", () => {
  it("escreve o cabeçalho PCM 16-bit mono", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 44_100);
    const view = new DataView(wav);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(wav.slice(o, o + 4)));
    expect(wav.byteLength).toBe(44 + 8);
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(36)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(28, true)).toBe(88_200);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
  });

  it("converte e limita as amostras", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2])));
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });
});

describe("analyzeVoice", () => {
  it("mede duração e nível", () => {
    const a = analyzeVoice(signal(40, 0.3), RATE, -80);
    expect(a.seconds).toBeCloseTo(40);
    // seno de amplitude 0,3 → RMS ≈ −13,5 dBFS
    expect(a.speechDb).toBeGreaterThan(-15);
    expect(a.speechDb).toBeLessThan(-12);
    expect(a.clipRatio).toBe(0);
    expect(a.silenceRatio).toBeLessThan(0.05);
  });

  it("conta o estouro", () => {
    expect(analyzeVoice(signal(40, 1.2), RATE, -80).clipRatio).toBeGreaterThan(0.1);
  });

  it("conta o silêncio", () => {
    const a = analyzeVoice(signal(40, 0.3, 1), RATE, -80);
    expect(a.silenceRatio).toBeGreaterThan(0.45);
    expect(a.silenceRatio).toBeLessThan(0.55);
  });

  it("estima o ruído sem o silêncio inicial", () => {
    const a = analyzeVoice(signal(40, 0.3, 1, 0.02), RATE);
    expect(a.noiseDb).toBeGreaterThan(-50);
    expect(analyzeVoice(signal(40, 0.3, 1), RATE).noiseDb).toBeLessThan(-100);
  });

  it("rmsDb de silêncio é o piso", () => {
    expect(rmsDb(new Float32Array(100))).toBe(-120);
  });
});

describe("voiceIssues", () => {
  it("passa uma boa gravação", () => {
    expect(voiceIssues(good)).toEqual([]);
  });

  it("bloqueia curta, estourada, baixa e com silêncio demais", () => {
    const ids = (a: Partial<VoiceAnalysis>) =>
      voiceIssues({ ...good, ...a }).map((i) => [i.id, i.blocking]);
    expect(ids({ seconds: 29 })).toEqual([["short", true]]);
    expect(ids({ clipRatio: 0.01 })).toEqual([["clipping", true]]);
    expect(ids({ clipRatio: 0.004 })).toEqual([]);
    expect(ids({ speechDb: -36 })).toEqual([["low", true]]);
    expect(ids({ silenceRatio: 0.41 })).toEqual([["silence", true]]);
  });

  it("só avisa do barulho", () => {
    const issues = voiceIssues({ ...good, noiseDb: -45 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: "noise", blocking: false });
  });

  it("vale para a medição de verdade", () => {
    const quiet = analyzeVoice(signal(40, 0.005), RATE, -90);
    expect(voiceIssues(quiet).map((i) => i.id)).toContain("low");
  });
});

describe("voiceCostLabel", () => {
  it("preço não conferido nunca é grátis", () => {
    expect(voiceCostLabel(undefined)).toBe(PRICE_TBD);
    expect(voiceCostLabel({ cost: { usd: 0, verified: false } })).toBe(PRICE_TBD);
    expect(voiceCostLabel({ cost: { usd: 0 } })).toBe(PRICE_TBD);
    expect(voiceCostLabel({ cost: { verified: true } })).toBe(PRICE_TBD);
  });
  it("conferido", () => {
    expect(voiceCostLabel({ cost: { usd: 0, verified: true } })).toBe("grátis");
    expect(voiceCostLabel({ cost: { usd: 0.3, verified: true, unit: "per_1k_chars" } })).toBe(
      "US$ 0,30 por mil letras",
    );
  });
});

describe("voiceRowFor", () => {
  const rows = [
    { model_id: "e", provider: "elevenlabs", tier: "default", experience: ["own_voice"], cost: {} },
    { model_id: "h", provider: "heygen", tier: "alt", experience: ["own_voice"], cost: {} },
  ];
  it("usa o provedor escolhido, senão o default", () => {
    expect(voiceRowFor(rows, "own_voice", "heygen")?.model_id).toBe("h");
    expect(voiceRowFor(rows, "own_voice", null)?.model_id).toBe("e");
    expect(voiceRowFor(rows, "voice_design", null)).toBeUndefined();
  });
});

describe("roteiro", () => {
  it("anda com o tempo", () => {
    expect(scriptBlockAt(0)).toBe(0);
    expect(scriptBlockAt(25)).toBe(1);
    expect(scriptBlockAt(500)).toBe(2);
    expect(formatClock(65)).toBe("1:05");
  });
});

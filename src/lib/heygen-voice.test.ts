import { describe, expect, it } from "vitest";

import {
  explicitHeygenVoice,
  heygenVoiceIdOf,
  heygenVoiceValue,
  listableClones,
  resolveAvatarVoice,
  voiceForSelection,
} from "@/lib/heygen-voice";

const base = { hasSaved: false, clones: [], clonesLoading: false, names: ["Ana"] };

describe("voz HeyGen na escolha do estúdio", () => {
  it("vai e volta pelo valor do seletor", () => {
    expect(heygenVoiceIdOf(heygenVoiceValue("abc"))).toBe("abc");
    expect(heygenVoiceIdOf("elevenlabs")).toBeNull();
    expect(heygenVoiceIdOf(null)).toBeNull();
  });

  it("não repete o que já aparece em outra lista", () => {
    const clones = [{ voice_id: "a" }, { voice_id: "b" }];
    expect(listableClones(clones, new Set(["a"]))).toEqual([{ voice_id: "b" }]);
  });
});

describe("a voz acompanha o avatar", () => {
  it("segue a ordem: salva, look, cadastro, grupo, clone de mesmo nome", () => {
    expect(resolveAvatarVoice({ ...base, hasSaved: true, lookVoice: "l" })).toEqual({
      state: "found",
      pick: "saved",
    });
    expect(resolveAvatarVoice({ ...base, lookVoice: "l", groupVoice: "g" })).toEqual({
      state: "found",
      pick: "heygen:l",
    });
    expect(resolveAvatarVoice({ ...base, refVoice: "r", groupVoice: "g" })).toEqual({
      state: "found",
      pick: "heygen:r",
    });
    expect(resolveAvatarVoice({ ...base, groupVoice: "g" })).toEqual({
      state: "found",
      pick: "heygen:g",
    });
    expect(resolveAvatarVoice({ ...base, clones: [{ voice_id: "c", name: " ana " }] })).toEqual({
      state: "found",
      pick: "heygen:c",
    });
  });

  it("enquanto carrega, não marca outra voz", () => {
    expect(resolveAvatarVoice({ ...base, groupLoading: true })).toEqual({ state: "loading" });
    expect(resolveAvatarVoice({ ...base, clonesLoading: true })).toEqual({ state: "loading" });
    expect(voiceForSelection(null, "a", { state: "loading" })).toBeNull();
  });

  it("voz na look não espera o grupo nem os clones", () => {
    expect(
      resolveAvatarVoice({ ...base, lookVoice: "l", groupLoading: true, clonesLoading: true }),
    ).toEqual({ state: "found", pick: "heygen:l" });
  });

  it("sem voz nenhuma, nada vem marcado e a pessoa escolhe", () => {
    const voice = resolveAvatarVoice({ ...base, clones: [{ voice_id: "c", name: "Bruno" }] });
    expect(voice).toEqual({ state: "none" });
    expect(voiceForSelection(null, "a", voice)).toBeNull();
  });

  it("troca entre dois avatares: nunca sobra a voz do anterior", () => {
    const vozDaAna = resolveAvatarVoice({ ...base, lookVoice: "ana" });
    const vozDoBruno = resolveAvatarVoice({ ...base, names: ["Bruno"], lookVoice: "bruno" });
    expect(voiceForSelection(null, "ana", vozDaAna)).toBe("heygen:ana");
    // a pessoa troca a voz da Ana à mão…
    const manual = { avatarId: "ana", pick: "elevenlabs" };
    expect(voiceForSelection(manual, "ana", vozDaAna)).toBe("elevenlabs");
    // …e o Bruno entra com a voz dele, não com a escolha feita para a Ana
    expect(voiceForSelection(manual, "bruno", vozDoBruno)).toBe("heygen:bruno");
    // volta para a Ana: a escolha manual dela continua valendo
    expect(voiceForSelection(manual, "ana", vozDaAna)).toBe("elevenlabs");
  });

  it("troca para um avatar ainda carregando: não herda a voz do anterior", () => {
    const manual = { avatarId: "ana", pick: "heygen:ana" };
    expect(voiceForSelection(manual, "bruno", { state: "loading" })).toBeNull();
  });
});

describe("voz no job", () => {
  it("a voz resolvida vai com voice_id, inclusive a que veio do grupo", () => {
    const groupVoice = resolveAvatarVoice({ ...base, groupVoice: "g" });
    const pick = voiceForSelection(null, "a", groupVoice);
    expect(explicitHeygenVoice(pick!, null)).toEqual({ provider: "heygen", voice_id: "g" });
  });

  it("a voz salva HeyGen também vai com voice_id", () => {
    expect(explicitHeygenVoice("saved", { provider: "heygen", voice_id: "s" })).toEqual({
      provider: "heygen",
      voice_id: "s",
    });
  });

  it("o que não é HeyGen com id fica com o caminho de antes", () => {
    expect(explicitHeygenVoice("saved", { provider: "twin" })).toBeNull();
    expect(explicitHeygenVoice("saved", null)).toBeNull();
    expect(explicitHeygenVoice("elevenlabs", null)).toBeNull();
  });
});

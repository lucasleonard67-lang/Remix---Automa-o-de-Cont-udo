// Vozes da HeyGen na escolha de voz dos estúdios, sem React. Uma voz da conta
// entra como `heygen:<voice_id>` e vai direto em voice_id, sem ElevenLabs.

const PREFIX = "heygen:";

export const heygenVoiceValue = (voiceId: string) => `${PREFIX}${voiceId}`;

export function heygenVoiceIdOf(pick: string | null | undefined): string | null {
  return pick?.startsWith(PREFIX) ? pick.slice(PREFIX.length) : null;
}

export type AvatarVoice =
  | { state: "loading" }
  | { state: "found"; pick: string }
  /** Sem voz nenhuma: só aqui a pessoa escolhe. */
  | { state: "none" };

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

/**
 * A voz do avatar selecionado. Ordem: a salva no apresentador → a da look →
 * a do avatar no cadastro → a do grupo → o clone da conta com o mesmo nome.
 * Enquanto uma fonte ainda responde, é "loading": nunca marca outra voz antes.
 */
export function resolveAvatarVoice(input: {
  hasSaved: boolean;
  lookVoice?: string | null;
  refVoice?: string | null;
  groupVoice?: string | null;
  groupLoading?: boolean;
  clones: readonly { voice_id: string; name: string }[];
  clonesLoading: boolean;
  names: readonly string[];
}): AvatarVoice {
  if (input.hasSaved) return { state: "found", pick: "saved" };
  const direct = input.lookVoice || input.refVoice;
  if (direct) return { state: "found", pick: heygenVoiceValue(direct) };
  if (input.groupLoading) return { state: "loading" };
  if (input.groupVoice) return { state: "found", pick: heygenVoiceValue(input.groupVoice) };
  if (input.clonesLoading) return { state: "loading" };
  const clone = input.clones.find((c) => input.names.some((name) => sameName(c.name, name)));
  return clone ? { state: "found", pick: heygenVoiceValue(clone.voice_id) } : { state: "none" };
}

/** Escolha manual de voz, presa ao avatar em que foi feita. */
export interface ManualVoice {
  avatarId: string;
  pick: string;
}

/** A voz que vale agora: a escolha manual só para o mesmo avatar; trocou, a voz acompanha. */
export function voiceForSelection(
  manual: ManualVoice | null,
  avatarId: string | null,
  voice: AvatarVoice,
): string | null {
  if (manual && manual.avatarId === avatarId) return manual.pick;
  return voice.state === "found" ? voice.pick : null;
}

/**
 * Voz HeyGen do job, sempre com `voice_id`: sem ele, o motor olha só a look e
 * falha quando a voz veio do grupo. null = não é uma voz HeyGen com id.
 */
export function explicitHeygenVoice(
  pick: string,
  saved: { provider: string; voice_id?: string } | null,
): { provider: "heygen"; voice_id: string } | null {
  const picked = heygenVoiceIdOf(pick);
  if (picked) return { provider: "heygen", voice_id: picked };
  if (pick === "saved" && saved?.provider === "heygen" && saved.voice_id) {
    return { provider: "heygen", voice_id: saved.voice_id };
  }
  return null;
}

/** Clones a listar: sem repetir o que já aparece como voz da marca ou como opção do estúdio. */
export function listableClones<T extends { voice_id: string }>(
  clones: readonly T[],
  takenIds: ReadonlySet<string>,
): T[] {
  return clones.filter((clone) => !takenIds.has(clone.voice_id));
}

import { describe, expect, it } from "vitest";

import { humanizeError } from "./humanize-error";

describe("falta de crédito", () => {
  it.each([
    [
      'Higgsfield: o workspace selecionado na conta conectada está sem créditos. No Higgsfield, troque para o workspace que tem créditos e clique em "Retomar do checkpoint".',
      "no Higgsfield",
    ],
    ["MCP generate_image: out of credits", "no Higgsfield"],
    [
      "Conta do Replicate sem crédito. Adicione crédito em replicate.com/account/billing",
      "no Replicate",
    ],
    ["A HeyGen está sem créditos para este vídeo. Recarregue em app.heygen.com", "no HeyGen"],
    [
      "ElevenLabs: os créditos da conta acabaram antes de gerar a narração. Recarregue o plano.",
      "no ElevenLabs",
    ],
    ['elevenlabs 402: {"detail":"x"}', "no ElevenLabs"],
  ])("%s", (bruto, onde) => {
    expect(humanizeError(bruto)).toBe(
      `Falhou por falta de créditos ${onde}. Para retomar, coloque créditos na conta.`,
    );
  });
});

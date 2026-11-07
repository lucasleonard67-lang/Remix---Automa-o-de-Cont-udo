// Qual vídeo vai ao ar. A versão do "Aprimorar com IA" só vale para o `final` que
// ela editou: uma cena refeita depois gera outro `final`, e publicar a edição
// antiga levaria a cena velha. Na dúvida, sai o original (docs/hub-motor-contratos.md §11.6).

export type EditedVideo = { edit_id: string; path: string; source_final: string };

export function publishablePath(artifacts: Record<string, unknown>): string | null {
  const final = typeof artifacts.final === 'string' && artifacts.final ? artifacts.final : null;
  const edited = artifacts.edited as Partial<EditedVideo> | null | undefined;
  const current = !!final && !artifacts.final_rebuilding && !!edited?.path && edited.source_final === final;
  return current ? edited!.path! : final;
}

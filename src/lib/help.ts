// Ajuda do app: o mesmo arquivo que o assistente usa no servidor
// (supabase/functions/_shared/help-content.ts, sem imports). A página Ajuda lê
// daqui; mudou um texto lá, muda na página e no assistente ao mesmo tempo.
// Lembrete: o assistente só pega o texto novo depois do deploy da edge
// function assistant-chat.

export {
  DUVIDAS,
  HELP,
  type Duvida,
  type HelpEntry,
} from "../../supabase/functions/_shared/help-content";

// Aviso do navegador: desligado até a pessoa ligar. A permissão só é pedida
// nesse toque, nunca ao abrir o app.

const KEY = "ce:avisos-navegador";

export function browserNotifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function browserNotifyOn(): boolean {
  if (!browserNotifySupported() || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Liga (pede a permissão) ou desliga. Devolve se ficou ligado. */
export async function setBrowserNotify(on: boolean): Promise<boolean> {
  const allowed = on && (await Notification.requestPermission()) === "granted";
  try {
    localStorage.setItem(KEY, allowed ? "1" : "0");
  } catch {
    return false;
  }
  return allowed;
}

/** Só com a aba em segundo plano: quem está olhando já vê o aviso na tela. */
export function browserNotify(title: string, body: string): void {
  if (!browserNotifyOn() || !document.hidden) return;
  const notification = new Notification(title, { body });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

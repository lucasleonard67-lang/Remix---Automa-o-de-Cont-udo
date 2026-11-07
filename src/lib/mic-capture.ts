// ---------------------------------------------------------------------------
// Gravação curta de fala para os campos de prompt. Diferente da amostra de voz
// (voice-recorder.tsx: WAV puro, roteiro guiado, processamento desligado), aqui
// o áudio só vai para a transcrição: o navegador pode limpar eco e ruído.
// ---------------------------------------------------------------------------

/** Teto de uma fala; o campo para sozinho aqui. */
export const MIC_MAX_S = 120;

const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function micSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator?.mediaDevices?.getUserMedia === "function"
  );
}

/** Extensão que o provedor reconhece, a partir do formato que o navegador gravou. */
export function audioFileName(mime: string): string {
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  return `fala.${ext}`;
}

export class MicCapture {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MIMES.find((mime) => MediaRecorder.isTypeSupported(mime));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  /** Para e devolve o áudio. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === "inactive") {
        this.release();
        resolve(new Blob([]));
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.release();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  /** Desiste: solta o microfone sem devolver nada. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}

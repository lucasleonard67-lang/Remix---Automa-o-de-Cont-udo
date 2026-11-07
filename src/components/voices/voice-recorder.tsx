import { Loader2, Mic, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  analyzeVoice,
  encodeWav,
  formatClock,
  NOISE_PROBE_S,
  RECORDING_SCRIPT,
  rmsDb,
  scriptBlockAt,
  VOICE_MAX_S,
  VOICE_SAMPLE_RATE,
  VOICE_UPLOAD_MAX_BYTES,
  voiceIssues,
  type VoiceIssue,
} from "@/lib/voice-recording";

// ---------------------------------------------------------------------------
// Gravação da voz no navegador (docs/construtor-de-voz.md §4.2): 2 s de
// silêncio medem o ruído, o roteiro guiado anda com o tempo, e o áudio vira
// WAV 16-bit mono 44,1 kHz com as checagens antes de enviar. O processamento
// do navegador (eco, ruído, ganho) fica desligado porque distorce o timbre.
// ---------------------------------------------------------------------------

const LINK =
  "font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]";

const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a";

export interface VoiceSample {
  blob: Blob;
  url: string;
  seconds: number;
  issues: VoiceIssue[];
  /** o arquivo passava de 3 min e foi cortado */
  trimmed: boolean;
}

type Phase = "idle" | "noise" | "recording" | "processing" | "done" | "denied";

/** Decodifica, junta em mono 44,1 kHz e corta em `offset + 180 s`. */
async function toMono(data: ArrayBuffer, offset: number) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(data);
    const total = Math.min(decoded.duration, offset + VOICE_MAX_S);
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(total * VOICE_SAMPLE_RATE)),
      VOICE_SAMPLE_RATE,
    );
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0, 0, total);
    const samples = (await offline.startRendering()).getChannelData(0);
    return { samples, trimmed: decoded.duration > offset + VOICE_MAX_S + 0.5 };
  } finally {
    void ctx.close();
  }
}

async function buildSample(data: ArrayBuffer, recorded: boolean): Promise<VoiceSample> {
  const offset = recorded ? NOISE_PROBE_S : 0;
  const { samples, trimmed } = await toMono(data, offset);
  const cut = Math.min(samples.length, Math.round(offset * VOICE_SAMPLE_RATE));
  const noiseDb = recorded ? rmsDb(samples, 0, cut) : undefined;
  const speech = samples.subarray(cut);
  const analysis = analyzeVoice(speech, VOICE_SAMPLE_RATE, noiseDb);
  const blob = new Blob([encodeWav(speech, VOICE_SAMPLE_RATE)], { type: "audio/wav" });
  return {
    blob,
    url: URL.createObjectURL(blob),
    seconds: analysis.seconds,
    issues: voiceIssues(analysis),
    trimmed,
  };
}

export function VoiceRecorder({
  onSample,
  disabled = false,
}: {
  onSample: (sample: VoiceSample | null) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    recorder: MediaRecorder;
    raf: number;
    timer: number;
  } | null>(null);
  const block = useRef<HTMLParagraphElement>(null);

  const release = () => {
    const l = live.current;
    if (!l) return;
    cancelAnimationFrame(l.raf);
    window.clearInterval(l.timer);
    l.stream.getTracks().forEach((t) => t.stop());
    void l.ctx.close();
    live.current = null;
  };

  useEffect(() => () => release(), []);
  useEffect(() => () => (sample ? URL.revokeObjectURL(sample.url) : undefined), [sample]);

  const speaking = Math.max(0, elapsed - NOISE_PROBE_S);
  const current = scriptBlockAt(speaking);
  useEffect(() => {
    if (phase === "recording") block.current?.scrollIntoView({ block: "nearest" });
  }, [current, phase]);

  const finish = async (data: ArrayBuffer, recorded: boolean) => {
    setPhase("processing");
    try {
      const next = await buildSample(data, recorded);
      setSample(next);
      onSample(next);
      setPhase("done");
    } catch {
      setPhase("idle");
      setProblem(
        recorded
          ? "Não deu para ler a gravação. Grave de novo."
          : "Não deu para ler esse áudio. Envie MP3, WAV ou M4A.",
      );
    }
  };

  const reset = () => {
    setSample(null);
    onSample(null);
    setProblem(null);
    setElapsed(0);
    setPhase("idle");
  };

  const start = async () => {
    reset();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch {
      setPhase("denied");
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      release();
      void new Blob(chunks, { type }).arrayBuffer().then((data) => finish(data, true));
    };
    const startedAt = performance.now();
    const meter = () => {
      analyser.getFloatTimeDomainData(buf);
      // −60 dBFS → vazio, 0 dBFS → cheio
      setLevel(Math.max(0, Math.min(1, (rmsDb(buf) + 60) / 60)));
      if (live.current) live.current.raf = requestAnimationFrame(meter);
    };
    const timer = window.setInterval(() => {
      const s = (performance.now() - startedAt) / 1000;
      setElapsed(s);
      setPhase(s < NOISE_PROBE_S ? "noise" : "recording");
      if (s >= NOISE_PROBE_S + VOICE_MAX_S && recorder.state === "recording") recorder.stop();
    }, 200);
    live.current = { stream, ctx, recorder, raf: requestAnimationFrame(meter), timer };
    recorder.start(1000);
    setPhase("noise");
  };

  const stop = () => {
    const l = live.current;
    if (l && l.recorder.state === "recording") l.recorder.stop();
  };

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    reset();
    if (file.size > VOICE_UPLOAD_MAX_BYTES) return setProblem("O áudio passa de 50 MB.");
    await finish(await file.arrayBuffer(), false);
  };

  const recording = phase === "noise" || phase === "recording";
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={AUDIO_ACCEPT}
      className="sr-only"
      onChange={(e) => void pick(e.target.files?.[0])}
      data-testid="voz-arquivo"
    />
  );

  return (
    <div className="space-y-3" data-testid="voz-gravador">
      {fileInput}

      {phase === "denied" ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-[var(--via-coral-dark)]">
            O navegador bloqueou o microfone. Libere no cadeado ao lado do endereço ou suba um
            áudio.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void start()} disabled={disabled}>
              <Mic aria-hidden="true" /> Tentar de novo
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setMode("upload");
                input.current?.click();
              }}
              disabled={disabled}
            >
              <Upload aria-hidden="true" /> Subir áudio
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "idle" && mode === "record" ? (
        <>
          <p className="text-sm text-[var(--via-text-muted)]">
            Leia o texto em voz alta, como se falasse com um cliente. De 1 a 2 min, num lugar
            quieto.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void start()} disabled={disabled} data-testid="voz-gravar">
              <Mic aria-hidden="true" /> Gravar
            </Button>
            <button
              type="button"
              className={cn(LINK, "text-sm")}
              onClick={() => {
                setMode("upload");
                input.current?.click();
              }}
              disabled={disabled}
            >
              Subir áudio
            </button>
          </div>
        </>
      ) : null}

      {phase === "idle" && mode === "upload" ? (
        <>
          <p className="text-sm text-[var(--via-text-muted)]">
            MP3, WAV ou M4A, até 50 MB. Só você falando, de 1 a 2 min, sem música.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => input.current?.click()} disabled={disabled}>
              <Upload aria-hidden="true" /> Escolher áudio
            </Button>
            <button
              type="button"
              className={cn(LINK, "text-sm")}
              onClick={() => setMode("record")}
              disabled={disabled}
            >
              Gravar
            </button>
          </div>
        </>
      ) : null}

      {recording ? (
        <div className="space-y-3">
          {phase === "noise" ? (
            <p className="text-sm font-medium text-[var(--via-text-primary)]" role="status">
              Fique 2 s em silêncio…
            </p>
          ) : (
            <ol
              className="max-h-40 space-y-2 overflow-y-auto border-l-2 border-[var(--via-border-soft)] pl-3"
              aria-label="Roteiro"
            >
              {RECORDING_SCRIPT.map((text, i) => (
                <li key={i}>
                  <p
                    ref={i === current ? block : undefined}
                    className={cn(
                      "text-sm leading-relaxed transition-colors",
                      i === current
                        ? "text-[var(--via-text-primary)]"
                        : "text-[var(--via-text-muted)] opacity-60",
                    )}
                  >
                    {text}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-center gap-3">
            <span
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--via-navy-06)]"
              role="meter"
              aria-label="Nível do microfone"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-75",
                  level > 0.97 ? "bg-[var(--via-coral-dark)]" : "bg-[var(--via-navy)]",
                )}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </span>
            <span className="w-24 text-right text-xs tabular-nums text-[var(--via-text-muted)]">
              {formatClock(speaking)} / {formatClock(VOICE_MAX_S)}
            </span>
          </div>
          <Button variant="outline" onClick={stop} disabled={phase === "noise"}>
            <Square aria-hidden="true" /> Parar
          </Button>
        </div>
      ) : null}

      {phase === "processing" ? (
        <p className="flex items-center gap-2 text-sm text-[var(--via-text-muted)]" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Conferindo o áudio…
        </p>
      ) : null}

      {phase === "done" && sample ? (
        <div className="space-y-2">
          <audio controls src={sample.url} className="w-full" />
          {sample.issues.length === 0 ? (
            <p className="text-sm font-medium text-[var(--via-success)]">
              Áudio bom: {formatClock(sample.seconds)}.
            </p>
          ) : (
            <ul className="space-y-1" aria-label="Checagens do áudio">
              {sample.issues.map((issue) => (
                <li
                  key={issue.id}
                  className={cn(
                    "text-sm",
                    issue.blocking
                      ? "font-medium text-[var(--via-coral-dark)]"
                      : "text-[var(--via-text-muted)]",
                  )}
                >
                  {issue.text}
                </li>
              ))}
            </ul>
          )}
          {sample.trimmed ? (
            <p className="text-xs text-[var(--via-text-muted)]">
              Usamos só os 3 primeiros minutos.
            </p>
          ) : null}
          <button
            type="button"
            className={cn(LINK, "text-sm")}
            onClick={() => (mode === "record" ? void start() : input.current?.click())}
            disabled={disabled}
          >
            {mode === "record" ? "Gravar de novo" : "Escolher outro áudio"}
          </button>
        </div>
      ) : null}

      {problem ? (
        <p className="text-sm text-[var(--via-coral-dark)]" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

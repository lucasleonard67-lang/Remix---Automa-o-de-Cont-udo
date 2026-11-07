"""Render local de um plano, para medir e gerar prévias.

Uso: python render_local.py plano.json source.mp4 broll.mp4 musica.mp3 saida.mp4 [imagem1.png ...]
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from compose import compose, music_settings

HERE = Path(__file__).resolve().parent
GSAP = "node_modules/hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js"


def write_project(project: Path, plan: dict) -> None:
    """index.html, plano e GSAP local: a composição não busca nada na rede."""
    (project / "assets" / "vendor").mkdir(parents=True, exist_ok=True)
    (project / "index.html").write_text(compose(plan), encoding="utf-8")
    (project / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
    shutil.copy(HERE / GSAP, project / "assets" / "vendor" / "gsap.min.js")


def build_project(
    project: Path, plan: dict, source: Path, broll: Path | None, music: Path | None, images: list[Path]
) -> None:
    write_project(project, plan)
    shutil.copy(source, project / "assets" / "source.mp4")
    if broll:
        shutil.copy(broll, project / "assets" / "broll.mp4")
    if music:
        shutil.copy(music, project / "assets" / "music.audio")
    (project / "assets" / "images").mkdir(exist_ok=True)
    for number, image in enumerate(images, start=1):
        shutil.copy(image, project / "assets" / "images" / f"{number}.png")


def render(project: Path, output: Path) -> None:
    binary = HERE / "node_modules" / ".bin" / "hyperframes"
    env = {**os.environ, "HYPERFRAMES_NO_TELEMETRY": "1", "DO_NOT_TRACK": "1", "HYPERFRAMES_SKIP_SKILLS": "1"}
    done = subprocess.run(
        [str(binary), "render", "--quality", "standard", "--workers", "auto", "--output", str(output)],
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        raise RuntimeError(f"hyperframes: {(done.stderr or done.stdout)[-600:]}")


def has_transparency(png: bytes) -> bool:
    """PNG com canal alfa ou paleta transparente; recorte com fundo vira uma caixa."""
    if png[:8] != b"\x89PNG\r\n\x1a\n" or len(png) < 26:
        return False
    return png[25] in (4, 6) or b"tRNS" in png[:4096]


def has_audio(video: Path) -> bool:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type",
         "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    )
    return bool(out.stdout.strip())


def audio_graph(speech: bool, volume: float | None) -> str | None:
    """Filtro do áudio final. A trilha abaixa na fala e tudo sai em -14 LUFS."""
    loud = "loudnorm=I=-14:TP=-1.5:LRA=11[audio]"
    if speech and volume is not None:
        return (
            f"[1:a]volume={volume},aformat=channel_layouts=stereo[track];"
            "[0:a]aformat=channel_layouts=stereo,asplit=2[voice][key];"
            "[track][key]sidechaincompress=threshold=0.05:ratio=3:attack=20:release=500[ducked];"
            f"[voice][ducked]amix=inputs=2:duration=first:normalize=0,{loud}"
        )
    if volume is not None:
        return f"[1:a]volume={volume},aformat=channel_layouts=stereo,{loud}"
    return f"[0:a]{loud}" if speech else None


def mix_audio(project: Path, video: Path, output: Path) -> None:
    music = music_settings(json.loads((project / "plan.json").read_text(encoding="utf-8")))
    track = project / "assets" / "music.audio"
    volume = music["volume"] if music and track.exists() else None
    graph = audio_graph(has_audio(video), volume)
    if graph is None:
        shutil.copy(video, output)
        return
    inputs = ["-i", str(video)]
    if volume is not None:
        inputs += ["-stream_loop", "-1", "-i", str(track)]
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph,
         "-map", "0:v", "-map", "[audio]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-ar", "48000", "-shortest", "-movflags", "+faststart", str(output)],
        check=True,
    )


def measure(video: Path) -> dict:
    """Medidas da conferência: as mesmas que o sandbox devolve no video-edit."""
    duration = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    )
    loud = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-af", "ebur128", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    found = re.findall(r"^\s+I:\s+(-?[\d.]+) LUFS", loud.stderr, re.MULTILINE)
    lufs = float(found[-1]) if found else None
    return {
        "duration": float(duration.stdout.strip()),
        "has_audio": has_audio(video),
        "lufs": lufs if lufs is not None and lufs < 0 else None,
    }


def extract_frames(video: Path, count: int, folder: Path) -> list[Path]:
    """Quadros da conferência, espalhados pelo vídeo."""
    duration = measure(video)["duration"]
    frames = []
    for index in range(count):
        frame = folder / f"q{index}.jpg"
        at = duration * (index + 0.5) / count
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{at:.3f}", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", str(frame)],
            check=True,
        )
        frames.append(frame)
    return frames


def render_with_audio(project: Path, output: Path) -> None:
    silent_mix = project / "render.mp4"
    render(project, silent_mix)
    mix_audio(project, silent_mix, output)
    silent_mix.unlink()


def main() -> None:
    plan_path, source, broll, music, output, *images = sys.argv[1:]
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as folder:
        project = Path(folder) / "job"
        build_project(project, plan, Path(source), Path(broll), Path(music), [Path(i) for i in images])
        started = time.monotonic()
        render_with_audio(project, Path(output).resolve())
    print(f"render: {time.monotonic() - started:.1f} s")


if __name__ == "__main__":
    main()

"""Worker de render no Modal: um plano entra, um MP4 sai.

Fluxo de um job, sem segredos no render:
  1. `POST /submit` valida o plano e dispara `run_job`.
  2. `run_job` baixa os arquivos (URLs assinadas) para a pasta do job no Volume.
  3. `render_job` roda sem rede e grava o MP4 e os quadros no Volume.
  4. `run_job` envia tudo para as URLs assinadas e apaga a pasta do job.
  5. `GET /status` devolve running, ready (com as medidas) ou failed.

Limite atual: o render enxerga o Volume inteiro. Serve para o HTML do compose.py
(código nosso); HTML escrito por IA exige um Volume por job.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

import modal

from compose import MAX_IMAGES, PlanError, compose

HERE = Path(__file__).resolve().parent
VOLUME_PATH = Path("/jobs")
JOB_ID = re.compile(r"^[0-9a-f-]{36}$")
MAX_ASSET_BYTES = 500 * 1024 * 1024
MAX_QA_FRAMES = 8
RENDER_TIMEOUT_S = 20 * 60
ALLOWED_HOST_SUFFIXES = tuple(os.environ.get("RENDER_ASSET_HOSTS", ".supabase.co").split(","))

image = modal.Image.from_dockerfile(
    str(HERE / "Dockerfile"), context_dir=str(HERE), add_python="3.12"
).pip_install("fastapi[standard]", "httpx")

app = modal.App("subido-render", image=image)
volume = modal.Volume.from_name("subido-render-jobs", create_if_missing=True)


def job_dir(job_id: str) -> Path:
    return VOLUME_PATH / job_id


def check_url(url: object) -> str:
    """Só HTTPS nos hosts de storage conhecidos: o worker não busca URL qualquer."""
    parsed = urlparse(str(url))
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not host.endswith(ALLOWED_HOST_SUFFIXES):
        raise PlanError("URL de arquivo fora do storage permitido.")
    return str(url)


def clean_request(body: dict) -> dict:
    """Valida o pedido antes de gastar render. Levanta PlanError."""
    job_id = str(body.get("job_id", ""))
    if not JOB_ID.match(job_id):
        raise PlanError("job_id inválido.")
    plan = body.get("plan")
    compose(plan)
    assets = body.get("assets") or {}
    clean = {"source_url": check_url(assets.get("source_url"))}
    for key in ("broll_url", "music_url"):
        if assets.get(key):
            clean[key] = check_url(assets[key])
    images = assets.get("image_urls") or []
    if len(images) > MAX_IMAGES:
        raise PlanError(f"Até {MAX_IMAGES} imagens por vídeo.")
    clean["image_urls"] = [check_url(url) for url in images]
    frames = body.get("frame_upload_urls") or []
    if len(frames) > MAX_QA_FRAMES:
        raise PlanError("Quadros demais na conferência.")
    return {
        "job_id": job_id,
        "plan": plan,
        "assets": clean,
        "upload_url": check_url(body.get("upload_url")),
        "frame_upload_urls": [check_url(url) for url in frames],
    }


def download(url: str, target: Path) -> None:
    import httpx

    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with httpx.stream("GET", url, timeout=120, follow_redirects=False) as response:
        response.raise_for_status()
        with target.open("wb") as out:
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_ASSET_BYTES:
                    raise PlanError("Arquivo acima de 500 MB.")
                out.write(chunk)


def upload(url: str, path: Path, content_type: str) -> None:
    import httpx

    with path.open("rb") as body:
        httpx.put(
            url, content=body, headers={"Content-Type": content_type, "x-upsert": "true"}, timeout=300
        ).raise_for_status()


@app.function(cpu=4.0, memory=8192, timeout=RENDER_TIMEOUT_S, volumes={VOLUME_PATH: volume}, block_network=True)
def render_job(job_id: str, frames: int) -> dict:
    """Render sem rede. Tudo que a composição usa já está na pasta do job."""
    from render_local import extract_frames, measure, render_with_audio

    volume.reload()
    folder = job_dir(job_id)
    output = folder / "out.mp4"
    render_with_audio(folder / "project", output)
    extract_frames(output, frames, folder)
    result = measure(output)
    volume.commit()
    return result


@app.function(cpu=1.0, memory=1024, timeout=RENDER_TIMEOUT_S + 600, volumes={VOLUME_PATH: volume})
def run_job(request: dict) -> dict:
    from render_local import has_transparency, write_project

    job_id, assets = request["job_id"], request["assets"]
    folder = job_dir(job_id)
    shutil.rmtree(folder, ignore_errors=True)
    try:
        project = folder / "project"
        write_project(project, request["plan"])
        download(assets["source_url"], project / "assets" / "source.mp4")
        if assets.get("broll_url"):
            download(assets["broll_url"], project / "assets" / "broll.mp4")
        if assets.get("music_url"):
            download(assets["music_url"], project / "assets" / "music.audio")
        for number, url in enumerate(assets["image_urls"], start=1):
            image_path = project / "assets" / "images" / f"{number}.png"
            download(url, image_path)
            if not has_transparency(image_path.read_bytes()):
                raise PlanError("A imagem do recorte precisa ser um PNG sem fundo.")
        volume.commit()

        frames = request["frame_upload_urls"]
        result = render_job.remote(job_id, len(frames))

        volume.reload()
        for index, url in enumerate(frames):
            upload(url, folder / f"q{index}.jpg", "image/jpeg")
        upload(request["upload_url"], folder / "out.mp4", "video/mp4")
        return {"status": "ready", **result}
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        volume.commit()


@app.function()
@modal.asgi_app(requires_proxy_auth=True)
def api():
    from fastapi import FastAPI, HTTPException

    web = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @web.post("/submit")
    def submit(body: dict) -> dict:
        try:
            request = clean_request(body)
        except PlanError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return {"call_id": run_job.spawn(request).object_id}

    @web.get("/status")
    def status(call_id: str) -> dict:
        try:
            return modal.FunctionCall.from_id(call_id).get(timeout=0)
        except (TimeoutError, modal.exception.ConnectionError, modal.exception.InternalFailure):
            return {"status": "running"}
        except PlanError as error:  # a pessoa consegue resolver: a tela mostra a frase
            return {"status": "failed", "message": str(error)}
        except Exception as error:  # falha do job: a tela mostra a saída para o original
            return {"status": "failed", "error": str(error)[:300]}

    return web

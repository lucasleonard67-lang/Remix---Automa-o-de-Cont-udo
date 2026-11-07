"""Plano de edição → composição HyperFrames (HTML).

O plano vem do Claude em saída estruturada; aqui ele é validado e vira HTML por
código nosso. Texto do plano só entra escapado, e nenhum HTML dele chega ao
Chrome. Sem rede e sem dependências: `python -m unittest` roda em qualquer lugar.
"""

from __future__ import annotations

import html
import json
import re

WIDTH = 1080
HEIGHT = 1920
MAX_DURATION_S = 180.0
MAX_WORDS = 600
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MEDIA = {"broll": "assets/broll.mp4"}
MAX_PHRASE_WORDS = 4
# Legenda: uma linha só dentro da área útil do Reels (840 px; a fonte varia no worker).
MAX_LINE_CHARS = 18
CAPTION_MIN_S = 0.7
CAPTION_LATE_S = 0.3
CAPTION_FAST_S = 0.35
CAPTION_HOLD_S = 0.15
CAPTION_MAX_GAP_S = 0.6
WORD_MIN_S = 0.05
LONG_HOOK_CHARS = 45
MAX_IMAGES = 6
# Recorte: imagem PNG sem fundo, sempre vinda da lista de arquivos do job.
CUTOUT_SPOTS = {
    "left": "left:40px;top:560px",
    "right": "right:40px;top:560px",
    "top": "left:280px;top:150px",
}
# Posição segura de cada efeito: o Claude escolhe olhando os quadros, para não
# cobrir o rosto.
POSITIONS = {
    "hook": {"top": "top:220px", "middle": "top:820px", "bottom": "bottom:520px"},
    "lower_third": {"top": "top:180px", "bottom": "bottom:420px"},
    "captions": {"top": "top:240px", "middle": "top:860px", "bottom": "bottom:420px"},
    "fact_card": {"top": "top:200px", "middle": "top:760px", "bottom": "bottom:460px"},
}
CORNERS = {
    "top_right": "top:160px;right:56px",
    "top_left": "top:160px;left:56px",
    "bottom_right": "bottom:420px;right:56px",
    "bottom_left": "bottom:420px;left:56px",
}
LAYER_TYPES = (
    "hook",
    "lower_third",
    "split_screen",
    "picture_in_picture",
    "captions",
    "end_card",
    "cutout",
    "fact_card",
)
DEFAULT_BRAND = {"accent": "#ff5a3c", "ink": "#ffffff", "ground": "#0b1220"}

CSS = """
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:1080px; height:1920px; overflow:hidden; background:var(--ground); }
#root { position:relative; width:100%; height:100%; font-family:sans-serif; overflow:hidden; }
#root video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
#root * { overflow-wrap:anywhere; }
.half { position:absolute; left:0; width:100%; height:50%; overflow:hidden; }
.pip { position:absolute; width:400px; height:710px; border-radius:28px; overflow:hidden; border:6px solid var(--ink); }
.hook { position:absolute; left:64px; right:64px; color:var(--ink); font-size:104px; font-weight:800; line-height:1.05; letter-spacing:-.03em; text-shadow:0 6px 30px rgba(0,0,0,.6); }
.hook.long { font-size:76px; }
.hook b { color:var(--accent); }
.third { position:absolute; left:64px; background:var(--accent); color:var(--ink); padding:22px 36px; border-radius:14px; font-size:46px; font-weight:700; max-width:952px; }
.cap { position:absolute; left:0; right:0; height:82px; display:flex; justify-content:center; color:var(--ink); font-size:68px; font-weight:800; line-height:82px; text-shadow:0 4px 18px rgba(0,0,0,.85); }
.cap span { display:block; flex:none; white-space:nowrap; }
.cap b { color:var(--ink); background:var(--accent); border-radius:12px; padding:0 14px; margin:0 -14px; text-shadow:none; }
.cutout { position:absolute; width:520px; height:520px; object-fit:contain; filter:drop-shadow(0 18px 40px rgba(0,0,0,.45)); }
.fact { position:absolute; left:64px; right:64px; padding:44px 48px; background:var(--ground); color:var(--ink); border-left:14px solid var(--accent); border-radius:18px; }
.fact strong { display:block; color:var(--accent); font-size:124px; font-weight:800; line-height:1; letter-spacing:-.03em; }
.fact span { display:block; margin-top:16px; font-size:46px; font-weight:600; line-height:1.2; }
.fact small { display:block; margin-top:20px; font-size:30px; opacity:.72; }
.end { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:var(--accent); color:var(--ink); font-size:120px; font-weight:800; text-align:center; padding:80px; }
"""


class PlanError(ValueError):
    """Plano recusado antes de gastar render; a mensagem vai para a tela."""


def _number(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlanError(f"{label} precisa ser um número.")
    return round(float(value), 3)


def _text(value, label: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PlanError(f"{label} está vazio.")
    if len(value) > limit:
        raise PlanError(f"{label} passa de {limit} caracteres.")
    return value.strip()


def _span(layer: dict, duration: float) -> tuple[float, float]:
    start = _number(layer.get("start"), "start")
    end = _number(layer.get("end"), "end")
    if start < 0 or end <= start or end > duration:
        raise PlanError(f"Tempo inválido em {layer.get('type')}: {start} a {end}.")
    return start, round(end - start, 3)


def _media(layer: dict) -> str:
    media = layer.get("media", "broll")
    if media not in MEDIA:
        raise PlanError(f"Mídia desconhecida: {media}.")
    return MEDIA[media]


def _brand(plan: dict) -> dict:
    brand = {**DEFAULT_BRAND, **(plan.get("brand") or {})}
    for key in DEFAULT_BRAND:
        if not HEX_COLOR.match(str(brand.get(key, ""))):
            raise PlanError(f"Cor inválida em {key}.")
    return {key: brand[key] for key in DEFAULT_BRAND}


def _position(layer: dict, kind: str, default: str) -> str:
    position = layer.get("position", default)
    if position not in POSITIONS[kind]:
        raise PlanError(f"Posição inválida em {kind}: {position}.")
    return POSITIONS[kind][position]


def _clip(cls: str, start: float, length: float, track: int, body: str, extra: str = "", element: str = "div") -> str:
    return (
        f'<{element} {extra} class="{cls} clip" data-start="{start}" '
        f'data-duration="{length}" data-track-index="{track}">{body}</{element}>'
    )


def _tween(selector: str, start: float, origin: dict, target: dict) -> str:
    return f"tl.fromTo({json.dumps(selector)}, {json.dumps(origin)}, {json.dumps(target)}, {start});"


def _hook(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    raw = _text(layer.get("text"), "Título", 90)
    word = _text(layer["emphasis"], "Destaque", 40) if layer.get("emphasis") else None
    if word and word in raw:
        before, after = raw.split(word, 1)
        text = f"{html.escape(before)}<b>{html.escape(word)}</b>{html.escape(after)}"
    else:
        text = html.escape(raw)
    tween = _tween(f"#l{index}", start, {"y": 80, "opacity": 0}, {"y": 0, "opacity": 1, "duration": 0.5, "ease": "power4.out"})
    style = _position(layer, "hook", "top")
    cls = "hook long" if len(raw) > LONG_HOOK_CHARS else "hook"
    return _clip(cls, start, length, 3, text, f'id="l{index}" style="{style}"', "h1"), [tween]


def _lower_third(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    text = html.escape(_text(layer.get("title"), "Nome", 60))
    tween = _tween(f"#l{index}", start, {"x": -900}, {"x": 0, "duration": 0.45, "ease": "power3.out"})
    style = _position(layer, "lower_third", "bottom")
    return _clip("third", start, length, 3, text, f'id="l{index}" style="{style}"'), [tween]


def _split_screen(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    # vídeo interno com tempo próprio: a fala de cima segue em sincronia com o áudio
    timing = f'data-start="{start}" data-duration="{length}"'
    top = f'<video src="assets/source.mp4" {timing} data-media-start="{start}" muted></video>'
    bottom = f'<video src="{_media(layer)}" {timing} muted></video>'
    nodes = _clip("half", start, length, 1, top, f'id="l{index}a" style="top:0"') + _clip(
        "half", start, length, 1, bottom, f'id="l{index}b" style="top:50%"'
    )
    move = {"yPercent": 0, "duration": 0.45, "ease": "power3.out"}
    return nodes, [
        _tween(f"#l{index}a", start, {"yPercent": -100}, move),
        _tween(f"#l{index}b", start, {"yPercent": 100}, move),
    ]


def _picture_in_picture(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    corner = layer.get("corner", "top_right")
    if corner not in CORNERS:
        raise PlanError(f"Canto inválido: {corner}.")
    body = f'<video src="{_media(layer)}" data-start="{start}" data-duration="{length}" muted></video>'
    node = _clip("pip", start, length, 2, body, f'id="l{index}" style="{CORNERS[corner]}"')
    target = {"scale": 1, "opacity": 1, "duration": 0.4, "ease": "back.out(1.7)"}
    return node, [_tween(f"#l{index}", start, {"scale": 0.6, "opacity": 0}, target)]


def _clean_words(words: list, duration: float) -> list[dict]:
    """Tempos do STT em ordem, com duração e sem sobreposição, dentro do vídeo."""
    valid = []
    for word in words:
        if not isinstance(word, dict):
            raise PlanError("Palavra de legenda inválida.")
        start = _number(word.get("start"), "start")
        end = _number(word.get("end"), "end")
        text = html.escape(_text(word.get("text"), "Palavra", 40))
        if text and start < duration:
            valid.append({"text": text, "start": start, "end": end, "brk": word.get("brk") is True})
    out: list[dict] = []
    for word in sorted(valid, key=lambda w: w["start"]):
        start = max(word["start"], out[-1]["start"] + WORD_MIN_S) if out else max(0.0, word["start"])
        if out:
            out[-1]["end"] = min(out[-1]["end"], start)
        out.append({**word, "start": start, "end": max(word["end"], start + WORD_MIN_S)})
    return out


def _phrases(words: list[dict]) -> list[list[dict]]:
    """Frases de até uma linha; só passa de MAX_PHRASE_WORDS se a frase seria curta demais."""
    groups: list[list[dict]] = []
    for word in words:
        group = groups[-1] if groups else None
        line = " ".join(w["text"] for w in group or []) + f' {word["text"]}'
        if (
            group
            and not word["brk"]
            and len(line) <= MAX_LINE_CHARS
            and (len(group) < MAX_PHRASE_WORDS or word["start"] - group[0]["start"] < CAPTION_MIN_S)
            and word["start"] - group[-1]["end"] < CAPTION_MAX_GAP_S
        ):
            group.append(word)
        else:
            groups.append([word])
    return groups


def _captions(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    words = layer.get("words")
    if not isinstance(words, list) or not words or len(words) > MAX_WORDS:
        raise PlanError(f"A legenda precisa ter de 1 a {MAX_WORDS} palavras.")
    style = _position(layer, "captions", "bottom")
    groups = _phrases(_clean_words(words, duration))
    if not groups:
        raise PlanError(f"A legenda precisa ter de 1 a {MAX_WORDS} palavras.")

    # Um texto por vez: cada frase termina antes da próxima e fica o tempo mínimo.
    spans: list[list[float]] = []
    for position, group in enumerate(groups):
        start = max(group[0]["start"], spans[-1][1] if spans else 0.0)
        following = groups[position + 1][0]["start"] if position + 1 < len(groups) else duration
        # Atrasada demais, encurta para alcançar a fala em vez de acumular.
        shortest = CAPTION_FAST_S if start - group[0]["start"] > CAPTION_LATE_S else CAPTION_MIN_S
        spans.append([start, max(start + shortest, min(group[-1]["end"] + CAPTION_HOLD_S, following))])
    limit = duration
    for span in reversed(spans):
        shown = min(span[1] - span[0], CAPTION_MIN_S)
        span[1] = min(span[1], limit)
        span[0] = max(0.0, min(span[0], span[1] - shown))
        limit = span[0]

    # Frases curtas, com a palavra falada em destaque.
    nodes = []
    for group, (first, last) in zip(groups, spans):
        if last - first < min(CAPTION_FAST_S, duration) - 1e-6:
            continue
        line = " ".join(w["text"] for w in group)
        scale = min(1.0, MAX_LINE_CHARS / len(line))
        fit = f' style="transform:scaleX({scale:.3f})"' if scale < 1 else ""
        for position, word in enumerate(group):
            start = first if position == 0 else max(word["start"], first)
            end = last if position == len(group) - 1 else min(group[position + 1]["start"], last)
            if end <= start:
                continue
            phrase = [w["text"] for w in group]
            phrase[position] = f"<b>{phrase[position]}</b>"
            body = f"<span{fit}>{' '.join(phrase)}</span>"
            nodes.append(_clip("cap", round(start, 3), round(end - start, 3), 5, body, f'style="{style}"'))
    return "".join(nodes), []


def _cutout(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    image = layer.get("image")
    if isinstance(image, bool) or not isinstance(image, int) or not 1 <= image <= MAX_IMAGES:
        raise PlanError(f"Recorte precisa apontar para uma imagem de 1 a {MAX_IMAGES}.")
    spot = layer.get("spot", "right")
    if spot not in CUTOUT_SPOTS:
        raise PlanError(f"Lugar inválido para o recorte: {spot}.")
    extra = f'id="l{index}" src="assets/images/{image}.png" alt="" style="{CUTOUT_SPOTS[spot]}"'
    node = (
        f'<img {extra} class="cutout clip" data-start="{start}" '
        f'data-duration="{length}" data-track-index="4" />'
    )
    enter = {"scale": 1, "rotation": 0, "opacity": 1, "duration": 0.5, "ease": "back.out(1.6)"}
    drift = {"y": -24, "duration": max(length - 0.5, 0.1), "ease": "sine.inOut"}
    return node, [
        _tween(f"#l{index}", start, {"scale": 0.5, "rotation": -8, "opacity": 0}, enter),
        _tween(f"#l{index}", round(start + 0.5, 3), {"y": 0}, drift),
    ]


def _fact_card(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    value = _text(layer.get("value"), "Número do card", 24)
    label = _text(layer.get("label"), "Texto do card", 90)
    source = _text(layer.get("source"), "Fonte do card", 70)
    if "[VERIFICAR" in f"{value}{label}{source}".upper():
        raise PlanError("Dado sem fonte conferida não entra no vídeo.")
    body = (
        f"<strong>{html.escape(value)}</strong><span>{html.escape(label)}</span>"
        f"<small>Fonte: {html.escape(source)}</small>"
    )
    style = _position(layer, "fact_card", "middle")
    target = {"x": 0, "opacity": 1, "duration": 0.45, "ease": "power3.out"}
    node = _clip("fact", start, length, 4, body, f'id="l{index}" style="{style}"')
    return node, [_tween(f"#l{index}", start, {"x": -120, "opacity": 0}, target)]


def _end_card(layer: dict, index: int, duration: float) -> tuple[str, list[str]]:
    start, length = _span(layer, duration)
    text = html.escape(_text(layer.get("text"), "Encerramento", 60))
    tween = _tween(f"#l{index}", start, {"yPercent": 100}, {"yPercent": 0, "duration": 0.4, "ease": "power3.out"})
    return _clip("end", start, length, 6, text, f'id="l{index}"'), [tween]


BUILDERS = {
    "hook": _hook,
    "lower_third": _lower_third,
    "split_screen": _split_screen,
    "picture_in_picture": _picture_in_picture,
    "captions": _captions,
    "end_card": _end_card,
    "cutout": _cutout,
    "fact_card": _fact_card,
}


def music_settings(plan: dict) -> dict | None:
    """Música do plano já validada; None quando o vídeo fica sem trilha."""
    music = plan.get("music")
    if music is None:
        return None
    if not isinstance(music, dict):
        raise PlanError("Música inválida.")
    volume = _number(music.get("volume", 0.3), "Volume da música")
    if not 0 < volume <= 1:
        raise PlanError("O volume da música precisa ser de 0 a 1.")
    return {"volume": volume}


def compose(plan: dict) -> str:
    """Devolve o index.html do plano ou levanta PlanError."""
    if not isinstance(plan, dict):
        raise PlanError("Plano inválido.")
    duration = _number(plan.get("duration"), "duration")
    if duration <= 0 or duration > MAX_DURATION_S:
        raise PlanError(f"O vídeo precisa ter até {MAX_DURATION_S:.0f} s.")
    layers = plan.get("layers")
    if not isinstance(layers, list) or not (layers or plan.get("music") is not None):
        raise PlanError("O plano não tem nenhum efeito.")

    nodes, tweens = [], []
    for index, layer in enumerate(layers):
        kind = layer.get("type") if isinstance(layer, dict) else None
        if kind not in BUILDERS:
            raise PlanError(f"Efeito desconhecido: {kind}.")
        node, layer_tweens = BUILDERS[kind](layer, index, duration)
        nodes.append(node)
        tweens.extend(layer_tweens)

    music_settings(plan)
    brand = _brand(plan)
    tokens = f":root{{--accent:{brand['accent']};--ink:{brand['ink']};--ground:{brand['ground']};}}"
    # sem faixa de áudio, `data-has-audio` derruba o render
    sound = "muted" if plan.get("source_audio") is False else 'data-has-audio="true"'
    source = (
        f'<video class="clip" src="assets/source.mp4" data-start="0" data-duration="{duration}" '
        f'data-track-index="0" {sound}></video>'
    )
    return f"""<!doctype html>
<html lang="pt-BR" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={WIDTH}, height={HEIGHT}" />
<script src="assets/vendor/gsap.min.js"></script>
<style>{tokens}{CSS}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{duration}" data-width="{WIDTH}" data-height="{HEIGHT}">
{source}
{"".join(nodes)}
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
{chr(10).join(tweens)}
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
"""

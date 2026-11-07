import re
import unittest

from compose import LAYER_TYPES, PlanError, compose, music_settings
from render_local import audio_graph, has_transparency


def plan(*layers, **over):
    return {"duration": 30, "layers": list(layers), **over}


ALL = plan(
    {"type": "hook", "start": 0, "end": 4, "text": "Pare de perder tempo", "emphasis": "perder"},
    {"type": "lower_third", "start": 4, "end": 9, "title": "Dra. Helena"},
    {"type": "split_screen", "start": 10, "end": 16},
    {"type": "picture_in_picture", "start": 18, "end": 24, "corner": "top_left"},
    {"type": "captions", "words": [{"text": "edite", "start": 1, "end": 2}]},
    {"type": "end_card", "start": 27, "end": 30, "text": "Siga"},
    {"type": "cutout", "start": 5, "end": 8, "image": 1, "spot": "left"},
    {"type": "fact_card", "start": 12, "end": 16, "value": "1 em 3", "label": "mortes", "source": "OMS"},
)


class ComposeTest(unittest.TestCase):
    def test_todos_os_efeitos_entram(self):
        html = compose(ALL)
        self.assertEqual({layer["type"] for layer in ALL["layers"]}, set(LAYER_TYPES))
        self.assertIn('data-duration="30.0"', html)
        self.assertIn("<b>perder</b>", html)
        self.assertIn("assets/broll.mp4", html)
        self.assertIn("top:160px;left:56px", html)

    def test_texto_do_plano_nunca_vira_html(self):
        html = compose(plan({"type": "hook", "start": 0, "end": 1, "text": '<script src="http://x/a.js"></script>'}))
        self.assertNotIn("http://x/a.js\"></script>", html)
        self.assertIn("&lt;script", html)

    def test_atributo_nao_escapa_por_midia_ou_cor(self):
        with self.assertRaises(PlanError):
            compose(plan({"type": "split_screen", "start": 0, "end": 1, "media": 'x"><img src=http://x>'}))
        with self.assertRaises(PlanError):
            compose(plan({"type": "end_card", "start": 0, "end": 1, "text": "a"}, brand={"accent": "red;}</style>"}))

    def test_nao_ha_url_externa(self):
        self.assertNotIn("http", compose(ALL).replace("http-equiv", ""))

    def test_legenda_em_frases_com_a_palavra_em_destaque(self):
        words = [{"text": f"p{i}", "start": i, "end": i + 1} for i in range(5)]
        html = compose(plan({"type": "captions", "words": words}))
        self.assertIn("p0 <b>p1</b> p2 p3", html)
        self.assertIn("<b>p4</b>", html)
        self.assertNotIn("p3 <b>p4</b>", html)

    def _caption_clips(self, words):
        html = compose(plan({"type": "captions", "words": words}))
        found = re.findall(r'class="cap clip" data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*>(.*?)</div>', html)
        return [(float(a), float(a) + float(b), body) for a, b, body in found]

    def test_legenda_nunca_tem_dois_textos_nem_frase_relampago(self):
        words = [
            {"text": "tres", "start": 2, "end": 2.2},
            {"text": "um", "start": 1, "end": 1},
            {"text": "dois", "start": 1, "end": 4},
            {"text": "quatro", "start": 2.1, "end": 2.15},
            {"text": "inconstitucionalissimamente", "start": 2.2, "end": 2.3},
            {"text": "cinco", "start": 2.3, "end": 2.4},
        ]
        clips = self._caption_clips(words)
        self.assertTrue(clips)
        for (_, end, _b), (start, _e, _body) in zip(clips, clips[1:]):
            self.assertLessEqual(end, start + 1e-3)
        phrases = {}
        for start, end, body in clips:
            key = re.sub(r"</?b>", "", body)
            first, last = phrases.get(key, (start, end))
            phrases[key] = (min(first, start), max(last, end))
        for first, last in phrases.values():
            self.assertGreaterEqual(last - first, 0.349)

    def test_legenda_e_sempre_uma_linha_no_mesmo_lugar(self):
        words = [{"text": f"palavra{i}", "start": i * 0.4, "end": i * 0.4 + 0.4} for i in range(30)]
        words[3]["text"] = "inconstitucionalissimamente"
        html = compose(plan({"type": "captions", "words": words, "position": "bottom"}))
        self.assertEqual(set(re.findall(r'style="([^"]+)" class="cap clip"', html)), {"bottom:420px"})
        self.assertIn("transform:scaleX(0.667)", html)
        for body in re.findall(r'class="cap clip"[^>]*><span[^>]*>(.*?)</span>', html):
            line = re.sub(r"</?b>", "", body)
            self.assertTrue(len(line) <= 18 or " " not in line, line)

    def test_posicao_evita_o_rosto(self):
        html = compose(plan({"type": "hook", "start": 0, "end": 1, "text": "a", "position": "bottom"}))
        self.assertIn('style="bottom:520px"', html)
        with self.assertRaises(PlanError):
            compose(plan({"type": "hook", "start": 0, "end": 1, "text": "a", "position": "x"}))

    def test_recorte_so_usa_arquivo_do_job(self):
        html = compose(plan({"type": "cutout", "start": 0, "end": 1, "image": 2}))
        self.assertIn('src="assets/images/2.png"', html)
        for image in (0, 7, "../../etc/passwd", "http://x/a.png", True):
            with self.assertRaises(PlanError):
                compose(plan({"type": "cutout", "start": 0, "end": 1, "image": image}))

    def test_card_exige_fonte_e_recusa_verificar(self):
        card = {"type": "fact_card", "start": 0, "end": 1, "value": "32%", "label": "das mortes"}
        with self.assertRaises(PlanError):
            compose(plan(card))
        with self.assertRaises(PlanError):
            compose(plan({**card, "source": "OMS", "value": "[VERIFICAR: 32%]"}))
        self.assertIn("Fonte: OMS", compose(plan({**card, "source": "OMS"})))

    def test_musica(self):
        self.assertIsNone(music_settings({}))
        self.assertEqual(music_settings({"music": {}}), {"volume": 0.3})
        with self.assertRaises(PlanError):
            compose(plan({"type": "hook", "start": 0, "end": 1, "text": "a"}, music={"volume": 2}))

    def test_destaque_nao_quebra_texto_escapado(self):
        html = compose(plan({"type": "hook", "start": 0, "end": 1, "text": "R&D forte", "emphasis": "amp"}))
        self.assertIn("R&amp;D forte", html)
        html = compose(plan({"type": "hook", "start": 0, "end": 1, "text": "R&D forte", "emphasis": "forte"}))
        self.assertIn("R&amp;D <b>forte</b>", html)

    def test_titulo_longo_diminui(self):
        html = compose(plan({"type": "hook", "start": 0, "end": 1, "text": "x " * 30}))
        self.assertIn('class="hook long clip"', html)

    def test_video_sem_audio_nao_declara_audio(self):
        self.assertNotIn("data-has-audio", compose(plan({"type": "end_card", "start": 0, "end": 1, "text": "a"}, source_audio=False)))

    def test_video_interno_tem_tempo_proprio(self):
        html = compose(plan({"type": "split_screen", "start": 4, "end": 8}))
        self.assertIn('data-start="4.0" data-duration="4.0" data-media-start="4.0" muted', html)

    def test_so_musica_nao_precisa_de_efeito(self):
        self.assertIn("<video", compose({"duration": 5, "layers": [], "music": {}}))

    def test_audio_com_e_sem_fala_e_musica(self):
        self.assertIn("sidechaincompress", audio_graph(True, 0.3))
        self.assertNotIn("sidechaincompress", audio_graph(False, 0.3))
        self.assertTrue(audio_graph(True, None).startswith("[0:a]loudnorm"))
        self.assertIsNone(audio_graph(False, None))

    def test_png_precisa_de_transparencia(self):
        header = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08"
        self.assertTrue(has_transparency(header + b"\x06"))
        self.assertFalse(has_transparency(header + b"\x02" + b"\x00" * 40))
        self.assertTrue(has_transparency(header + b"\x03" + b"\x00" * 40 + b"tRNS"))
        self.assertFalse(has_transparency(b"nao e png"))

    def test_recusa_plano_invalido(self):
        ruins = [
            None,
            plan(),
            plan({"type": "video_livre", "start": 0, "end": 1}),
            plan({"type": "hook", "start": 5, "end": 4, "text": "a"}),
            plan({"type": "hook", "start": 0, "end": 31, "text": "a"}),
            plan({"type": "hook", "start": 0, "end": 1, "text": "x" * 91}),
            plan({"type": "hook", "start": 0, "end": 1, "text": "a"}, duration=181),
            plan({"type": "picture_in_picture", "start": 0, "end": 1, "corner": "meio"}),
            plan({"type": "captions", "words": []}),
            plan({"type": "hook", "start": True, "end": 1, "text": "a"}),
        ]
        for ruim in ruins:
            with self.assertRaises(PlanError):
                compose(ruim)


if __name__ == "__main__":
    unittest.main()

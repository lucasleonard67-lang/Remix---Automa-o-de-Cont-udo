import { describe, expect, it } from "vitest";

import {
  articleFromHtml,
  classifyLink,
  feedBody,
  isPrivateAddress,
  isPublicUrl,
  linkCaption,
  xPostText,
} from "../../supabase/functions/_shared/link-rules";

describe("classifyLink", () => {
  it("reconhece cada rede e normaliza o endereço", () => {
    expect(classifyLink("https://www.instagram.com/reel/abc/?igsh=1")).toEqual({
      url: "https://www.instagram.com/reel/abc/",
      platform: "instagram",
      owner: null,
    });
    expect(classifyLink("instagram.com/coach/p/abc")?.owner).toBe("coach");
    expect(classifyLink("https://twitter.com/Jack/status/20?s=1")).toEqual({
      url: "https://x.com/Jack/status/20",
      platform: "x",
      owner: "jack",
    });
    expect(classifyLink("https://youtu.be/xyz")?.url).toBe("https://www.youtube.com/watch?v=xyz");
    expect(classifyLink("https://www.youtube.com/shorts/xyz")?.platform).toBe("youtube");
    expect(classifyLink("https://www.tiktok.com/@ana/video/1?x=1")).toEqual({
      url: "https://www.tiktok.com/@ana/video/1",
      platform: "tiktok",
      owner: "ana",
    });
    expect(classifyLink("exemplo.com/artigo#topo")?.url).toBe("https://exemplo.com/artigo");
  });

  it("perfil do Instagram é página comum, e texto solto não é link", () => {
    expect(classifyLink("https://instagram.com/coach")?.platform).toBe("site");
    expect(classifyLink("isso não é link")).toBeNull();
    expect(classifyLink("")).toBeNull();
  });
});

describe("endereços internos", () => {
  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://servico.internal/",
    "http://rpsyfmvwdmzykggcwnoc.supabase.co/functions/v1/x",
    "https://exemplo.com:8443/",
    "https://user:senha@exemplo.com/",
    "file:///etc/passwd",
    "ftp://exemplo.com/",
  ])("recusa %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it("aceita site público", () => {
    expect(isPublicUrl("https://exemplo.com/artigo")).toBe(true);
    expect(isPublicUrl("http://8.8.8.8/")).toBe(true);
  });

  it("DNS que aponta para dentro é interno", () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("fd12::1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1::1")).toBe(false);
  });
});

describe("articleFromHtml", () => {
  const html = `<html><head><title>Título cru</title>
    <meta property="og:title" content="Título bom">
    <meta name="description" content="Resumo &amp; mais">
    <meta property="og:image" content="/capa.jpg"></head>
    <body><nav>Menu</nav><header>Topo</header>
    <article><p>Primeiro parágrafo.</p><script>x()</script><p>Segundo.</p></article>
    <footer>Rodapé</footer></body></html>`;

  it("pega título, resumo, imagem absoluta e só o corpo", () => {
    const article = articleFromHtml(html, "https://exemplo.com/a/b");
    expect(article.title).toBe("Título bom");
    expect(article.description).toBe("Resumo & mais");
    expect(article.image).toBe("https://exemplo.com/capa.jpg");
    expect(article.text).toBe("Primeiro parágrafo.\nSegundo.");
  });

  it("descarta imagem que aponta para dentro", () => {
    const page = '<meta property="og:image" content="http://169.254.169.254/x">';
    expect(articleFromHtml(page, "https://exemplo.com").image).toBeNull();
  });
});

describe("textos", () => {
  it("tira o rodapé do Reddit", () => {
    expect(feedBody("Corpo do post\nsubmitted by /u/ana\n[link] [comments]")).toBe("Corpo do post");
    expect(feedBody("submitted by /u/ana [link]")).toBeNull();
  });

  it("tira o link de imagem do post do X", () => {
    const html =
      '<blockquote><p lang="en">just setting up <a href="#">pic.x.com/abc</a></p></blockquote>';
    expect(xPostText(html)).toBe("just setting up");
  });

  it("não repete o título e respeita o teto", () => {
    expect(linkCaption("Oi", "Oi, tudo bem")).toBe("Oi, tudo bem");
    expect(linkCaption("Título", "Corpo")).toBe("Título\n\nCorpo");
    expect(linkCaption(null, "abcdef", 3)).toBe("abc");
  });
});

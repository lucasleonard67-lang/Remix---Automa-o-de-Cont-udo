import { describe, expect, it } from "vitest";

import {
  isClaudeCallback,
  isPreviewOrigin,
  pkceChallenge,
  serverMetadata,
  validAppOrigin,
  validChallenge,
  validRedirect,
  validVerifier,
  wwwAuthenticate,
} from "../../supabase/functions/_shared/mcp-oauth";

describe("retorno do OAuth", () => {
  it("só volta para o Claude ou para a máquina local", () => {
    expect(validRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(validVerifier("a".repeat(43))).toBe(true);
    expect(validVerifier("curto")).toBe(false);
    expect(validChallenge("a".repeat(43))).toBe(true);
    expect(validChallenge("a b")).toBe(false);
    expect(validRedirect("http://localhost:33418/callback")).toBe(true);
    expect(validRedirect("http://127.0.0.1:9999/callback")).toBe(true);
  });

  it("recusa qualquer outro destino", () => {
    expect(validRedirect("https://evil.com/cb")).toBe(false);
    expect(validRedirect("https://claude.ai.evil.com/cb")).toBe(false);
    expect(validRedirect("https://claude.ai/qualquer")).toBe(false);
    expect(validRedirect("https://outro.claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(validRedirect("https://claude.ai:8443/api/mcp/auth_callback")).toBe(false);
    expect(validRedirect("javascript:alert(document.domain)//")).toBe(false);
    expect(validRedirect("http://user:x@localhost/cb")).toBe(false);
    expect(validRedirect("http://claude.ai/cb")).toBe(false);
    expect(validRedirect("https://claude.ai/cb#x")).toBe(false);
    expect(validRedirect("javascript:alert(1)")).toBe(false);
    expect(validRedirect(3)).toBe(false);
  });
});

describe("PKCE", () => {
  it("bate com o vetor da RFC 7636", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("descoberta", () => {
  const base = "https://x.supabase.co/functions/v1/mcp-server";

  it("publica S256 e cliente público", () => {
    expect(serverMetadata(base)).toMatchObject({
      issuer: base,
      token_endpoint: `${base}/token`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      jwks_uri: `${base}/jwks`,
      subject_types_supported: ["public"],
    });
  });

  it("401 aponta para os metadados", () => {
    expect(wwwAuthenticate(base)).toContain(`${base}/.well-known/oauth-protected-resource`);
  });

  it("reconhece o retorno do Claude e a prévia do Lovable", () => {
    expect(isClaudeCallback("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isClaudeCallback("http://localhost:1/cb")).toBe(false);
    expect(isPreviewOrigin("https://abc.lovableproject.com")).toBe(true);
    expect(isPreviewOrigin("https://id-preview--abc.lovable.app")).toBe(true);
    expect(isPreviewOrigin("https://app.subido.ai")).toBe(false);
  });

  it("origem do app é só origem", () => {
    expect(validAppOrigin("https://app.exemplo.com")).toBe(true);
    expect(validAppOrigin("https://app.exemplo.com/x")).toBe(false);
    expect(validAppOrigin("http://evil.com")).toBe(false);
    expect(validAppOrigin("http://127.0.0.1:8082")).toBe(true);
  });
});

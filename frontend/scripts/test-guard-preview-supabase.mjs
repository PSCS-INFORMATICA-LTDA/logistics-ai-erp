import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateGuards, evaluatePreviewSupabase } from "./guard-sso-dev-supabase.mjs";

const DEV_REF = "jmbajdpkvlrslirwzyze";
const PROD_REF = "tqeenmswotxqainkyyct";

function projectUrl(ref) {
  return `https://${ref}.supabase.co`;
}

const DEV_URL = projectUrl(DEV_REF);
const PROD_URL = projectUrl(PROD_REF);

function texts(result) {
  return result.lines.map((line) => line.text).join("\n");
}

function assertNoSecretLeak(result, ...forbidden) {
  const blob = texts(result);
  for (const value of forbidden) {
    assert.equal(blob.includes(value), false, `log vazou ${value}`);
  }
  assert.equal(blob.includes("http"), false);
  assert.equal(blob.includes("supabase.co"), false);
}

describe("preview supabase guard", () => {
  it("aceita o DEV correto com SSO desligado", () => {
    const result = evaluateGuards({
      VERCEL_ENV: "preview",
      PSCS_ONE_SSO_ENABLED: "false",
      NEXT_PUBLIC_SUPABASE_URL: `${DEV_URL}/`,
    });
    assert.equal(result.exitCode, 0);
    assert.match(texts(result), /preview-supabase: PASS project_ref=jmbajdpkvlrslirwzyze/);
    assert.match(texts(result), /SSO guard: skipped \(flag off\)/);
    assertNoSecretLeak(result, DEV_URL);
  });

  it("recusa PROD no Preview e registra só o project_ref", () => {
    const result = evaluateGuards({
      VERCEL_ENV: "preview",
      PSCS_ONE_SSO_ENABLED: "false",
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
    });
    assert.equal(result.exitCode, 1);
    assert.match(texts(result), /preview-supabase: FAIL project_ref=tqeenmswotxqainkyyct/);
    assertNoSecretLeak(result, PROD_URL);
  });

  it("falha quando a variável está ausente", () => {
    const result = evaluateGuards({
      VERCEL_ENV: "preview",
      PSCS_ONE_SSO_ENABLED: "false",
    });
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.lines.some((line) => line.text === "preview-supabase: FAIL"),
      true,
    );
    assert.equal(texts(result).includes("project_ref="), false);
  });

  it("rejeita URL inválida, credencial, porta e hostname parecido", () => {
    const cases = [
      "not a url",
      `http://${DEV_REF}.supabase.co`,
      `https://user:secret@${DEV_REF}.supabase.co`,
      `https://${DEV_REF}.supabase.co:8443`,
      `https://${DEV_REF}.supabase.co.evil.com`,
      `${DEV_URL}/rest/v1`,
      `https://${DEV_REF}a.supabase.co`,
    ];
    for (const url of cases) {
      const result = evaluateGuards({
        VERCEL_ENV: "preview",
        PSCS_ONE_SSO_ENABLED: "false",
        NEXT_PUBLIC_SUPABASE_URL: url,
      });
      assert.equal(result.exitCode, 1, url);
      assert.match(texts(result), /preview-supabase: FAIL/);
      assertNoSecretLeak(result, url, "secret", "user", "evil.com", "8443");
    }
    assert.equal(evaluatePreviewSupabase(DEV_URL).ok, true);
  });

  it("não aplica a trava de Preview fora de preview e preserva o SSO desligado", () => {
    const result = evaluateGuards({
      VERCEL_ENV: "production",
      PSCS_ONE_SSO_ENABLED: "false",
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(texts(result).includes("preview-supabase"), false);
    assert.match(texts(result), /SSO guard: skipped \(flag off\)/);
    assertNoSecretLeak(result, PROD_URL);
  });

  it("mantém a recusa de PROD do SSO quando o ambiente não é preview", () => {
    const result = evaluateGuards({
      VERCEL_ENV: "production",
      PSCS_ONE_SSO_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(texts(result).includes("preview-supabase"), false);
    assert.match(texts(result), /SSO guard: supabase_prod_forbidden/);
    assertNoSecretLeak(result, PROD_URL);
  });
});

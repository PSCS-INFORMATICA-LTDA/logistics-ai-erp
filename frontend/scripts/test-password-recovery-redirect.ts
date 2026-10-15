import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { submitPasswordLogin } from "../src/lib/auth/password-login.ts";
import {
  buildPasswordRecoveryRedirect,
  classifyPasswordUpdate,
  classifyRecoveryLinkError,
  isAuthorizedRecoveryOrigin,
  resolveRecoveryCallback,
} from "../src/lib/auth/recovery-redirect.ts";

const PREVIEW_ORIGIN =
  "https://logistics-ai-erp-3io79a3ng-pscs-informatica-ltda-s-projects.vercel.app";
const DEV_ORIGIN = "https://logistics-ai-erp-dev.vercel.app";
const RESET_NEXT = "/auth/redefinir-senha";
const SAMPLE_CODE = "pkce-code-nao-logar";
const SAMPLE_PASSWORD = "senha-nova-nao-usar";

function assertNoSecrets(value: string, extras: string[] = []) {
  const haystack = value.toLowerCase();
  for (const secret of [SAMPLE_CODE, SAMPLE_PASSWORD, "access_token", "refresh_token", ...extras]) {
    assert.equal(haystack.includes(secret.toLowerCase()), false, `vazou material sensível: ${secret}`);
  }
}

describe("recuperação de senha — redirect autorizado", () => {
  it("T01 recuperação iniciada no Preview aponta para o callback HTTPS do Preview", () => {
    const redirect = buildPasswordRecoveryRedirect(PREVIEW_ORIGIN, RESET_NEXT);
    assert.equal(
      redirect,
      `${PREVIEW_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
    assert.equal(redirect?.startsWith("https://"), true);
    assert.equal(redirect?.includes("localhost"), false);
    assert.equal(redirect?.includes("grx-management.vercel.app"), false);
  });

  it("T02 recuperação iniciada no DEV operacional permanece no host operacional", () => {
    const redirect = buildPasswordRecoveryRedirect(DEV_ORIGIN, RESET_NEXT);
    assert.equal(
      redirect,
      `${DEV_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
  });

  it("T03 recuperação em localhost durante DEV local aceita as portas locais", () => {
    for (const origin of ["http://localhost:3000", "http://localhost:3002", "http://127.0.0.1:3002"]) {
      const redirect = buildPasswordRecoveryRedirect(origin, RESET_NEXT);
      assert.equal(redirect, `${origin}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`);
    }
  });

  it("T04 código válido segue para a rota de redefinição sem o código na URL", () => {
    const decision = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: null,
    });
    assert.equal(decision.kind, "valid");
    assert.equal(decision.location, `${PREVIEW_ORIGIN}${RESET_NEXT}`);
    assertNoSecrets(decision.location);
  });

  it("T05 código expirado volta ao login com mensagem fixa", () => {
    assert.equal(classifyRecoveryLinkError({ code: "otp_expired", message: "Token has expired" }), "expired");
    const decision = resolveRecoveryCallback({
      requestUrl: `${DEV_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: { code: "otp_expired", message: `expired ${SAMPLE_CODE}` },
    });
    assert.equal(decision.kind, "expired");
    const expiredLogin = new URL(decision.location);
    assert.equal(expiredLogin.origin, DEV_ORIGIN);
    assert.equal(expiredLogin.pathname, "/login");
    assert.equal(expiredLogin.searchParams.get("code"), null);
    assert.equal(
      expiredLogin.searchParams.get("error"),
      "Este link de recuperação expirou. Solicite um novo.",
    );
    assertNoSecrets(decision.location);
  });

  it("T06 código reutilizado volta ao login com mensagem fixa", () => {
    assert.equal(
      classifyRecoveryLinkError({ code: "flow_state_not_found", message: "Flow state not found" }),
      "reused",
    );
    const decision = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: { message: "Email link is invalid or has already been used" },
    });
    assert.equal(decision.kind, "reused");
    const reusedLogin = new URL(decision.location);
    assert.equal(reusedLogin.pathname, "/login");
    assert.equal(reusedLogin.searchParams.get("code"), null);
    assert.equal(
      reusedLogin.searchParams.get("error"),
      "Este link de recuperação já foi utilizado. Solicite um novo.",
    );
    assertNoSecrets(decision.location);
  });

  it("T07 senha atualizada com sucesso aponta para o dashboard e não devolve a senha", () => {
    const decision = classifyPasswordUpdate({ sessionPresent: true, updateError: null });
    assert.deepEqual(decision, { ok: true, next: "/dashboard" });
    assertNoSecrets(JSON.stringify(decision), [SAMPLE_PASSWORD]);
  });

  it("T08 login com a nova senha usa o endpoint de senha e o resultado não ecoa a senha", async () => {
    const update = classifyPasswordUpdate({ sessionPresent: true, updateError: null });
    assert.equal(update.ok, true);

    const originalFetch = globalThis.fetch;
    let capturedBody = "";
    globalThis.fetch = async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      const login = await submitPasswordLogin("fixture@example.test", SAMPLE_PASSWORD);
      assert.equal(login.ok, true);
      assert.equal(JSON.stringify(login).includes(SAMPLE_PASSWORD), false);
      assert.equal(capturedBody.includes(SAMPLE_PASSWORD), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("T09 URL externa não autorizada não gera redirect", () => {
    const rejected = [
      null,
      "",
      "https://evil.example",
      "https://outro-app.vercel.app",
      "https://logistics-ai-erp.vercel.app.evil.com",
      "http://logistics-ai-erp-preview.vercel.app",
      "https://user:pass@logistics-ai-erp-preview.vercel.app",
      "https://logistics-ai-erp-preview.vercel.app/phishing",
      "https://logistics-ai-erp-preview.vercel.app?next=https://evil.example",
      "https://evil.example.vercel.app",
      "http://localhost:3001",
      "https://grx-management.vercel.app.evil.com",
    ];
    for (const origin of rejected) {
      assert.equal(isAuthorizedRecoveryOrigin(origin), false, String(origin));
      assert.equal(buildPasswordRecoveryRedirect(origin, RESET_NEXT), null, String(origin));
    }
    assert.equal(buildPasswordRecoveryRedirect(PREVIEW_ORIGIN, "https://evil.example"), null);
    assert.equal(buildPasswordRecoveryRedirect(PREVIEW_ORIGIN, "//evil.example"), null);
    assert.equal(isAuthorizedRecoveryOrigin("https://grx-management.vercel.app"), true);
    assert.equal(
      buildPasswordRecoveryRedirect("https://grx-management.vercel.app", RESET_NEXT),
      `https://grx-management.vercel.app/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
  });

  it("T10 ausência de exposição de tokens no redirect, nos erros e no código", () => {
    const missing = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: null,
    });
    assert.equal(missing.kind, "missing");
    assertNoSecrets(missing.location);
    assert.equal(missing.location.includes("/dashboard"), false);

    const invalid = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&access_token=segredo&next=/dashboard`,
      exchangeError: { code: "bad_code", message: `invalid access_token=${SAMPLE_CODE}` },
    });
    assert.equal(invalid.kind, "invalid");
    assertNoSecrets(invalid.location, ["access_token", "segredo"]);

    const root = path.join(process.cwd(), "src");
    const files = [
      "lib/auth/recovery-redirect.ts",
      "app/auth/callback/route.ts",
      "app/auth/redefinir-senha/page.tsx",
      "app/login/page.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      assert.equal(/console\.(log|debug|info|warn|error)\s*\(/.test(source), false, file);
      assert.equal(source.includes("access_token"), false, file);
      assert.equal(source.includes("refresh_token"), false, file);
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { submitPasswordLogin } from "../src/lib/auth/password-login.ts";
import {
  buildPasswordRecoveryRedirect,
  canShowPasswordResetForm,
  classifyPasswordConfirmation,
  classifyPasswordUpdate,
  classifyRecoveryLinkError,
  isAuthorizedRecoveryOrigin,
  RECOVERY_LINK_EXPIRED_MESSAGE,
  RECOVERY_LINK_REUSED_MESSAGE,
  recoveryAuthErrorKindFromHref,
  resolveAuthEntryRedirect,
  resolveRecoveryCallback,
} from "../src/lib/auth/recovery-redirect.ts";

const PREVIEW_ORIGIN =
  "https://logistics-ai-erp-3io79a3ng-pscs-informatica-ltda-s-projects.vercel.app";
const DEV_ORIGIN = "https://logistics-ai-erp-dev.vercel.app";
const PR19_PREVIEW_ORIGIN = "https://logistics-release-main-ll6013z3f.vercel.app";
const PR19_STABLE_ORIGIN =
  "https://logistics-release-m-git-fa6d84-pscs-informatica-ltda-s-projects.vercel.app";
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
  it("recuperação iniciada no Preview aponta para o callback HTTPS do Preview", () => {
    const redirect = buildPasswordRecoveryRedirect(PREVIEW_ORIGIN, RESET_NEXT);
    assert.equal(
      redirect,
      `${PREVIEW_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
    assert.equal(redirect?.startsWith("https://"), true);
    assert.equal(redirect?.includes("localhost"), false);
    assert.equal(redirect?.includes("grx-management.vercel.app"), false);
  });

  it("recuperação iniciada no DEV operacional permanece no host operacional", () => {
    const redirect = buildPasswordRecoveryRedirect(DEV_ORIGIN, RESET_NEXT);
    assert.equal(
      redirect,
      `${DEV_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
  });

  it("recuperação em localhost durante DEV local aceita as portas locais", () => {
    for (const origin of ["http://localhost:3000", "http://localhost:3002", "http://127.0.0.1:3002"]) {
      const redirect = buildPasswordRecoveryRedirect(origin, RESET_NEXT);
      assert.equal(redirect, `${origin}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`);
    }
  });

  it("T01 link válido abre a redefinição sem o código na URL", () => {
    const decision = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: null,
    });
    assert.equal(decision.kind, "valid");
    assert.equal(decision.setRecoveryGrant, true);
    assert.equal(decision.location, `${PREVIEW_ORIGIN}${RESET_NEXT}`);
    assert.equal(decision.location.includes("/dashboard"), false);
    assertNoSecrets(decision.location);
  });

  it("T02 link expirado não abre o dashboard", () => {
    assert.equal(classifyRecoveryLinkError({ code: "otp_expired", message: "Token has expired" }), "expired");
    const decision = resolveRecoveryCallback({
      requestUrl: `${DEV_ORIGIN}/auth/callback?error=access_denied&error_code=otp_expired&next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: null,
      existingSession: true,
    });
    assert.equal(decision.kind, "expired");
    assert.equal(decision.setRecoveryGrant, false);
    const expiredLogin = new URL(decision.location);
    assert.equal(expiredLogin.origin, DEV_ORIGIN);
    assert.equal(expiredLogin.pathname, "/login");
    assert.equal(expiredLogin.searchParams.get("code"), null);
    assert.equal(expiredLogin.searchParams.get("error_code"), null);
    assert.equal(expiredLogin.searchParams.get("recovery"), "1");
    assert.equal(expiredLogin.searchParams.get("error"), RECOVERY_LINK_EXPIRED_MESSAGE);
    assert.equal(decision.location.includes("/dashboard"), false);
    assertNoSecrets(decision.location);
  });

  it("T03 link reutilizado volta ao login com mensagem própria", () => {
    assert.equal(
      classifyRecoveryLinkError({ code: "flow_state_not_found", message: "Flow state not found" }),
      "reused",
    );
    const decision = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&next=${encodeURIComponent(RESET_NEXT)}`,
      exchangeError: { message: "Email link is invalid or has already been used" },
    });
    assert.equal(decision.kind, "reused");
    assert.equal(decision.setRecoveryGrant, false);
    const reusedLogin = new URL(decision.location);
    assert.equal(reusedLogin.pathname, "/login");
    assert.equal(reusedLogin.searchParams.get("code"), null);
    assert.equal(reusedLogin.searchParams.get("error"), RECOVERY_LINK_REUSED_MESSAGE);
    assert.equal(decision.location.includes("/dashboard"), false);
    assertNoSecrets(decision.location);
  });

  it("T04 callback com erro permanece no login", () => {
    const decision = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?error=server_error&error_code=unexpected_failure&next=/dashboard`,
      exchangeError: null,
    });
    assert.equal(decision.kind, "invalid");
    const failed = new URL(decision.location);
    assert.equal(failed.pathname, "/login");
    assert.equal(failed.searchParams.get("error"), RECOVERY_LINK_EXPIRED_MESSAGE);
    assert.equal(decision.location.includes("/dashboard"), false);
    assertNoSecrets(decision.location);
  });

  it("T05 sessão previamente autenticada não mascara otp_expired", () => {
    const decision = resolveAuthEntryRedirect({
      requestUrl: `${DEV_ORIGIN}/login?next=${encodeURIComponent("/dashboard?error=access_denied&error_code=otp_expired")}`,
      existingSession: true,
    });
    assert.ok(decision);
    assert.equal(decision?.kind, "expired");
    const landed = new URL(decision!.location);
    assert.equal(landed.pathname, "/login");
    assert.equal(landed.searchParams.get("error"), RECOVERY_LINK_EXPIRED_MESSAGE);
    assert.equal(landed.searchParams.get("error_code"), null);
    assert.equal(decision?.location.includes("/dashboard"), false);
    assertNoSecrets(decision!.location);
  });

  it("T06 código PKCE inválido não abre o dashboard", () => {
    assert.equal(
      classifyRecoveryLinkError({ code: "bad_code_verifier", message: "code verifier mismatch" }),
      "invalid",
    );
    const decision = resolveRecoveryCallback({
      requestUrl: `${PREVIEW_ORIGIN}/auth/callback?code=${SAMPLE_CODE}&next=/dashboard`,
      exchangeError: { code: "bad_code_verifier", message: `pkce ${SAMPLE_CODE}` },
      existingSession: true,
    });
    assert.equal(decision.kind, "invalid");
    assert.equal(decision.setRecoveryGrant, false);
    const landed = new URL(decision.location);
    assert.equal(landed.pathname, "/login");
    assert.equal(landed.searchParams.get("error"), RECOVERY_LINK_EXPIRED_MESSAGE);
    assert.equal(decision.location.includes("/dashboard"), false);
    assertNoSecrets(decision.location);
  });

  it("T07 tela de redefinição só abre com o grant do callback", () => {
    assert.equal(canShowPasswordResetForm(false), false);
    assert.equal(canShowPasswordResetForm(true), true);
    const form = fs.readFileSync(
      path.join(process.cwd(), "src/app/auth/redefinir-senha/redefinir-senha-form.tsx"),
      "utf8",
    );
    assert.equal(form.includes("Nova senha"), true);
    assert.equal(form.includes("Confirmar nova senha"), true);
    assert.equal(form.includes("Solicitar um novo e-mail"), true);
    assert.equal(form.includes("RECOVERY_LINK_EXPIRED_MESSAGE"), true);
    assert.equal(form.includes("updateUser"), true);
  });

  it("T08 confirmação de senha divergente não segue para a atualização", () => {
    const mismatch = classifyPasswordConfirmation(SAMPLE_PASSWORD, `${SAMPLE_PASSWORD}-outra`);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.error, "A confirmação da senha não confere.");
      assertNoSecrets(mismatch.error, [SAMPLE_PASSWORD]);
    }
    const match = classifyPasswordConfirmation(SAMPLE_PASSWORD, SAMPLE_PASSWORD);
    assert.equal(match.ok, true);
  });

  it("T09 atualização efetiva exige grant e resposta positiva", () => {
    const sessionOnly = classifyPasswordUpdate({
      sessionPresent: true,
      recoveryGrant: false,
      updateError: null,
      updateAccepted: false,
    });
    assert.equal(sessionOnly.ok, false);

    const rejected = classifyPasswordUpdate({
      sessionPresent: true,
      recoveryGrant: true,
      updateError: { message: "Auth update failed" },
      updateAccepted: false,
    });
    assert.equal(rejected.ok, false);

    const accepted = classifyPasswordUpdate({
      sessionPresent: true,
      recoveryGrant: true,
      updateError: null,
      updateAccepted: true,
    });
    assert.deepEqual(accepted, { ok: true, next: "/dashboard" });
    assertNoSecrets(JSON.stringify(accepted), [SAMPLE_PASSWORD]);
  });

  it("T10 login com a nova senha usa o endpoint de senha e o resultado não ecoa a senha", async () => {
    const update = classifyPasswordUpdate({
      sessionPresent: true,
      recoveryGrant: true,
      updateError: null,
      updateAccepted: true,
    });
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

  it("T11 redirecionamento seguro permanece na origem e fora do dashboard quando o link falha", () => {
    const cases = [
      `${PREVIEW_ORIGIN}/dashboard?error=access_denied&error_code=otp_expired`,
      `${PREVIEW_ORIGIN}/?error=access_denied&error_code=otp_expired`,
      `${PREVIEW_ORIGIN}/auth/callback?next=${encodeURIComponent("/dashboard")}&error=access_denied&error_code=otp_expired`,
    ];
    for (const requestUrl of cases) {
      const decision = resolveAuthEntryRedirect({ requestUrl, existingSession: true });
      assert.ok(decision);
      const landed = new URL(decision!.location);
      assert.equal(landed.origin, PREVIEW_ORIGIN);
      assert.equal(landed.pathname, "/login");
      assert.equal(landed.protocol, "https:");
      assert.equal(decision!.location.includes("/dashboard"), false);
      assert.equal(landed.searchParams.get("error_code"), null);
      assertNoSecrets(decision!.location);
    }
    assert.equal(
      recoveryAuthErrorKindFromHref(`${PREVIEW_ORIGIN}/dashboard#error=access_denied&error_code=otp_expired`),
      "expired",
    );
  });

  it("o Preview da PR #19 entra na allowlist sem abrir os demais hosts da Vercel", () => {
    assert.equal(isAuthorizedRecoveryOrigin(PR19_PREVIEW_ORIGIN), true);
    assert.equal(
      buildPasswordRecoveryRedirect(PR19_PREVIEW_ORIGIN, RESET_NEXT),
      `${PR19_PREVIEW_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
    assert.equal(isAuthorizedRecoveryOrigin(PR19_STABLE_ORIGIN), true);
    assert.equal(
      buildPasswordRecoveryRedirect(PR19_STABLE_ORIGIN, RESET_NEXT),
      `${PR19_STABLE_ORIGIN}/auth/callback?next=${encodeURIComponent(RESET_NEXT)}`,
    );
    const stillRejected = [
      "https://logistics-release-main-outro.vercel.app",
      "https://logistics-release-m-git-outro-pscs-informatica-ltda-s-projects.vercel.app",
      "https://outro-app.vercel.app",
      "https://evil.example",
    ];
    for (const origin of stillRejected) {
      assert.equal(isAuthorizedRecoveryOrigin(origin), false, origin);
      assert.equal(buildPasswordRecoveryRedirect(origin, RESET_NEXT), null, origin);
    }
    assert.equal(isAuthorizedRecoveryOrigin("https://grx-management.vercel.app"), true);
    assert.equal(isAuthorizedRecoveryOrigin(DEV_ORIGIN), true);
    assert.equal(isAuthorizedRecoveryOrigin(PREVIEW_ORIGIN), true);
  });

  it("URL externa não autorizada não gera redirect", () => {
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

  it("T12 ausência de exposição de tokens no redirect, nos erros e no código", () => {
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
      "app/auth/redefinir-senha/redefinir-senha-form.tsx",
      "app/login/page.tsx",
      "components/auth/RecoveryErrorGuard.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      assert.equal(/console\.(log|debug|info|warn|error)\s*\(/.test(source), false, file);
      assert.equal(source.includes("access_token"), false, file);
      assert.equal(source.includes("refresh_token"), false, file);
    }
  });
});

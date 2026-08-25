import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  hasAuthSession,
  mapPasswordAuthError,
  sanitizeAuthNextPath,
} from "../src/lib/auth/password-login.ts";

describe("password login helpers", () => {
  it("sanitizes next redirect paths", () => {
    assert.equal(sanitizeAuthNextPath(null), "/dashboard");
    assert.equal(sanitizeAuthNextPath(""), "/dashboard");
    assert.equal(sanitizeAuthNextPath("/financeiro"), "/financeiro");
    assert.equal(sanitizeAuthNextPath("//evil.test"), "/dashboard");
    assert.equal(sanitizeAuthNextPath("https://evil.test"), "/dashboard");
    assert.equal(sanitizeAuthNextPath("  /operacional  "), "/operacional");
  });

  it("maps Supabase auth errors to Portuguese messages", () => {
    assert.equal(
      mapPasswordAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }),
      "E-mail ou senha incorretos.",
    );
    assert.equal(
      mapPasswordAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }),
      "Confirme seu e-mail antes de entrar.",
    );
    assert.equal(
      mapPasswordAuthError({ code: "too_many_requests", message: "Too many requests" }),
      "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    );
    assert.equal(mapPasswordAuthError(null), "Não foi possível entrar. Tente novamente.");
  });

  it("detects auth sessions", () => {
    assert.equal(hasAuthSession(null), false);
    assert.equal(hasAuthSession({}), false);
    assert.equal(hasAuthSession({ access_token: "token" }), true);
  });
});

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return null;
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

describe("password login API (DEV read-only)", () => {
  const env = loadEnvLocal();
  const devRef = "jmbajdpkvlrslirwzyze";
  const prodRef = "tqeenmswotxqainkyyct";

  it("targets Logistics DEV Supabase only", () => {
    if (!env) return;
    const ref = env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1];
    assert.equal(ref, devRef);
    assert.notEqual(ref, prodRef);
    assert.ok(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });

  it("rejects invalid password without creating a session", async () => {
    if (!env?.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.signInWithPassword({
      email: "dev.ap@pscs.local",
      password: "invalid-probe-only",
    });
    assert.equal(error?.code, "invalid_credentials");
    assert.equal(hasAuthSession(data.session), false);
  });

  it("accepts the documented DEV seed fixture password", async () => {
    if (!env?.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.signInWithPassword({
      email: "dev.ap@pscs.local",
      password: "DevAp#2026Test",
    });
    assert.equal(error, null);
    assert.equal(hasAuthSession(data.session), true);
  });
});

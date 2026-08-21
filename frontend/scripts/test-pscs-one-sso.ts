import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executePscsOneCallback,
  identityFromTokenPayload,
} from "../src/lib/pscs-one/callbackFlow.ts";
import { evaluateLogisticsSsoSupabase } from "../src/lib/pscs-one/devSupabaseGuard.ts";
import { publicPscsOneSsoReason } from "../src/lib/pscs-one/errors.ts";
import { pickMappedMembership } from "../src/lib/pscs-one/preferMappedMembership.ts";

const DEV = "jmbajdpkvlrslirwzyze";
const PROD = "tqeenmswotxqainkyyct";

const identity = {
  version: "1",
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "qa@example.com",
  company_id: "c0b00000-0000-4000-8000-00000000000b",
  product_key: "logistics_ai",
  external_company_id: "bcd3c6c9-0e4a-4356-addd-4af925725576",
  environment: "development",
};

function deps(overrides = {}) {
  return {
    exchangeAuthorizationCode: async () => identity,
    ensureLocalUser: async () => ({
      authUserId: "22222222-2222-4222-8222-222222222222",
      email: identity.email,
      tokenHash: "hash",
    }),
    ensureMembership: async () => undefined,
    verifySession: async () => ({ accessTokenPresent: true, refreshTokenPresent: true }),
    writeCookies: () => undefined,
    ...overrides,
  };
}

describe("logistics SSO guard", () => {
  it("stays off until the flag is true", () => {
    const decision = evaluateLogisticsSsoSupabase({
      NEXT_PUBLIC_SUPABASE_URL: `https://${DEV}.supabase.co`,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, "sso_disabled");
  });

  it("refuses production Supabase even with the flag on", () => {
    const decision = evaluateLogisticsSsoSupabase({
      PSCS_ONE_SSO_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, "supabase_prod_forbidden");
  });

  it("accepts only Logistics DEV", () => {
    const decision = evaluateLogisticsSsoSupabase({
      PSCS_ONE_SSO_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: `https://${DEV}.supabase.co`,
    });
    assert.equal(decision.ok, true);
  });
});

describe("logistics SSO identity contract", () => {
  it("rejects catering_ai product_key", () => {
    assert.throws(
      () =>
        identityFromTokenPayload({
          ok: true,
          identity: { ...identity, product_key: "catering_ai" },
        }),
      /product_key_denied/,
    );
  });

  it("accepts logistics_ai identity", () => {
    assert.deepEqual(identityFromTokenPayload({ ok: true, identity }), identity);
  });
});

describe("mapped company preference", () => {
  it("prefers the mapped company when the user has more than one membership", () => {
    const picked = pickMappedMembership(
      [
        { company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { company_id: identity.external_company_id },
      ],
      identity.external_company_id,
    );
    assert.equal(picked?.company_id, identity.external_company_id);
  });
});

describe("callback flow", () => {
  it("denies missing code", async () => {
    const missing = await executePscsOneCallback({ code: null, origin: "https://example.test" }, deps());
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.stage, "callback_params");
      assert.equal(missing.reason, "missing_code");
    }
  });

  it("maps token denials without leaking the code", async () => {
    const denied = await executePscsOneCallback(
      { code: "abc", origin: "https://example.test" },
      deps({
        exchangeAuthorizationCode: async () => {
          throw new Error("invalid_client");
        },
      }),
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, "invalid_client");
  });

  it("maps schema errors", () => {
    assert.equal(
      publicPscsOneSsoReason(new Error("column profiles.pscs_one_user_id does not exist")),
      "identity_schema_mismatch",
    );
  });

  it("completes happy path to dashboard", async () => {
    const ok = await executePscsOneCallback({ code: "abc", origin: "https://example.test" }, deps());
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.location, "https://example.test/dashboard");
      assert.equal(ok.cookieNames.includes("pscs_one_mapped_company_id"), true);
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PscsOneIdentityService } from "../src/lib/pscs-one/identityService.ts";
import {
  exchangeCoreToken,
  exchangeErrorReason,
  PSCS_ONE_OIDC_HEADER,
} from "../src/lib/pscs-one/oidcTransport.ts";

const HOST = "core-candidate.vercel.app";
const TOKEN_URL = `https://${HOST}/api/integrations/sso/token`;
const SECRET = "client-secret-value";

function jwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OIDC transport", () => {
  it("sends the runtime token only to the authorized preview host", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 600);
    let calls = 0;
    const { response } = await exchangeCoreToken({
      tokenUrl: TOKEN_URL,
      body: { grant_type: "authorization_code", client_secret: SECRET, code: "abc" },
      env: { PSCS_ONE_OIDC_HOST: HOST },
      loadOidcToken: async () => token,
      fetchImpl: async (input, init) => {
        calls += 1;
        const headers = new Headers(init?.headers);
        assert.equal(String(input), TOKEN_URL);
        assert.equal(headers.get(PSCS_ONE_OIDC_HEADER), token);
        assert.equal(init?.redirect, "manual");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.client_secret, SECRET);
        assert.equal(JSON.stringify(body).includes(token), false);
        return jsonResponse(200, { ok: true });
      },
    });
    assert.equal(calls, 1);
    assert.equal(response.status, 200);
  });

  it("refuses a missing or expired token without calling the host", async () => {
    for (const loaded of [undefined, "", jwt(Math.floor(Date.now() / 1000) - 60)]) {
      let calls = 0;
      await assert.rejects(
        () =>
          exchangeCoreToken({
            tokenUrl: TOKEN_URL,
            body: { client_secret: SECRET },
            env: { PSCS_ONE_OIDC_HOST: HOST },
            loadOidcToken: async () => {
              if (loaded === undefined) throw new Error("missing");
              return loaded;
            },
            fetchImpl: async () => {
              calls += 1;
              return jsonResponse(200, {});
            },
          }),
        (error: unknown) => {
          assert.equal(error instanceof Error ? error.message : "", "oidc_token_unavailable");
          assert.equal(String(error).includes("eyJ"), false);
          return true;
        },
      );
      assert.equal(calls, 0);
    }
  });

  it("does not attach the token to an unauthorized hostname", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 600);
    let loaded = false;
    await exchangeCoreToken({
      tokenUrl: "https://other.example/api/integrations/sso/token",
      body: { client_secret: SECRET },
      env: { PSCS_ONE_OIDC_HOST: HOST },
      loadOidcToken: async () => {
        loaded = true;
        return token;
      },
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get(PSCS_ONE_OIDC_HEADER), null);
        assert.equal(init?.redirect, undefined);
        assert.equal(JSON.parse(String(init?.body)).client_secret, SECRET);
        return jsonResponse(200, { ok: true });
      },
    });
    assert.equal(loaded, false);
  });

  it("does not follow a redirect to another hostname", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 600);
    let calls = 0;
    await assert.rejects(
      () =>
        exchangeCoreToken({
          tokenUrl: TOKEN_URL,
          body: { client_secret: SECRET },
          env: { PSCS_ONE_OIDC_HOST: HOST },
          loadOidcToken: async () => token,
          fetchImpl: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: `https://evil.example/take?token=${token}` },
            });
          },
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        assert.equal(message, "oidc_redirect_blocked");
        assert.equal(message.includes(token), false);
        assert.equal(message.includes("evil.example"), false);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("keeps the current request when Trusted Sources is not configured", async () => {
    const previous = {
      tokenUrl: process.env.PSCS_ONE_TOKEN_URL,
      host: process.env.PSCS_ONE_OIDC_HOST,
      secret: process.env.PSCS_ONE_CLIENT_SECRET,
    };
    const originalFetch = globalThis.fetch;
    process.env.PSCS_ONE_TOKEN_URL = "https://pscs-core.vercel.app/api/integrations/sso/token";
    delete process.env.PSCS_ONE_OIDC_HOST;
    process.env.PSCS_ONE_CLIENT_SECRET = SECRET;
    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get(PSCS_ONE_OIDC_HEADER), null);
      assert.equal(init?.redirect, undefined);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.client_secret, SECRET);
      assert.equal(body.grant_type, "authorization_code");
      return jsonResponse(200, {
        ok: true,
        identity: {
          version: "1",
          user_id: "11111111-1111-4111-8111-111111111111",
          email: "qa@example.com",
          company_id: "c0b00000-0000-4000-8000-00000000000b",
          product_key: "logistics_ai",
          external_company_id: "bcd3c6c9-0e4a-4356-addd-4af925725576",
          environment: "development",
        },
      });
    }) as typeof fetch;
    try {
      const exchanged = await PscsOneIdentityService.exchangeAuthorizationCode("code");
      assert.equal(exchanged.identity.product_key, "logistics_ai");
    } finally {
      globalThis.fetch = originalFetch;
      if (previous.tokenUrl === undefined) delete process.env.PSCS_ONE_TOKEN_URL;
      else process.env.PSCS_ONE_TOKEN_URL = previous.tokenUrl;
      if (previous.host === undefined) delete process.env.PSCS_ONE_OIDC_HOST;
      else process.env.PSCS_ONE_OIDC_HOST = previous.host;
      if (previous.secret === undefined) delete process.env.PSCS_ONE_CLIENT_SECRET;
      else process.env.PSCS_ONE_CLIENT_SECRET = previous.secret;
    }
  });

  it("strips a token echoed in an upstream error", () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 600);
    const reason = exchangeErrorReason(`denied ${token}`, token);
    assert.equal(reason, "token_exchange_denied");
    assert.equal(reason.includes(token), false);
  });
});

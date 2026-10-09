import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCoreSupabaseAuthCookieHeader, parseCoreSessionCookie } from "../src/lib/pscs-one/core/authCookie.ts";
import { PscsOneCoreArClient } from "../src/lib/pscs-one/core/arClient.ts";
import { CoreArError, mapCoreHttpError } from "../src/lib/pscs-one/core/errors.ts";
import {
  assertLogisticsCompanyMatchesMapping,
  readCoreCompanyIdFromCookieHeader,
} from "../src/lib/pscs-one/core/tenantMapping.ts";

const fixtureReceivable = {
  receivable_id: "c1b8e615-d725-4e66-acb3-5efe44aa1dd9",
  company_id: "c0b00000-0000-4000-8000-00000000000b",
  party_id: "83ecac03-c122-4908-9c1e-a07d6fdc50c5",
  currency_code: "BRL",
  original_amount: "800.00",
  posted_amount: "800.00",
  balance: "0.00",
  status: "paid",
  reference_code: "PSCS_AR_LOGISTICS_FREIGHT_DEMO_001",
  source_system: "logistics_ai",
  source_entity_type: "service_order",
  source_entity_id: "0c62b273-260c-4965-b015-91b73eeaf8ed",
};

describe("Core AR auth cookie", () => {
  it("round-trips session json", () => {
    const session = {
      access_token: "a",
      refresh_token: "r",
      expires_at: 9999999999,
      user_id: "11111111-1111-4111-8111-111111111111",
    };
    const parsed = parseCoreSessionCookie(JSON.stringify(session));
    assert.deepEqual(parsed, {
      access_token: "a",
      refresh_token: "r",
      expires_at: 9999999999,
    });
    const header = buildCoreSupabaseAuthCookieHeader(session, {
      PSCS_ONE_CORE_SUPABASE_PROJECT_REF: "uvyaqklvqcakwfvfopof",
    });
    assert.match(header, /^sb-uvyaqklvqcakwfvfopof-auth-token=/);
  });
});

describe("Core AR tenant mapping", () => {
  it("reads core company id from cookie header", () => {
    const id = readCoreCompanyIdFromCookieHeader(
      "pscs_one_core_company_id=c0b00000-0000-4000-8000-00000000000b",
    );
    assert.equal(id, "c0b00000-0000-4000-8000-00000000000b");
  });

  it("rejects company mismatch", () => {
    assert.throws(
      () =>
        assertLogisticsCompanyMatchesMapping({
          logisticsCompanyId: "bcd3c6c9-0e4a-4356-addd-4af925725576",
          mappedLogisticsCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
  });
});

describe("Core AR client", () => {
  it("maps Core HTTP errors without masking as empty data", async () => {
    const err = mapCoreHttpError(401, { error: { code: "UNAUTHENTICATED" } });
    assert.equal(err.code, "core_unauthenticated");
  });

  it("loads receivable detail and payments via mocked fetch", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.includes("/payments")) {
        return new Response(
          JSON.stringify({
            ok: true,
            payments: [
              {
                payment_id: "0cb0b44c-4661-4178-9a31-c84ff1a5d190",
                amount: "800.00",
                currency_code: "BRL",
                status: "posted",
                reference_code: "PSCS_AR_CUSTOMER_PAYMENT_DEMO_001",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/receivables?")) {
        return new Response(JSON.stringify({ ok: true, receivables: [fixtureReceivable] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, receivable: fixtureReceivable }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new PscsOneCoreArClient(
      {
        access_token: "token",
        refresh_token: "refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
      {
        baseUrl: "https://core.test",
        env: { PSCS_ONE_CORE_SUPABASE_PROJECT_REF: "uvyaqklvqcakwfvfopof" },
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    const found = await client.findReceivableByLogisticsSource({
      coreCompanyId: fixtureReceivable.company_id,
      serviceOrderId: fixtureReceivable.source_entity_id!,
    });
    assert.equal(found?.receivable_id, fixtureReceivable.receivable_id);

    const detail = await client.getReceivable(fixtureReceivable.receivable_id);
    assert.equal(detail.original_amount, "800.00");
    assert.equal(detail.balance, "0.00");

    const payments = await client.getReceivablePayments(fixtureReceivable.receivable_id);
    assert.equal(payments.length, 1);
    assert.equal(payments[0]?.amount, "800.00");
    assert.equal(Number(detail.original_amount), 800);
    assert.notEqual(Number(detail.original_amount), 950);
    assert.match(calls.join(" "), /source_entity_id=0c62b273/);
  });
});

describe("Logistics AR duplication guard", () => {
  it("does not introduce accounts_receivable in Core consumer modules", () => {
    const { readFileSync } = require("node:fs");
    const { readdirSync } = require("node:fs");
    const base = `${import.meta.dirname}/../src/lib/pscs-one/core`;
    for (const name of readdirSync(base)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(`${base}/${name}`, "utf8");
      assert.doesNotMatch(text, /accounts_receivable/i, name);
    }
  });
});

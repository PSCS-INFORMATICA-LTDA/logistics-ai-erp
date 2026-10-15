import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PscsOneCoreArClient } from "../src/lib/pscs-one/core/arClient.ts";
import {
  CLOSE_CORE_UNAVAILABLE_MESSAGE,
  CLOSE_PARTY_MAPPING_MESSAGE,
  CLOSE_SUCCESS_CREATED,
  CLOSE_SUCCESS_REPLAY,
  closeIntegratedMessage,
} from "../src/lib/pscs-one/core/closeMessages.ts";
import {
  type CloseOrderRow,
  type LogisticsCloseStore,
  SERVICE_ORDER_CLOSE_COLUMNS,
  closeServiceOrderWithCoreReceivable,
} from "../src/lib/pscs-one/core/closeServiceOrder.ts";
import type { CoreIntegrationDirectory } from "../src/lib/pscs-one/core/coreDirectory.ts";
import { CoreArError } from "../src/lib/pscs-one/core/errors.ts";
import { resolveServiceOrderReceivableAmount } from "../src/lib/pscs-one/core/receivableAmount.ts";
import { resolveServiceOrderReceivableDueAt } from "../src/lib/pscs-one/core/receivableSchedule.ts";
import { requireCoreArSession } from "../src/lib/pscs-one/core/requestAuth.ts";

const LOGISTICS = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const CORE = "c0b00000-0000-4000-8000-00000000000b";
const OTHER_CORE = "c0a00000-0000-4000-8000-00000000000a";
const OTHER_LOGISTICS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "8583bec2-0faa-4576-96dc-04ff0cf6d48e";
const PARTY = "83ecac03-c122-4908-9c1e-a07d6fdc50c5";
const OS_ID = "0c62b273-260c-4965-b015-91b73eeaf8ed";
const USER = "11111111-1111-4111-8111-111111111111";
const RECEIVABLE_ID = "c1b8e615-d725-4e66-acb3-5efe44aa1dd9";

const fixtureReceivable = {
  receivable_id: RECEIVABLE_ID,
  company_id: CORE,
  party_id: PARTY,
  currency_code: "BRL",
  original_amount: "800.00",
  posted_amount: "800.00",
  balance: "0.00",
  status: "paid",
  reference_code: "PSCS_AR_LOGISTICS_FREIGHT_DEMO_001",
  source_system: "logistics_ai",
  source_entity_type: "service_order",
  source_entity_id: OS_ID,
};

function cookie(logistics = LOGISTICS, core = CORE) {
  return `pscs_one_mapped_company_id=${logistics}; pscs_one_core_company_id=${core}`;
}

function openOrder(overrides: Partial<CloseOrderRow> = {}): CloseOrderRow {
  return {
    id: OS_ID,
    company_id: LOGISTICS,
    code: "PSCS-FREIGHT-DEMO-001",
    status: "Aberto",
    client_id: CLIENT,
    service_type: "Frete",
    service_date: "2026-10-08",
    service_amount: 800,
    freight_agreed_amount: 800,
    driver_id: "22222222-2222-4222-8222-222222222222",
    driver_assignment_response: "accepted",
    proposal_sent_at: "2026-10-07T12:00:00.000Z",
    proposal_response: "accepted",
    service_completed_at: null,
    ...overrides,
  };
}

function storeFor(order: CloseOrderRow, completeImpl?: () => Promise<{ status: string; service_completed_at: string | null }> | { status: string; service_completed_at: string | null }) {
  const calls = { complete: 0 };
  const store: LogisticsCloseStore = {
    async loadOrder() {
      return order;
    },
    async assertMembership() {
      return true;
    },
    async completeOrder() {
      calls.complete += 1;
      if (completeImpl) return await completeImpl();
      return { status: "Concluido", service_completed_at: "2026-10-13T18:00:00.000Z" };
    },
  };
  return { store, calls };
}

function directoryFor(options?: {
  coreCompanyId?: string | null;
  partyCompanyId?: string | null;
  partyId?: string | null;
  missingParty?: boolean;
}): { directory: CoreIntegrationDirectory; companyIds: string[]; partyIds: string[] } {
  const companyIds: string[] = [];
  const partyIds: string[] = [];
  const directory: CoreIntegrationDirectory = {
    async resolveCoreCompany(logisticsCompanyId) {
      companyIds.push(logisticsCompanyId);
      if (options?.coreCompanyId === null) return null;
      if (logisticsCompanyId !== LOGISTICS) return null;
      return { coreCompanyId: options?.coreCompanyId ?? CORE };
    },
    async resolveClientParty(input) {
      partyIds.push(input.clientId);
      if (options?.missingParty) return null;
      if (input.clientId !== CLIENT) return null;
      return {
        partyId: options?.partyId ?? PARTY,
        companyId: options?.partyCompanyId ?? input.coreCompanyId,
      };
    },
  };
  return { directory, companyIds, partyIds };
}

function coreClient(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return handler(url, init);
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
  return { client, calls };
}

const session = {
  access_token: "token",
  refresh_token: "refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user_id: USER,
};

const dueAt = () => ({ ok: true as const, dueAt: "2026-11-08" });

async function run(
  order: CloseOrderRow,
  options?: {
    cookie?: string;
    directory?: ReturnType<typeof directoryFor>;
    fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
    complete?: () => Promise<{ status: string; service_completed_at: string | null }> | { status: string; service_completed_at: string | null };
    resolveDueAt?: typeof dueAt;
    member?: boolean;
  },
) {
  const built = storeFor(order, options?.complete);
  if (options?.member === false) {
    built.store.assertMembership = async () => false;
  }
  const directory = options?.directory ?? directoryFor();
  const http = coreClient(
    options?.fetch ??
      (async () =>
        new Response(JSON.stringify({ ok: true, created: true, receivable: { ...fixtureReceivable, status: "open", posted_amount: "0.00", balance: "800.00" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
  );
  const result = await closeServiceOrderWithCoreReceivable({
    authUserId: USER,
    serviceOrderId: order.id,
    cookieHeader: options?.cookie ?? cookie(),
    coreSession: session,
    store: built.store,
    directory: directory.directory,
    coreClient: http.client,
    resolveDueAt: options?.resolveDueAt,
  });
  return { result, completeCalls: built.calls.complete, http: http.calls, directory };
}

describe("commercial amount", () => {
  it("uses freight agreed amount for Frete and ignores driver expense", () => {
    const resolved = resolveServiceOrderReceivableAmount({
      service_type: "Frete",
      freight_agreed_amount: 800,
      service_amount: 150,
      driver_assignment_pay_amount: 150,
    } as Parameters<typeof resolveServiceOrderReceivableAmount>[0] & {
      driver_assignment_pay_amount: number;
    });
    assert.equal(resolved.ok && resolved.amount, "800.00");
    assert.equal(resolved.ok && resolved.source, "freight_agreed_amount");
    const source = readFileSync(new URL("../src/lib/pscs-one/core/receivableAmount.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /driver_assignment_pay_amount/);
    assert.doesNotMatch(SERVICE_ORDER_CLOSE_COLUMNS, /driver_assignment_pay_amount/);
  });

  it("rejects zero, invalid and legacy types", () => {
    assert.equal(resolveServiceOrderReceivableAmount({ service_type: "Frete", freight_agreed_amount: 0 }).ok, false);
    assert.equal(
      resolveServiceOrderReceivableAmount({ service_type: "Frete", freight_agreed_amount: "abc" }).code,
      "COMMERCIAL_AMOUNT_INVALID",
    );
    assert.equal(
      resolveServiceOrderReceivableAmount({ service_type: "Estacionamento", service_amount: 800 }).code,
      "COMMERCIAL_AMOUNT_UNSUPPORTED",
    );
    assert.equal(
      resolveServiceOrderReceivableAmount({ service_type: "Transporte", service_amount: "640.50" }).ok &&
        resolveServiceOrderReceivableAmount({ service_type: "Transporte", service_amount: "640.50" }).amount,
      "640.50",
    );
  });

  it("does not invent a due date", () => {
    const due = resolveServiceOrderReceivableDueAt({ service_date: "2026-10-08" }, {});
    assert.equal(due.ok, false);
    assert.equal(due.code, "AR_DUE_DATE_RULE_REQUIRED");
  });

  it("derives due_at from PSCS_ONE_LOGISTICS_RECEIVABLE_DUE_DAYS", () => {
    const due = resolveServiceOrderReceivableDueAt(
      { service_date: "2026-10-08" },
      { PSCS_ONE_LOGISTICS_RECEIVABLE_DUE_DAYS: "31" },
    );
    assert.equal(due.ok, true);
    if (due.ok) assert.equal(due.dueAt, "2026-11-08");
  });
});

describe("close orchestrator gates", () => {
  it("fails closed without client_id before AR", async () => {
    const seen = { posts: 0 };
    await assert.rejects(
      () =>
        run(openOrder({ client_id: null }), {
          fetch: () => {
            seen.posts += 1;
            return new Response("{}", { status: 500 });
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "CLIENT_ID_REQUIRED",
    );
    assert.equal(seen.posts, 0);
  });

  it("returns CORE_PARTY_MAPPING_REQUIRED when the client has no Party", async () => {
    const directory = directoryFor({ missingParty: true });
    await assert.rejects(
      () => run(openOrder(), { directory, resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "CORE_PARTY_MAPPING_REQUIRED",
    );
    assert.deepEqual(directory.partyIds, [CLIENT]);
  });

  it("denies a Logistics company without Core mapping", async () => {
    const directory = directoryFor({ coreCompanyId: null });
    await assert.rejects(
      () => run(openOrder(), { directory, resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
  });

  it("denies a Core Party from another company", async () => {
    const directory = directoryFor({ partyCompanyId: OTHER_CORE });
    await assert.rejects(
      () => run(openOrder(), { directory, resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "PARTY_COMPANY_MISMATCH",
    );
  });

  it("fails closed when the Core session is missing", () => {
    assert.throws(
      () => requireCoreArSession(null, { PSCS_ONE_CORE_SUPABASE_PROJECT_REF: "uvyaqklvqcakwfvfopof" }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_session_missing",
    );
  });

  it("denies pending driver before AR", async () => {
    const seen = { posts: 0 };
    await assert.rejects(
      () =>
        run(openOrder({ driver_assignment_response: "pending" }), {
          fetch: () => {
            seen.posts += 1;
            return new Response("{}", { status: 200 });
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "DRIVER_ASSIGNMENT_PENDING",
    );
    assert.equal(seen.posts, 0);
  });

  it("denies rejected driver before AR", async () => {
    const seen = { posts: 0 };
    await assert.rejects(
      () =>
        run(openOrder({ driver_assignment_response: "rejected" }), {
          fetch: () => {
            seen.posts += 1;
            return new Response("{}", { status: 200 });
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "DRIVER_ASSIGNMENT_REJECTED",
    );
    assert.equal(seen.posts, 0);
  });

  it("accepts canonical DRIVER_CONFIRMED and stops on the due date gap before AR", async () => {
    const seen = { posts: 0 };
    await assert.rejects(
      () =>
        run(openOrder(), {
          fetch: () => {
            seen.posts += 1;
            return new Response("{}", { status: 200 });
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "AR_DUE_DATE_RULE_REQUIRED",
    );
    assert.equal(seen.posts, 0);
  });

  it("denies zero and invalid commercial amounts", async () => {
    await assert.rejects(
      () => run(openOrder({ freight_agreed_amount: 0 }), { resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "COMMERCIAL_AMOUNT_INVALID",
    );
    await assert.rejects(
      () => run(openOrder({ freight_agreed_amount: -10 }), { resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "COMMERCIAL_AMOUNT_INVALID",
    );
  });
});

describe("close saga", () => {
  it("creates the receivable before completing the OS", async () => {
    const sequence: string[] = [];
    const { result, http } = await run(openOrder(), {
      resolveDueAt: dueAt,
      fetch: async (_url, init) => {
        sequence.push(init?.method ?? "GET");
        return new Response(
          JSON.stringify({
            ok: true,
            created: true,
            receivable: { ...fixtureReceivable, status: "open", posted_amount: "0.00", balance: "800.00" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      complete: async () => {
        sequence.push("complete");
        return { status: "Concluido", service_completed_at: "2026-10-13T18:00:00.000Z" };
      },
    });
    assert.deepEqual(sequence, ["POST", "complete"]);
    assert.equal(result.receivable_created, true);
    assert.equal(result.order.status, "Concluido");
    const body = http[0]?.body as { amount: string; source_entity_id: string; party_id: string; company_id: string };
    assert.equal(body.amount, "800.00");
    assert.notEqual(body.amount, "150.00");
    assert.equal(body.source_entity_id, OS_ID);
    assert.equal(body.party_id, PARTY);
    assert.equal(body.company_id, CORE);
    assert.equal(body.source_system, "logistics_ai");
    assert.equal(body.source_entity_type, "service_order");
  });

  it("retries with created=false and does not ask Core to insert again", async () => {
    let posts = 0;
    const { result, http } = await run(openOrder(), {
      resolveDueAt: dueAt,
      fetch: async () => {
        posts += 1;
        return new Response(
          JSON.stringify({ ok: true, created: false, receivable: fixtureReceivable }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    assert.equal(posts, 1);
    assert.equal(http.length, 1);
    assert.equal(result.receivable_created, false);
    assert.equal(result.receivable.receivable_id, RECEIVABLE_ID);
  });

  it("does not complete the OS on Core 409", async () => {
    const { completeCalls } = await (async () => {
      let complete = 0;
      await assert.rejects(
        () =>
          run(openOrder(), {
            resolveDueAt: dueAt,
            fetch: async () =>
              new Response(JSON.stringify({ error: { code: "IDEMPOTENCY_CONFLICT", message: "conflict" } }), {
                status: 409,
                headers: { "Content-Type": "application/json" },
              }),
            complete: async () => {
              complete += 1;
              return { status: "Concluido", service_completed_at: null };
            },
          }),
        (error: unknown) => error instanceof CoreArError && error.code === "IDEMPOTENCY_CONFLICT",
      );
      return { completeCalls: complete };
    })();
    assert.equal(completeCalls, 0);
  });

  it("does not complete the OS on Core 5xx or network failure", async () => {
    let complete = 0;
    await assert.rejects(
      () =>
        run(openOrder(), {
          resolveDueAt: dueAt,
          fetch: async () => new Response("{}", { status: 503 }),
          complete: async () => {
            complete += 1;
            return { status: "Concluido", service_completed_at: null };
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_unavailable",
    );
    await assert.rejects(
      () =>
        run(openOrder(), {
          resolveDueAt: dueAt,
          fetch: async () => {
            throw new Error("network down");
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_unavailable",
    );
    assert.equal(complete, 0);
  });

  it("recovers a Core success followed by a local close failure without a second receivable", async () => {
    let attempt = 0;
    const createdFlags: boolean[] = [];
    const order = openOrder();
    const first = await assert.rejects(
      () =>
        run(order, {
          resolveDueAt: dueAt,
          fetch: async () => {
            attempt += 1;
            createdFlags.push(true);
            return new Response(
              JSON.stringify({ ok: true, created: true, receivable: fixtureReceivable }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          },
          complete: async () => {
            throw new Error("transient close");
          },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "LOCAL_CLOSE_FAILED",
    );
    assert.equal(first, undefined);
    const second = await run(order, {
      resolveDueAt: dueAt,
      fetch: async () => {
        attempt += 1;
        createdFlags.push(false);
        return new Response(
          JSON.stringify({ ok: true, created: false, receivable: fixtureReceivable }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    assert.equal(attempt, 2);
    assert.deepEqual(createdFlags, [true, false]);
    assert.equal(second.result.receivable_created, false);
    assert.equal(second.result.receivable.receivable_id, RECEIVABLE_ID);
  });

  it("denies cross-tenant company and cross-tenant party", async () => {
    await assert.rejects(
      () => run(openOrder(), { cookie: cookie(OTHER_LOGISTICS, CORE), resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
    await assert.rejects(
      () => run(openOrder(), { cookie: cookie(LOGISTICS, OTHER_CORE), resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
    const directory = directoryFor();
    await assert.rejects(
      () => run(openOrder({ company_id: OTHER_LOGISTICS }), { directory, resolveDueAt: dueAt }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
    assert.equal(directory.companyIds.includes(OTHER_LOGISTICS) || directory.companyIds.length === 0, true);
  });
});

describe("official fixture and regressions", () => {
  it("recognizes the existing receivable and does not post a second one", async () => {
    const { result, http, completeCalls } = await run(
      openOrder({ status: "Concluido", service_completed_at: "2026-10-08T00:00:00.000Z" }),
      {
        fetch: async (url) => {
          if (String(url).includes("/api/receivables?")) {
            return new Response(JSON.stringify({ ok: true, receivables: [fixtureReceivable] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ error: { code: "IDEMPOTENCY_CONFLICT" } }), { status: 409 });
        },
      },
    );
    assert.equal(completeCalls, 0);
    assert.equal(http.some((call) => call.method === "POST"), false);
    assert.equal(result.receivable_created, false);
    assert.equal(result.receivable.original_amount, "800.00");
    assert.equal(result.receivable.posted_amount, "800.00");
    assert.equal(result.receivable.balance, "0.00");
    assert.equal(result.receivable.status, "paid");
    assert.equal(result.receivable.receivable_id, RECEIVABLE_ID);
  });

  it("reports reconciliation when a completed OS has no receivable", async () => {
    await assert.rejects(
      () =>
        run(openOrder({ status: "Concluido" }), {
          fetch: async () =>
            new Response(JSON.stringify({ ok: true, receivables: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "AR_RECONCILIATION_REQUIRED",
    );
  });

  it("keeps proposal, driver assignment, agenda and Core read boundaries", () => {
    const closeSrc = readFileSync(new URL("../src/lib/pscs-one/core/closeServiceOrder.ts", import.meta.url), "utf8");
    const routeSrc = readFileSync(
      new URL("../src/app/api/service-orders/[id]/close/route.ts", import.meta.url),
      "utf8",
    );
    const uiSrc = readFileSync(
      new URL("../src/components/operacional/ServiceOrderRowActions.tsx", import.meta.url),
      "utf8",
    );
    const amountSrc = readFileSync(new URL("../src/lib/pscs-one/core/receivableAmount.ts", import.meta.url), "utf8");
    for (const src of [closeSrc, routeSrc, amountSrc]) {
      assert.doesNotMatch(src, /service_role|SERVICE_ROLE|createServiceClient|accounts_receivable/i);
    }
    assert.match(routeSrc, /requireCoreArSession/);
    assert.match(closeSrc, /complete_service_order/);
    assert.doesNotMatch(closeSrc, /service-order-proposal|agenda|service-order-driver-assignment/);
    assert.doesNotMatch(uiSrc, /completeServiceOrder\(/);
    assert.match(uiSrc, /\/api\/service-orders\/\$\{row\.id\}\/close/);
    assert.match(uiSrc, /resetProposalClientResponse/);
    assert.match(uiSrc, /respondToDriverAssignment/);
    assert.equal(closeIntegratedMessage({ ok: true, receivableCreated: true }), CLOSE_SUCCESS_CREATED);
    assert.equal(closeIntegratedMessage({ ok: true, receivableCreated: false }), CLOSE_SUCCESS_REPLAY);
    assert.equal(
      closeIntegratedMessage({ ok: false, code: "CORE_PARTY_MAPPING_REQUIRED" }),
      CLOSE_PARTY_MAPPING_MESSAGE,
    );
    assert.equal(
      closeIntegratedMessage({ ok: false, code: "core_unavailable" }),
      CLOSE_CORE_UNAVAILABLE_MESSAGE,
    );
    assert.equal(
      closeIntegratedMessage({ ok: false, code: "IDEMPOTENCY_CONFLICT" }),
      CLOSE_CORE_UNAVAILABLE_MESSAGE,
    );
  });
});

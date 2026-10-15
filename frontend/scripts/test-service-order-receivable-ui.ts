import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PscsOneCoreArClient } from "../src/lib/pscs-one/core/arClient.ts";
import { CoreArError } from "../src/lib/pscs-one/core/errors.ts";
import type { CoreIntegrationDirectory } from "../src/lib/pscs-one/core/coreDirectory.ts";
import {
  NO_RECEIVABLE_PAYMENTS_LABEL,
  RECEIVABLE_DUE_ABSENT_LABEL,
  formatReceivableAmount,
  paymentStatusLabel,
  receivableDueLabel,
  receivableStatusLabel,
  serviceOrderShowsFinanceAction,
} from "../src/lib/pscs-one/core/receivablePresentation.ts";
import { requireCoreArSession } from "../src/lib/pscs-one/core/requestAuth.ts";
import {
  type ServiceOrderReceivableOrder,
  type ServiceOrderReceivableReadStore,
  readServiceOrderReceivable,
} from "../src/lib/pscs-one/core/serviceOrderReceivableRead.ts";

const LOGISTICS = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const CORE = "c0b00000-0000-4000-8000-00000000000b";
const OTHER_CORE = "c0a00000-0000-4000-8000-00000000000a";
const OTHER_LOGISTICS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OS_ID = "0c62b273-260c-4965-b015-91b73eeaf8ed";
const USER = "11111111-1111-4111-8111-111111111111";
const RECEIVABLE_ID = "c1b8e615-d725-4e66-acb3-5efe44aa1dd9";
const PAYMENT_ID = "0cb0b44c-4661-4178-9a31-c84ff1a5d190";
const PARTY = "83ecac03-c122-4908-9c1e-a07d6fdc50c5";

const fixtureReceivable = {
  receivable_id: RECEIVABLE_ID,
  company_id: CORE,
  party_id: PARTY,
  currency_code: "BRL",
  original_amount: "800.00",
  posted_amount: "800.00",
  balance: "0.00",
  status: "paid",
  due_on: null as string | null,
  reference_code: "PSCS_AR_LOGISTICS_FREIGHT_DEMO_001",
  source_system: "logistics_ai",
  source_entity_type: "service_order",
  source_entity_id: OS_ID,
};

const fixturePayment = {
  payment_id: PAYMENT_ID,
  amount: "800.00",
  currency_code: "BRL",
  status: "posted",
  reference_code: "PSCS_AR_CUSTOMER_PAYMENT_DEMO_001",
};

const session = {
  access_token: "token",
  refresh_token: "refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user_id: USER,
};

function cookie(logistics = LOGISTICS, core = CORE) {
  return `pscs_one_mapped_company_id=${logistics}; pscs_one_core_company_id=${core}`;
}

function completedOrder(overrides: Partial<ServiceOrderReceivableOrder> = {}): ServiceOrderReceivableOrder {
  return {
    id: OS_ID,
    company_id: LOGISTICS,
    code: "PSCS-FREIGHT-DEMO-001",
    status: "Concluido",
    ...overrides,
  };
}

function storeFor(order: ServiceOrderReceivableOrder | null, member = true): ServiceOrderReceivableReadStore {
  return {
    async loadOrder() {
      return order;
    },
    async assertMembership() {
      return member;
    },
  };
}

function directoryFor(coreCompanyId: string | null = CORE): {
  directory: CoreIntegrationDirectory;
  companyIds: string[];
} {
  const companyIds: string[] = [];
  return {
    companyIds,
    directory: {
      async resolveCoreCompany(logisticsCompanyId) {
        companyIds.push(logisticsCompanyId);
        if (coreCompanyId === null) return null;
        if (logisticsCompanyId !== LOGISTICS) return null;
        return { coreCompanyId };
      },
      async resolveClientParty() {
        return null;
      },
    },
  };
}

function coreClient(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    return handler(url, init);
  };
  const client = new PscsOneCoreArClient(
    session,
    {
      baseUrl: "https://core.test",
      env: { PSCS_ONE_CORE_SUPABASE_PROJECT_REF: "uvyaqklvqcakwfvfopof" },
      fetchImpl: fetchImpl as typeof fetch,
    },
  );
  return { client, calls };
}

function paidFetch(receivable: typeof fixtureReceivable = fixtureReceivable) {
  return async (url: string) => {
    if (url.includes("/payments")) {
      return new Response(JSON.stringify({ ok: true, payments: [fixturePayment] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/receivables?")) {
      return new Response(JSON.stringify({ ok: true, receivables: [receivable] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, receivable }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function readPaid(options?: {
  order?: ServiceOrderReceivableOrder;
  member?: boolean;
  cookie?: string;
  coreCompanyId?: string | null;
  fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  coreSession?: typeof session | { access_token: string; refresh_token: string; expires_at: number };
}) {
  const directory = directoryFor(options?.coreCompanyId === undefined ? CORE : options.coreCompanyId);
  const http = coreClient(options?.fetch ?? paidFetch());
  const result = await readServiceOrderReceivable({
    authUserId: USER,
    serviceOrderId: options?.order?.id ?? OS_ID,
    cookieHeader: options?.cookie ?? cookie(),
    coreSession: options?.coreSession ?? session,
    store: storeFor(options?.order ?? completedOrder(), options?.member ?? true),
    directory: directory.directory,
    coreClient: http.client,
  });
  return { result, http, directory };
}

describe("OS receivable read", () => {
  it("returns the paid fixture amounts and payments from Core", async () => {
    const { result, http } = await readPaid();
    assert.equal(result.receivable.original_amount, "800.00");
    assert.equal(result.receivable.posted_amount, "800.00");
    assert.equal(result.receivable.balance, "0.00");
    assert.equal(result.receivable.status, "paid");
    assert.equal(result.receivable.currency_code, "BRL");
    assert.equal(result.receivable.receivable_id, RECEIVABLE_ID);
    assert.equal(result.receivable.due_on, null);
    assert.equal(result.payments.length, 1);
    assert.equal(result.payments[0]?.amount, "800.00");
    assert.equal(result.payments[0]?.status, "posted");
    assert.equal(result.payments[0]?.currency_code, "BRL");
    assert.equal(result.payments[0]?.reference_code, fixturePayment.reference_code);
    assert.equal(http.calls.some((call) => call.method !== "GET"), false);
    assert.equal(http.calls.some((call) => call.url.includes("/payments")), true);
    assert.equal(http.calls.some((call) => call.url.includes(`/api/receivables/${RECEIVABLE_ID}`)), true);
  });

  it("never puts the driver expense in the financial payload", async () => {
    const { result } = await readPaid({
      order: completedOrder(),
    });
    const payload = JSON.stringify(result);
    assert.equal(payload.includes("150"), false);
    assert.equal(payload.includes("150.00"), false);
    assert.equal(payload.includes("driver"), false);
    assert.equal(payload.includes("financial_transactions"), false);
    assert.notEqual(result.receivable.original_amount, "150.00");
    assert.notEqual(result.receivable.posted_amount, "150.00");
    assert.notEqual(result.payments[0]?.amount, "150.00");
  });

  it("uses the service order company from Logistics, not a browser company id", async () => {
    const browserCompanyId = OTHER_LOGISTICS;
    const { directory } = await readPaid();
    assert.deepEqual(directory.companyIds, [LOGISTICS]);
    assert.notEqual(directory.companyIds[0], browserCompanyId);
  });

  it("denies a user without membership", async () => {
    await assert.rejects(
      () => readPaid({ member: false }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_unauthorized" && error.status === 403,
    );
  });

  it("fails closed when the Core session is missing", async () => {
    assert.throws(
      () => requireCoreArSession(null, { PSCS_ONE_CORE_SUPABASE_PROJECT_REF: "uvyaqklvqcakwfvfopof" }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_session_missing",
    );
    await assert.rejects(
      () =>
        readPaid({
          coreSession: { access_token: "", refresh_token: "refresh", expires_at: session.expires_at },
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_session_missing",
    );
  });

  it("fails closed when the company mapping is missing", async () => {
    await assert.rejects(
      () => readPaid({ coreCompanyId: null }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
    await assert.rejects(
      () => readPaid({ cookie: `pscs_one_mapped_company_id=${LOGISTICS}` }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
  });

  it("denies cross-tenant company mapping and a receivable from another company", async () => {
    await assert.rejects(
      () => readPaid({ cookie: cookie(OTHER_LOGISTICS, CORE) }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
    await assert.rejects(
      () => readPaid({ cookie: cookie(LOGISTICS, OTHER_CORE) }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
    await assert.rejects(
      () =>
        readPaid({
          fetch: paidFetch({ ...fixtureReceivable, company_id: OTHER_CORE }),
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "core_unauthorized" && error.status === 403,
    );
  });

  it("returns AR_RECONCILIATION_REQUIRED for a completed OS without a receivable and does not POST", async () => {
    const http = coreClient(async (url) => {
      if (url.includes("/api/receivables?")) {
        return new Response(JSON.stringify({ ok: true, receivables: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    });
    await assert.rejects(
      () =>
        readServiceOrderReceivable({
          authUserId: USER,
          serviceOrderId: OS_ID,
          cookieHeader: cookie(),
          coreSession: session,
          store: storeFor(completedOrder()),
          directory: directoryFor().directory,
          coreClient: http.client,
        }),
      (error: unknown) =>
        error instanceof CoreArError && error.code === "AR_RECONCILIATION_REQUIRED" && error.status === 409,
    );
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls.every((call) => call.method === "GET"), true);
    assert.equal(http.calls.some((call) => call.url.includes("/payments")), false);
  });

  it("does not call Core when the OS is not completed", async () => {
    const http = coreClient(async () => new Response("nope", { status: 500 }));
    await assert.rejects(
      () =>
        readServiceOrderReceivable({
          authUserId: USER,
          serviceOrderId: OS_ID,
          cookieHeader: cookie(),
          coreSession: session,
          store: storeFor(completedOrder({ status: "Aberto" })),
          directory: directoryFor().directory,
          coreClient: http.client,
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "SERVICE_ORDER_NOT_CLOSABLE",
    );
    assert.equal(http.calls.length, 0);
  });
});

describe("receivable presentation", () => {
  it("formats BRL and maps status without treating driver pay as revenue", () => {
    const formatted = formatReceivableAmount("800.00", "BRL");
    assert.match(formatted, /800,00/);
    assert.match(formatted, /R\$/);
    assert.equal(formatReceivableAmount("800.00", "BRL").includes("150"), false);
    assert.equal(receivableStatusLabel("paid"), "Pago");
    assert.equal(receivableStatusLabel("open"), "Em aberto");
    assert.equal(receivableStatusLabel("partial"), "Parcial");
    assert.equal(receivableStatusLabel("partially_paid"), "Parcial");
    assert.equal(receivableStatusLabel("void"), "void");
    assert.equal(paymentStatusLabel("posted"), "Posted");
    assert.equal(receivableDueLabel(null), RECEIVABLE_DUE_ABSENT_LABEL);
    assert.equal(receivableDueLabel(undefined), RECEIVABLE_DUE_ABSENT_LABEL);
    assert.equal(NO_RECEIVABLE_PAYMENTS_LABEL, "Nenhum pagamento registrado.");
  });

  it("shows the finance action only for a completed service order", () => {
    assert.equal(serviceOrderShowsFinanceAction({ status: "Concluido" }), true);
    assert.equal(serviceOrderShowsFinanceAction({ status: "Aberto" }), false);
    assert.equal(serviceOrderShowsFinanceAction({ status: "Cancelado" }), false);
    assert.equal(serviceOrderShowsFinanceAction({ status: null }), false);
  });
});

describe("route, UI and regression boundaries", () => {
  const routeSrc = readFileSync(
    new URL("../src/app/api/service-orders/[id]/receivable/route.ts", import.meta.url),
    "utf8",
  );
  const readSrc = readFileSync(
    new URL("../src/lib/pscs-one/core/serviceOrderReceivableRead.ts", import.meta.url),
    "utf8",
  );
  const uiSrc = readFileSync(
    new URL("../src/components/operacional/ServiceOrderRowActions.tsx", import.meta.url),
    "utf8",
  );
  const modalSrc = readFileSync(
    new URL("../src/components/operacional/ServiceOrderReceivableModal.tsx", import.meta.url),
    "utf8",
  );
  const agendaSrc = readFileSync(
    new URL("../src/components/operacional/VehicleScheduleBoard.tsx", import.meta.url),
    "utf8",
  );
  const closeSrc = readFileSync(new URL("../src/lib/pscs-one/core/closeServiceOrder.ts", import.meta.url), "utf8");
  const proposalSrc = readFileSync(
    new URL("../src/lib/service-order-proposal-api.ts", import.meta.url),
    "utf8",
  );
  const driverSrc = readFileSync(
    new URL("../src/lib/service-order-driver-assignment.ts", import.meta.url),
    "utf8",
  );

  it("GET route does not accept a browser company id, does not POST, and does not use service role", () => {
    assert.match(routeSrc, /export async function GET/);
    assert.doesNotMatch(routeSrc, /export async function POST/);
    assert.doesNotMatch(routeSrc, /request\.json|searchParams|company_id|receivable_id|createReceivable/);
    assert.match(routeSrc, /requireCoreArSession/);
    assert.match(routeSrc, /readServiceOrderReceivable/);
    assert.doesNotMatch(routeSrc, /service_role|SERVICE_ROLE|createServiceClient/);
    assert.doesNotMatch(readSrc, /createReceivable|financial_transactions|driver_assignment_pay|service_role|SERVICE_ROLE/);
    assert.doesNotMatch(readSrc, /method:\s*"POST"/);
    assert.match(readSrc, /findReceivableByLogisticsSource/);
    assert.match(readSrc, /getReceivable\(/);
    assert.match(readSrc, /getReceivablePayments/);
    assert.match(readSrc, /resolveCoreCompany/);
    assert.match(readSrc, /AR_RECONCILIATION_REQUIRED/);
    assert.match(modalSrc, /\/api\/service-orders\/\$\{serviceOrderId\}\/receivable/);
    assert.match(modalSrc, /method:\s*"GET"/);
    assert.doesNotMatch(modalSrc, /pscs-core|\/api\/receivables|service_role/);
    assert.match(modalSrc, /PSCS One • Financeiro/);
    assert.match(modalSrc, /sm:items-center/);
  });

  it("keeps Concluir, proposal, driver assignment, agenda and Core AR read intact", () => {
    assert.match(uiSrc, /serviceOrderShowsFinanceAction/);
    assert.match(uiSrc, /glassAction\("brand", true\)/);
    assert.match(uiSrc, /Financeiro/);
    assert.match(uiSrc, /\/api\/service-orders\/\$\{row\.id\}\/close/);
    assert.match(uiSrc, /Concluir/);
    assert.match(uiSrc, /resetProposalClientResponse/);
    assert.match(uiSrc, /respondToDriverAssignment/);
    assert.match(uiSrc, /AssignDriverModal/);
    assert.doesNotMatch(agendaSrc, /ServiceOrderReceivableModal|\/receivable/);
    assert.match(closeSrc, /complete_service_order/);
    assert.match(proposalSrc, /resetProposalClientResponse|respondToProposal/);
    assert.match(driverSrc, /respondToDriverAssignment/);
    assert.doesNotMatch(readSrc, /service-order-proposal|service-order-driver-assignment|VehicleScheduleBoard/);
  });
});

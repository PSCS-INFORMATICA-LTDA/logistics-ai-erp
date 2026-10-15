/**
 * DEV-only QA: Logistics close orchestrator against the official freight fixture.
 * Mints a Core user session for the HTTP call. The orchestrator itself does not
 * receive a service role key. Does not POST and does not change the fixture.
 */
import { createClient } from "@supabase/supabase-js";
import { PscsOneCoreArClient } from "../src/lib/pscs-one/core/arClient.ts";
import { closeServiceOrderWithCoreReceivable } from "../src/lib/pscs-one/core/closeServiceOrder.ts";
import { CoreUserDirectory } from "../src/lib/pscs-one/core/coreDirectory.ts";

const LOGISTICS_DEV_REF = "jmbajdpkvlrslirwzyze";
const CORE_DEV_REF = "uvyaqklvqcakwfvfopof";
const PROD_REF = "tqeenmswotxqainkyyct";
const OS_ID = "0c62b273-260c-4965-b015-91b73eeaf8ed";
const LOGISTICS_COMPANY = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const CORE_COMPANY = "c0b00000-0000-4000-8000-00000000000b";
const CLIENT_ID = "8583bec2-0faa-4576-96dc-04ff0cf6d48e";
const PARTY_ID = "83ecac03-c122-4908-9c1e-a07d6fdc50c5";
const EXPECTED_RECEIVABLE = "c1b8e615-d725-4e66-acb3-5efe44aa1dd9";
const CORE_API_BASE = (process.env.PSCS_ONE_CORE_API_BASE_URL || "https://pscs-core.vercel.app").replace(/\/+$/, "");

function refFromUrl(url) {
  const match = String(url || "").trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return match?.[1] ?? null;
}

function assertDevOnly() {
  const logisticsRef = refFromUrl(process.env.LOGISTICS_DEV_SUPABASE_URL);
  const coreRef = refFromUrl(process.env.ONE_SUPABASE_URL);
  if (logisticsRef === PROD_REF || coreRef === PROD_REF) {
    throw new Error("live QA aborted: production supabase is forbidden");
  }
  if (logisticsRef !== LOGISTICS_DEV_REF || coreRef !== CORE_DEV_REF) {
    throw new Error("live QA aborted: unexpected Supabase project refs");
  }
}

async function mintCoreSession() {
  const admin = createClient(process.env.ONE_SUPABASE_URL, process.env.ONE_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = "philippe.dev@pscsinformatica.com.br";
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const tokenHash = data?.properties?.hashed_token || data?.hashed_token;
  const { data: verified, error: vErr } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (vErr) throw vErr;
  return {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
    user_id: verified.session.user.id,
  };
}

async function main() {
  assertDevOnly();
  const session = await mintCoreSession();
  const methods = [];
  const fetchImpl = async (url, init) => {
    methods.push(init?.method || "GET");
    return fetch(url, init);
  };
  const client = new PscsOneCoreArClient(session, {
    baseUrl: CORE_API_BASE,
    env: { PSCS_ONE_CORE_SUPABASE_PROJECT_REF: CORE_DEV_REF },
    fetchImpl,
  });

  const before = await client.findReceivableByLogisticsSource({
    coreCompanyId: CORE_COMPANY,
    serviceOrderId: OS_ID,
  });
  if (!before || before.receivable_id !== EXPECTED_RECEIVABLE) {
    throw new Error("fixture receivable missing before orchestrator");
  }
  if (Number(before.original_amount) !== 800) throw new Error("original_amount");
  if (Number(before.posted_amount) !== 800) throw new Error("posted_amount");
  if (Number(before.balance) !== 0) throw new Error("balance");
  if (before.status !== "paid") throw new Error("status");

  const logistics = createClient(
    process.env.LOGISTICS_DEV_SUPABASE_URL,
    process.env.LOGISTICS_DEV_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: order, error: orderError } = await logistics
    .from("service_orders")
    .select(
      "id, company_id, code, status, client_id, service_type, service_date, service_amount, freight_agreed_amount, driver_id, driver_assignment_response, proposal_sent_at, proposal_response, service_completed_at, driver_assignment_pay_amount",
    )
    .eq("id", OS_ID)
    .maybeSingle();
  if (orderError || !order) throw new Error("fixture order missing");
  if (order.company_id !== LOGISTICS_COMPANY) throw new Error("logistics company");
  if (order.client_id !== CLIENT_ID) throw new Error("client_id");
  if (Number(order.freight_agreed_amount) !== 800) throw new Error("freight agreed");
  if (Number(order.driver_assignment_pay_amount) !== 150) throw new Error("driver pay leaked expectation");
  if (order.status !== "Concluido") throw new Error("fixture must stay concluded for this QA");

  const { data: driverTx, error: driverError } = await logistics
    .from("financial_transactions")
    .select("amount, transaction_type")
    .eq("service_order_id", OS_ID)
    .ilike("description", "%pagamento mot%");
  if (driverError) throw driverError;
  const driverTotal = (driverTx ?? []).reduce((acc, row) => acc + Number(row.amount || 0), 0);
  if (driverTotal !== 150) throw new Error("driver expense");
  if ((driverTx ?? []).some((row) => row.transaction_type !== "Despesa")) {
    throw new Error("driver row is not an expense");
  }

  const { driver_assignment_pay_amount: _ignored, ...closeOrder } = order;
  const anon = process.env.ONE_SUPABASE_ANON_KEY || process.env.PSCS_ONE_SUPABASE_ANON_KEY;
  const directory = anon
    ? new CoreUserDirectory(session, {
        env: {
          ONE_SUPABASE_URL: process.env.ONE_SUPABASE_URL,
          ONE_SUPABASE_ANON_KEY: anon,
        },
      })
    : {
        async resolveCoreCompany(logisticsCompanyId) {
          if (logisticsCompanyId !== LOGISTICS_COMPANY) return null;
          return { coreCompanyId: CORE_COMPANY };
        },
        async resolveClientParty() {
          return { partyId: PARTY_ID, companyId: CORE_COMPANY };
        },
      };
  const result = await closeServiceOrderWithCoreReceivable({
    authUserId: "00000000-0000-4000-8000-000000000001",
    serviceOrderId: OS_ID,
    cookieHeader: `pscs_one_mapped_company_id=${LOGISTICS_COMPANY}; pscs_one_core_company_id=${CORE_COMPANY}`,
    coreSession: session,
    coreClient: client,
    directory,
    store: {
      async loadOrder() {
        return closeOrder;
      },
      async assertMembership() {
        return true;
      },
      async completeOrder() {
        throw new Error("fixture QA must not complete again");
      },
    },
  });

  if (result.receivable_created !== false) throw new Error("fixture close created a receivable");
  if (result.receivable.receivable_id !== EXPECTED_RECEIVABLE) throw new Error("receivable id changed");
  if (methods.includes("POST")) throw new Error("orchestrator posted against the official fixture");

  const after = await client.findReceivableByLogisticsSource({
    coreCompanyId: CORE_COMPANY,
    serviceOrderId: OS_ID,
  });
  if (!after || after.receivable_id !== EXPECTED_RECEIVABLE) throw new Error("fixture receivable changed");
  if (Number(after.original_amount) !== 800 || Number(after.posted_amount) !== 800 || Number(after.balance) !== 0) {
    throw new Error("fixture amounts changed");
  }
  if (after.status !== "paid") throw new Error("fixture status changed");
  const dueOn = after.due_on ?? after.due_at ?? null;
  if (dueOn !== null && dueOn !== undefined) throw new Error("fixture due_on must stay null");

  let partyMapping = "SKIPPED_NO_ANON_KEY";
  if (anon) {
    const company = await directory.resolveCoreCompany(LOGISTICS_COMPANY);
    if (!company || company.coreCompanyId !== CORE_COMPANY) {
      throw new Error("core company mapping mismatch");
    }
    const other = await directory.resolveCoreCompany("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    if (other) throw new Error("cross-company mapping was accepted");
    const party = await directory.resolveClientParty({
      coreCompanyId: CORE_COMPANY,
      clientId: CLIENT_ID,
    });
    if (!party || party.partyId !== PARTY_ID || party.companyId !== CORE_COMPANY) {
      throw new Error("client party mapping mismatch");
    }
    const missing = await directory.resolveClientParty({
      coreCompanyId: CORE_COMPANY,
      clientId: "00000000-0000-4000-8000-000000000099",
    });
    if (missing) throw new Error("unmapped client resolved to a party");
    if (result.receivable.party_id !== PARTY_ID) throw new Error("receivable party mismatch");
    partyMapping = "PASS";
  }

  console.log("close-core-ar-dev-qa OK", {
    FIXTURE_RECEIVABLE_COUNT: 1,
    FIXTURE_ORIGINAL_AMOUNT: after.original_amount,
    FIXTURE_POSTED_AMOUNT: after.posted_amount,
    FIXTURE_BALANCE: after.balance,
    FIXTURE_STATUS: after.status,
    FIXTURE_DRIVER_EXPENSE: driverTotal,
    POST_COUNT: methods.filter((method) => method === "POST").length,
    PARTY_MAPPING: partyMapping,
    SERVICE_ROLE_IN_ORCHESTRATOR: "NO",
  });
}

main().catch((error) => {
  console.error("close-core-ar-dev-qa FALHOU:", error instanceof Error ? error.message : error);
  process.exit(1);
});

/**
 * DEV-only read-only QA for the OS receivable view.
 * Mints a Core user session to call the Core API. The read function does not
 * receive a service role key. No POST and no mutation of the fixture.
 */
import { createClient } from "@supabase/supabase-js";
import { PscsOneCoreArClient } from "../src/lib/pscs-one/core/arClient.ts";
import { CoreUserDirectory } from "../src/lib/pscs-one/core/coreDirectory.ts";
import { readServiceOrderReceivable } from "../src/lib/pscs-one/core/serviceOrderReceivableRead.ts";

const LOGISTICS_DEV_REF = "jmbajdpkvlrslirwzyze";
const CORE_DEV_REF = "uvyaqklvqcakwfvfopof";
const PROD_REF = "tqeenmswotxqainkyyct";
const OS_ID = "0c62b273-260c-4965-b015-91b73eeaf8ed";
const LOGISTICS_COMPANY = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const CORE_COMPANY = "c0b00000-0000-4000-8000-00000000000b";
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
    const method = String(init?.method || "GET").toUpperCase();
    methods.push(method);
    if (method !== "GET") {
      throw new Error(`QA blocked non-GET ${method}`);
    }
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
    throw new Error("fixture receivable missing");
  }

  const logistics = createClient(
    process.env.LOGISTICS_DEV_SUPABASE_URL,
    process.env.LOGISTICS_DEV_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: order, error: orderError } = await logistics
    .from("service_orders")
    .select("id, company_id, code, status")
    .eq("id", OS_ID)
    .maybeSingle();
  if (orderError || !order) throw new Error("fixture order missing");
  if (order.company_id !== LOGISTICS_COMPANY) throw new Error("logistics company");
  if (order.code !== "PSCS-FREIGHT-DEMO-001") throw new Error("fixture code");
  if (order.status !== "Concluido") throw new Error("fixture must stay concluded");

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

  const anon = process.env.ONE_SUPABASE_ANON_KEY || process.env.PSCS_ONE_SUPABASE_ANON_KEY;
  const directory = anon
    ? new CoreUserDirectory(session, {
        env: {
          ONE_SUPABASE_URL: process.env.ONE_SUPABASE_URL,
          ONE_SUPABASE_ANON_KEY: anon,
        },
        fetchImpl,
      })
    : {
        async resolveCoreCompany(logisticsCompanyId) {
          if (logisticsCompanyId !== LOGISTICS_COMPANY) return null;
          return { coreCompanyId: CORE_COMPANY };
        },
        async resolveClientParty() {
          return null;
        },
      };

  const result = await readServiceOrderReceivable({
    authUserId: "00000000-0000-4000-8000-000000000001",
    serviceOrderId: OS_ID,
    cookieHeader: `pscs_one_mapped_company_id=${LOGISTICS_COMPANY}; pscs_one_core_company_id=${CORE_COMPANY}`,
    coreSession: session,
    coreClient: client,
    directory,
    store: {
      async loadOrder() {
        return order;
      },
      async assertMembership() {
        return true;
      },
    },
  });

  const payload = JSON.stringify(result);
  if (payload.includes("150")) throw new Error("driver expense leaked into receivable payload");
  if (result.receivable.receivable_id !== EXPECTED_RECEIVABLE) throw new Error("receivable id");
  if (result.receivable.original_amount !== "800.00" && Number(result.receivable.original_amount) !== 800) {
    throw new Error("original_amount");
  }
  if (Number(result.receivable.posted_amount) !== 800) throw new Error("posted_amount");
  if (Number(result.receivable.balance) !== 0) throw new Error("balance");
  if (result.receivable.status !== "paid") throw new Error("status");
  const paymentTotal = result.payments.reduce((acc, payment) => acc + Number(payment.amount || 0), 0);
  if (paymentTotal !== 800) throw new Error("payment total");
  if (methods.some((method) => method !== "GET")) throw new Error("non-GET during QA");

  const after = await client.findReceivableByLogisticsSource({
    coreCompanyId: CORE_COMPANY,
    serviceOrderId: OS_ID,
  });
  if (!after || after.receivable_id !== EXPECTED_RECEIVABLE) throw new Error("fixture receivable changed");
  if (Number(after.original_amount) !== 800 || Number(after.balance) !== 0 || after.status !== "paid") {
    throw new Error("fixture amounts changed");
  }

  console.log("service-order-receivable-dev-qa OK", {
    FIXTURE_RECEIVABLE_COUNT: 1,
    FIXTURE_ORIGINAL_AMOUNT: result.receivable.original_amount,
    FIXTURE_POSTED_AMOUNT: result.receivable.posted_amount,
    FIXTURE_BALANCE: result.receivable.balance,
    FIXTURE_STATUS: result.receivable.status,
    FIXTURE_DUE_ON: Object.prototype.hasOwnProperty.call(result.receivable, "due_on")
      ? result.receivable.due_on
      : null,
    FIXTURE_PAYMENT_TOTAL: paymentTotal.toFixed(2),
    FIXTURE_DRIVER_EXPENSE: driverTotal,
    QA_POST_COUNT: methods.filter((method) => method === "POST").length,
    COMPANY_MAPPING: anon ? "LIVE" : "COOKIE_AGREEMENT_ONLY",
    SERVICE_ROLE_RUNTIME: "NO",
  });
}

main().catch((error) => {
  console.error("service-order-receivable-dev-qa FALHOU:", error instanceof Error ? error.message : error);
  process.exit(1);
});

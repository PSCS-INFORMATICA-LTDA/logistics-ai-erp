/**
 * DEV-only live QA for Logistics → Core AR read (official freight demo fixture).
 * Uses injected ONE_SUPABASE_* secrets; never prints tokens or keys.
 */
import { createClient } from "@supabase/supabase-js";
import { buildCoreSupabaseAuthCookieHeader } from "../src/lib/pscs-one/core/authCookie.ts";
import { PscsOneCoreArClient } from "../src/lib/pscs-one/core/arClient.ts";

const LOGISTICS_DEV_REF = "jmbajdpkvlrslirwzyze";
const CORE_DEV_REF = "uvyaqklvqcakwfvfopof";
const PROD_REF = "tqeenmswotxqainkyyct";

const OS_ID = "0c62b273-260c-4965-b015-91b73eeaf8ed";
const LOGISTICS_COMPANY = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const CORE_COMPANY = "c0b00000-0000-4000-8000-00000000000b";
const EXPECTED_RECEIVABLE = "c1b8e615-d725-4e66-acb3-5efe44aa1dd9";

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
  const { data: verified, error: vErr } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
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
  const client = new PscsOneCoreArClient(session, {
    env: {
      PSCS_ONE_CORE_SUPABASE_PROJECT_REF: CORE_DEV_REF,
      PSCS_ONE_CORE_API_BASE_URL: "https://pscs-core.vercel.app",
    },
  });

  const receivable = await client.findReceivableByLogisticsSource({
    coreCompanyId: CORE_COMPANY,
    serviceOrderId: OS_ID,
  });
  if (!receivable) throw new Error("receivable correlation missing");
  if (receivable.receivable_id !== EXPECTED_RECEIVABLE) {
    throw new Error("receivable id mismatch");
  }
  if (Number(receivable.original_amount) !== 800) throw new Error("original_amount mismatch");
  if (Number(receivable.posted_amount) !== 800) throw new Error("posted_amount mismatch");
  if (Number(receivable.balance) !== 0) throw new Error("balance mismatch");
  if (receivable.status !== "paid") throw new Error("status mismatch");

  const payments = await client.getReceivablePayments(receivable.receivable_id);
  if (payments.length !== 1) throw new Error("payment_count mismatch");
  if (Number(payments[0].amount) !== 800) throw new Error("payment_amount mismatch");
  if (Number(receivable.original_amount) === 150) throw new Error("driver expense leaked into AR");

  const logisticsAdmin = createClient(
    process.env.LOGISTICS_DEV_SUPABASE_URL,
    process.env.LOGISTICS_DEV_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: order } = await logisticsAdmin
    .from("service_orders")
    .select("id, company_id, code")
    .eq("id", OS_ID)
    .maybeSingle();
  if (!order || order.company_id !== LOGISTICS_COMPANY) {
    throw new Error("logistics service order fixture missing or company mismatch");
  }

  const { data: driverTx } = await logisticsAdmin
    .from("financial_transactions")
    .select("amount")
    .eq("service_order_id", OS_ID)
    .ilike("description", "%pagamento mot%");
  const driverTotal = (driverTx ?? []).reduce((acc, row) => acc + Number(row.amount || 0), 0);
  if (driverTotal !== 150) throw new Error("driver expense mismatch");

  // Sanity: cookie builder works (same path used by client)
  buildCoreSupabaseAuthCookieHeader(session, { PSCS_ONE_CORE_SUPABASE_PROJECT_REF: CORE_DEV_REF });

  console.log("core-ar-dev-live OK", {
    LOGISTICS_FREIGHT_CODE: "PSCS-FREIGHT-DEMO-001",
    LOGISTICS_OS_ID: OS_ID,
    LOGISTICS_COMPANY,
    CORE_COMPANY,
    CORE_RECEIVABLE_ID: receivable.receivable_id,
    CORE_PAYMENT_COUNT: payments.length,
    LOGISTICS_DRIVER_EXPENSE: driverTotal,
    DRIVER_EXPENSE_IN_CORE_AR: "NO",
  });
}

main().catch((error) => {
  console.error("core-ar-dev-live FALHOU:", error instanceof Error ? error.message : error);
  process.exit(1);
});

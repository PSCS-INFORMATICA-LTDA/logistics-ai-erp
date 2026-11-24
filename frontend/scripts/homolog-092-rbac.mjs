/**
 * Homologação da 092 no Supabase DEV jmbajdpkvlrslirwzyze.
 * Não reaplicar a migration. Não chama o runner. Não usa produção.
 *
 * T34–T40 usam duas empresas descartáveis e as sessões já existentes.
 * As empresas A e B não recebem conta nem tarifa nova.
 * T21, T22 e T24–T26 são relidos. A cadeia usa occurred_at.
 * O lançamento financeiro não tem deleted_at.
 * T24–T26 exigem proposta enviada antes da resposta pública.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = path.join(root, "frontend", ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (host !== "jmbajdpkvlrslirwzyze.supabase.co") throw new Error("ambiente recusado");

const A = "92c4c90d-6856-4c41-a9a1-9eba6a7468f6";
const B = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const QA = "06017813-bde8-4802-afda-8936ad81f042";
const EXPECTED_ACCOUNTS = 81;

function client() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
function errOf(error) {
  if (!error) return null;
  return { code: error.code || null, message: String(error.message || "").slice(0, 180) };
}
function blocked(error) {
  const info = errOf(error);
  if (!info) return false;
  return info.code === "42501" || info.code === "P0001" || /42501|permiss|autenticado|permission denied/i.test(info.message);
}

async function session(email) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`link ${email}: ${link.error.message}`);
  const user = client();
  const verified = await user.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
  });
  if (verified.error) throw new Error(`otp ${email}: ${verified.error.message}`);
  return { user, session: verified.data.session, email };
}
async function countAccounts(companyId) {
  const { count, error } = await admin.from("chart_of_accounts").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
async function countRates(companyId) {
  const { count, error } = await admin.from("freight_rate_tables").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const rescoreOnly = process.argv.includes("--rescore");
const created = [];
async function cleanup() {
  for (const companyId of created) {
    const removed = await admin.from("company_members").delete().eq("company_id", companyId);
    if (removed.error) console.error("limpeza de membro", companyId, removed.error.message);
  }
}

try {
  const ledger = await admin.from("_dev_schema_migrations").select("filename, applied_at");
  if (ledger.error) throw new Error(ledger.error.message);
  const names = new Set((ledger.data || []).map((row) => row.filename));
  const row092 = (ledger.data || []).find((row) => row.filename === "092_chart_seed_finance_guard.sql");
  const row091 = (ledger.data || []).find((row) => row.filename === "091_pre_pilot_security.sql");
  const row021 = (ledger.data || []).find((row) => row.filename === "021_seed_demo_freight_os.sql");
  const row060 = (ledger.data || []).find((row) => row.filename === "060_import_driver_confirmed.sql");
  const files = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql"));
  const pending = files.filter((name) => !names.has(name));
  record("LEDGER", names.size === 92 && ledger.data.length === 92 && Boolean(row092) && pending.length === 0, {
    rows: ledger.data.length,
    names: names.size,
    pending,
    applied092: row092?.applied_at,
    preserved091: row091?.applied_at,
    preserved021: row021?.applied_at,
    preserved060: row060?.applied_at,
  });

  const beforeA = { accounts: await countAccounts(A), rates: await countRates(A) };
  const beforeB = { accounts: await countAccounts(B), rates: await countRates(B) };
  const qaBefore = await admin.from("service_orders").select("updated_at").eq("id", QA).single();
  const auditBefore = await admin.from("deletion_audit_events").select("id", { count: "exact", head: true }).eq("screen_key", "homolog.089");

  const adminA = await session("dev.ap.a.admin@pscs.local");
  const fin = await session("dev.ap.a.fin@pscs.local");
  const oper = await session("rafael.homolog@pscs.test");
  const adminB = await session("dev.ap.b.admin@pscs.local");
  const own = await adminA.user.from("companies").select("id");
  record("T01", (own.data || []).some((row) => row.id === A) && !(own.data || []).some((row) => row.id === B), `empresas=${own.data?.length ?? 0}`);

  if (!rescoreOnly) {
  const adminCompany = await admin.from("companies").insert({ name: "HOM-092-ADMIN" }).select("id").single();
  const finCompany = await admin.from("companies").insert({ name: "HOM-092-FIN" }).select("id").single();
  if (adminCompany.error || finCompany.error) throw new Error(adminCompany.error?.message || finCompany.error?.message);
  created.push(adminCompany.data.id, finCompany.data.id);
  const members = await admin.from("company_members").insert([
    { company_id: adminCompany.data.id, user_id: adminA.session.user.id, role: "admin" },
    { company_id: adminCompany.data.id, user_id: oper.session.user.id, role: "operacional" },
    { company_id: finCompany.data.id, user_id: fin.session.user.id, role: "financeiro" },
  ]);
  if (members.error) throw new Error(members.error.message);

  const operChart = await oper.user.rpc("seed_chart_of_accounts", { p_company_id: adminCompany.data.id });
  const operCount = await countAccounts(adminCompany.data.id);
  record("T36", blocked(operChart.error) && operCount === 0, { error: errOf(operChart.error), accounts: operCount });

  const anon = client();
  const anonChart = await anon.rpc("seed_chart_of_accounts", { p_company_id: adminCompany.data.id });
  record("T37", blocked(anonChart.error) && (await countAccounts(adminCompany.data.id)) === 0, errOf(anonChart.error));

  const crossFixture = await adminB.user.rpc("seed_chart_of_accounts", { p_company_id: adminCompany.data.id });
  const crossB = await adminA.user.rpc("seed_chart_of_accounts", { p_company_id: B });
  const bAfterCross = await countAccounts(B);
  record("T38", blocked(crossFixture.error) && blocked(crossB.error) && bAfterCross === beforeB.accounts && (await countAccounts(adminCompany.data.id)) === 0, {
    fixture: errOf(crossFixture.error),
    companyB: errOf(crossB.error),
    accountsB: bAfterCross,
  });

  const adminSeed = await adminA.user.rpc("seed_chart_of_accounts", { p_company_id: adminCompany.data.id });
  const adminAccounts = await countAccounts(adminCompany.data.id);
  const adminExisting = await adminA.user.rpc("seed_chart_of_accounts", { p_company_id: A });
  record("T34", !adminSeed.error && adminAccounts === EXPECTED_ACCOUNTS && !adminExisting.error && (await countAccounts(A)) === beforeA.accounts, {
    inserted: adminSeed.data,
    fixture: adminAccounts,
    existing: errOf(adminExisting.error) || adminExisting.data,
  });

  const finSeed = await fin.user.rpc("seed_chart_of_accounts", { p_company_id: finCompany.data.id });
  const finAccounts = await countAccounts(finCompany.data.id);
  record("T35", !finSeed.error && finAccounts === EXPECTED_ACCOUNTS && Number(finSeed.data) === EXPECTED_ACCOUNTS, {
    inserted: finSeed.data,
    accounts: finAccounts,
  });

  const again = await fin.user.rpc("seed_chart_of_accounts", { p_company_id: finCompany.data.id });
  const adminAgain = await adminA.user.rpc("seed_chart_of_accounts", { p_company_id: adminCompany.data.id });
  record("T39", !again.error && Number(again.data) === 0 && !adminAgain.error && Number(adminAgain.data) === 0 && (await countAccounts(finCompany.data.id)) === EXPECTED_ACCOUNTS && (await countAccounts(adminCompany.data.id)) === EXPECTED_ACCOUNTS, {
    fin: again.data,
    admin: adminAgain.data,
  });

  const freight = await oper.user.rpc("seed_freight_rate_defaults", { p_company_id: adminCompany.data.id });
  const freightAgain = await oper.user.rpc("seed_freight_rate_defaults", { p_company_id: adminCompany.data.id });
  const freightA = await oper.user.rpc("seed_freight_rate_defaults", { p_company_id: A });
  const ratesFixture = await countRates(adminCompany.data.id);
  const ratesA = await countRates(A);
  record("T40", !freight.error && !freightAgain.error && !freightA.error && ratesFixture === 5 && ratesA === beforeA.rates, {
    fixture: ratesFixture,
    companyA: ratesA,
  });
  }

  const tx = await admin.from("financial_transactions").select("id, amount, approval_status").ilike("description", "AP-00000025%T21 estorno").maybeSingle();
  const posting = tx.data
    ? await admin.from("accounts_payable_postings").select("reversed_at").eq("financial_transaction_id", tx.data.id)
    : { data: [] };
  const payable = await admin.from("accounts_payable").select("status, deleted_at, original_amount").eq("internal_number", "AP-00000025").single();
  const corrections = tx.data
    ? await adminA.user.from("financial_correction_events").select("id").eq("transaction_id", tx.data.id)
    : { data: [], error: null };
  record("T21", !corrections.error && Number(tx.data?.amount) === 15 && tx.data?.approval_status === "cancelled" && (posting.data || []).every((row) => row.reversed_at) && payable.data?.status === "cancelled" && payable.data?.deleted_at && Number(payable.data?.original_amount) === 15 && (corrections.data || []).length === 0, {
    amount: tx.data?.amount,
    status: tx.data?.approval_status,
    payable: payable.data?.status,
  });

  const chainedTx = await admin.from("financial_transactions").select("id, amount").eq("description", "HOM-C36-20261124 T05").single();
  const chain = chainedTx.data
    ? await adminA.user.from("financial_correction_events").select("old_values, new_values, reason, occurred_at").eq("transaction_id", chainedTx.data.id).order("occurred_at")
    : { data: [], error: null };
  if (chain.error) record("T22-leitura", false, errOf(chain.error));
  const linked = (chain.data || []).length >= 2 && (chain.data || []).every((row, index, list) => index === 0 || Number(row.old_values?.amount) === Number(list[index - 1].new_values?.amount));
  record("T22", linked && Number(chainedTx.data?.amount) === 32, {
    amount: chainedTx.data?.amount,
    steps: (chain.data || []).map((row) => `${row.old_values?.amount}->${row.new_values?.amount}`),
  });

  const accepted = await admin.from("service_orders").select("proposal_response, status").eq("code", "HOM-C36-20261124-ACEITE").single();
  const rejected = await admin.from("service_orders").select("proposal_response").eq("code", "HOM-C36-20261124-RECUSA").single();
  record("T24", accepted.data?.proposal_response === "accepted" && rejected.data?.proposal_response === "rejected", {
    accepted: accepted.data,
    rejected: rejected.data?.proposal_response,
    preparacao: "mark_proposal_sent antes de respond_to_proposal",
  });
  const assignment = await admin.from("service_orders").select("driver_assignment_response").eq("code", "HOM-C36-20261124-ACEITE").single();
  record("T25", assignment.data?.driver_assignment_response === "accepted", assignment.data?.driver_assignment_response || "ausente");
  const parking = await admin.from("parking_entries").select("id, code").eq("code", "HOM-C36-PATIO").maybeSingle();
  record("T26", Boolean(parking.data?.id), parking.data?.code || parking.error?.message || "ausente");

  const t29 = await admin.from("financial_transactions").select("amount, approval_status").eq("description", "HOM-C36 T29 UI").single();
  record("T29", Number(t29.data?.amount) === 22.11 && t29.data?.approval_status === "approved", t29.data);
  const t33 = await admin.from("deletion_audit_events").select("id", { count: "exact", head: true }).ilike("reason", "%fila de aprovacao%");
  record("T33", (t33.count ?? 0) > 0, `eventos=${t33.count ?? 0}`);

  const orders = await oper.user.from("service_orders").select("id, code, updated_at").eq("id", QA).single();
  const rate = await oper.user.from("freight_rate_tables").select("code, rate_per_km").eq("company_id", A).eq("code", "TF001").limit(1);
  record("OS", orders.data?.code === "QA-OS-ND-001" && (rate.data || []).length === 1, {
    code: orders.data?.code,
    rate: rate.data?.[0]?.rate_per_km ?? null,
  });

  await cleanup();
  created.length = 0;
  const afterOwn = await adminA.user.from("companies").select("id");
  const afterA = { accounts: await countAccounts(A), rates: await countRates(A) };
  const afterB = { accounts: await countAccounts(B), rates: await countRates(B) };
  const qaAfter = await admin.from("service_orders").select("updated_at").eq("id", QA).single();
  const auditAfter = await admin.from("deletion_audit_events").select("id", { count: "exact", head: true }).eq("screen_key", "homolog.089");
  record("PRESERVADO", afterA.accounts === beforeA.accounts && afterA.rates === beforeA.rates && afterB.accounts === beforeB.accounts && afterB.rates === beforeB.rates && qaAfter.data?.updated_at === qaBefore.data?.updated_at && auditAfter.count === auditBefore.count && (afterOwn.data || []).length === 1, {
    beforeA, afterA, beforeB, afterB,
    qa: qaAfter.data?.updated_at,
    homolog089: auditAfter.count,
    empresas: afterOwn.data?.length,
  });

  const out = {
    host,
    head: "5942fb361b399329b0534adc78aafac1db6a9ec9",
    pass: results.filter((row) => row.pass).length,
    fail: results.filter((row) => !row.pass).length,
    results,
  };
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync("/opt/cursor/artifacts/homolog-092.json", JSON.stringify(out, null, 2));
  fs.writeFileSync("/tmp/homolog-092-sessions.json", JSON.stringify({
    adminA: adminA.session,
    fin: fin.session,
    operacional: oper.session,
  }));
  if (results.some((row) => !row.pass)) process.exitCode = 1;
} finally {
  await cleanup();
}

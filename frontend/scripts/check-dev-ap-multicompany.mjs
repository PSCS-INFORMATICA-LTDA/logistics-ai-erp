/**
 * Isolamento multiempresa Contas a Pagar — sessão de usuário comum (anon + login).
 * NÃO usa service_role para as asserções RLS.
 *
 * Pré-requisito: node scripts/seed-dev-ap-multicompany.mjs
 * Senha: DEV_SEED_PASSWORD
 *
 * Uso (cwd=frontend): node scripts/check-dev-ap-multicompany.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function fail(msg) {
  console.error("check-dev-ap-multicompany FALHOU:", msg);
  process.exit(1);
}

function loadEnv(filePath) {
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const verify = spawnSync(
  process.execPath,
  [path.join(__dirname, "verify-dev-environment.mjs")],
  { cwd: frontendRoot, encoding: "utf8" }
);
if (verify.status !== 0) {
  process.stdout.write(verify.stdout || "");
  process.stderr.write(verify.stderr || "");
  fail("verify:dev-env");
}
process.stdout.write(verify.stdout || "");

const env = loadEnv(path.join(frontendRoot, ".env.local"));
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(
  /^https:\/\/([a-z0-9]+)\.supabase\.co/i
)?.[1];
if (!ref || ref === PROD_REF) fail("ref inválido/prod");

const password = process.env.DEV_SEED_PASSWORD || "";
if (!password) fail("DEV_SEED_PASSWORD obrigatória");

const metaPath = path.join(frontendRoot, ".tmp-dev-ap-multicompany.json");
if (!fs.existsSync(metaPath)) fail("Rode seed-dev-ap-multicompany.mjs antes");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

function userClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(email) {
  const sb = userClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) fail(`login ${email}: ${error?.message || "sem sessão"}`);
  return sb;
}

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log("PASS", label);
  } else {
    failed += 1;
    console.error("FAIL", label);
  }
}

async function runAs(email, companyOwn, companyOther) {
  const sb = await login(email);
  const ownId = companyOwn.id;
  const otherId = companyOther.id;

  const { data: apOwn } = await sb
    .from("accounts_payable")
    .select("id, company_id, internal_number")
    .eq("company_id", ownId)
    .is("deleted_at", null);
  assert((apOwn || []).length >= 1, `${email} vê títulos próprios`);
  assert(
    (apOwn || []).every((r) => r.company_id === ownId),
    `${email} títulos só da própria empresa`
  );

  const { data: apOther } = await sb
    .from("accounts_payable")
    .select("id, company_id")
    .eq("company_id", otherId)
    .is("deleted_at", null);
  assert((apOther || []).length === 0, `${email} NÃO lista títulos da outra empresa`);

  const otherApId = companyOther.approved?.id || companyOther.draft?.id;
  if (otherApId) {
    const { data: byId } = await sb
      .from("accounts_payable")
      .select("id")
      .eq("id", otherApId)
      .maybeSingle();
    assert(!byId, `${email} NÃO acessa título da outra por id`);

    const { error: approveErr } = await sb.rpc("approve_accounts_payable", {
      p_payable_id: otherApId,
      p_review_note: "cross",
    });
    assert(Boolean(approveErr), `${email} NÃO aprova título da outra (${approveErr?.message || ""})`);

    const { error: submitErr } = await sb.rpc("submit_accounts_payable", {
      p_payable_id: otherApId,
    });
    assert(Boolean(submitErr), `${email} NÃO submete título da outra`);

    const { error: cancelErr } = await sb.rpc("cancel_accounts_payable", {
      p_payable_id: otherApId,
      p_reason: "cross",
    });
    assert(Boolean(cancelErr), `${email} NÃO cancela título da outra`);
  }

  const { data: suppliersOther } = await sb
    .from("suppliers")
    .select("id")
    .eq("company_id", otherId)
    .is("deleted_at", null);
  assert((suppliersOther || []).length === 0, `${email} NÃO lista fornecedores da outra`);

  const { data: accountsOther } = await sb
    .from("company_financial_accounts")
    .select("id")
    .eq("company_id", otherId)
    .is("deleted_at", null);
  assert((accountsOther || []).length === 0, `${email} NÃO lista contas financeiras da outra`);

  const { data: coaOther } = await sb
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", otherId);
  assert((coaOther || []).length === 0, `${email} NÃO lista DRE da outra`);

  // Tentativa de criar título com fornecedor da outra empresa
  const otherSupplier = companyOther.supplierId;
  const ownChart = companyOwn.chartId;
  const { data: numData, error: numErr } = await sb.rpc("next_company_document_number", {
    p_company_id: ownId,
    p_document_type: "accounts_payable",
    p_prefix: "AP",
    p_padding: 8,
  });
  assert(!numErr && String(numData).startsWith("AP-"), `${email} numeração AP própria`);

  const { error: crossInsertErr } = await sb.from("accounts_payable").insert({
    company_id: ownId,
    internal_number: `AP-CROSS-${Date.now()}`,
    description: "Tentativa cruzada DEV",
    competence_date: new Date().toISOString().slice(0, 10),
    entry_date: new Date().toISOString().slice(0, 10),
    supplier_id: otherSupplier,
    chart_of_account_id: ownChart,
    original_amount: 10,
    net_amount: 10,
    open_balance: 10,
    installment_count: 1,
    status: "open",
    approval_status: "draft",
    source: "manual",
  });
  // Pode falhar por FK/check/RLS — qualquer bloqueio é OK; sucesso seria FALHA de isolamento
  assert(Boolean(crossInsertErr), `${email} bloqueado ao usar fornecedor da outra empresa`);

  const { error: numOtherErr } = await sb.rpc("next_company_document_number", {
    p_company_id: otherId,
    p_document_type: "accounts_payable",
    p_prefix: "AP",
    p_padding: 8,
  });
  assert(Boolean(numOtherErr), `${email} NÃO gera numeração da outra empresa`);

  await sb.auth.signOut();
}

async function checkIndependentSequences() {
  const aNums = [meta.companyA.draft?.number, meta.companyA.approved?.number].filter(Boolean);
  const bNums = [meta.companyB.draft?.number, meta.companyB.approved?.number].filter(Boolean);
  assert(aNums.every((n) => String(n).startsWith("AP-")), "Empresa A usa prefixo AP");
  assert(bNums.every((n) => String(n).startsWith("AP-")), "Empresa B usa prefixo AP");
  // Cada empresa pode ter AP-00000001 independentemente
  console.log("SEQ_A", aNums.join(","));
  console.log("SEQ_B", bNums.join(","));
}

await checkIndependentSequences();
await runAs(meta.emails.aAdmin, meta.companyA, meta.companyB);
await runAs(meta.emails.bAdmin, meta.companyB, meta.companyA);

console.log(`RESULT passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
console.log("MULTI_ISOLATION_OK");

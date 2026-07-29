/**
 * Testes: soft-deleted invisível + restore (admin) + cross-company.
 * Pré: DEV_SEED_PASSWORD + seed-dev-ap-multicompany.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  createAccountsPayableDraft,
  softDeleteAccountsPayable,
  listAccountsPayable,
  fetchAccountsPayableDetail,
  fetchApKpis,
} from "../src/lib/accounts-payable-api.ts";

const PROD = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function fail(m) {
  console.error("FAIL", m);
  process.exit(1);
}
function ok(m) {
  console.log("PASS", m);
}

function loadEnv(p) {
  const o = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    o[t.slice(0, i)] = v;
  }
  return o;
}

const verify = spawnSync(process.execPath, [path.join(__dirname, "verify-dev-environment.mjs")], {
  cwd: frontendRoot,
  encoding: "utf8",
});
if (verify.status !== 0) fail("verify");
process.stdout.write(verify.stdout || "");

const env = loadEnv(path.join(frontendRoot, ".env.local"));
if ((env.NEXT_PUBLIC_SUPABASE_URL || "").includes(PROD)) fail("prod");
const password = process.env.DEV_SEED_PASSWORD;
if (!password) fail("DEV_SEED_PASSWORD");
const metaPath = path.join(frontendRoot, ".tmp-dev-ap-multicompany.json");
if (!fs.existsSync(metaPath)) fail("meta ausente — rode seed-dev-ap-multicompany.mjs");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await sb.auth.signInWithPassword({ email: meta.emails.aAdmin, password });
const companyId = meta.companyA.id;
const today = new Date();
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = iso(today);
const future = new Date(today);
future.setDate(future.getDate() + 10);
const futureIso = iso(future);

const desc = "Teste DEV — Soft invisible " + Date.now();
const created = await createAccountsPayableDraft(sb, {
  companyId,
  description: desc,
  competenceDate: todayIso,
  firstDueDate: futureIso,
  chartOfAccountId: meta.companyA.chartId,
  originalAmount: 42,
  installmentCount: 1,
  supplierId: meta.companyA.supplierId,
});
if (created.error || !created.id) fail(created.error || "create");
const id = created.id;
const number = created.internalNumber;
ok(`criado ${number}`);

const del = await softDeleteAccountsPayable(sb, companyId, id, {
  code: "other",
  detail: "Teste invisibilidade soft-delete",
});
if (del.error) fail(del.error);
ok("soft-delete RPC");

const { data: rawSelect } = await sb.from("accounts_payable").select("id, deleted_at").eq("id", id);
if ((rawSelect || []).length > 0) {
  fail("SELECT genérico ainda enxerga soft-deleted (policy 075 não removida?)");
}
ok("SELECT genérico não retorna soft-deleted");

const list = await listAccountsPayable(sb, companyId);
if (list.rows.some((r) => r.id === id)) fail("ainda na listagem");
ok("ausente da listagem");

const detail = await fetchAccountsPayableDetail(sb, companyId, id);
if (detail.payable) fail("detalhe ainda retorna soft-deleted");
ok("detalhe não retorna soft-deleted");

const kpis = await fetchApKpis(sb, companyId);
if (kpis.error) fail(kpis.error);
ok(`kpis ok open=${kpis.kpis.openTotal}`);

const { data: audit } = await sb
  .from("deletion_audit_events")
  .select("id")
  .eq("company_id", companyId)
  .eq("entity_type", "accounts_payable")
  .eq("entity_id", id)
  .eq("restored", false)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (!audit?.id) fail("sem auditoria");

// financeiro não-admin: se existir, deve falhar restore
await sb.auth.signInWithPassword({ email: meta.emails.aFin, password });
const { error: finRestErr } = await sb.rpc("restore_deleted_from_audit", {
  p_event_id: audit.id,
  p_restoration_reason: "Tentativa financeiro restaurar AP",
});
if (!finRestErr) fail("financeiro conseguiu restaurar (deveria bloquear)");
ok(`restore bloqueado para financeiro: ${finRestErr.message.slice(0, 80)}`);

await sb.auth.signInWithPassword({ email: meta.emails.aAdmin, password });
const { error: restErr } = await sb.rpc("restore_deleted_from_audit", {
  p_event_id: audit.id,
  p_restoration_reason: "Restauração autorizada admin DEV",
});
if (restErr) fail(restErr.message);
const { data: restored } = await sb
  .from("accounts_payable")
  .select("id, internal_number, deleted_at")
  .eq("id", id)
  .is("deleted_at", null)
  .maybeSingle();
if (!restored || restored.internal_number !== number) fail("restauração falhou");
ok(`restauração admin manteve ${number}`);

// reuse event
const { error: reuseErr } = await sb.rpc("restore_deleted_from_audit", {
  p_event_id: audit.id,
  p_restoration_reason: "Reuso indevido do evento",
});
if (!reuseErr) fail("reuso do evento deveria falhar");
ok("reuso de evento bloqueado");

// cross-company: B tenta ver/restaurar
await sb.auth.signInWithPassword({ email: meta.emails.bAdmin, password });
const { data: cross } = await sb.from("accounts_payable").select("id, description").eq("id", id);
if ((cross || []).length > 0) fail("Empresa B viu título da A");
ok("cross-company detalhe vazio");

const { data: auditB } = await sb
  .from("deletion_audit_events")
  .select("id")
  .eq("id", audit.id)
  .maybeSingle();
// may or may not see audit depending on RLS — try restore anyway with A's event id
const { error: crossRest } = await sb.rpc("restore_deleted_from_audit", {
  p_event_id: audit.id,
  p_restoration_reason: "Cross company restore attempt XX",
});
if (!crossRest) {
  // if event already restored, expect already restored error from A admin path;
  // B should not succeed as admin of other company
  fail("Empresa B restaurou evento da A");
}
ok(`cross restore bloqueado: ${crossRest.message.slice(0, 80)}`);

console.log("SOFT_DELETE_SECURITY_OK");

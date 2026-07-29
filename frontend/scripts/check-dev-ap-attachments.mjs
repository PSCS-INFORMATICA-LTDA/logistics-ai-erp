/**
 * Anexos Contas a Pagar — isolamento storage + preservacao (DEV).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { buildAttachmentPath } from "../src/lib/attachments.ts";

const PROD = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const BUCKET = "company-attachments";

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
const meta = JSON.parse(
  fs.readFileSync(path.join(frontendRoot, ".tmp-dev-ap-multicompany.json"), "utf8")
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email: meta.emails.aAdmin, password });

const payableId = meta.companyA.approved.id;
const companyId = meta.companyA.id;
const blob = new Blob([Buffer.from("%PDF-1.1 fake DEV attachment AP\n")], {
  type: "application/pdf",
});
const fileName = "dev-ap-anexo-ficticio.pdf";
const storagePath = buildAttachmentPath(companyId, "accounts_payable", payableId, fileName);

const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, blob, {
  contentType: "application/pdf",
  upsert: true,
});
if (upErr) fail(upErr.message);

const {
  data: { user },
} = await sb.auth.getUser();
const { data: att, error: insErr } = await sb
  .from("attachments")
  .insert({
    company_id: companyId,
    entity_type: "accounts_payable",
    entity_id: payableId,
    file_name: fileName,
    storage_path: storagePath,
    mime_type: "application/pdf",
    file_size: 32,
    uploaded_by: user?.id || null,
    description: "Anexo fictício DEV",
  })
  .select("id, storage_path")
  .single();
if (insErr) fail(insErr.message);
ok("anexo título Empresa A");

const { data: signed, error: signErr } = await sb.storage
  .from(BUCKET)
  .createSignedUrl(storagePath, 120);
if (signErr || !signed?.signedUrl) fail(signErr?.message || "signed url");
ok("signed URL 120s");

await sb.auth.signInWithPassword({ email: meta.emails.bAdmin, password });
const { data: leakRows } = await sb
  .from("attachments")
  .select("id, file_name")
  .eq("id", att.id);
if ((leakRows || []).length > 0) fail("Empresa B listou anexo da A");
ok("anexo meta inacessível para B");

const { data: leakSign, error: leakSignErr } = await sb.storage
  .from(BUCKET)
  .createSignedUrl(storagePath, 60);
if (leakSign?.signedUrl && !leakSignErr) {
  fail("Empresa B obteve signed URL do path da A");
}
ok("storage path bloqueado para B");

// cleanup soft: keep file (soft delete shouldn't remove) — remove row for idempotency via A
await sb.auth.signInWithPassword({ email: meta.emails.aAdmin, password });
await sb.from("attachments").delete().eq("id", att.id);
await sb.storage.from(BUCKET).remove([storagePath]);
ok("cleanup anexo teste");

console.log("AP_ATTACHMENTS_OK");

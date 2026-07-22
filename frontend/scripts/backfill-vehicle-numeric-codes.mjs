/**
 * Converte códigos legados de veículos (VEI001…) para numérico 8 dígitos (00000001…).
 * Uso: node frontend/scripts/backfill-vehicle-numeric-codes.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

const env = {
  ...loadEnv(join(__dirname, "../../.env.local")),
  ...loadEnv(join(__dirname, "../.env.local")),
};
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const companyId = process.argv[2] || "4787a893-6b62-4d36-87ce-57c15338ea11";

const { data, error } = await sb
  .from("vehicles")
  .select("id, code, plate, created_at")
  .eq("company_id", companyId)
  .order("created_at", { ascending: true });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = data ?? [];
const alreadyNumeric = rows.every((r) => /^\d{8}$/.test(String(r.code ?? "")));
if (alreadyNumeric) {
  console.log("Todos os códigos de veículos já estão no padrão 8 dígitos.");
  process.exit(0);
}

// Evita conflito de UNIQUE: primeiro move para temporário, depois para final.
let seq = 0;
for (const row of rows) {
  seq += 1;
  const temp = `__TMP_${seq}`;
  const { error: e1 } = await sb.from("vehicles").update({ code: temp }).eq("id", row.id);
  if (e1) {
    console.error("temp", row.id, e1.message);
    process.exit(1);
  }
}

seq = 0;
for (const row of rows) {
  seq += 1;
  const code = String(seq).padStart(8, "0");
  const { error: e2 } = await sb.from("vehicles").update({ code }).eq("id", row.id);
  if (e2) {
    console.error("final", row.id, e2.message);
    process.exit(1);
  }
  console.log(`${row.plate}: ${row.code} -> ${code}`);
}

console.log(`Atualizados ${rows.length} veículos.`);

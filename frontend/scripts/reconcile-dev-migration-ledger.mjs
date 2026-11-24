/**
 * Conferidor de conexão da reconciliação do ledger DEV.
 * Não abre conexão e não executa o SQL. Produção é recusada.
 * O arquivo SQL continua responsável pela transação atômica.
 */
export const DEV_REF = "jmbajdpkvlrslirwzyze";
export const PROD_REF = "tqeenmswotxqainkyyct";

export function assertReconcileTarget(connection) {
  const raw = String(connection || "").trim();
  if (raw.toLowerCase().includes(PROD_REF)) {
    throw new Error("reconciliação recusada: conexão de produção");
  }
  let host = "";
  let user = "";
  try {
    const normalized = raw.includes("://") ? raw : `postgresql://${raw}`;
    const url = new URL(normalized);
    host = url.hostname.toLowerCase();
    user = decodeURIComponent(url.username || "").toLowerCase();
  } catch {
    throw new Error("reconciliação recusada: conexão ilegível");
  }
  const direct = host === `db.${DEV_REF}.supabase.co`;
  const pooler =
    host.endsWith(".pooler.supabase.com") &&
    (user === `postgres.${DEV_REF}` || user.endsWith(`.${DEV_REF}`));
  if (!direct && !pooler) {
    throw new Error("reconciliação recusada: a conexão não é o DEV jmbajdpkvlrslirwzyze");
  }
  return { host, user };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("reconcile-dev-migration-ledger.mjs");
if (isDirectRun) {
  const connection = process.env.RECONCILE_DATABASE_URL || "";
  try {
    assertReconcileTarget(connection);
  } catch (error) {
    fail(error instanceof Error ? error.message : "reconciliação recusada");
  }
  fail("reconciliação recusada: este comando não abre conexão e não executa o script");
}

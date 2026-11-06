import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const migrationPath = path.join(root, "supabase/migrations/084_service_order_security_guards.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const database = `logistics_084_revoke_${process.pid}`;

const revokeMatch = migration.match(
  /-- BEGIN seed_drivers revoke\n([\s\S]*?)\n-- END seed_drivers revoke/,
);
if (!revokeMatch) {
  throw new Error("Bloco condicional de seed_drivers não encontrado na migration 084.");
}
const revokeSql = revokeMatch[1];

function psql(sql: string, options: { stopOnError?: boolean } = {}) {
  const stopOnError = options.stopOnError ?? true;
  const result = spawnSync(
    "sudo",
    [
      "-n",
      "-u",
      "postgres",
      "psql",
      "-X",
      "--no-psqlrc",
      "-v",
      stopOnError ? "ON_ERROR_STOP=1" : "ON_ERROR_STOP=0",
      "-v",
      "VERBOSITY=verbose",
      "-d",
      database,
    ],
    { encoding: "utf8", input: sql },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stopOnError && result.status !== 0) {
    throw new Error(
      `psql exit ${result.status} signal ${result.signal ?? ""} ${result.error?.message ?? ""}\n${stderr}\n${stdout}`,
    );
  }
  return { status: result.status ?? 1, stdout, stderr };
}

before(() => {
  execFileSync("sudo", ["-n", "-u", "postgres", "createdb", database], { encoding: "utf8" });
});

after(() => {
  execFileSync("sudo", ["-n", "-u", "postgres", "dropdb", "--if-exists", database], { encoding: "utf8" });
});

describe("migration 084 — seed_drivers condicional", () => {
  it("remove EXECUTE de anon, authenticated e PUBLIC quando a função existe", () => {
    const output = psql(`
      BEGIN;
      CREATE FUNCTION public.seed_drivers(p_company_id uuid)
      RETURNS integer
      LANGUAGE sql
      AS $$ SELECT 1 $$;
      GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO PUBLIC;
      GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO anon;
      GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO service_role;
      ${revokeSql}
      DO $$
      BEGIN
        IF has_function_privilege('anon', 'public.seed_drivers(uuid)', 'EXECUTE') THEN
          RAISE EXCEPTION 'anon mantém EXECUTE';
        END IF;
        IF has_function_privilege('authenticated', 'public.seed_drivers(uuid)', 'EXECUTE') THEN
          RAISE EXCEPTION 'authenticated mantém EXECUTE';
        END IF;
        IF has_function_privilege('public', 'public.seed_drivers(uuid)', 'EXECUTE') THEN
          RAISE EXCEPTION 'PUBLIC mantém EXECUTE';
        END IF;
        IF NOT has_function_privilege('service_role', 'public.seed_drivers(uuid)', 'EXECUTE') THEN
          RAISE EXCEPTION 'service_role perdeu EXECUTE';
        END IF;
      END
      $$;
      ROLLBACK;
      SELECT to_regprocedure('public.seed_drivers(uuid)') IS NULL AS rolled_back;
    `).stdout;
    assert.match(output, /ROLLBACK/);
    assert.match(output, /rolled_back/);
    assert.match(output, /\n t\n|\|\s*t/);
  });

  it("não falha e mantém a transação aberta quando a função não existe", () => {
    const output = psql(`
      BEGIN;
      ${revokeSql}
      SELECT 'transacao_aberta' AS state, to_regprocedure('public.seed_drivers(uuid)') IS NULL AS missing;
      ROLLBACK;
    `).stdout;
    assert.match(output, /transacao_aberta/);
    assert.match(output, /\|\s*t/);
  });

  it("desfaz a revogação se um comando posterior da mesma transação falha", () => {
    let failed = false;
    try {
      psql(`
        BEGIN;
        CREATE FUNCTION public.seed_drivers(p_company_id uuid)
        RETURNS integer
        LANGUAGE sql
        AS $$ SELECT 1 $$;
        GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO anon;
        GRANT EXECUTE ON FUNCTION public.seed_drivers(uuid) TO authenticated;
        ${revokeSql}
        DO $$ BEGIN RAISE EXCEPTION 'falha posterior'; END $$;
        COMMIT;
      `);
    } catch (error) {
      failed = true;
      assert.match(String(error), /falha posterior/);
    }
    assert.equal(failed, true);
    const gone = psql("SELECT to_regprocedure('public.seed_drivers(uuid)') IS NULL;").stdout;
    assert.match(gone, /\bt\b/);
  });

  it("mostra que o REVOKE incondicional aborta a transação sem a função", () => {
    const result = psql(
      `
        BEGIN;
        REVOKE ALL ON FUNCTION public.seed_drivers(uuid) FROM anon;
        SELECT 'nao_deve_executar';
      `,
      { stopOnError: false },
    );
    const text = `${result.stdout}\n${result.stderr}`;
    assert.match(text, /seed_drivers\(uuid\) does not exist|função .*seed_drivers\(uuid\).*não existe/i);
    assert.match(text, /current transaction is aborted|transação atual foi interrompida/i);
    psql("ROLLBACK;");
  });
});

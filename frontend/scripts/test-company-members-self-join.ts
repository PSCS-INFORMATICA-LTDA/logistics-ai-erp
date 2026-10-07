import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const migrationPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "079_close_company_members_self_join.sql",
);

function migrationSql(): string {
  const raw = fs.readFileSync(migrationPath, "utf8");
  return raw.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
}

describe("company_members self-join policy", () => {
  it("keeps bootstrap and admin insert, and removes open self-join", () => {
    const sql = migrationSql();
    assert.match(sql, /create or replace function public\.company_has_no_members/);
    assert.match(sql, /security definer/);
    assert.match(sql, /drop policy if exists company_members_insert on public\.company_members/);
    assert.match(sql, /auth_user_is_company_admin\(company_id\)/);
    assert.match(sql, /user_id = auth\.uid\(\)/);
    assert.match(sql, /role = 'admin'/);
    assert.match(sql, /company_has_no_members\(company_id\)/);
    assert.doesNotMatch(sql, /user_id = auth\.uid\(\)\s+or\s+public\.auth_user_is_company_admin/);
    assert.doesNotMatch(sql, /create table/);
    assert.doesNotMatch(sql, /add column/);
    assert.doesNotMatch(sql, /accounts_receivable/);
  });
});

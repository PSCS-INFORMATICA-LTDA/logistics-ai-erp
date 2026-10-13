import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  resolveUniqueClientId,
  serviceOrderClientLinkStatus,
} from "../src/lib/service-order-client.ts";

const migrationPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "082_service_order_client_id.sql",
);

describe("service order client link", () => {
  it("marks linked and legacy orders", () => {
    assert.equal(serviceOrderClientLinkStatus({ client_id: "c1" }), "LINKED");
    assert.equal(serviceOrderClientLinkStatus({ client_id: null }), "LEGACY_UNLINKED");
    assert.equal(serviceOrderClientLinkStatus({}), "LEGACY_UNLINKED");
  });

  it("resolves one client and refuses ambiguity", () => {
    const clients = [
      { id: "a", name: "Alfa", trade_name: "Alfa LTDA", status: "Ativo", deleted_at: null },
      { id: "b", name: "Beta", trade_name: null, status: "Ativo", deleted_at: null },
      { id: "c", name: "Alfa", trade_name: null, status: "Inativo", deleted_at: null },
      { id: "d", name: "Gamma", trade_name: "Beta", status: "Ativo", deleted_at: null },
    ];
    assert.equal(resolveUniqueClientId(clients, "  Alfa   LTDA ").clientId, "a");
    assert.equal(resolveUniqueClientId(clients, "Beta").reason, "ambiguous");
    assert.equal(resolveUniqueClientId(clients, "Sem Cadastro").reason, "unmatched");
    assert.equal(resolveUniqueClientId(clients, "   ").reason, "missing");
    assert.equal(resolveUniqueClientId(clients, "Alfa").clientId, "a");
  });
});

describe("migration 082", () => {
  it("adds a nullable same-company client reference and does not touch Core", () => {
    const sql = fs.readFileSync(migrationPath, "utf8").toLowerCase();
    assert.match(sql, /add column if not exists client_id uuid null/);
    assert.match(sql, /references public\.clients\(id\) on delete restrict/);
    assert.match(sql, /cliente de outra empresa/);
    assert.match(sql, /cliente inexistente/);
    assert.match(sql, /cliente inativo ou excluído/);
    assert.match(sql, /having count\(distinct client_id\) = 1/);
    assert.doesNotMatch(sql, /alter column client_id set not null/);
    assert.doesNotMatch(sql, /accounts_receivable/);
    assert.doesNotMatch(sql, /get_public_proposal/);
    assert.doesNotMatch(sql, /complete_service_order/);
    assert.doesNotMatch(sql, /drop policy/);
    assert.doesNotMatch(sql, /create policy/);
  });
});

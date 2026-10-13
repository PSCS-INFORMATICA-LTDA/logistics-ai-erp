import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isCanonicalDriverConfirmed } from "../src/lib/driver-confirmed.ts";
import {
  isDriverConfirmedOnServiceOrder,
  isFreightInExecution,
  resolveServiceOrderDisplayStatus,
} from "../src/lib/service-order-display-status.ts";

const migrationPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "080_canonical_driver_confirmed.sql",
);

const migration029Path = path.join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "029_service_order_completion.sql",
);

function migrationSql(): string {
  return fs.readFileSync(migrationPath, "utf8");
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "Aberto",
    proposal_sent_at: "2026-10-01T00:00:00Z",
    proposal_response: "accepted" as const,
    proposal_accepted_at: "2026-10-01T00:00:00Z",
    proposal_rejected_at: null,
    driver_id: "driver-1",
    proposed_driver_id: "driver-1",
    driver_assignment_sent_at: "2026-10-01T00:00:00Z",
    driver_assignment_response: "pending" as const,
    driver_assignment_rejected_driver_ids: [],
    driver_name: "Ana",
    ...overrides,
  };
}

describe("canonical driver confirmed predicate", () => {
  it("formal assignment pending is not confirmed", () => {
    const row = baseRow({
      driver_id: null,
      proposed_driver_id: "driver-1",
      driver_assignment_response: "pending",
      driver_assignment_sent_at: "2026-10-01T00:00:00Z",
    });
    assert.equal(isCanonicalDriverConfirmed(row), false);
    assert.equal(isDriverConfirmedOnServiceOrder(row), false);
    assert.equal(resolveServiceOrderDisplayStatus(row), "Aguardando confirmação do motorista");
    assert.equal(isFreightInExecution(row), false);
  });

  it("formal assignment accepted is confirmed", () => {
    const row = baseRow({
      driver_id: "driver-1",
      proposed_driver_id: "driver-1",
      driver_assignment_response: "accepted",
    });
    assert.equal(isCanonicalDriverConfirmed(row), true);
    assert.equal(isDriverConfirmedOnServiceOrder(row), true);
    assert.equal(resolveServiceOrderDisplayStatus(row), "Motorista confirmado");
    assert.equal(isFreightInExecution(row), true);
  });

  it("formal assignment rejected is not confirmed", () => {
    const row = baseRow({
      driver_id: null,
      proposed_driver_id: "driver-1",
      driver_assignment_response: "rejected",
    });
    assert.equal(isCanonicalDriverConfirmed(row), false);
    assert.equal(isDriverConfirmedOnServiceOrder(row), false);
    assert.equal(resolveServiceOrderDisplayStatus(row), "Designação recusada pelo motorista");
  });

  it("driver_id alone, including legacy import, is not confirmed", () => {
    const legacy = baseRow({
      driver_id: "driver-1",
      proposed_driver_id: null,
      driver_assignment_sent_at: null,
      driver_assignment_response: "pending",
    });
    assert.equal(isCanonicalDriverConfirmed(legacy), false);
    assert.equal(isDriverConfirmedOnServiceOrder(legacy), false);
    assert.notEqual(resolveServiceOrderDisplayStatus(legacy), "Motorista confirmado");
  });

  it("accepted without driver_id is not confirmed", () => {
    const row = baseRow({
      driver_id: null,
      driver_assignment_response: "accepted",
    });
    assert.equal(isCanonicalDriverConfirmed(row), false);
    assert.equal(isDriverConfirmedOnServiceOrder(row), false);
  });

  it("UI confirmed means close gate would pass; UI not confirmed means it would block", () => {
    const cases = [
      baseRow({ driver_id: null, driver_assignment_response: "pending" }),
      baseRow({ driver_id: "driver-1", driver_assignment_response: "pending" }),
      baseRow({ driver_id: "driver-1", driver_assignment_response: "rejected" }),
      baseRow({ driver_id: null, driver_assignment_response: "accepted" }),
      baseRow({ driver_id: "driver-1", driver_assignment_response: "accepted" }),
    ];
    for (const row of cases) {
      const ui = isDriverConfirmedOnServiceOrder(row);
      const closeAllows = Boolean(row.driver_id) && row.driver_assignment_response === "accepted";
      assert.equal(ui, closeAllows);
    }
  });
});

describe("migration 080 canonical contract", () => {
  it("versions the single rule and does not edit migration 029", () => {
    const sql = migrationSql().toLowerCase();
    const original029 = fs.readFileSync(migration029Path, "utf8");
    assert.match(sql, /service_order_driver_confirmed/);
    assert.match(sql, /p_driver_id is not null/);
    assert.match(sql, /p_driver_assignment_response = 'accepted'/);
    assert.match(sql, /confirm_service_order_driver_without_link/);
    assert.match(sql, /driver_assignment_response = 'accepted'/);
    assert.match(sql, /driver_id = p_driver_id/);
    assert.match(sql, /proposed_driver_id = p_driver_id/);
    assert.match(sql, /driver_assignment_token = null/);
    assert.match(sql, /driver_assignment_pay_amount = null/);
    assert.match(sql, /driver_assignment_assistant_pay_amount = null/);
    assert.match(sql, /_assert_service_order_member/);
    assert.doesNotMatch(sql, /driver_assignment_sent_at is null\s+and\s+v_row\.proposed_driver_id is null/);
    assert.doesNotMatch(sql, /accounts_receivable/);
    assert.doesNotMatch(sql, /drop policy/);
    assert.doesNotMatch(sql, /create policy/);
    assert.match(original029, /driver_assignment_response <> 'accepted' OR v_row.driver_id IS NULL/);
  });
});

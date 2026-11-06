import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canReplaceConfirmedDriver } from "../src/lib/service-order-display-status.ts";

const root = path.join(import.meta.dirname, "..", "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/085_driver_reassignment_and_public_amounts.sql"),
  "utf8",
);
const previousPublic = fs.readFileSync(
  path.join(root, "supabase/migrations/083_public_driver_assignment_schedule.sql"),
  "utf8",
);
const form = fs.readFileSync(
  path.join(root, "frontend/src/app/(app)/operacional/ordens-servico/page.tsx"),
  "utf8",
);
const actions = fs.readFileSync(
  path.join(root, "frontend/src/components/operacional/ServiceOrderRowActions.tsx"),
  "utf8",
);
const modal = fs.readFileSync(
  path.join(root, "frontend/src/components/operacional/AssignDriverModal.tsx"),
  "utf8",
);

const confirmed = {
  status: "Aberto",
  proposal_response: "accepted" as const,
  proposal_sent_at: "2026-11-04T00:00:00Z",
  driver_id: "driver-a",
  proposed_driver_id: "driver-a",
  driver_assignment_response: "accepted" as const,
  driver_assignment_sent_at: "2026-11-05T12:00:00Z",
  driver_assignment_accepted_at: "2026-11-05T13:00:00Z",
  driver_assignment_rejected_at: null,
  driver_assignment_rejected_driver_ids: [] as string[],
};

describe("troca de motorista após aceite", () => {
  it("bloqueia a troca direta e abre a nova designação", () => {
    assert.match(migration, /NEW\.driver_id IS DISTINCT FROM OLD\.driver_id/);
    assert.match(migration, /Motorista confirmado só pode ser substituído por uma nova designação/);
    assert.match(form, /Motorista confirmado só pode ser substituído por uma nova designação/);
    assert.match(actions, /Nova designação/);
    assert.match(actions, /replacement=\{assignReplacement\}/);
  });

  it("a nova designação grava o aceite anterior e fica pendente", () => {
    assert.match(migration, /service_order_driver_acceptance_history/);
    assert.match(migration, /driver_assignment_accepted_at/);
    assert.match(migration, /driver_assignment_response', 'pending'/);
    assert.match(migration, /driver_id = NULL/);
    assert.doesNotMatch(migration, /driver_assignment_response = 'accepted'/);
    assert.match(modal, /reassignAcceptedServiceOrderDriver/);
    assert.match(modal, /O novo motorista precisa aceitar/);
    assert.equal(canReplaceConfirmedDriver(confirmed), true);
    assert.equal(canReplaceConfirmedDriver({ ...confirmed, status: "Concluido" }), false);
    assert.equal(canReplaceConfirmedDriver({ ...confirmed, status: "Cancelado" }), false);
  });

  it("não confirma a outra empresa", () => {
    assert.match(migration, /_assert_service_order_member/);
    assert.match(migration, /d\.company_id = v_row\.company_id/);
    assert.match(migration, /company_id IN \(SELECT public\.auth_user_company_ids\(\)\)/);
  });
});

describe("valores comerciais fora do link público", () => {
  it("a migration 083 conserva o contrato anterior", () => {
    assert.match(previousPublic, /'freight_agreed_amount', v_row\.freight_agreed_amount/);
    assert.match(previousPublic, /'service_amount', v_row\.service_amount/);
    assert.match(previousPublic, /'entry_time', v_row\.entry_time/);
  });

  it("a migration 085 tira só os dois valores comerciais", () => {
    assert.doesNotMatch(migration, /freight_agreed_amount/);
    assert.doesNotMatch(migration, /service_amount/);
    assert.match(migration, /'entry_date', v_row\.entry_date/);
    assert.match(migration, /'entry_time', v_row\.entry_time/);
    assert.match(migration, /'exit_date', v_row\.exit_date/);
    assert.match(migration, /'exit_time', v_row\.exit_time/);
    assert.match(migration, /driver_assignment_pay_amount/);
    assert.match(migration, /driver_assignment_assistant_pay_amount/);
    assert.match(migration, /'freight_toll_amount', v_row\.freight_toll_amount/);
    assert.match(migration, /'can_respond'/);
    assert.doesNotMatch(migration, /\bOS003\b/);
  });
});

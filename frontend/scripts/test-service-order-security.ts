import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isCanonicalDriverConfirmed } from "../src/lib/driver-confirmed.ts";
import { resolveServiceOrderDisplayStatus } from "../src/lib/service-order-display-status.ts";
import { DRIVER_ASSIGNMENT_RESPONSE_LABELS } from "../src/lib/service-order-driver-assignment.ts";

const root = path.join(import.meta.dirname, "..", "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/084_service_order_security_guards.sql"),
  "utf8",
);
const listPage = fs.readFileSync(
  path.join(root, "frontend/src/app/(app)/operacional/ordens-servico/page.tsx"),
  "utf8",
);
const crudPage = fs.readFileSync(
  path.join(root, "frontend/src/components/crud/CrudPage.tsx"),
  "utf8",
);

const os003 = {
  status: "Aberto",
  proposal_sent_at: "2026-11-04T00:00:00Z",
  proposal_response: "accepted" as const,
  proposal_accepted_at: "2026-11-04T00:00:00Z",
  proposal_rejected_at: null,
  driver_id: "driver-os003",
  proposed_driver_id: "driver-os003",
  driver_assignment_sent_at: "2026-11-05T12:47:59Z",
  driver_assignment_response: "accepted" as const,
  driver_assignment_accepted_at: "2026-11-05T13:54:32Z",
  driver_assignment_rejected_at: null,
  driver_assignment_rejected_driver_ids: [] as string[],
  driver_name: "Motorista Homologacao WhatsApp DEV",
};

describe("OS003 confirmada", () => {
  it("permanece Motorista confirmado com a OS aberta", () => {
    assert.equal(isCanonicalDriverConfirmed(os003), true);
    assert.equal(
      resolveServiceOrderDisplayStatus(os003),
      DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted,
    );
  });

  it("o nome longo deixa de usar reticências e expõe o texto completo", () => {
    assert.match(listPage, /wrapContent: true/);
    assert.match(listPage, /aria-label=\{label\}/);
    assert.match(listPage, /title=\{label\}/);
    assert.match(crudPage, /wrapContent \? "whitespace-normal break-words align-top" : "truncate"/);
  });
});

describe("migration 084 — testes negativos do contrato", () => {
  it("retira TRUNCATE e não devolve essa permissão", () => {
    assert.match(migration, /REVOKE TRUNCATE ON TABLE public\.service_orders FROM authenticated/);
    assert.doesNotMatch(migration, /GRANT TRUNCATE/i);
  });

  it("impede conclusão direta de ordem cancelada e confirmação duplicada", () => {
    assert.match(migration, /OLD\.status = 'Cancelado' AND NEW\.status = 'Concluido'/);
    assert.match(migration, /IF v_row\.status = 'Cancelado' THEN/);
    assert.match(migration, /Designação já respondida/);
    assert.match(migration, /Motorista já confirmado nesta ordem/);
  });

  it("bloqueia alteração direta da designação e preserva o fluxo oficial", () => {
    assert.match(migration, /current_user IN \('authenticated', 'anon'\)/);
    assert.match(migration, /driver_assignment_response IS DISTINCT FROM OLD\.driver_assignment_response/);
    assert.match(migration, /A designação do motorista só pode ser alterada pelo fluxo oficial/);
  });

  it("tira EXECUTE anônimo das funções internas e mantém o card público", () => {
    assert.match(migration, /REVOKE ALL ON FUNCTION public\._assert_service_order_member\(uuid\) FROM anon/);
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.send_driver_assignment\(uuid, uuid, numeric, numeric\) FROM anon/,
    );
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.seed_drivers\(uuid\) FROM authenticated/);
    assert.doesNotMatch(migration, /get_public_driver_assignment/);
    assert.doesNotMatch(migration, /REVOKE ALL ON FUNCTION public\.respond_to_driver_assignment/);
  });

  it("não abre acesso entre empresas nem altera a OS no arquivo", () => {
    assert.doesNotMatch(migration, /\bOS003\b/);
    assert.doesNotMatch(migration, /auth_user_company_ids/);
    assert.match(migration, /d\.company_id = v_row\.company_id/);
  });
});

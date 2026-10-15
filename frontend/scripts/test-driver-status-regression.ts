/**
 * Regressão do status do motorista na OS.
 * Cobre o formato da OS002 (seleção sem aceite) e as superfícies que
 * compartilham o mesmo contrato: listagem, formulário, acompanhamento e fechamento.
 * Não altera banco, RLS nem o registro OS002.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isCanonicalDriverConfirmed } from "../src/lib/driver-confirmed.ts";
import { DRIVER_ASSIGNMENT_RESPONSE_LABELS } from "../src/lib/service-order-driver-assignment.ts";
import {
  isDriverConfirmedOnServiceOrder,
  isFreightInExecution,
  resolveServiceOrderDisplayStatus,
  serviceOrderFormStatus,
} from "../src/lib/service-order-display-status.ts";

const CONFIRMED = DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted;
const PENDING_INVITE = DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending;
const REJECTED = DRIVER_ASSIGNMENT_RESPONSE_LABELS.rejected;

type Row = {
  status: string;
  proposal_sent_at: string | null;
  proposal_response: "pending" | "accepted" | "rejected";
  proposal_accepted_at: string | null;
  proposal_rejected_at: string | null;
  driver_id: string | null;
  proposed_driver_id: string | null;
  driver_assignment_sent_at: string | null;
  driver_assignment_response: "pending" | "accepted" | "rejected";
  driver_assignment_accepted_at: string | null;
  driver_assignment_rejected_at: string | null;
  driver_assignment_rejected_driver_ids: string[];
  legacy_number?: string | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    status: "Aberto",
    proposal_sent_at: null,
    proposal_response: "pending",
    proposal_accepted_at: null,
    proposal_rejected_at: null,
    driver_id: null,
    proposed_driver_id: null,
    driver_assignment_sent_at: null,
    driver_assignment_response: "pending",
    driver_assignment_accepted_at: null,
    driver_assignment_rejected_at: null,
    driver_assignment_rejected_driver_ids: [],
    ...overrides,
  };
}

/** Estado confirmado no banco para OS002 — não é aceite. */
const OS002 = row({
  driver_id: "driver-selecionado",
  proposed_driver_id: null,
  driver_assignment_response: "pending",
  driver_assignment_sent_at: null,
  driver_assignment_accepted_at: null,
  driver_assignment_rejected_at: null,
});

function assertNotConfirmed(current: Row) {
  assert.equal(isCanonicalDriverConfirmed(current), false);
  assert.equal(isDriverConfirmedOnServiceOrder(current), false);
  assert.notEqual(resolveServiceOrderDisplayStatus(current), CONFIRMED);
  assert.equal(isFreightInExecution(current), false);
  assert.notEqual(serviceOrderFormStatus(current.status), CONFIRMED);
}

describe("T01 OS aberta sem motorista", () => {
  it("permanece Aberto e sem confirmação", () => {
    const current = row();
    assertNotConfirmed(current);
    assert.equal(resolveServiceOrderDisplayStatus(current), "Aberto");
    assert.equal(serviceOrderFormStatus(current.status), "Aberto");
  });
});

describe("T02 OS aberta com motorista selecionado", () => {
  it("o formato da OS002 não vira Motorista confirmado", () => {
    assert.equal(OS002.status, "Aberto");
    assert.ok(OS002.driver_id);
    assert.equal(OS002.proposed_driver_id, null);
    assert.equal(OS002.driver_assignment_response, "pending");
    assert.equal(OS002.driver_assignment_sent_at, null);
    assert.equal(OS002.driver_assignment_accepted_at, null);
    assertNotConfirmed(OS002);
    assert.equal(resolveServiceOrderDisplayStatus(OS002), "Aberto");
    assert.equal(serviceOrderFormStatus(OS002.status), "Aberto");
  });

  it("seleção com proposta já aceita também não confirma", () => {
    const current = row({
      ...OS002,
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
    });
    assertNotConfirmed(current);
    assert.equal(resolveServiceOrderDisplayStatus(current), "Aguardando designação motorista");
  });
});

describe("T03 Motorista proposto sem aceite", () => {
  it("proposed_driver_id sem resposta accepted não confirma", () => {
    const current = row({
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
      proposed_driver_id: "driver-proposto",
      driver_id: null,
      driver_assignment_response: "pending",
      driver_assignment_sent_at: null,
    });
    assertNotConfirmed(current);
    assert.equal(resolveServiceOrderDisplayStatus(current), "Aguardando designação motorista");
  });
});

describe("T04 Convite enviado com resposta pending", () => {
  it("envio do convite não é aceite", () => {
    const current = row({
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
      proposed_driver_id: "driver-convidado",
      driver_id: null,
      driver_assignment_response: "pending",
      driver_assignment_sent_at: "2026-10-02T00:00:00Z",
    });
    assertNotConfirmed(current);
    assert.equal(resolveServiceOrderDisplayStatus(current), PENDING_INVITE);
  });
});

describe("T05 Confirmação efetiva do motorista", () => {
  it("somente driver_id com resposta accepted confirma", () => {
    const current = row({
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
      driver_id: "driver-aceito",
      proposed_driver_id: "driver-aceito",
      driver_assignment_response: "accepted",
      driver_assignment_sent_at: "2026-10-02T00:00:00Z",
      driver_assignment_accepted_at: "2026-10-03T00:00:00Z",
    });
    assert.equal(isCanonicalDriverConfirmed(current), true);
    assert.equal(isDriverConfirmedOnServiceOrder(current), true);
    assert.equal(resolveServiceOrderDisplayStatus(current), CONFIRMED);
    assert.equal(isFreightInExecution(current), true);
    assert.equal(serviceOrderFormStatus(current.status), "Aberto");
  });

  it("accepted sem driver_id não confirma", () => {
    const current = row({
      driver_id: null,
      driver_assignment_response: "accepted",
      driver_assignment_accepted_at: "2026-10-03T00:00:00Z",
    });
    assertNotConfirmed(current);
  });
});

describe("T06 Recusa do motorista", () => {
  it("recusa não confirma e preserva o rótulo de recusa", () => {
    const current = row({
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
      driver_id: null,
      proposed_driver_id: "driver-recusou",
      driver_assignment_response: "rejected",
      driver_assignment_sent_at: "2026-10-02T00:00:00Z",
      driver_assignment_rejected_at: "2026-10-03T00:00:00Z",
      driver_assignment_rejected_driver_ids: ["driver-recusou"],
    });
    assertNotConfirmed(current);
    assert.equal(resolveServiceOrderDisplayStatus(current), REJECTED);
  });
});

describe("T07 Nova indicação após recusa", () => {
  it("novo convite pending depois da recusa não herda confirmação", () => {
    const current = row({
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
      driver_id: null,
      proposed_driver_id: "driver-novo",
      driver_assignment_response: "pending",
      driver_assignment_sent_at: "2026-10-04T00:00:00Z",
      driver_assignment_rejected_at: "2026-10-03T00:00:00Z",
      driver_assignment_rejected_driver_ids: ["driver-recusou"],
    });
    assertNotConfirmed(current);
    assert.equal(resolveServiceOrderDisplayStatus(current), PENDING_INVITE);
  });
});

describe("T08 Troca de motorista confirmado", () => {
  it("trocar o motorista sem novo aceite derruba a confirmação", () => {
    const confirmed = row({
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
      driver_id: "driver-a",
      proposed_driver_id: "driver-a",
      driver_assignment_response: "accepted",
      driver_assignment_accepted_at: "2026-10-03T00:00:00Z",
    });
    assert.equal(resolveServiceOrderDisplayStatus(confirmed), CONFIRMED);

    const swapped = row({
      ...confirmed,
      driver_id: "driver-b",
      proposed_driver_id: "driver-b",
      driver_assignment_response: "pending",
      driver_assignment_sent_at: "2026-10-05T00:00:00Z",
      driver_assignment_accepted_at: null,
    });
    assertNotConfirmed(swapped);
    assert.equal(resolveServiceOrderDisplayStatus(swapped), PENDING_INVITE);
  });
});

describe("T09 OS concluída sem confirmação falsa", () => {
  it("conclusão não inventa Motorista confirmado", () => {
    const current = row({
      ...OS002,
      status: "Concluido",
    });
    assert.equal(isCanonicalDriverConfirmed(current), false);
    assert.equal(isDriverConfirmedOnServiceOrder(current), false);
    assert.equal(resolveServiceOrderDisplayStatus(current), "Concluido");
    assert.equal(serviceOrderFormStatus(current.status), "Concluido");
    assert.equal(isFreightInExecution(current), false);
  });
});

describe("T10 Compatibilidade com OS legadas", () => {
  it("legado importado só com driver_id não confirma", () => {
    const legacy = row({
      ...OS002,
      legacy_number: "COT-100",
    });
    assertNotConfirmed(legacy);
    assert.equal(resolveServiceOrderDisplayStatus(legacy), "Aberto");
  });

  it("legado que já gravou aceite canônico continua confirmado", () => {
    const legacy = row({
      legacy_number: "COT-200",
      proposal_response: "accepted",
      proposal_accepted_at: "2026-01-01T00:00:00Z",
      driver_id: "driver-legado",
      proposed_driver_id: "driver-legado",
      driver_assignment_response: "accepted",
      driver_assignment_accepted_at: "2026-01-02T00:00:00Z",
    });
    assert.equal(isCanonicalDriverConfirmed(legacy), true);
    assert.equal(resolveServiceOrderDisplayStatus(legacy), CONFIRMED);
    assert.equal(serviceOrderFormStatus(legacy.status), "Aberto");
  });
});

describe("T11 Consistência entre formulário e listagem", () => {
  it("formulário mostra o status da OS e a listagem não confirma a OS002", () => {
    assert.equal(serviceOrderFormStatus(OS002.status), OS002.status);
    assert.equal(serviceOrderFormStatus(OS002.status), "Aberto");
    assert.equal(resolveServiceOrderDisplayStatus(OS002), serviceOrderFormStatus(OS002.status));
    assert.notEqual(resolveServiceOrderDisplayStatus(OS002), CONFIRMED);
  });

  it("aceite efetivo muda só o rótulo da listagem", () => {
    const current = row({
      driver_id: "driver-aceito",
      proposed_driver_id: "driver-aceito",
      driver_assignment_response: "accepted",
      driver_assignment_accepted_at: "2026-10-03T00:00:00Z",
      proposal_response: "accepted",
      proposal_accepted_at: "2026-10-01T00:00:00Z",
    });
    assert.equal(serviceOrderFormStatus(current.status), "Aberto");
    assert.equal(resolveServiceOrderDisplayStatus(current), CONFIRMED);
    assert.notEqual(serviceOrderFormStatus(current.status), resolveServiceOrderDisplayStatus(current));
  });
});

describe("superfícies que compartilham o contrato", () => {
  it("a exceção legada de driver_id sem envio não volta ao código da listagem", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "../src/lib/service-order-display-status.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /!row\.driver_assignment_sent_at && !row\.proposed_driver_id\) return true/,
    );
    assert.match(source, /isCanonicalDriverConfirmed\(row\)/);
  });

  it("fechamento e pagamentos não tratam driver_id sozinho como aceite", () => {
    const closeSource = fs.readFileSync(
      path.join(import.meta.dirname, "../src/lib/pscs-one/core/closeServiceOrder.ts"),
      "utf8",
    );
    const paymentsSource = fs.readFileSync(
      path.join(import.meta.dirname, "../src/lib/driver-payments-api.ts"),
      "utf8",
    );
    assert.match(closeSource, /isCanonicalDriverConfirmed\(order\)/);
    assert.match(paymentsSource, /driver_assignment_response\.eq\.accepted/);
    assert.doesNotMatch(paymentsSource, /Motorista confirmado/);
  });
});

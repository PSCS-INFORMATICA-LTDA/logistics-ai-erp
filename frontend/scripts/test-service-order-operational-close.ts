import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  closeServiceOrderOperationally,
  OPERATIONAL_CLOSE_COLUMNS,
  type OperationalCloseOrder,
  type OperationalCloseStore,
  OperationalCloseAlreadyCompleted,
  OperationalCloseError,
} from "../src/lib/service-order-operational-close.ts";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const DRIVER_ID = "55555555-5555-4555-8555-555555555555";

function order(overrides: Partial<OperationalCloseOrder> = {}): OperationalCloseOrder {
  return {
    id: ORDER_ID,
    company_id: COMPANY_ID,
    status: "Aberto",
    driver_id: DRIVER_ID,
    driver_assignment_response: "accepted",
    service_completed_at: null,
    client_id: null,
    ...overrides,
  };
}

function memoryStore(initial: OperationalCloseOrder | null, member = true) {
  const calls = { complete: 0, receivables: 0 };
  let current = initial;
  const store: OperationalCloseStore = {
    async loadOrder() {
      return current;
    },
    async assertMembership() {
      return member;
    },
    async completeOrder() {
      calls.complete += 1;
      if (!current) throw new OperationalCloseError("not_found", "missing", 404);
      if (current.status === "Concluido") throw new OperationalCloseAlreadyCompleted();
      current = {
        ...current,
        status: "Concluido",
        service_completed_at: "2026-11-03T12:00:00.000Z",
      };
      return {
        status: "Concluido",
        service_completed_at: current.service_completed_at ?? null,
      };
    },
  };
  return { store, calls, read: () => current };
}

async function expectCode(
  run: Promise<unknown>,
  code: string,
  status: number,
) {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof OperationalCloseError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

describe("fechamento operacional local", () => {
  it("OS sem motorista não conclui", async () => {
    const { store, calls } = memoryStore(order({ driver_id: null, driver_assignment_response: "pending" }));
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "DRIVER_ASSIGNMENT_PENDING",
      409,
    );
    assert.equal(calls.complete, 0);
    assert.equal(calls.receivables, 0);
  });

  it("motorista pendente não conclui", async () => {
    const { store, calls } = memoryStore(
      order({ driver_assignment_response: "pending" }),
    );
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "DRIVER_ASSIGNMENT_PENDING",
      409,
    );
    assert.equal(calls.complete, 0);
  });

  it("motorista recusado não conclui", async () => {
    const { store, calls } = memoryStore(
      order({ driver_assignment_response: "rejected" }),
    );
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "DRIVER_ASSIGNMENT_REJECTED",
      409,
    );
    assert.equal(calls.complete, 0);
  });

  it("motorista aceito conclui sem client_id e sem recebível", async () => {
    const { store, calls, read } = memoryStore(order({ client_id: null }));
    const result = await closeServiceOrderOperationally({
      authUserId: USER_ID,
      serviceOrderId: ORDER_ID,
      store,
    });
    assert.equal(result.receivable_created, false);
    assert.equal(result.already_completed, false);
    assert.equal(result.order.status, "Concluido");
    assert.equal(read()?.status, "Concluido");
    assert.equal(calls.complete, 1);
    assert.equal(calls.receivables, 0);
  });

  it("OS já concluída é idempotente e não chama a RPC de novo", async () => {
    const { store, calls } = memoryStore(
      order({ status: "Concluido", service_completed_at: "2026-10-01T00:00:00.000Z" }),
    );
    const result = await closeServiceOrderOperationally({
      authUserId: USER_ID,
      serviceOrderId: ORDER_ID,
      store,
    });
    assert.equal(result.already_completed, true);
    assert.equal(result.receivable_created, false);
    assert.equal(calls.complete, 0);
  });

  it("chamada simultânea que perde a corrida relê a conclusão já gravada", async () => {
    let phase: "open" | "won" = "open";
    const calls = { complete: 0, receivables: 0 };
    const store: OperationalCloseStore = {
      async loadOrder() {
        if (phase === "open") return order({ service_completed_at: null });
        return order({
          status: "Concluido",
          service_completed_at: "2026-11-03T15:04:00.000Z",
        });
      },
      async assertMembership() {
        return true;
      },
      async completeOrder() {
        calls.complete += 1;
        phase = "won";
        throw new OperationalCloseAlreadyCompleted();
      },
    };
    const result = await closeServiceOrderOperationally({
      authUserId: USER_ID,
      serviceOrderId: ORDER_ID,
      store,
    });
    assert.equal(result.already_completed, true);
    assert.equal(result.receivable_created, false);
    assert.equal(result.order.status, "Concluido");
    assert.equal(result.order.service_completed_at, "2026-11-03T15:04:00.000Z");
    assert.equal(calls.complete, 1);
    assert.equal(calls.receivables, 0);
  });

  it("fechamento repetido não cria segunda conclusão nem recebível", async () => {
    const { store, calls } = memoryStore(order());
    const first = await closeServiceOrderOperationally({
      authUserId: USER_ID,
      serviceOrderId: ORDER_ID,
      store,
    });
    const second = await closeServiceOrderOperationally({
      authUserId: USER_ID,
      serviceOrderId: ORDER_ID,
      store,
    });
    assert.equal(first.receivable_created, false);
    assert.equal(second.already_completed, true);
    assert.equal(second.receivable_created, false);
    assert.equal(calls.complete, 1);
    assert.equal(calls.receivables, 0);
  });

  it("usuário sem autenticação não conclui", async () => {
    const { store, calls } = memoryStore(order());
    await expectCode(
      closeServiceOrderOperationally({ authUserId: "", serviceOrderId: ORDER_ID, store }),
      "unauthenticated",
      401,
    );
    assert.equal(calls.complete, 0);
  });

  it("usuário sem permissão na empresa não conclui", async () => {
    const { store, calls } = memoryStore(order(), false);
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "forbidden",
      403,
    );
    assert.equal(calls.complete, 0);
  });

  it("empresa diferente não devolve a OS e não conclui", async () => {
    const { store, calls } = memoryStore(null, true);
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "not_found",
      404,
    );
    assert.equal(calls.complete, 0);
  });

  it("OS cancelada não conclui", async () => {
    const { store, calls } = memoryStore(order({ status: "Cancelado" }));
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "SERVICE_ORDER_NOT_CLOSABLE",
      409,
    );
    assert.equal(calls.complete, 0);
  });

  it("accepted sem driver_id não confirma", async () => {
    const { store, calls } = memoryStore(
      order({ driver_id: null, driver_assignment_response: "accepted" }),
    );
    await expectCode(
      closeServiceOrderOperationally({ authUserId: USER_ID, serviceOrderId: ORDER_ID, store }),
      "DRIVER_ASSIGNMENT_PENDING",
      409,
    );
    assert.equal(calls.complete, 0);
  });
});

describe("o fechamento operacional não fala com o Core", () => {
  it("a rota e o módulo local não criam recebível nem exigem sessão Core", () => {
    const root = path.join(import.meta.dirname, "..", "src");
    const route = fs.readFileSync(
      path.join(root, "app/api/service-orders/[id]/close/route.ts"),
      "utf8",
    );
    const local = fs.readFileSync(
      path.join(root, "lib/service-order-operational-close.ts"),
      "utf8",
    );
    const button = fs.readFileSync(
      path.join(root, "components/operacional/ServiceOrderRowActions.tsx"),
      "utf8",
    );
    for (const source of [route, local]) {
      assert.equal(source.includes("requireCoreArSession"), false);
      assert.equal(source.includes("createReceivable"), false);
      assert.equal(source.includes("closeServiceOrderWithCoreReceivable"), false);
      assert.equal(source.includes("pscs-one/core"), false);
    }
    assert.equal(route.includes("complete_service_order") || local.includes("complete_service_order"), true);
    assert.equal(local.includes(OPERATIONAL_CLOSE_COLUMNS), true);
    assert.equal(OPERATIONAL_CLOSE_COLUMNS.includes("client_id"), false);
    assert.equal(button.includes("supabase.rpc"), false);
    assert.equal(button.includes("completeServiceOrder("), false);
    assert.equal(button.includes("/api/service-orders/"), true);
    assert.equal(button.includes("recebível do cliente"), false);
  });

  it("a leitura de recebível e o orquestrador Core permanecem no repositório", () => {
    const root = path.join(import.meta.dirname, "..", "src");
    const core = fs.readFileSync(
      path.join(root, "lib/pscs-one/core/closeServiceOrder.ts"),
      "utf8",
    );
    const readRoute = fs.readFileSync(
      path.join(root, "app/api/service-orders/[id]/receivable/route.ts"),
      "utf8",
    );
    assert.equal(core.includes("createReceivable"), true);
    assert.equal(readRoute.includes("readServiceOrderReceivable"), true);
  });
});

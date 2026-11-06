import type { SupabaseClient } from "@supabase/supabase-js";
import { isCanonicalDriverConfirmed } from "@/lib/driver-confirmed";

/**
 * Fechamento operacional da OS no Logistics.
 * A conclusão grava status pela RPC já existente `complete_service_order`,
 * com a sessão do usuário (RLS + _assert_service_order_member).
 * Não abre sessão no PSCS One e não cria recebível.
 *
 * Grants: a rota não cria função nem GRANT. Quem chama a RPC é o servidor,
 * com o cookie do usuário. O browser não recebe uma RPC nova.
 * A migration 081, já no DEV, tira EXECUTE de anon. Este arquivo não aplica SQL.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const OPERATIONAL_CLOSE_COLUMNS =
  "id, company_id, status, driver_id, driver_assignment_response, service_completed_at";

export const OPERATIONAL_CLOSE_SUCCESS = "OS concluída.";
export const OPERATIONAL_CLOSE_REPLAY = "OS já estava concluída.";

export class OperationalCloseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OperationalCloseError";
    this.code = code;
    this.status = status;
  }
}

export class OperationalCloseAlreadyCompleted extends Error {
  constructor() {
    super("Ordem de serviço já concluída");
    this.name = "OperationalCloseAlreadyCompleted";
  }
}

export type OperationalCloseOrder = {
  id: string;
  company_id: string;
  status: string | null;
  driver_id: string | null;
  driver_assignment_response: string | null;
  service_completed_at?: string | null;
  client_id?: string | null;
};

export type OperationalCloseStore = {
  loadOrder(serviceOrderId: string): Promise<OperationalCloseOrder | null>;
  assertMembership(authUserId: string, companyId: string): Promise<boolean>;
  completeOrder(
    serviceOrderId: string,
  ): Promise<{ status: string; service_completed_at: string | null }>;
};

export type OperationalCloseResult = {
  order: {
    id: string;
    status: string;
    service_completed_at: string | null;
  };
  already_completed: boolean;
  receivable_created: false;
  message: string;
};

function fail(code: string, message: string, status: number): never {
  throw new OperationalCloseError(code, message, status);
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function closeServiceOrderOperationally(input: {
  authUserId: string;
  serviceOrderId: string;
  store: OperationalCloseStore;
}): Promise<OperationalCloseResult> {
  if (!input.authUserId) {
    fail("unauthenticated", "Authentication required.", 401);
  }
  if (!isUuid(input.serviceOrderId)) {
    fail("not_found", "Ordem de serviço não encontrada.", 404);
  }

  const order = await input.store.loadOrder(input.serviceOrderId);
  if (!order) {
    fail("not_found", "Ordem de serviço não encontrada.", 404);
  }

  const member = await input.store.assertMembership(input.authUserId, order.company_id);
  if (!member) {
    fail("forbidden", "Você não pertence a esta empresa.", 403);
  }

  if (order.status === "Cancelado") {
    fail("SERVICE_ORDER_NOT_CLOSABLE", "Ordem de serviço cancelada. A OS não foi concluída.", 409);
  }

  if (order.status === "Concluido") {
    return {
      order: {
        id: order.id,
        status: "Concluido",
        service_completed_at: order.service_completed_at ?? null,
      },
      already_completed: true,
      receivable_created: false,
      message: OPERATIONAL_CLOSE_REPLAY,
    };
  }

  if (order.driver_assignment_response === "rejected") {
    fail(
      "DRIVER_ASSIGNMENT_REJECTED",
      "Motorista recusou a designação. A OS não foi concluída.",
      409,
    );
  }

  if (!isCanonicalDriverConfirmed(order)) {
    fail(
      "DRIVER_ASSIGNMENT_PENDING",
      "Motorista ainda não confirmou a designação. A OS não foi concluída.",
      409,
    );
  }

  try {
    const completed = await input.store.completeOrder(order.id);
    return {
      order: {
        id: order.id,
        status: completed.status || "Concluido",
        service_completed_at: completed.service_completed_at,
      },
      already_completed: false,
      receivable_created: false,
      message: OPERATIONAL_CLOSE_SUCCESS,
    };
  } catch (error) {
    if (error instanceof OperationalCloseAlreadyCompleted) {
      const fresh = await input.store.loadOrder(order.id);
      return {
        order: {
          id: order.id,
          status: "Concluido",
          service_completed_at: fresh?.service_completed_at ?? order.service_completed_at ?? null,
        },
        already_completed: true,
        receivable_created: false,
        message: OPERATIONAL_CLOSE_REPLAY,
      };
    }
    if (error instanceof OperationalCloseError) throw error;
    fail("LOCAL_CLOSE_FAILED", "Não foi possível concluir a OS. Tente novamente.", 503);
  }
}

export function createSupabaseOperationalCloseStore(
  supabase: SupabaseClient,
): OperationalCloseStore {
  return {
    async loadOrder(serviceOrderId) {
      const { data, error } = await supabase
        .from("service_orders")
        .select(OPERATIONAL_CLOSE_COLUMNS)
        .eq("id", serviceOrderId)
        .maybeSingle();
      if (error) {
        throw new OperationalCloseError(
          "unavailable",
          "Não foi possível carregar a ordem de serviço.",
          502,
        );
      }
      return (data as OperationalCloseOrder | null) ?? null;
    },
    async assertMembership(authUserId, companyId) {
      const { data, error } = await supabase
        .from("company_members")
        .select("id")
        .eq("user_id", authUserId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) {
        throw new OperationalCloseError(
          "unavailable",
          "Não foi possível verificar o acesso à empresa.",
          502,
        );
      }
      return Boolean(data);
    },
    async completeOrder(serviceOrderId) {
      const { data, error } = await supabase.rpc("complete_service_order", {
        p_order_id: serviceOrderId,
      });
      if (error) {
        const message = error.message ?? "";
        if (/já concluída/i.test(message)) throw new OperationalCloseAlreadyCompleted();
        if (/não encontrada/i.test(message)) {
          throw new OperationalCloseError("not_found", "Ordem de serviço não encontrada.", 404);
        }
        if (/motorista/i.test(message)) {
          throw new OperationalCloseError("DRIVER_ASSIGNMENT_PENDING", message, 409);
        }
        throw new OperationalCloseError("LOCAL_CLOSE_FAILED", message, 503);
      }
      const payload = data as { status?: string; service_completed_at?: string } | null;
      return {
        status: payload?.status ?? "Concluido",
        service_completed_at: payload?.service_completed_at ?? null,
      };
    },
  };
}

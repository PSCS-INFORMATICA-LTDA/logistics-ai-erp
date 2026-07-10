import { PROPOSAL_RESPONSE_LABELS, type DriverAssignmentResponse, type ServiceOrder } from "@/types/database";
import { DRIVER_ASSIGNMENT_RESPONSE_LABELS } from "@/lib/service-order-driver-assignment";

export type ServiceOrderStatusRow = Pick<
  ServiceOrder,
  | "status"
  | "proposal_sent_at"
  | "proposal_response"
  | "proposal_accepted_at"
  | "proposal_rejected_at"
  | "driver_id"
  | "proposed_driver_id"
  | "driver_assignment_sent_at"
  | "driver_assignment_response"
  | "driver_assignment_rejected_driver_ids"
>;

function isProposalRejectedByClient(row: ServiceOrderStatusRow): boolean {
  return (
    (row.proposal_response ?? "pending") === "rejected" ||
    Boolean(row.proposal_rejected_at)
  );
}

export function isProposalAcceptedByClient(row: ServiceOrderStatusRow): boolean {
  return (
    (row.proposal_response ?? "pending") === "accepted" ||
    Boolean(row.proposal_accepted_at)
  );
}

/** Motorista confirmado na OS (aceitou a designação). */
export function isDriverConfirmedOnServiceOrder(row: ServiceOrderStatusRow): boolean {
  return (
    Boolean(row.driver_id) &&
    (row.driver_assignment_response ?? "pending") === "accepted"
  );
}

export function isServiceOrderCompleted(row: ServiceOrderStatusRow): boolean {
  return row.status === "Concluido";
}

/** Cliente aceitou e a OS ainda precisa de motorista confirmado. */
export function needsDriverAssignment(row: ServiceOrderStatusRow): boolean {
  return isProposalAcceptedByClient(row) && !isDriverConfirmedOnServiceOrder(row);
}

/** Frete em execução ou conclusão pendente. */
export function isFreightInExecution(row: ServiceOrderStatusRow): boolean {
  return isDriverConfirmedOnServiceOrder(row) && !isServiceOrderCompleted(row);
}

/** ID do motorista designado (confirmado ou aguardando aceite). */
export function resolveDesignatedDriverId(
  row: Pick<ServiceOrder, "driver_id" | "proposed_driver_id">
): string | null {
  return row.driver_id ?? row.proposed_driver_id ?? null;
}

/** Voucher operacional — após designar motorista (enviar ao motorista) ou frete concluído. */
export function canViewDriverVoucher(
  row: ServiceOrderStatusRow & { driver_assignment_pay_amount?: number | null }
): boolean {
  const designatedDriverId = resolveDesignatedDriverId(row);

  if (designatedDriverId && isProposalAcceptedByClient(row)) {
    return true;
  }

  if (isServiceOrderCompleted(row)) {
    if (designatedDriverId) return true;
    if (row.driver_assignment_pay_amount != null && row.driver_assignment_pay_amount > 0) {
      return true;
    }
  }

  return false;
}

export function isDriverAssignmentPendingAcceptance(row: ServiceOrderStatusRow): boolean {
  return (
    Boolean(resolveDesignatedDriverId(row)) &&
    !isDriverConfirmedOnServiceOrder(row) &&
    (row.driver_assignment_response ?? "pending") === "pending"
  );
}

export function canAssignDriverToServiceOrder(
  row: ServiceOrderStatusRow
): boolean {
  if (!needsDriverAssignment(row)) return false;
  if (isPendingDriverAssignment(row)) return false;
  return true;
}

/** Status operacional único — evita conflito entre colunas Proposta e Status. */
export function resolveServiceOrderDisplayStatus(row: ServiceOrderStatusRow): string {
  const response = row.proposal_response ?? "pending";

  if (isProposalAcceptedByClient(row)) {
    const assignment = (row.driver_assignment_response ?? "pending") as DriverAssignmentResponse;
    if (assignment === "rejected") {
      return DRIVER_ASSIGNMENT_RESPONSE_LABELS.rejected;
    }
    if (isServiceOrderCompleted(row)) {
      return "Concluido";
    }
    if (isDriverConfirmedOnServiceOrder(row)) {
      return DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted;
    }
    if (isPendingDriverAssignment(row)) {
      return DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending;
    }
    if (needsDriverAssignment(row)) {
      return "Aguardando designação motorista";
    }
    return PROPOSAL_RESPONSE_LABELS.accepted;
  }

  if (row.proposal_sent_at) {
    if (isProposalRejectedByClient(row)) {
      return PROPOSAL_RESPONSE_LABELS.rejected;
    }
    if (response === "pending") {
      return "Aguardando aprovação cliente";
    }
  }

  return row.status;
}

export function serviceOrderStatusVariant(
  row: ServiceOrderStatusRow
): "success" | "warning" | "default" | "danger" {
  const label = resolveServiceOrderDisplayStatus(row);
  if (label === DRIVER_ASSIGNMENT_RESPONSE_LABELS.rejected) return "danger";
  if (label === PROPOSAL_RESPONSE_LABELS.rejected) return "danger";
  if (label === "Concluido" || label === PROPOSAL_RESPONSE_LABELS.accepted) return "success";
  if (
    label === "Aberto" ||
    label === "Aguardando aprovação cliente" ||
    label === "Aguardando designação motorista" ||
    label === DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending
  ) {
    return "warning";
  }
  if (label === DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted) return "success";
  return "default";
}

export function isPendingClientProposal(row: ServiceOrderStatusRow): boolean {
  return (
    Boolean(row.proposal_sent_at) &&
    (row.proposal_response ?? "pending") === "pending"
  );
}

/** Designação enviada ao motorista, aguardando aceite/recusa (telefone ou link). */
export function isPendingDriverAssignment(row: ServiceOrderStatusRow): boolean {
  return (
    isProposalAcceptedByClient(row) &&
    (row.driver_assignment_response ?? "pending") === "pending" &&
    Boolean(row.proposed_driver_id) &&
    Boolean(row.driver_assignment_sent_at)
  );
}

/** Motorista recusou a designação — Rafael pode designar outro. */
export function isDriverAssignmentRejected(row: ServiceOrderStatusRow): boolean {
  return (
    isProposalAcceptedByClient(row) &&
    (row.driver_assignment_response ?? "pending") === "rejected"
  );
}

export function resolveServiceOrderDriverColumnLabel(
  row: ServiceOrderStatusRow & { driver_name?: string | null }
): string {
  const assignment = (row.driver_assignment_response ?? "pending") as DriverAssignmentResponse;

  if (isDriverConfirmedOnServiceOrder(row) && row.driver_name) {
    return row.driver_name;
  }

  if (isPendingDriverAssignment(row) && row.driver_name) {
    return `${row.driver_name} (aguardando)`;
  }

  if (assignment === "rejected" && row.driver_name) {
    return `${row.driver_name} (recusou)`;
  }

  if (needsDriverAssignment(row)) {
    return "A designar";
  }

  return row.driver_name ?? "—";
}

export function canEditServiceOrder(row: ServiceOrderStatusRow): boolean {
  const label = resolveServiceOrderDisplayStatus(row);
  return (
    label !== PROPOSAL_RESPONSE_LABELS.accepted &&
    label !== PROPOSAL_RESPONSE_LABELS.rejected &&
    label !== "Aguardando designação motorista" &&
    label !== DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending &&
    label !== DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted &&
    label !== DRIVER_ASSIGNMENT_RESPONSE_LABELS.rejected &&
    label !== "Concluido"
  );
}

export function serviceOrderEditBlockedReason(row: ServiceOrderStatusRow): string | null {
  if (canEditServiceOrder(row)) return null;

  const label = resolveServiceOrderDisplayStatus(row);
  return `Edição indisponível com status «${label}». Use «Reabrir proposta» para alterar.`;
}

/** Impede exclusão após proposta enviada ou fluxo operacional iniciado — preserva histórico. */
export function canDeleteServiceOrder(row: ServiceOrderStatusRow): boolean {
  if (isServiceOrderCompleted(row)) return false;
  if (isDriverConfirmedOnServiceOrder(row)) return false;
  if (isPendingDriverAssignment(row)) return false;
  if (isProposalAcceptedByClient(row)) return false;
  if (row.proposal_sent_at) return false;
  return true;
}

export function serviceOrderDeleteBlockedReason(row: ServiceOrderStatusRow): string | null {
  if (canDeleteServiceOrder(row)) return null;

  if (isServiceOrderCompleted(row)) {
    return "OS concluída — exclusão bloqueada para preservar o histórico operacional e financeiro.";
  }

  const label = resolveServiceOrderDisplayStatus(row);
  return `Exclusão indisponível com status «${label}». O registro faz parte do histórico da operação.`;
}

export function matchesServiceOrderStatusFilter(
  row: ServiceOrderStatusRow,
  filterStatus: string
): boolean {
  if (!filterStatus) return true;
  return resolveServiceOrderDisplayStatus(row) === filterStatus;
}

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

/**
 * Motorista confirmado na OS.
 * - Fluxo normal: aceitou a designação (`driver_assignment_response = accepted`).
 * - Import/legado: já veio com `driver_id` sem WhatsApp/designação pendente.
 */
export function isDriverConfirmedOnServiceOrder(row: ServiceOrderStatusRow): boolean {
  if (!row.driver_id) return false;
  const assignment = (row.driver_assignment_response ?? "pending") as DriverAssignmentResponse;
  if (assignment === "accepted") return true;
  if (assignment === "rejected") return false;
  // Designação formal enviada e ainda aguardando aceite do motorista
  if (row.driver_assignment_sent_at && row.proposed_driver_id) return false;
  // Import / cadastro legado: motorista já vinculado, sem fluxo de designação
  if (!row.driver_assignment_sent_at && !row.proposed_driver_id) return true;
  return false;
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

/** Voucher operacional — designação enviada ao motorista ou frete concluído. */
export function canViewDriverVoucher(
  row: ServiceOrderStatusRow & { driver_assignment_pay_amount?: number | null }
): boolean {
  if (isServiceOrderCompleted(row)) return true;

  const designatedDriverId = resolveDesignatedDriverId(row);
  if (designatedDriverId && isProposalAcceptedByClient(row)) return true;

  if (isPendingDriverAssignment(row)) return true;
  if (isFreightInExecution(row)) return true;
  if (isDriverConfirmedOnServiceOrder(row)) return true;

  if (row.driver_assignment_sent_at && designatedDriverId) return true;

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

  if (isServiceOrderCompleted(row)) {
    return "Concluido";
  }

  // Import/legado com motorista já na OS: libera a mesma fase de «Motorista confirmado»
  if (isDriverConfirmedOnServiceOrder(row)) {
    return DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted;
  }

  if (isProposalAcceptedByClient(row)) {
    const assignment = (row.driver_assignment_response ?? "pending") as DriverAssignmentResponse;
    if (assignment === "rejected") {
      return DRIVER_ASSIGNMENT_RESPONSE_LABELS.rejected;
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
  if (label === DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted) {
    return `Consulta — status «${label}». Use as ações da OS (acompanhamento / concluir frete). A ficha não edita neste status.`;
  }
  if (label === "Concluido") {
    return `Consulta — OS concluída. Use Voucher / Pagamento DRE nas ações.`;
  }
  if (
    label === DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending ||
    label === "Aguardando designação motorista"
  ) {
    return `Consulta — status «${label}». Use as ações de designação do motorista na lista.`;
  }
  if (
    label === PROPOSAL_RESPONSE_LABELS.accepted ||
    label === PROPOSAL_RESPONSE_LABELS.rejected
  ) {
    return `Consulta — status «${label}». Use «Reabrir proposta» nas ações se precisar alterar.`;
  }
  return `Consulta — status «${label}». Edição da ficha indisponível; use as ações da OS.`;
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

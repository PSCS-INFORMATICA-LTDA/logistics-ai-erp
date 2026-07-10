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

/** Cliente aceitou e a OS ainda precisa de motorista confirmado. */
export function needsDriverAssignment(row: ServiceOrderStatusRow): boolean {
  return isProposalAcceptedByClient(row) && !isDriverConfirmedOnServiceOrder(row);
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

/** Bloqueia edição enquanto o cliente já aceitou ou recusou a proposta enviada. */
export function canEditServiceOrder(row: ServiceOrderStatusRow): boolean {
  const label = resolveServiceOrderDisplayStatus(row);
  return (
    label !== PROPOSAL_RESPONSE_LABELS.accepted &&
    label !== PROPOSAL_RESPONSE_LABELS.rejected &&
    label !== "Aguardando designação motorista" &&
    label !== DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending &&
    label !== DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted &&
    label !== DRIVER_ASSIGNMENT_RESPONSE_LABELS.rejected
  );
}

export function serviceOrderEditBlockedReason(row: ServiceOrderStatusRow): string | null {
  if (canEditServiceOrder(row)) return null;

  const label = resolveServiceOrderDisplayStatus(row);
  return `Edição indisponível com status «${label}». Use «Reabrir proposta» para alterar.`;
}

export function matchesServiceOrderStatusFilter(
  row: ServiceOrderStatusRow,
  filterStatus: string
): boolean {
  if (!filterStatus) return true;
  return resolveServiceOrderDisplayStatus(row) === filterStatus;
}

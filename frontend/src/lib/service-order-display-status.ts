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

export function canAssignDriverToServiceOrder(
  row: ServiceOrderStatusRow
): boolean {
  if (!isProposalAcceptedByClient(row)) return false;
  if (row.driver_id) return false;
  if (
    row.driver_assignment_response === "pending" &&
    row.proposed_driver_id &&
    row.driver_assignment_sent_at
  ) {
    return false;
  }
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
    if (assignment === "accepted" && row.driver_id) {
      return DRIVER_ASSIGNMENT_RESPONSE_LABELS.accepted;
    }
    if (
      assignment === "pending" &&
      row.proposed_driver_id &&
      row.driver_assignment_sent_at
    ) {
      return DRIVER_ASSIGNMENT_RESPONSE_LABELS.pending;
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
): "success" | "warning" | "default" {
  const label = resolveServiceOrderDisplayStatus(row);
  if (label === "Concluido" || label === PROPOSAL_RESPONSE_LABELS.accepted) return "success";
  if (label === "Aberto" || label === "Aguardando aprovação cliente") return "warning";
  if (label === PROPOSAL_RESPONSE_LABELS.rejected) return "default";
  return "default";
}

export function isPendingClientProposal(row: ServiceOrderStatusRow): boolean {
  return (
    Boolean(row.proposal_sent_at) &&
    (row.proposal_response ?? "pending") === "pending"
  );
}

/** Bloqueia edição enquanto o cliente já aceitou ou recusou a proposta enviada. */
export function canEditServiceOrder(row: ServiceOrderStatusRow): boolean {
  const label = resolveServiceOrderDisplayStatus(row);
  return (
    label !== PROPOSAL_RESPONSE_LABELS.accepted &&
    label !== PROPOSAL_RESPONSE_LABELS.rejected
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

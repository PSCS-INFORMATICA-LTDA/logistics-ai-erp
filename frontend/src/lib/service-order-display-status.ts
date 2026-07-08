import { PROPOSAL_RESPONSE_LABELS, type ServiceOrder } from "@/types/database";

export type ServiceOrderStatusRow = Pick<
  ServiceOrder,
  "status" | "proposal_sent_at" | "proposal_response" | "proposal_accepted_at"
>;

function isProposalAcceptedByClient(row: ServiceOrderStatusRow): boolean {
  return (
    (row.proposal_response ?? "pending") === "accepted" ||
    Boolean(row.proposal_accepted_at)
  );
}

/** Status operacional único — evita conflito entre colunas Proposta e Status. */
export function resolveServiceOrderDisplayStatus(row: ServiceOrderStatusRow): string {
  const response = row.proposal_response ?? "pending";

  if (isProposalAcceptedByClient(row)) {
    return PROPOSAL_RESPONSE_LABELS.accepted;
  }

  if (row.proposal_sent_at) {
    if (response === "rejected") {
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
  if (!row.proposal_sent_at) return true;

  const response = row.proposal_response ?? "pending";
  if (response === "pending") return true;

  return false;
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

import { PROPOSAL_RESPONSE_LABELS, type ServiceOrder } from "@/types/database";

export type ServiceOrderStatusRow = Pick<
  ServiceOrder,
  "status" | "proposal_sent_at" | "proposal_response"
>;

/** Status operacional único — evita conflito entre colunas Proposta e Status. */
export function resolveServiceOrderDisplayStatus(row: ServiceOrderStatusRow): string {
  const response = row.proposal_response ?? "pending";

  if (response === "accepted") {
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

export function matchesServiceOrderStatusFilter(
  row: ServiceOrderStatusRow,
  filterStatus: string
): boolean {
  if (!filterStatus) return true;
  return resolveServiceOrderDisplayStatus(row) === filterStatus;
}

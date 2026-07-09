import { formatServiceCategories } from "@/lib/service-order-categories";
import {
  isPendingClientProposal,
  matchesServiceOrderStatusFilter,
} from "@/lib/service-order-display-status";
import type { ServiceOrder } from "@/types/database";
import { SERVICE_ORDER_TYPE_LABELS } from "@/types/database";

export type ServiceOrderListRow = ServiceOrder & {
  driver_name?: string;
  proposed_driver_code?: string;
  dre_account_name?: string;
};

export function isPendingProposalRow(row: ServiceOrderListRow): boolean {
  return isPendingClientProposal(row);
}

export function normalizeServiceOrderSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

function serviceOrderSearchHaystack(row: ServiceOrderListRow): string {
  const typeLabel = SERVICE_ORDER_TYPE_LABELS[row.service_type] ?? row.service_type;
  const nature = row.service_categories?.length
    ? formatServiceCategories(row.service_categories)
    : row.service_name;

  return [
    row.code,
    row.plate,
    row.client_name,
    row.driver_name,
    row.phone,
    row.notes,
    typeLabel,
    nature,
    row.freight_origin_address,
    row.freight_destination_address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesServiceOrderFilters(
  row: ServiceOrderListRow,
  filters: {
    search: string;
    status: string;
    serviceType: string;
    pendingProposals?: boolean;
  }
): boolean {
  if (filters.pendingProposals && !isPendingProposalRow(row)) return false;
  if (!matchesServiceOrderStatusFilter(row, filters.status)) return false;
  if (filters.serviceType && row.service_type !== filters.serviceType) return false;

  const term = normalizeServiceOrderSearchTerm(filters.search);
  if (!term) return true;

  return serviceOrderSearchHaystack(row).includes(term);
}

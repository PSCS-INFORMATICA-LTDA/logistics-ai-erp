import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSnapshot,
  resolveDashboardRange,
  type DashboardDateRange,
  type DashboardFilters,
  type DashboardPeriodKey,
  type DashboardSnapshot,
  type FtRow,
  type OwnershipRow,
} from "@/lib/dashboard-metrics";
import { fromDbPercent, getOwnershipDbSchema } from "@/lib/vehicle-ownership-db";

const PAGE_SIZE = 1000;

async function fetchAllFinancialRows(
  supabase: SupabaseClient,
  companyId: string,
  from: string,
  to: string
): Promise<{ rows: FtRow[]; error: string | null }> {
  const rows: FtRow[] = [];
  let offset = 0;

  for (;;) {
    let { data, error } = await supabase
      .from("financial_transactions")
      .select(
        "id, transaction_date, amount, transaction_type, classification, description, entry_source, allocation_vehicle_id, chart_of_account_id, chart_of_accounts ( name )"
      )
      .eq("company_id", companyId)
      .eq("approval_status", "approved")
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (
      error?.message?.toLowerCase().includes("approval_status") &&
      (error.message.toLowerCase().includes("does not exist") ||
        error.message.toLowerCase().includes("não existe"))
    ) {
      const retry = await supabase
        .from("financial_transactions")
        .select(
          "id, transaction_date, amount, transaction_type, classification, description, entry_source, allocation_vehicle_id, chart_of_account_id, chart_of_accounts ( name )"
        )
        .eq("company_id", companyId)
        .gte("transaction_date", from)
        .lte("transaction_date", to)
        .order("transaction_date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      data = retry.data;
      error = retry.error;
    }

    if (error) return { rows: [], error: error.message };

    const batch = ((data as unknown[]) ?? []).map((raw) => {
      const r = raw as Record<string, unknown>;
      const account = r.chart_of_accounts as { name?: string } | null;
      return {
        id: String(r.id),
        transaction_date: String(r.transaction_date),
        amount: Number(r.amount),
        transaction_type: String(r.transaction_type),
        classification: (r.classification as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        entry_source: (r.entry_source as string | null) ?? null,
        allocation_vehicle_id: (r.allocation_vehicle_id as string | null) ?? null,
        chart_of_account_id: String(r.chart_of_account_id),
        account_name: account?.name ?? null,
      } satisfies FtRow;
    });

    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { rows, error: null };
}

export async function fetchDashboardSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  periodKey: DashboardPeriodKey,
  filters?: DashboardFilters,
  customRange?: Partial<DashboardDateRange> | null
): Promise<{ snapshot: DashboardSnapshot | null; error: string | null }> {
  const { from, to } = resolveDashboardRange(periodKey, customRange);

  const schema = await getOwnershipDbSchema(supabase);

  const [ftRes, ownRes] = await Promise.all([
    fetchAllFinancialRows(supabase, companyId, from, to),
    supabase
      .from("vehicle_ownership")
      .select(
        "vehicle_id, partner_id, ownership_percentage, vehicles ( plate ), partners ( name )"
      )
      .eq("company_id", companyId)
      .eq("status", "Ativo"),
  ]);

  if (ftRes.error) return { snapshot: null, error: ftRes.error };
  if (ownRes.error) return { snapshot: null, error: ownRes.error.message };

  const ownership: OwnershipRow[] = ((ownRes.data as unknown[]) ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const vehicle = r.vehicles as { plate?: string } | null;
    const partner = r.partners as { name?: string } | null;
    return {
      vehicle_id: String(r.vehicle_id),
      partner_id: String(r.partner_id),
      partner_name: partner?.name ?? "Sócio",
      plate: vehicle?.plate ?? "—",
      ownership_percentage: fromDbPercent(Number(r.ownership_percentage), schema),
    };
  });

  return {
    snapshot: buildSnapshot({
      periodKey,
      from,
      to,
      rows: ftRes.rows,
      ownership,
      filters,
    }),
    error: null,
  };
}

export async function seedDashboardDemo(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { error } = await supabase.rpc("seed_dashboard_demo", {
    p_company_id: companyId,
  });
  return error?.message ?? null;
}

export async function resetDashboardDemo(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ deleted: number; error: string | null }> {
  const { data, error } = await supabase.rpc("reset_dashboard_demo_financial", {
    p_company_id: companyId,
  });
  if (error) return { deleted: 0, error: error.message };
  return { deleted: Number(data ?? 0), error: null };
}

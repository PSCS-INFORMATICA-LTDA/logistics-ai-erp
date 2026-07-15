import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSnapshot,
  DASHBOARD_DEMO_ENTRY_SOURCE,
  DASHBOARD_DEMO_PREFIX,
  periodRange,
  type DashboardPeriodKey,
  type DashboardSnapshot,
  type FtRow,
} from "@/lib/dashboard-metrics";

export async function fetchDashboardSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  periodKey: DashboardPeriodKey
): Promise<{ snapshot: DashboardSnapshot | null; error: string | null }> {
  const { from, to } = periodRange(periodKey);

  const [ftRes, ownRes] = await Promise.all([
    supabase
      .from("financial_transactions")
      .select(
        "id, transaction_date, amount, transaction_type, classification, description, entry_source, allocation_vehicle_id, chart_of_account_id, chart_of_accounts ( name )"
      )
      .eq("company_id", companyId)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date", { ascending: true }),
    supabase
      .from("vehicle_ownership")
      .select(
        "vehicle_id, partner_id, ownership_percentage, vehicles ( plate ), partners ( name )"
      )
      .eq("company_id", companyId)
      .eq("status", "Ativo"),
  ]);

  if (ftRes.error) return { snapshot: null, error: ftRes.error.message };
  if (ownRes.error) return { snapshot: null, error: ownRes.error.message };

  const rows: FtRow[] = ((ftRes.data as unknown[]) ?? []).map((raw) => {
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
    };
  });

  const ownership = ((ownRes.data as unknown[]) ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const vehicle = r.vehicles as { plate?: string } | null;
    const partner = r.partners as { name?: string } | null;
    return {
      vehicle_id: String(r.vehicle_id),
      partner_id: String(r.partner_id),
      partner_name: partner?.name ?? "Sócio",
      plate: vehicle?.plate ?? "—",
      ownership_percentage: Number(r.ownership_percentage),
    };
  });

  return {
    snapshot: buildSnapshot({ periodKey, from, to, rows, ownership }),
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
  const { data, error } = await supabase
    .from("financial_transactions")
    .delete()
    .eq("company_id", companyId)
    .or(
      `entry_source.eq.${DASHBOARD_DEMO_ENTRY_SOURCE},description.ilike.${DASHBOARD_DEMO_PREFIX}%`
    )
    .select("id");

  if (error) {
    // fallback: delete by entry_source only, then by description prefix via filter
    const bySource = await supabase
      .from("financial_transactions")
      .delete()
      .eq("company_id", companyId)
      .eq("entry_source", DASHBOARD_DEMO_ENTRY_SOURCE)
      .select("id");
    if (bySource.error) return { deleted: 0, error: bySource.error.message };

    const { data: listed } = await supabase
      .from("financial_transactions")
      .select("id, description")
      .eq("company_id", companyId)
      .like("description", `${DASHBOARD_DEMO_PREFIX}%`);

    const ids = ((listed as { id: string }[]) ?? []).map((r) => r.id);
    if (ids.length) {
      const del = await supabase.from("financial_transactions").delete().in("id", ids);
      if (del.error) return { deleted: 0, error: del.error.message };
    }
    return {
      deleted: (bySource.data?.length ?? 0) + ids.length,
      error: null,
    };
  }

  return { deleted: data?.length ?? 0, error: null };
}

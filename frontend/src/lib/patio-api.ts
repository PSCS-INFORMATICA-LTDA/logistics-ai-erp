import type { SupabaseClient } from "@supabase/supabase-js";
import { nextCode } from "@/lib/codes";
import {
  calcParkingDailyCount,
  calcParkingHourCount,
  calcRotativoTotal,
  PARKING_SERVICE_NAMES,
  PATIO_ENTRY_SOURCE_PARKING,
  PATIO_ENTRY_SOURCE_WASH,
  type CarWashServiceRow,
  type ParkingBillingMode,
  type ParkingEntryRow,
  type PatioModality,
  type PatioPriceRow,
  type PatioVehicleType,
} from "@/lib/patio";
import { normalizePlate } from "@/lib/utils";

export async function seedPatioDefaults(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { error } = await supabase.rpc("seed_patio_defaults", { p_company_id: companyId });
  if (error) return error.message;
  const { error: rotError } = await supabase.rpc("seed_patio_rotativo_defaults", {
    p_company_id: companyId,
  });
  // RPC pode ainda não existir até aplicar apply-044 — não bloqueia o módulo.
  if (rotError && !/seed_patio_rotativo_defaults|function .* does not exist/i.test(rotError.message)) {
    return rotError.message;
  }
  return null;
}

export async function listPatioVehicleTypes(
  supabase: SupabaseClient,
  companyId: string,
  activeOnly = false
): Promise<{ rows: PatioVehicleType[]; error: string | null }> {
  let q = supabase
    .from("patio_vehicle_types")
    .select("*")
    .eq("company_id", companyId)
    .order("sort_order")
    .order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  return { rows: (data as PatioVehicleType[]) ?? [], error: null };
}

export async function listPatioPrices(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: PatioPriceRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("patio_price_tables")
    .select("*, patio_vehicle_types ( name )")
    .eq("company_id", companyId)
    .order("modality")
    .order("service_name")
    .order("valid_from", { ascending: false });

  if (error) return { rows: [], error: error.message };

  const rows = ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const vt = row.patio_vehicle_types as { name?: string } | null;
    return {
      ...(row as unknown as PatioPriceRow),
      vehicle_type_name: vt?.name ?? undefined,
    };
  });
  return { rows, error: null };
}

export async function resolvePatioPrice(params: {
  supabase: SupabaseClient;
  companyId: string;
  modality: PatioModality;
  vehicleTypeId: string;
  serviceName: string;
  onDate: string;
}): Promise<{ price: number; billingUnit: string } | { error: string }> {
  const { data, error } = await params.supabase
    .from("patio_price_tables")
    .select("price, billing_unit, valid_from, valid_until")
    .eq("company_id", params.companyId)
    .eq("modality", params.modality)
    .eq("vehicle_type_id", params.vehicleTypeId)
    .eq("service_name", params.serviceName)
    .eq("status", "Ativo")
    .lte("valid_from", params.onDate)
    .order("valid_from", { ascending: false })
    .limit(20);

  if (error) return { error: error.message };
  const rows = (data as Array<{
    price: number;
    billing_unit: string;
    valid_from: string;
    valid_until: string | null;
  }>) ?? [];

  const match = rows.find(
    (r) => !r.valid_until || r.valid_until >= params.onDate
  );
  if (!match) {
    return {
      error: `Sem preço vigente para ${params.modality} / ${params.serviceName}. Cadastre em Parâmetros do Pátio.`,
    };
  }
  return { price: Number(match.price), billingUnit: match.billing_unit };
}

async function resolveRevenueAccountId(
  supabase: SupabaseClient,
  companyId: string,
  accountName: string
): Promise<{ id: string; classification: string } | { error: string }> {
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("id, classification")
    .eq("company_id", companyId)
    .eq("name", accountName)
    .eq("status", "Ativo")
    .maybeSingle();
  if (error || !data) {
    return { error: `Conta DRE «${accountName}» não encontrada. Rode o SQL apply-041.` };
  }
  return { id: data.id as string, classification: (data.classification as string) || "Receitas" };
}

export async function postParkingRevenue(params: {
  supabase: SupabaseClient;
  companyId: string;
  entry: ParkingEntryRow;
}): Promise<{ transactionId: string | null; error: string | null }> {
  if (params.entry.financial_transaction_id) {
    return { transactionId: params.entry.financial_transaction_id, error: null };
  }
  const amount = Number(params.entry.total_amount);
  if (!amount || amount <= 0) return { transactionId: null, error: "Valor total inválido." };

  const account = await resolveRevenueAccountId(
    params.supabase,
    params.companyId,
    "Receita Estacionamento"
  );
  if ("error" in account) return { transactionId: null, error: account.error };

  const { data, error } = await params.supabase
    .from("financial_transactions")
    .insert({
      company_id: params.companyId,
      transaction_date: params.entry.exit_date ?? params.entry.entry_date,
      amount,
      chart_of_account_id: account.id,
      classification: account.classification,
      transaction_type: "Receita",
      description: `Estacionamento ${params.entry.code} — ${params.entry.plate}`,
      entry_source: PATIO_ENTRY_SOURCE_PARKING,
    })
    .select("id")
    .single();

  if (error) return { transactionId: null, error: error.message };

  const txId = (data as { id: string }).id;
  await params.supabase
    .from("parking_entries")
    .update({ financial_transaction_id: txId })
    .eq("id", params.entry.id);

  return { transactionId: txId, error: null };
}

export async function postCarWashRevenue(params: {
  supabase: SupabaseClient;
  companyId: string;
  row: CarWashServiceRow;
}): Promise<{ transactionId: string | null; error: string | null }> {
  if (params.row.financial_transaction_id) {
    return { transactionId: params.row.financial_transaction_id, error: null };
  }
  const amount = Number(params.row.service_amount);
  if (!amount || amount <= 0) return { transactionId: null, error: "Valor do serviço inválido." };

  const account = await resolveRevenueAccountId(
    params.supabase,
    params.companyId,
    "Receita Lava Rápido"
  );
  if ("error" in account) return { transactionId: null, error: account.error };

  const { data, error } = await params.supabase
    .from("financial_transactions")
    .insert({
      company_id: params.companyId,
      transaction_date: params.row.service_date,
      amount,
      chart_of_account_id: account.id,
      classification: account.classification,
      transaction_type: "Receita",
      description: `Lava-rápido ${params.row.code} — ${params.row.plate} — ${params.row.service_name}`,
      entry_source: PATIO_ENTRY_SOURCE_WASH,
    })
    .select("id")
    .single();

  if (error) return { transactionId: null, error: error.message };

  const txId = (data as { id: string }).id;
  await params.supabase
    .from("car_wash_services")
    .update({ financial_transaction_id: txId })
    .eq("id", params.row.id);

  return { transactionId: txId, error: null };
}

export type ParkingTotalsOk = {
  ok: true;
  dailyCount: number | null;
  dailyRate: number;
  totalAmount: number | null;
  additionalRate: number | null;
};

export async function computeParkingTotals(params: {
  supabase: SupabaseClient;
  companyId: string;
  vehicleTypeId: string;
  billingMode: ParkingBillingMode;
  entryDate: string;
  exitDate: string | null;
  entryTime?: string | null;
  exitTime?: string | null;
}): Promise<ParkingTotalsOk | { ok: false; error: string }> {
  if (params.billingMode === "Rotativo") {
    const first = await resolvePatioPrice({
      supabase: params.supabase,
      companyId: params.companyId,
      modality: "Estacionamento",
      vehicleTypeId: params.vehicleTypeId,
      serviceName: PARKING_SERVICE_NAMES.rotativoFirst,
      onDate: params.entryDate,
    });
    if ("error" in first) return { ok: false, error: first.error };

    const extra = await resolvePatioPrice({
      supabase: params.supabase,
      companyId: params.companyId,
      modality: "Estacionamento",
      vehicleTypeId: params.vehicleTypeId,
      serviceName: PARKING_SERVICE_NAMES.rotativoExtra,
      onDate: params.entryDate,
    });
    if ("error" in extra) return { ok: false, error: extra.error };

    if (!params.exitDate) {
      return {
        ok: true,
        dailyCount: null,
        dailyRate: first.price,
        totalAmount: null,
        additionalRate: extra.price,
      };
    }

    const hourCount = calcParkingHourCount(
      params.entryDate,
      params.entryTime,
      params.exitDate,
      params.exitTime
    );
    return {
      ok: true,
      dailyCount: hourCount,
      dailyRate: first.price,
      totalAmount: calcRotativoTotal(hourCount, first.price, extra.price),
      additionalRate: extra.price,
    };
  }

  const serviceName =
    params.billingMode === "Mensal"
      ? PARKING_SERVICE_NAMES.mensal
      : PARKING_SERVICE_NAMES.diaria;

  const price = await resolvePatioPrice({
    supabase: params.supabase,
    companyId: params.companyId,
    modality: "Estacionamento",
    vehicleTypeId: params.vehicleTypeId,
    serviceName,
    onDate: params.entryDate,
  });
  if ("error" in price) return { ok: false, error: price.error };

  if (params.billingMode === "Mensal") {
    return {
      ok: true,
      dailyCount: 1,
      dailyRate: price.price,
      totalAmount: price.price,
      additionalRate: null,
    };
  }

  if (!params.exitDate) {
    return {
      ok: true,
      dailyCount: null,
      dailyRate: price.price,
      totalAmount: null,
      additionalRate: null,
    };
  }

  const dailyCount = calcParkingDailyCount(params.entryDate, params.exitDate);
  return {
    ok: true,
    dailyCount,
    dailyRate: price.price,
    totalAmount: dailyCount * price.price,
    additionalRate: null,
  };
}

export async function createParkingEntry(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    plate: string;
    brand?: string;
    model?: string;
    year?: number | null;
    vehicleTypeId: string;
    vehicleTypeName: string;
    clientName?: string;
    phone?: string;
    entryDate: string;
    entryTime?: string;
    billingMode: ParkingBillingMode;
    notes?: string;
  }
): Promise<{ row: ParkingEntryRow | null; error: string | null }> {
  const code = await nextCode("parking_entries", companyId, "EST");
  const totals = await computeParkingTotals({
    supabase,
    companyId,
    vehicleTypeId: input.vehicleTypeId,
    billingMode: input.billingMode,
    entryDate: input.entryDate,
    exitDate: null,
  });
  if (!totals.ok) return { row: null, error: totals.error };

  const { data, error } = await supabase
    .from("parking_entries")
    .insert({
      company_id: companyId,
      code,
      plate: normalizePlate(input.plate),
      brand: input.brand || null,
      model: input.model || null,
      year: input.year ?? null,
      vehicle_type_id: input.vehicleTypeId,
      vehicle_type: input.vehicleTypeName,
      client_name: input.clientName || null,
      phone: input.phone || null,
      entry_date: input.entryDate,
      entry_time: input.entryTime || null,
      billing_mode: input.billingMode,
      daily_rate: totals.dailyRate,
      daily_count: null,
      total_amount: input.billingMode === "Mensal" ? totals.totalAmount : null,
      status: "Aberto",
      notes: input.notes || null,
    })
    .select("*")
    .single();

  if (error) return { row: null, error: error.message };
  return { row: data as ParkingEntryRow, error: null };
}

export async function finalizeParkingEntry(
  supabase: SupabaseClient,
  companyId: string,
  entryId: string,
  exitDate: string,
  exitTime?: string
): Promise<{ error: string | null }> {
  const { data: current, error: fetchError } = await supabase
    .from("parking_entries")
    .select("*")
    .eq("id", entryId)
    .eq("company_id", companyId)
    .single();
  if (fetchError || !current) return { error: fetchError?.message ?? "Movimento não encontrado." };

  const entry = current as ParkingEntryRow;
  if (entry.status !== "Aberto") return { error: "Só movimentos Abertos podem ser finalizados." };
  if (!entry.vehicle_type_id) return { error: "Movimento sem porte de veículo." };

  const billingMode = (entry.billing_mode as ParkingBillingMode) || "Diária";
  const totals = await computeParkingTotals({
    supabase,
    companyId,
    vehicleTypeId: entry.vehicle_type_id,
    billingMode,
    entryDate: entry.entry_date,
    entryTime: entry.entry_time,
    exitDate,
    exitTime: exitTime || null,
  });
  if (!totals.ok) return { error: totals.error };

  const { data: updated, error: updateError } = await supabase
    .from("parking_entries")
    .update({
      exit_date: exitDate,
      exit_time: exitTime || null,
      daily_count: totals.dailyCount,
      daily_rate: totals.dailyRate,
      total_amount: totals.totalAmount,
      status: "Finalizado",
    })
    .eq("id", entryId)
    .select("*")
    .single();

  if (updateError || !updated) return { error: updateError?.message ?? "Falha ao finalizar." };

  const posted = await postParkingRevenue({
    supabase,
    companyId,
    entry: updated as ParkingEntryRow,
  });
  return { error: posted.error };
}

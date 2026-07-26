import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WASH_LOYALTY_SETTINGS,
  type PatioWashLoyaltySettings,
} from "@/lib/wash-loyalty";

export async function getPatioSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ settings: PatioWashLoyaltySettings; error: string | null }> {
  const { data, error } = await supabase
    .from("company_patio_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    if (/company_patio_settings|does not exist/i.test(error.message)) {
      return {
        settings: { company_id: companyId, ...DEFAULT_WASH_LOYALTY_SETTINGS },
        error:
          "Banco sem parâmetros de fidelidade. Rode frontend/scripts/apply-063-car-wash-ready-loyalty.sql no Supabase.",
      };
    }
    return {
      settings: { company_id: companyId, ...DEFAULT_WASH_LOYALTY_SETTINGS },
      error: error.message,
    };
  }

  if (!data) {
    return {
      settings: { company_id: companyId, ...DEFAULT_WASH_LOYALTY_SETTINGS },
      error: null,
    };
  }

  const every = Number(data.wash_loyalty_every_n) === 10 ? 10 : 5;
  return {
    settings: {
      company_id: companyId,
      wash_loyalty_enabled: data.wash_loyalty_enabled !== false,
      wash_loyalty_every_n: every,
      wash_loyalty_reward_qty: Math.max(1, Number(data.wash_loyalty_reward_qty) || 1),
    },
    error: null,
  };
}

export async function upsertPatioSettings(
  supabase: SupabaseClient,
  settings: PatioWashLoyaltySettings
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("company_patio_settings").upsert(
    {
      company_id: settings.company_id,
      wash_loyalty_enabled: settings.wash_loyalty_enabled,
      wash_loyalty_every_n: settings.wash_loyalty_every_n,
      wash_loyalty_reward_qty: settings.wash_loyalty_reward_qty,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );
  if (error) {
    if (/company_patio_settings|does not exist/i.test(error.message)) {
      return {
        error:
          "Banco sem parâmetros de fidelidade. Rode frontend/scripts/apply-063-car-wash-ready-loyalty.sql no Supabase.",
      };
    }
    return { error: error.message };
  }
  return { error: null };
}

export async function listWashHistoryForPlate(
  supabase: SupabaseClient,
  companyId: string,
  plate: string
): Promise<{
  rows: Array<{ status: string; is_loyalty_reward: boolean | null }>;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("car_wash_services")
    .select("status, is_loyalty_reward")
    .eq("company_id", companyId)
    .eq("plate", plate)
    .neq("status", "Cancelado");

  if (error) {
    if (/is_loyalty_reward/i.test(error.message)) {
      const fallback = await supabase
        .from("car_wash_services")
        .select("status")
        .eq("company_id", companyId)
        .eq("plate", plate)
        .neq("status", "Cancelado");
      return {
        rows: (fallback.data ?? []).map((r) => ({
          status: r.status as string,
          is_loyalty_reward: false,
        })),
        error: null,
      };
    }
    return { rows: [], error: error.message };
  }

  return {
    rows: (data ?? []).map((r) => ({
      status: r.status as string,
      is_loyalty_reward: Boolean(r.is_loyalty_reward),
    })),
    error: null,
  };
}

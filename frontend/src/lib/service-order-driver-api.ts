import type { SupabaseClient } from "@supabase/supabase-js";

export async function assignServiceOrderDriver(
  supabase: SupabaseClient,
  orderId: string,
  driverId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("service_orders")
    .update({ driver_id: driverId })
    .eq("id", orderId);

  if (error) return { error: error.message };
  return { error: null };
}

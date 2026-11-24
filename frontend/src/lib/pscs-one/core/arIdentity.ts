import type { SupabaseClient } from "@supabase/supabase-js";
import { actorFromRecords, type IdentityActor } from "../identityGate";
import { CoreUserDirectory } from "./coreDirectory";
import { CoreArError } from "./errors";
import type { CloseIdentityContext } from "./closeServiceOrder";
import type { CoreArAuthSessionWithUser } from "./types";

type ProfileRow = { pscs_one_user_id?: string | null };
type MemberRow = { role?: string | null };

export function createSupabaseArIdentityLoader(
  supabase: SupabaseClient,
  session: CoreArAuthSessionWithUser,
  logisticsUserId: string,
): (context: CloseIdentityContext) => Promise<IdentityActor> {
  return async (context) => {
    const profile = await supabase
      .from("profiles")
      .select("pscs_one_user_id")
      .eq("id", logisticsUserId)
      .maybeSingle();
    if (profile.error) {
      throw new CoreArError("core_unavailable", "Could not read the shared identity.", 502, profile.error.message);
    }
    const member = await supabase
      .from("company_members")
      .select("role")
      .eq("user_id", logisticsUserId)
      .eq("company_id", context.logisticsCompanyId)
      .maybeSingle();
    if (member.error) {
      throw new CoreArError("core_unavailable", "Could not read the company role.", 502, member.error.message);
    }
    const directory = new CoreUserDirectory(session);
    const coreMembership = await directory.readOwnMembership(context.coreCompanyId);
    const actor = actorFromRecords({
      logisticsUserId,
      logisticsRole: (member.data as MemberRow | null)?.role ?? null,
      logisticsCompanyId: context.logisticsCompanyId,
      pscsOneUserId: (profile.data as ProfileRow | null)?.pscs_one_user_id ?? null,
      coreUserId: session.user_id ?? null,
      coreCompanyId: context.coreCompanyId,
      mappedLogisticsCompanyId: context.mappedLogisticsCompanyId,
      coreMembershipRole: coreMembership?.role ?? null,
      coreMembershipActive: coreMembership?.active === true,
    });
    if (!actor) {
      throw new CoreArError("core_unauthorized", "A sessão não autoriza o recebível.", 403);
    }
    return actor;
  };
}

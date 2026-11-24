import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APP_SCREENS,
  apiAuthorization,
  asCompanyMemberRole,
  canRoleViewScreen,
  screenKeyFromPath,
  type CompanyMemberRole,
} from "@/lib/app-screens";
import { pickMappedMembership } from "@/lib/pscs-one/preferMappedMembership";

type Membership = {
  company_id: string;
  role: string | null;
  partner_id: string | null;
};

async function loadMembership(
  supabase: SupabaseClient,
  userId: string,
  mappedCompanyId?: string | null,
): Promise<Membership | null> {
  const { data: memberships } = await supabase
    .from("company_members")
    .select("company_id, role, partner_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (pickMappedMembership(memberships ?? [], mappedCompanyId) as Membership | undefined) ?? null;
}

async function partnerViewSet(
  supabase: SupabaseClient,
  companyId: string,
  partnerId: string,
): Promise<Set<string>> {
  const { data: rows } = await supabase
    .from("partner_screen_permissions")
    .select("screen_key, can_view")
    .eq("company_id", companyId)
    .eq("partner_id", partnerId)
    .eq("can_view", true);

  return new Set(
    (rows ?? [])
      .filter((row) => row.can_view)
      .map((row) => row.screen_key as string),
  );
}

function viewAllowed(
  role: CompanyMemberRole | null,
  partnerId: string | null,
  screenKey: string,
  partnerScreens: Set<string>,
): boolean {
  return canRoleViewScreen({
    role,
    partnerId,
    screenKey,
    partnerCanView: partnerScreens.has(screenKey),
  });
}

async function firstAllowedPath(
  supabase: SupabaseClient,
  role: CompanyMemberRole | null,
  companyId: string,
  partnerId: string | null,
): Promise<string | null> {
  const partnerScreens = partnerId
    ? await partnerViewSet(supabase, companyId, partnerId)
    : new Set<string>();

  for (const screen of APP_SCREENS) {
    if (viewAllowed(role, partnerId, screen.key, partnerScreens)) return screen.href;
  }
  return null;
}

/**
 * Se o usuário não pode ver a rota atual, devolve o href da primeira tela liberada.
 * Admin da própria empresa segue sem redirect. Sem partner_id usa a allowlist do papel.
 */
export async function resolveForbiddenRedirect(
  supabase: SupabaseClient,
  userId: string,
  pathname: string,
  mappedCompanyId?: string | null,
): Promise<string | null> {
  const member = await loadMembership(supabase, userId, mappedCompanyId);
  if (!member?.company_id) return null;

  const role = asCompanyMemberRole(member.role);
  if (role === "admin") return null;

  const screenKey = screenKeyFromPath(pathname);
  if (!screenKey) return null;

  const partnerScreens = member.partner_id
    ? await partnerViewSet(supabase, member.company_id, member.partner_id)
    : new Set<string>();

  if (viewAllowed(role, member.partner_id, screenKey, partnerScreens)) return null;
  return (
    (await firstAllowedPath(supabase, role, member.company_id, member.partner_id)) ??
    "/login?error=sem-acesso"
  );
}

/** Destino pós-login. Admin vai ao dashboard. Os demais vão à primeira tela do papel. */
export async function resolvePostLoginPath(
  supabase: SupabaseClient,
  userId: string,
  mappedCompanyId?: string | null,
): Promise<string> {
  const member = await loadMembership(supabase, userId, mappedCompanyId);
  if (!member?.company_id) return "/setup";
  const role = asCompanyMemberRole(member.role);
  if (role === "admin") return "/dashboard";

  return (
    (await firstAllowedPath(supabase, role, member.company_id, member.partner_id)) ??
    "/login?error=sem-acesso"
  );
}

/** 403 das APIs autenticadas. Não usa service role. */
export async function resolveApiAccess(
  supabase: SupabaseClient,
  userId: string,
  pathname: string,
  mappedCompanyId?: string | null,
): Promise<"allow" | "deny"> {
  const member = await loadMembership(supabase, userId, mappedCompanyId);
  if (!member?.company_id) return "deny";
  return apiAuthorization(asCompanyMemberRole(member.role), pathname);
}

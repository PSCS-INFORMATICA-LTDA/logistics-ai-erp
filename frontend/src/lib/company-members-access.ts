import type { SupabaseClient } from "@supabase/supabase-js";
import {
  planMemberRoleChange,
  presentMemberRole,
  type KnownMemberRole,
} from "./member-role-plan";

export {
  ASSIGNABLE_ROLES,
  authorizeMemberInvite,
  parseAssignableRole,
  planMemberRoleChange,
  presentMemberRole,
  roleLabel,
  type AssignableRole,
} from "./member-role-plan";

export type CompanyMemberRow = {
  id: string;
  user_id: string;
  role: KnownMemberRole | null;
  created_at: string;
  email: string | null;
  full_name: string | null;
  can_approve_launches: boolean;
};

export async function listCompanyMembers(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ rows: CompanyMemberRow[]; error: string | null }> {
  const { data: members, error } = await supabase
    .from("company_members")
    .select("id, user_id, role, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }

  const list = members ?? [];
  const userIds = list.map((m) => m.user_id);
  const profileById = new Map<string, { email: string | null; full_name: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);

    if (profileErr) {
      return { rows: [], error: profileErr.message };
    }

    for (const p of profiles ?? []) {
      profileById.set(p.id, {
        email: p.email ?? null,
        full_name: p.full_name ?? null,
      });
    }
  }

  const rows: CompanyMemberRow[] = list.map((m) => {
    const profile = profileById.get(m.user_id);
    const presented = presentMemberRole(m.role);
    return {
      id: m.id,
      user_id: m.user_id,
      role: presented.role,
      created_at: m.created_at,
      email: profile?.email ?? null,
      full_name: profile?.full_name ?? null,
      can_approve_launches: presented.canApproveLaunches,
    };
  });

  return { rows, error: null };
}

export async function setCompanyMemberRole(
  supabase: SupabaseClient,
  companyId: string,
  memberId: string,
  requestedRole: unknown,
): Promise<{ error: string | null }> {
  const { data: target, error: targetErr } = await supabase
    .from("company_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (targetErr) return { error: targetErr.message };
  if (!target) return { error: "Usuário não encontrado nesta empresa." };

  let adminCount = 0;
  if (target.role === "admin") {
    const { count, error: countErr } = await supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "admin");

    if (countErr) return { error: countErr.message };
    adminCount = count ?? 0;
  }

  const plan = planMemberRoleChange({
    currentRole: target.role,
    requestedRole,
    adminCount,
  });
  if (!plan.ok) return { error: plan.error };
  if (plan.role === target.role) return { error: null };

  const { error } = await supabase
    .from("company_members")
    .update({ role: plan.role })
    .eq("id", memberId)
    .eq("company_id", companyId);

  if (error) return { error: error.message };
  return { error: null };
}

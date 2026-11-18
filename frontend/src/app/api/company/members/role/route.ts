import { NextResponse } from "next/server";
import { requireCompanyMember } from "@/lib/billing-server";
import { planMemberRoleChange } from "@/lib/company-members-access";

export const runtime = "nodejs";

type Body = {
  memberId?: string;
  role?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireCompanyMember();
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const memberId = body?.memberId?.trim() ?? "";
  if (!memberId) {
    return NextResponse.json({ error: "Informe o membro." }, { status: 400 });
  }

  const { data: target, error: targetErr } = await auth.supabase
    .from("company_members")
    .select("id, company_id, role")
    .eq("id", memberId)
    .maybeSingle();

  if (targetErr) {
    return NextResponse.json({ error: targetErr.message }, { status: 400 });
  }
  if (!target?.company_id) {
    return NextResponse.json({ error: "Usuário não encontrado nesta empresa." }, { status: 404 });
  }

  const { data: caller, error: callerErr } = await auth.supabase
    .from("company_members")
    .select("role")
    .eq("company_id", target.company_id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (callerErr) {
    return NextResponse.json({ error: callerErr.message }, { status: 400 });
  }
  if (caller?.role !== "admin") {
    return NextResponse.json(
      { error: "Somente administrador pode alterar papéis." },
      { status: 403 },
    );
  }

  let adminCount = 0;
  if (target.role === "admin") {
    const { count, error: countErr } = await auth.supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", target.company_id)
      .eq("role", "admin");

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 400 });
    }
    adminCount = count ?? 0;
  }

  const plan = planMemberRoleChange({
    currentRole: target.role,
    requestedRole: body?.role,
    adminCount,
  });
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error }, { status: 409 });
  }
  if (plan.role === target.role) {
    return NextResponse.json({ ok: true, role: plan.role });
  }

  const { error: updateErr } = await auth.supabase
    .from("company_members")
    .update({ role: plan.role })
    .eq("id", target.id)
    .eq("company_id", target.company_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, role: plan.role });
}

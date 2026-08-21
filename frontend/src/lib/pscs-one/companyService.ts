import { createServiceClient } from "@/lib/supabase/service";

export class PscsOneCompanyService {
  static async ensureMembership(authUserId: string, companyId: string): Promise<void> {
    const admin = createServiceClient();
    if (!admin) {
      throw new Error("sso_admin_unconfigured");
    }

    const { data: company } = await admin
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();

    if (!company) {
      throw new Error("mapped_company_missing");
    }

    const { data: existing } = await admin
      .from("company_members")
      .select("id")
      .eq("user_id", authUserId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existing) {
      return;
    }

    const { error } = await admin.from("company_members").insert({
      company_id: companyId,
      user_id: authUserId,
      role: "operacional",
    });
    if (error) throw new Error(error.message);
  }
}

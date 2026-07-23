import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPANY_DOCUMENT_TYPES_TO_DEACTIVATE,
  DEFAULT_DOCUMENT_TYPE_SEEDS,
  resolveComplianceSituation,
  thresholdsForDoc,
  type ComplianceDocument,
  type DocumentAppliesTo,
  type DocumentType,
} from "@/lib/compliance-documents";
import { isoWeekPeriodKey, type ExpiryTier } from "@/lib/expiry-status";

type Sb = SupabaseClient;

function mapType(raw: Record<string, unknown>): DocumentType {
  return {
    id: String(raw.id),
    company_id: String(raw.company_id),
    name: String(raw.name),
    acronym: (raw.acronym as string | null) ?? null,
    issuing_body: (raw.issuing_body as string | null) ?? null,
    applies_to: raw.applies_to as DocumentAppliesTo,
    requires_expiry: Boolean(raw.requires_expiry),
    is_required: Boolean(raw.is_required),
    vehicle_categories: (raw.vehicle_categories as string[]) ?? [],
    alert_days_first: Number(raw.alert_days_first ?? 60),
    alert_days_second: Number(raw.alert_days_second ?? 30),
    alert_days_critical: Number(raw.alert_days_critical ?? 15),
    alert_days_urgent: Number(raw.alert_days_urgent ?? 7),
    sort_order: Number(raw.sort_order ?? 100),
    is_active: raw.is_active !== false,
  };
}

function mapDoc(raw: Record<string, unknown>): ComplianceDocument {
  const typeRaw = raw.document_types as Record<string, unknown> | null;
  return {
    id: String(raw.id),
    company_id: String(raw.company_id),
    owner_type: raw.owner_type as DocumentAppliesTo,
    owner_id: String(raw.owner_id),
    document_type_id: String(raw.document_type_id),
    document_number: (raw.document_number as string | null) ?? null,
    issuing_body: (raw.issuing_body as string | null) ?? null,
    issued_at: (raw.issued_at as string | null) ?? null,
    expires_at: (raw.expires_at as string | null) ?? null,
    no_expiry: Boolean(raw.no_expiry),
    renewal_start_date: (raw.renewal_start_date as string | null) ?? null,
    renewal_status: (raw.renewal_status as "none" | "in_renewal") ?? "none",
    manual_status: (raw.manual_status as ComplianceDocument["manual_status"]) ?? null,
    alert_days_first: raw.alert_days_first == null ? null : Number(raw.alert_days_first),
    alert_days_second: raw.alert_days_second == null ? null : Number(raw.alert_days_second),
    alert_days_critical:
      raw.alert_days_critical == null ? null : Number(raw.alert_days_critical),
    alert_days_urgent: raw.alert_days_urgent == null ? null : Number(raw.alert_days_urgent),
    responsible_name: (raw.responsible_name as string | null) ?? null,
    responsible_user_id: (raw.responsible_user_id as string | null) ?? null,
    notes: (raw.notes as string | null) ?? null,
    is_active: raw.is_active !== false,
    root_id: (raw.root_id as string | null) ?? null,
    version_number: Number(raw.version_number ?? 1),
    is_current: raw.is_current !== false,
    supersedes_id: (raw.supersedes_id as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    deleted_at: (raw.deleted_at as string | null) ?? null,
    document_type: typeRaw ? mapType(typeRaw) : null,
  };
}

export async function seedDefaultDocumentTypes(
  supabase: Sb,
  companyId: string
): Promise<string | null> {
  const { data: existing, error } = await supabase
    .from("document_types")
    .select("id, acronym, applies_to, name, is_active")
    .eq("company_id", companyId);
  if (error) return error.message;

  const rows = existing ?? [];
  if (rows.length === 0) {
    const insertRows = DEFAULT_DOCUMENT_TYPE_SEEDS.map((t) => ({
      company_id: companyId,
      ...t,
    }));
    const { error: insertError } = await supabase.from("document_types").insert(insertRows);
    return insertError?.message ?? null;
  }

  // Empresas já seedadas: garante Prefixo (por placa) e TA só da empresa.
  const byAcronym = new Map(
    rows
      .filter((r) => r.acronym)
      .map((r) => [String(r.acronym).toUpperCase(), r] as const)
  );

  const prefixSeed = DEFAULT_DOCUMENT_TYPE_SEEDS.find((t) => t.acronym === "PREFIXO");
  if (prefixSeed && !byAcronym.has("PREFIXO")) {
    const { error: prefixErr } = await supabase.from("document_types").insert({
      company_id: companyId,
      ...prefixSeed,
    });
    if (prefixErr) return prefixErr.message;
  }

  const ta = byAcronym.get("TA");
  if (ta) {
    const { error: taErr } = await supabase
      .from("document_types")
      .update({
        applies_to: "company",
        is_active: true,
        is_required: true,
        name: "Termo de Autorização (TA)",
      })
      .eq("id", ta.id)
      .eq("company_id", companyId);
    if (taErr) return taErr.message;
  } else {
    const taSeed = DEFAULT_DOCUMENT_TYPE_SEEDS.find((t) => t.acronym === "TA");
    if (taSeed) {
      const { error: taIns } = await supabase.from("document_types").insert({
        company_id: companyId,
        ...taSeed,
      });
      if (taIns) return taIns.message;
    }
  }

  for (const acronym of COMPANY_DOCUMENT_TYPES_TO_DEACTIVATE) {
    const row = byAcronym.get(acronym);
    if (!row || row.is_active === false) continue;
    const { error: deactErr } = await supabase
      .from("document_types")
      .update({ is_active: false })
      .eq("id", row.id)
      .eq("company_id", companyId);
    if (deactErr) return deactErr.message;
  }

  return null;
}

export async function listDocumentTypes(
  supabase: Sb,
  companyId: string,
  appliesTo?: DocumentAppliesTo | "all"
): Promise<{ rows: DocumentType[]; error: string | null }> {
  let q = supabase
    .from("document_types")
    .select("*")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true });
  if (appliesTo && appliesTo !== "all") q = q.eq("applies_to", appliesTo);
  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  return { rows: ((data as unknown[]) ?? []).map((r) => mapType(r as Record<string, unknown>)), error: null };
}

export async function upsertDocumentType(
  supabase: Sb,
  companyId: string,
  payload: Partial<DocumentType> & { name: string; applies_to: DocumentAppliesTo },
  id?: string
): Promise<string | null> {
  const row = {
    company_id: companyId,
    name: payload.name,
    acronym: payload.acronym ?? null,
    issuing_body: payload.issuing_body ?? null,
    applies_to: payload.applies_to,
    requires_expiry: payload.requires_expiry ?? true,
    is_required: payload.is_required ?? false,
    vehicle_categories: payload.vehicle_categories ?? [],
    alert_days_first: payload.alert_days_first ?? 60,
    alert_days_second: payload.alert_days_second ?? 30,
    alert_days_critical: payload.alert_days_critical ?? 15,
    alert_days_urgent: payload.alert_days_urgent ?? 7,
    sort_order: payload.sort_order ?? 100,
    is_active: payload.is_active !== false,
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const { error } = await supabase.from("document_types").update(row).eq("id", id).eq("company_id", companyId);
    return error?.message ?? null;
  }
  const { error } = await supabase.from("document_types").insert(row);
  return error?.message ?? null;
}

export async function listComplianceDocuments(
  supabase: Sb,
  companyId: string,
  opts: {
    ownerType: DocumentAppliesTo;
    ownerId: string;
    currentOnly?: boolean;
    rootId?: string;
  }
): Promise<{ rows: ComplianceDocument[]; error: string | null }> {
  let q = supabase
    .from("compliance_documents")
    .select("*, document_types(*)")
    .eq("company_id", companyId)
    .eq("owner_type", opts.ownerType)
    .eq("owner_id", opts.ownerId)
    .is("deleted_at", null)
    .order("version_number", { ascending: false });

  if (opts.currentOnly !== false && !opts.rootId) q = q.eq("is_current", true);
  if (opts.rootId) q = q.eq("root_id", opts.rootId);

  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data as unknown[]) ?? []).map((r) => mapDoc(r as Record<string, unknown>)),
    error: null,
  };
}

export async function listCompanyDocumentsForVehicleView(
  supabase: Sb,
  companyId: string
): Promise<{ rows: ComplianceDocument[]; error: string | null }> {
  const res = await listComplianceDocuments(supabase, companyId, {
    ownerType: "company",
    ownerId: companyId,
    currentOnly: true,
  });
  // Na placa, só o TA da empresa (consulta) — Prefixo e demais são por veículo.
  return {
    ...res,
    rows: res.rows.filter(
      (d) =>
        d.document_type?.acronym?.toUpperCase() === "TA" &&
        d.document_type?.is_active !== false
    ),
  };
}

export type ComplianceDocInput = {
  document_type_id: string;
  document_number?: string | null;
  issuing_body?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  no_expiry?: boolean;
  renewal_start_date?: string | null;
  renewal_status?: "none" | "in_renewal";
  manual_status?: "suspended" | "not_applicable" | null;
  alert_days_first?: number | null;
  alert_days_second?: number | null;
  alert_days_critical?: number | null;
  alert_days_urgent?: number | null;
  responsible_name?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

export async function createComplianceDocument(
  supabase: Sb,
  companyId: string,
  ownerType: DocumentAppliesTo,
  ownerId: string,
  input: ComplianceDocInput,
  userId?: string | null
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("compliance_documents")
    .insert({
      company_id: companyId,
      owner_type: ownerType,
      owner_id: ownerId,
      document_type_id: input.document_type_id,
      document_number: input.document_number ?? null,
      issuing_body: input.issuing_body ?? null,
      issued_at: input.issued_at || null,
      expires_at: input.no_expiry ? null : input.expires_at || null,
      no_expiry: Boolean(input.no_expiry),
      renewal_start_date: input.renewal_start_date || null,
      renewal_status: input.renewal_status ?? "none",
      manual_status: input.manual_status ?? null,
      alert_days_first: input.alert_days_first ?? null,
      alert_days_second: input.alert_days_second ?? null,
      alert_days_critical: input.alert_days_critical ?? null,
      alert_days_urgent: input.alert_days_urgent ?? null,
      responsible_name: input.responsible_name ?? null,
      notes: input.notes ?? null,
      is_active: input.is_active !== false,
      version_number: 1,
      is_current: true,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    })
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };
  return { id: String(data.id), error: null };
}

export async function updateComplianceDocument(
  supabase: Sb,
  companyId: string,
  id: string,
  input: ComplianceDocInput,
  userId?: string | null
): Promise<string | null> {
  const { error } = await supabase
    .from("compliance_documents")
    .update({
      document_type_id: input.document_type_id,
      document_number: input.document_number ?? null,
      issuing_body: input.issuing_body ?? null,
      issued_at: input.issued_at || null,
      expires_at: input.no_expiry ? null : input.expires_at || null,
      no_expiry: Boolean(input.no_expiry),
      renewal_start_date: input.renewal_start_date || null,
      renewal_status: input.renewal_status ?? "none",
      manual_status: input.manual_status ?? null,
      alert_days_first: input.alert_days_first ?? null,
      alert_days_second: input.alert_days_second ?? null,
      alert_days_critical: input.alert_days_critical ?? null,
      alert_days_urgent: input.alert_days_urgent ?? null,
      responsible_name: input.responsible_name ?? null,
      notes: input.notes ?? null,
      is_active: input.is_active !== false,
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("company_id", companyId);
  return error?.message ?? null;
}

/** Renova: arquiva versão atual e cria nova. */
export async function renewComplianceDocument(
  supabase: Sb,
  companyId: string,
  current: ComplianceDocument,
  input: ComplianceDocInput,
  userId?: string | null
): Promise<{ id: string | null; error: string | null }> {
  const { error: archiveError } = await supabase
    .from("compliance_documents")
    .update({
      is_current: false,
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .eq("company_id", companyId);
  if (archiveError) return { id: null, error: archiveError.message };

  const { data, error } = await supabase
    .from("compliance_documents")
    .insert({
      company_id: companyId,
      owner_type: current.owner_type,
      owner_id: current.owner_id,
      document_type_id: input.document_type_id || current.document_type_id,
      document_number: input.document_number ?? null,
      issuing_body: input.issuing_body ?? current.issuing_body,
      issued_at: input.issued_at || null,
      expires_at: input.no_expiry ? null : input.expires_at || null,
      no_expiry: Boolean(input.no_expiry),
      renewal_start_date: input.renewal_start_date || null,
      renewal_status: "none",
      manual_status: input.manual_status ?? null,
      alert_days_first: input.alert_days_first ?? current.alert_days_first,
      alert_days_second: input.alert_days_second ?? current.alert_days_second,
      alert_days_critical: input.alert_days_critical ?? current.alert_days_critical,
      alert_days_urgent: input.alert_days_urgent ?? current.alert_days_urgent,
      responsible_name: input.responsible_name ?? current.responsible_name,
      notes: input.notes ?? null,
      is_active: true,
      root_id: current.root_id ?? current.id,
      version_number: (current.version_number || 1) + 1,
      is_current: true,
      supersedes_id: current.id,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    await supabase
      .from("compliance_documents")
      .update({ is_current: true })
      .eq("id", current.id);
    return { id: null, error: error.message };
  }
  return { id: String(data.id), error: null };
}

export async function softDeleteComplianceDocument(
  supabase: Sb,
  companyId: string,
  id: string,
  userId?: string | null
): Promise<string | null> {
  const { error } = await supabase
    .from("compliance_documents")
    .update({
      deleted_at: new Date().toISOString(),
      is_current: false,
      is_active: false,
      updated_by: userId ?? null,
    })
    .eq("id", id)
    .eq("company_id", companyId);
  return error?.message ?? null;
}

function tierToAlert(
  tier: ExpiryTier
): "first" | "second" | "critical" | "urgent" | "expired" | null {
  if (tier === "first" || tier === "second" || tier === "critical" || tier === "urgent" || tier === "expired") {
    return tier;
  }
  return null;
}

/** Gera alertas da semana com dedup (ignore conflicts). */
export async function syncComplianceAlerts(
  supabase: Sb,
  companyId: string,
  docs: ComplianceDocument[]
): Promise<number> {
  const period = isoWeekPeriodKey();
  let created = 0;
  for (const doc of docs) {
    if (!doc.is_current || !doc.is_active) continue;
    const view = resolveComplianceSituation(doc, doc.document_type);
    const alertTier = tierToAlert(view.tier);
    if (!alertTier) continue;
    const typeName = doc.document_type?.acronym || doc.document_type?.name || "Documento";
    const title =
      alertTier === "expired"
        ? `${typeName} vencido`
        : `${typeName} — ${view.label}`;
    const body = [
      doc.document_number ? `Nº ${doc.document_number}` : null,
      doc.expires_at ? `Validade: ${doc.expires_at}` : null,
      view.daysLeft != null ? `Dias: ${view.daysLeft}` : null,
      view.renewalNote ? "Em renovação" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const { error } = await supabase.from("compliance_alert_outbox").insert({
      company_id: companyId,
      document_id: doc.id,
      alert_tier: alertTier,
      period_key: period,
      title,
      body: body || view.label,
      meta_json: {
        owner_type: doc.owner_type,
        owner_id: doc.owner_id,
        days_left: view.daysLeft,
        thresholds: thresholdsForDoc(doc, doc.document_type),
      },
    });
    if (!error) created += 1;
  }
  return created;
}

export async function listUnreadComplianceAlerts(
  supabase: Sb,
  companyId: string,
  limit = 30
): Promise<{
  rows: Array<{
    id: string;
    title: string;
    body: string;
    alert_tier: string;
    created_at: string;
    document_id: string;
  }>;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("compliance_alert_outbox")
    .select("id, title, body, alert_tier, created_at, document_id")
    .eq("company_id", companyId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data as unknown[]) ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        alert_tier: String(row.alert_tier),
        created_at: String(row.created_at),
        document_id: String(row.document_id),
      };
    }),
    error: null,
  };
}

export async function markComplianceAlertRead(
  supabase: Sb,
  companyId: string,
  id: string,
  userId?: string | null
): Promise<string | null> {
  const { error } = await supabase
    .from("compliance_alert_outbox")
    .update({ read_at: new Date().toISOString(), read_by: userId ?? null })
    .eq("id", id)
    .eq("company_id", companyId);
  return error?.message ?? null;
}

export async function listExpiringDocumentsReport(
  supabase: Sb,
  companyId: string
): Promise<{ rows: ComplianceDocument[]; error: string | null }> {
  const { data, error } = await supabase
    .from("compliance_documents")
    .select("*, document_types(*)")
    .eq("company_id", companyId)
    .eq("is_current", true)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("expires_at", { ascending: true, nullsFirst: false });
  if (error) return { rows: [], error: error.message };
  const rows = ((data as unknown[]) ?? []).map((r) => mapDoc(r as Record<string, unknown>));
  return {
    rows: rows.filter((d) => {
      const v = resolveComplianceSituation(d, d.document_type);
      return (
        v.situation === "expired" ||
        v.situation === "expiring_soon" ||
        v.situation === "in_renewal" ||
        v.situation === "suspended"
      );
    }),
    error: null,
  };
}

export async function vehicleDocSummaryMap(
  supabase: Sb,
  companyId: string,
  vehicleIds: string[]
): Promise<Map<string, { expired: number; expiring: number; missingRequired: number }>> {
  const map = new Map<string, { expired: number; expiring: number; missingRequired: number }>();
  if (!vehicleIds.length) return map;

  const { rows: types } = await listDocumentTypes(supabase, companyId, "vehicle");
  const required = types.filter((t) => t.is_required && t.is_active);

  const { data } = await supabase
    .from("compliance_documents")
    .select("*, document_types(*)")
    .eq("company_id", companyId)
    .eq("owner_type", "vehicle")
    .eq("is_current", true)
    .is("deleted_at", null)
    .in("owner_id", vehicleIds);

  const byVehicle = new Map<string, ComplianceDocument[]>();
  for (const raw of (data as unknown[]) ?? []) {
    const doc = mapDoc(raw as Record<string, unknown>);
    const list = byVehicle.get(doc.owner_id) ?? [];
    list.push(doc);
    byVehicle.set(doc.owner_id, list);
  }

  for (const vid of vehicleIds) {
    const docs = byVehicle.get(vid) ?? [];
    const have = new Set(docs.map((d) => d.document_type_id));
    let expired = 0;
    let expiring = 0;
    for (const d of docs) {
      const v = resolveComplianceSituation(d, d.document_type);
      if (v.situation === "expired" || v.situation === "suspended") expired += 1;
      else if (v.situation === "expiring_soon") expiring += 1;
    }
    const missingRequired = required.filter((t) => !have.has(t.id)).length;
    map.set(vid, { expired, expiring, missingRequired });
  }
  return map;
}

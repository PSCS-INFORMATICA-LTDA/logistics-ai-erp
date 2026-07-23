/** Domínio de documentos / licenças (empresa + veículo). */

import {
  DEFAULT_DOCUMENT_ALERT_DAYS,
  daysUntilExpiry,
  expiryTierLabel,
  expiryTierToBadgeVariant,
  getExpiryTierByDays,
  type DayAlertThresholds,
  type ExpiryBadgeVariant,
  type ExpiryTier,
} from "@/lib/expiry-status";

export type DocumentAppliesTo = "company" | "vehicle";

export type DocumentType = {
  id: string;
  company_id: string;
  name: string;
  acronym: string | null;
  issuing_body: string | null;
  applies_to: DocumentAppliesTo;
  requires_expiry: boolean;
  is_required: boolean;
  vehicle_categories: string[];
  alert_days_first: number;
  alert_days_second: number;
  alert_days_critical: number;
  alert_days_urgent: number;
  sort_order: number;
  is_active: boolean;
};

export type ComplianceDocument = {
  id: string;
  company_id: string;
  owner_type: DocumentAppliesTo;
  owner_id: string;
  document_type_id: string;
  document_number: string | null;
  issuing_body: string | null;
  issued_at: string | null;
  expires_at: string | null;
  no_expiry: boolean;
  renewal_start_date: string | null;
  renewal_status: "none" | "in_renewal";
  manual_status: "suspended" | "not_applicable" | null;
  alert_days_first: number | null;
  alert_days_second: number | null;
  alert_days_critical: number | null;
  alert_days_urgent: number | null;
  responsible_name: string | null;
  responsible_user_id: string | null;
  notes: string | null;
  is_active: boolean;
  root_id: string | null;
  version_number: number;
  is_current: boolean;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  document_type?: DocumentType | null;
};

/** Situação de negócio na UI. */
export type ComplianceSituation =
  | "missing"
  | "valid"
  | "expiring_soon"
  | "expired"
  | "in_renewal"
  | "suspended"
  | "not_applicable";

export type ComplianceSituationView = {
  situation: ComplianceSituation;
  tier: ExpiryTier;
  label: string;
  badge: ExpiryBadgeVariant;
  daysLeft: number | null;
  /** Em renovação não esconde alerta de vencimento. */
  renewalNote: boolean;
};

export function thresholdsForDoc(
  doc: Pick<
    ComplianceDocument,
    | "alert_days_first"
    | "alert_days_second"
    | "alert_days_critical"
    | "alert_days_urgent"
  >,
  type?: DocumentType | null
): DayAlertThresholds {
  return {
    first: doc.alert_days_first ?? type?.alert_days_first ?? DEFAULT_DOCUMENT_ALERT_DAYS.first,
    second: doc.alert_days_second ?? type?.alert_days_second ?? DEFAULT_DOCUMENT_ALERT_DAYS.second,
    critical:
      doc.alert_days_critical ?? type?.alert_days_critical ?? DEFAULT_DOCUMENT_ALERT_DAYS.critical,
    urgent: doc.alert_days_urgent ?? type?.alert_days_urgent ?? DEFAULT_DOCUMENT_ALERT_DAYS.urgent,
  };
}

export function resolveComplianceSituation(
  doc: ComplianceDocument | null | undefined,
  type?: DocumentType | null
): ComplianceSituationView {
  if (!doc || !doc.is_active) {
    return {
      situation: "missing",
      tier: "none",
      label: "Sem documento cadastrado",
      badge: "default",
      daysLeft: null,
      renewalNote: false,
    };
  }

  if (doc.manual_status === "not_applicable") {
    return {
      situation: "not_applicable",
      tier: "ok",
      label: "Não aplicável",
      badge: "default",
      daysLeft: null,
      renewalNote: false,
    };
  }

  if (doc.manual_status === "suspended") {
    return {
      situation: "suspended",
      tier: "critical",
      label: "Suspenso",
      badge: "danger",
      daysLeft: daysUntilExpiry(doc.expires_at),
      renewalNote: doc.renewal_status === "in_renewal",
    };
  }

  const thresholds = thresholdsForDoc(doc, type ?? doc.document_type);
  const tier = getExpiryTierByDays(doc.expires_at, thresholds, {
    noExpiry: doc.no_expiry || !type?.requires_expiry,
  });
  const daysLeft = doc.no_expiry ? null : daysUntilExpiry(doc.expires_at);
  const renewalNote = doc.renewal_status === "in_renewal";

  if (tier === "expired") {
    return {
      situation: "expired",
      tier,
      label: renewalNote ? "Vencido · Em renovação" : "Vencido",
      badge: "danger",
      daysLeft,
      renewalNote,
    };
  }

  if (tier === "first" || tier === "second" || tier === "critical" || tier === "urgent") {
    return {
      situation: renewalNote ? "in_renewal" : "expiring_soon",
      tier,
      label: renewalNote
        ? `Em renovação · ${expiryTierLabel(tier)}`
        : expiryTierLabel(tier),
      badge: expiryTierToBadgeVariant(tier),
      daysLeft,
      renewalNote,
    };
  }

  if (renewalNote) {
    return {
      situation: "in_renewal",
      tier: "ok",
      label: "Em renovação",
      badge: "warning",
      daysLeft,
      renewalNote: true,
    };
  }

  return {
    situation: "valid",
    tier: "ok",
    label: doc.no_expiry ? "Válido (sem vencimento)" : "Válido",
    badge: "success",
    daysLeft,
    renewalNote: false,
  };
}

export function documentDisplayName(type: DocumentType | null | undefined): string {
  if (!type) return "Documento";
  if (type.acronym) return `${type.acronym} — ${type.name}`;
  return type.name;
}

export type DocumentIndicators = {
  valid: number;
  expiring: number;
  expired: number;
  inRenewal: number;
  missing: number;
};

export function buildIndicators(
  requiredTypes: DocumentType[],
  currentDocs: ComplianceDocument[],
  vehicleCategory?: string | null
): DocumentIndicators {
  const applicable = requiredTypes.filter((t) => {
    if (!t.is_active) return false;
    if (!t.vehicle_categories?.length) return true;
    if (!vehicleCategory) return true;
    return t.vehicle_categories.includes(vehicleCategory);
  });

  const byType = new Map(
    currentDocs.filter((d) => d.is_current && d.is_active).map((d) => [d.document_type_id, d])
  );

  const ind: DocumentIndicators = {
    valid: 0,
    expiring: 0,
    expired: 0,
    inRenewal: 0,
    missing: 0,
  };

  for (const t of applicable) {
    const doc = byType.get(t.id) ?? null;
    if (!doc) {
      if (t.is_required) ind.missing += 1;
      continue;
    }
    const view = resolveComplianceSituation(doc, t);
    if (view.renewalNote) ind.inRenewal += 1;
    if (view.situation === "expired" || view.situation === "suspended") ind.expired += 1;
    else if (view.situation === "expiring_soon" || view.tier === "urgent" || view.tier === "critical")
      ind.expiring += 1;
    else if (view.situation === "valid" || view.situation === "in_renewal") ind.valid += 1;
    else if (view.situation === "missing") ind.missing += 1;
  }

  // docs opcionais cadastrados também entram nos contadores
  for (const doc of byType.values()) {
    const t = applicable.find((x) => x.id === doc.document_type_id);
    if (t) continue;
    const type = doc.document_type;
    if (!type || type.applies_to !== "vehicle") continue;
    const view = resolveComplianceSituation(doc, type);
    if (view.renewalNote) ind.inRenewal += 1;
    if (view.situation === "expired") ind.expired += 1;
    else if (view.situation === "expiring_soon") ind.expiring += 1;
    else if (view.situation === "valid") ind.valid += 1;
  }

  return ind;
}

/** Seed inicial de tipos (pedido GRX). */
export const DEFAULT_DOCUMENT_TYPE_SEEDS: Array<
  Omit<DocumentType, "id" | "company_id"> & { acronym: string }
> = [
  {
    name: "Prefixo",
    acronym: "PREFIXO",
    issuing_body: "Empresa / órgão de frota",
    applies_to: "vehicle",
    requires_expiry: false,
    is_required: true,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 5,
    is_active: true,
  },
  {
    name: "Certificado de Vínculo ao Serviço",
    acronym: "CVS",
    issuing_body: "Órgão competente",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: true,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 10,
    is_active: true,
  },
  {
    name: "Cadastro / autorização ANTT",
    acronym: "ANTT",
    issuing_body: "ANTT",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: false,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 20,
    is_active: true,
  },
  {
    name: "Cadastro / licença / vistoria ARTESP",
    acronym: "ARTESP",
    issuing_body: "ARTESP",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: false,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 30,
    is_active: true,
  },
  {
    name: "Cadastro / licença / inspeção EMTU",
    acronym: "EMTU",
    issuing_body: "EMTU",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: false,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 40,
    is_active: true,
  },
  {
    name: "Autorização Especial de Trânsito (ZMRF)",
    acronym: "AET",
    issuing_body: "Órgão de trânsito",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: false,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 50,
    is_active: true,
  },
  {
    name: "Licenciamento / CRLV",
    acronym: "CRLV",
    issuing_body: "DETRAN",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: true,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 60,
    is_active: true,
  },
  {
    name: "Seguro",
    acronym: "SEGURO",
    issuing_body: "Seguradora",
    applies_to: "vehicle",
    requires_expiry: true,
    is_required: false,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 70,
    is_active: true,
  },
  {
    name: "Outros documentos do veículo",
    acronym: "OUTROS",
    issuing_body: null,
    applies_to: "vehicle",
    requires_expiry: false,
    is_required: false,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 200,
    is_active: true,
  },
  {
    name: "Termo de Autorização (TA)",
    acronym: "TA",
    issuing_body: "Órgão competente",
    applies_to: "company",
    requires_expiry: true,
    is_required: true,
    vehicle_categories: [],
    alert_days_first: 60,
    alert_days_second: 30,
    alert_days_critical: 15,
    alert_days_urgent: 7,
    sort_order: 10,
    is_active: true,
  },
];

/** Tipos de empresa que deixam de ser usados (só TA fica na empresa). */
export const COMPANY_DOCUMENT_TYPES_TO_DEACTIVATE = [
  "ARTESP-E",
  "EMTU-E",
  "ANTT-E",
  "CADASTUR",
] as const;

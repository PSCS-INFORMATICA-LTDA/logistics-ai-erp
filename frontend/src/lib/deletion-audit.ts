import type { SupabaseClient } from "@supabase/supabase-js";

export const DELETION_REASON_OPTIONS = [
  { code: "duplicidade", label: "Duplicidade" },
  { code: "cadastro_incorreto", label: "Cadastro incorreto" },
  { code: "solicitacao_cliente", label: "Solicitação do cliente" },
  { code: "teste", label: "Teste" },
  { code: "criado_por_engano", label: "Registro criado por engano" },
  { code: "substituicao_cadastro", label: "Substituição de cadastro" },
  { code: "outro", label: "Outro" },
] as const;

export type DeletionReasonCode = (typeof DELETION_REASON_OPTIONS)[number]["code"];

export const SOFT_RESTORABLE_ENTITY_TYPES = new Set([
  "clients",
  "suppliers",
  "vehicles",
  "partners",
  "drivers",
  "accounts_payable",
  "company_financial_accounts",
]);

export const HARD_RESTORABLE_ENTITY_TYPES = new Set([
  "financial_transactions",
  "vehicle_ownership",
  "traffic_infractions",
  "service_orders",
]);

export const CRITICAL_DELETE_ENTITY_TYPES = new Set([
  "partners",
  "vehicles",
  "drivers",
  "clients",
  "service_orders",
  "financial_transactions",
]);

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  clients: "Cliente",
  suppliers: "Fornecedor",
  vehicles: "Veículo",
  partners: "Sócio",
  drivers: "Motorista",
  financial_transactions: "Lançamento DRE",
  accounts_payable: "Contas a Pagar",
  company_financial_accounts: "Conta financeira",
  vehicle_ownership: "Participação",
  traffic_infractions: "Infração",
  service_orders: "Ordem de serviço",
  chart_of_accounts: "Conta DRE",
};

export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

export function deletionReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return DELETION_REASON_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export function composeDeletionReason(
  reasonCode: string,
  detail: string
): { reason: string; reasonCode: string; error: string | null } {
  const option = DELETION_REASON_OPTIONS.find((o) => o.code === reasonCode);
  if (!option) {
    return { reason: "", reasonCode: "", error: "Selecione um motivo da lista." };
  }

  const trimmedDetail = detail.trim().replace(/\s+/g, " ");
  if (option.code === "outro") {
    const detailError = validateDeletionReason(trimmedDetail);
    if (detailError) {
      return {
        reason: "",
        reasonCode: option.code,
        error: detailError.replace("motivo", "detalhe do motivo"),
      };
    }
    return { reason: trimmedDetail, reasonCode: option.code, error: null };
  }

  if (trimmedDetail) {
    const detailError = validateDeletionReason(trimmedDetail);
    if (detailError) {
      return { reason: "", reasonCode: option.code, error: detailError };
    }
    return {
      reason: `${option.label}: ${trimmedDetail}`,
      reasonCode: option.code,
      error: null,
    };
  }

  return { reason: option.label, reasonCode: option.code, error: null };
}

/** Valida motivo de exclusão: rejeita vazio, muito curto e caracteres repetidos. */
export function validateDeletionReason(reason: string): string | null {
  const trimmed = reason.trim().replace(/\s+/g, " ");
  if (trimmed.length < 8) {
    return "Informe um motivo com pelo menos 8 caracteres.";
  }

  const letters = trimmed.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length < 5) {
    return "Informe um motivo com palavras (não só símbolos ou espaços).";
  }

  if (/^(.)\1+$/iu.test(letters)) {
    return "Não use caracteres repetidos. Descreva o motivo com uma justificativa clara.";
  }

  if (/(.)\1{4,}/iu.test(trimmed)) {
    return "Não use a mesma letra/número várias vezes seguidas. Escreva uma justificativa coerente.";
  }

  const freq = new Map<string, number>();
  for (const ch of letters.toLocaleLowerCase("pt-BR")) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const uniqueCount = freq.size;
  const maxFreq = Math.max(...freq.values());
  if (letters.length >= 6 && uniqueCount <= 2) {
    return "O motivo precisa ser uma justificativa coerente, não caracteres repetidos.";
  }
  if (letters.length >= 6 && maxFreq / letters.length >= 0.7) {
    return "O motivo precisa ser uma justificativa coerente, não caracteres repetidos.";
  }

  return null;
}

export type DeletionAuditEvent = {
  id: string;
  company_id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  screen_key: string | null;
  entity_type: string;
  entity_id: string;
  entity_code: string | null;
  summary: string | null;
  reason: string | null;
  reason_code: string | null;
  delete_mode: "soft" | "hard";
  payload_json: Record<string, unknown> | null;
  restored: boolean;
  restored_at: string | null;
  restored_by: string | null;
  restored_by_name: string | null;
  restored_by_email: string | null;
  restoration_reason: string | null;
};

export type RecordDeletionInput = {
  supabase: SupabaseClient;
  companyId: string;
  entityType: string;
  entityId: string;
  entityCode?: string | null;
  summary?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  screenKey?: string | null;
  deleteMode: "soft" | "hard";
  payload?: Record<string, unknown> | null;
};

/** Snapshot limpo: remove chaves internas e valores muito grandes. */
export function buildDeletionSnapshot(
  row: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("__")) continue;
    if (typeof value === "string" && value.length > 8000) {
      out[key] = `${value.slice(0, 200)}… [truncado]`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Campos legíveis do snapshot para o painel Detalhe. */
export function formatSnapshotLines(
  payload: Record<string, unknown> | null | undefined
): Array<{ label: string; value: string }> {
  if (!payload) return [];

  const preferred: Array<[string, string]> = [
    ["name", "Nome"],
    ["client_name", "Cliente"],
    ["code", "Código"],
    ["plate", "Placa"],
    ["document", "Documento"],
    ["cpf", "CPF/CNPJ"],
    ["cnpj", "CNPJ"],
    ["phone", "Telefone"],
    ["email", "E-mail"],
    ["status", "Status"],
    ["partner_type", "Tipo de sócio"],
    ["description", "Descrição"],
    ["amount", "Valor"],
    ["transaction_date", "Data"],
    ["service_date", "Data do serviço"],
    ["created_at", "Criado em"],
  ];

  const lines: Array<{ label: string; value: string }> = [];
  const used = new Set<string>();

  for (const [key, label] of preferred) {
    if (!(key in payload) || payload[key] == null || payload[key] === "") continue;
    used.add(key);
    const raw = payload[key];
    const value =
      typeof raw === "number"
        ? String(raw)
        : typeof raw === "boolean"
          ? raw
            ? "Sim"
            : "Não"
          : String(raw);
    lines.push({ label, value });
  }

  for (const [key, raw] of Object.entries(payload)) {
    if (used.has(key)) continue;
    if (key === "id" || key === "company_id" || key === "deleted_at") continue;
    if (raw == null || raw === "") continue;
    if (typeof raw === "object") continue;
    lines.push({ label: key, value: String(raw) });
    if (lines.length >= 24) break;
  }

  return lines;
}

/** Campos úteis para resumo / código a partir de um registro genérico. */
export function summarizeDeletedRow(
  row: Record<string, unknown> | null | undefined,
  entityType: string
): { entityCode: string | null; summary: string } {
  if (!row) return { entityCode: null, summary: entityTypeLabel(entityType) };

  const code =
    (typeof row.code === "string" && row.code) ||
    (typeof row.plate === "string" && row.plate) ||
    null;

  const parts: string[] = [];
  if (typeof row.name === "string" && row.name.trim()) parts.push(row.name.trim());
  if (typeof row.client_name === "string" && row.client_name.trim()) {
    parts.push(row.client_name.trim());
  }
  if (typeof row.description === "string" && row.description.trim()) {
    parts.push(row.description.trim());
  }
  if (typeof row.plate === "string" && row.plate && row.plate !== code) {
    parts.push(row.plate);
  }
  if (row.amount != null && row.amount !== "") {
    parts.push(`R$ ${Number(row.amount).toFixed(2)}`);
  }
  if (typeof row.transaction_date === "string" && row.transaction_date) {
    parts.push(row.transaction_date);
  }
  if (typeof row.status === "string" && row.status) parts.push(row.status);

  const summary =
    parts.length > 0 ? parts.slice(0, 4).join(" · ") : entityTypeLabel(entityType);
  return { entityCode: code, summary };
}

export function canRestoreDeletionEvent(row: DeletionAuditEvent): boolean {
  if (row.restored) return false;
  if (row.delete_mode === "soft") {
    return SOFT_RESTORABLE_ENTITY_TYPES.has(row.entity_type);
  }
  if (row.delete_mode === "hard") {
    return (
      HARD_RESTORABLE_ENTITY_TYPES.has(row.entity_type) &&
      Boolean(row.payload_json && typeof row.payload_json === "object" && row.payload_json.id)
    );
  }
  return false;
}

async function resolveActor(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ userId: string | null; name: string | null; email: string | null }> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return { userId: null, name: null, email: null };

  const email = user.email ?? null;
  let name: string | null =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    null;

  const { data: member } = await supabase
    .from("company_members")
    .select("partner_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (member?.partner_id) {
    const { data: partner } = await supabase
      .from("partners")
      .select("name")
      .eq("id", member.partner_id)
      .maybeSingle();
    if (partner?.name) name = partner.name as string;
  }

  if (!name && email) name = email.split("@")[0] ?? email;

  return { userId: user.id, name, email };
}

function isMissingColumnError(message: string | null | undefined, column: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes(column.toLowerCase()) && (m.includes("does not exist") || m.includes("não existe"));
}

function reasonFromPayload(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || typeof payload !== "object") return null;
  const nested = payload.__deletion_reason;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

function reasonCodeFromPayload(
  payload: Record<string, unknown> | null | undefined
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const nested = payload.__deletion_reason_code;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

/** Grava evento de exclusão com snapshot. Motivo é obrigatório. */
export async function recordDeletion(
  input: RecordDeletionInput
): Promise<{ error: string | null }> {
  const reason = input.reason?.trim().replace(/\s+/g, " ") || "";
  const reasonError = validateDeletionReason(reason);
  if (reasonError) return { error: reasonError };

  const reasonCode = input.reasonCode?.trim() || null;
  const actor = await resolveActor(input.supabase, input.companyId);
  const snapshot = buildDeletionSnapshot(input.payload);

  const base = {
    company_id: input.companyId,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    actor_email: actor.email,
    screen_key: input.screenKey ?? null,
    entity_type: input.entityType,
    entity_id: String(input.entityId),
    entity_code: input.entityCode ?? null,
    summary: input.summary ?? null,
    delete_mode: input.deleteMode,
    payload_json: snapshot,
  };

  const withExtras = {
    ...base,
    reason,
    reason_code: reasonCode,
  };

  const { error } = await input.supabase.from("deletion_audit_events").insert(withExtras);
  if (!error) return { error: null };

  if (isMissingColumnError(error.message, "reason_code")) {
    const retry = await input.supabase.from("deletion_audit_events").insert({
      ...base,
      reason,
      payload_json: {
        ...(snapshot ?? {}),
        __deletion_reason_code: reasonCode,
      },
    });
    if (!retry.error) return { error: null };
    if (isMissingColumnError(retry.error.message, "reason")) {
      const fallback = await input.supabase.from("deletion_audit_events").insert({
        ...base,
        payload_json: {
          ...(snapshot ?? {}),
          __deletion_reason: reason,
          __deletion_reason_code: reasonCode,
        },
      });
      return { error: fallback.error?.message ?? null };
    }
    return { error: retry.error.message };
  }

  if (isMissingColumnError(error.message, "reason")) {
    const retry = await input.supabase.from("deletion_audit_events").insert({
      ...base,
      payload_json: {
        ...(snapshot ?? {}),
        __deletion_reason: reason,
        __deletion_reason_code: reasonCode,
      },
    });
    return { error: retry.error?.message ?? null };
  }

  return { error: error.message };
}

export type ListDeletionAuditOptions = {
  limit?: number;
  entityType?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  deleteMode?: "soft" | "hard" | null;
  restored?: boolean | null;
  reasonCode?: string | null;
  actorQuery?: string | null;
  recordCode?: string | null;
  reasonQuery?: string | null;
};

export async function listDeletionAuditEvents(
  supabase: SupabaseClient,
  companyId: string,
  options?: ListDeletionAuditOptions
): Promise<{ rows: DeletionAuditEvent[]; error: string | null; missingHardening?: boolean }> {
  const selectFull =
    "id, company_id, occurred_at, actor_user_id, actor_name, actor_email, screen_key, entity_type, entity_id, entity_code, summary, reason, reason_code, delete_mode, payload_json, restored, restored_at, restored_by, restored_by_name, restored_by_email, restoration_reason";
  const selectBasic =
    "id, company_id, occurred_at, actor_user_id, actor_name, actor_email, screen_key, entity_type, entity_id, entity_code, summary, reason, delete_mode, payload_json";

  const run = async (select: string) => {
    let query = supabase
      .from("deletion_audit_events")
      .select(select)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .limit(options?.limit ?? 300);

    if (options?.entityType) query = query.eq("entity_type", options.entityType);
    if (options?.fromDate) query = query.gte("occurred_at", `${options.fromDate}T00:00:00`);
    if (options?.toDate) query = query.lte("occurred_at", `${options.toDate}T23:59:59.999`);
    if (options?.deleteMode) query = query.eq("delete_mode", options.deleteMode);
    if (typeof options?.restored === "boolean" && select.includes("restored")) {
      query = query.eq("restored", options.restored);
    }
    if (options?.reasonCode && select.includes("reason_code")) {
      query = query.eq("reason_code", options.reasonCode);
    }
    if (options?.recordCode?.trim()) {
      query = query.ilike("entity_code", `%${options.recordCode.trim()}%`);
    }
    if (options?.reasonQuery?.trim()) {
      query = query.ilike("reason", `%${options.reasonQuery.trim()}%`);
    }
    if (options?.actorQuery?.trim()) {
      const q = options.actorQuery.trim();
      query = query.or(`actor_name.ilike.%${q}%,actor_email.ilike.%${q}%`);
    }
    return query;
  };

  const first = await run(selectFull);
  let data = first.data;
  let error = first.error;
  let missingHardening = false;

  if (
    error &&
    (isMissingColumnError(error.message, "restored") ||
      isMissingColumnError(error.message, "reason_code"))
  ) {
    missingHardening = true;
    const second = await run(selectBasic);
    data = second.data;
    error = second.error;
  }

  if (error) return { rows: [], error: error.message, missingHardening };

  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const payload = (row.payload_json as Record<string, unknown> | null) ?? null;
    const reason =
      (typeof row.reason === "string" && row.reason) || reasonFromPayload(payload) || null;
    const reason_code =
      (typeof row.reason_code === "string" && row.reason_code) ||
      reasonCodeFromPayload(payload) ||
      null;
    return {
      id: String(row.id),
      company_id: String(row.company_id),
      occurred_at: String(row.occurred_at),
      actor_user_id: (row.actor_user_id as string | null) ?? null,
      actor_name: (row.actor_name as string | null) ?? null,
      actor_email: (row.actor_email as string | null) ?? null,
      screen_key: (row.screen_key as string | null) ?? null,
      entity_type: String(row.entity_type),
      entity_id: String(row.entity_id),
      entity_code: (row.entity_code as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
      reason,
      reason_code,
      delete_mode: (row.delete_mode as "soft" | "hard") ?? "soft",
      payload_json: payload,
      restored: Boolean(row.restored),
      restored_at: (row.restored_at as string | null) ?? null,
      restored_by: (row.restored_by as string | null) ?? null,
      restored_by_name: (row.restored_by_name as string | null) ?? null,
      restored_by_email: (row.restored_by_email as string | null) ?? null,
      restoration_reason: (row.restoration_reason as string | null) ?? null,
    } satisfies DeletionAuditEvent;
  });

  return { rows, error: null, missingHardening };
}

export async function restoreSoftDeletedFromAudit(
  supabase: SupabaseClient,
  eventId: string,
  restorationReason: string
): Promise<{ error: string | null }> {
  return restoreDeletedFromAudit(supabase, eventId, restorationReason);
}

export async function restoreDeletedFromAudit(
  supabase: SupabaseClient,
  eventId: string,
  restorationReason: string
): Promise<{ error: string | null }> {
  const reasonError = validateDeletionReason(restorationReason);
  if (reasonError) return { error: reasonError };

  const reason = restorationReason.trim().replace(/\s+/g, " ");
  const primary = await supabase.rpc("restore_deleted_from_audit", {
    p_event_id: eventId,
    p_restoration_reason: reason,
  });

  if (!primary.error) return { error: null };

  const fallback = await supabase.rpc("restore_soft_deleted_from_audit", {
    p_event_id: eventId,
    p_restoration_reason: reason,
  });

  if (!fallback.error) return { error: null };

  const msg = primary.error.message || fallback.error.message || "Falha ao restaurar.";
  if (isMissingColumnError(msg, "restored") || msg.toLowerCase().includes("function")) {
    return {
      error:
        "Função de restauração ainda não está no banco. Aplique apply-054 e apply-055 no Supabase.",
    };
  }
  return { error: msg };
}

/** Heurística simples de exclusões anormais no conjunto carregado. */
export function detectAbnormalDeletions(rows: DeletionAuditEvent[]): string[] {
  const alerts: string[] = [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = rows.filter((r) => new Date(r.occurred_at).getTime() >= dayAgo);

  const byUser = new Map<string, number>();
  for (const row of recent) {
    const key = row.actor_email || row.actor_name || row.actor_user_id || "desconhecido";
    byUser.set(key, (byUser.get(key) ?? 0) + 1);
  }
  for (const [user, count] of byUser) {
    if (count >= 10) {
      alerts.push(`${user} registrou ${count} exclusões nas últimas 24h.`);
    }
  }

  const financial = recent.filter((r) => r.entity_type === "financial_transactions").length;
  if (financial >= 5) {
    alerts.push(`${financial} exclusões de lançamentos financeiros nas últimas 24h.`);
  }

  const hard = recent.filter((r) => r.delete_mode === "hard").length;
  if (hard >= 8) {
    alerts.push(`${hard} exclusões definitivas (hard) nas últimas 24h.`);
  }

  const offHours = recent.filter((r) => {
    const h = new Date(r.occurred_at).getHours();
    return h < 6 || h >= 22;
  }).length;
  if (offHours >= 3) {
    alerts.push(`${offHours} exclusões fora do horário habitual (antes das 6h ou após 22h).`);
  }

  return alerts;
}

export async function exportDeletionAuditExcel(rows: DeletionAuditEvent[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Logistics AI Platform";
  wb.created = new Date();
  const sheet = wb.addWorksheet("Historico exclusoes");
  sheet.columns = [
    { header: "Data/hora exclusão", key: "occurred", width: 22 },
    { header: "Usuário", key: "actor", width: 28 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Tela", key: "screen", width: 28 },
    { header: "Módulo", key: "module", width: 18 },
    { header: "Código", key: "code", width: 14 },
    { header: "Resumo", key: "summary", width: 36 },
    { header: "Motivo (código)", key: "reasonCode", width: 18 },
    { header: "Motivo", key: "reason", width: 40 },
    { header: "Modo", key: "mode", width: 10 },
    { header: "Status", key: "status", width: 12 },
    { header: "Restaurado em", key: "restoredAt", width: 22 },
    { header: "Restaurado por", key: "restoredBy", width: 28 },
    { header: "Motivo restauração", key: "restorationReason", width: 36 },
    { header: "ID registro", key: "entityId", width: 38 },
  ];

  for (const row of rows) {
    sheet.addRow({
      occurred: row.occurred_at,
      actor: row.actor_name ?? "",
      email: row.actor_email ?? "",
      screen: row.screen_key ?? "",
      module: entityTypeLabel(row.entity_type),
      code: row.entity_code ?? "",
      summary: row.summary ?? "",
      reasonCode: row.reason_code ?? "",
      reason: row.reason ?? "",
      mode: row.delete_mode,
      status: row.restored ? "Restaurado" : "Excluído",
      restoredAt: row.restored_at ?? "",
      restoredBy: row.restored_by_name ?? row.restored_by_email ?? "",
      restorationReason: row.restoration_reason ?? "",
      entityId: row.entity_id,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `historico-exclusoes-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

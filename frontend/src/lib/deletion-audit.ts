import type { SupabaseClient } from "@supabase/supabase-js";

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
  delete_mode: "soft" | "hard";
  payload_json: Record<string, unknown> | null;
};

export type RecordDeletionInput = {
  supabase: SupabaseClient;
  companyId: string;
  entityType: string;
  entityId: string;
  entityCode?: string | null;
  summary?: string | null;
  reason?: string | null;
  screenKey?: string | null;
  deleteMode: "soft" | "hard";
  payload?: Record<string, unknown> | null;
};

/** Campos úteis para resumo / código a partir de um registro genérico. */
export function summarizeDeletedRow(
  row: Record<string, unknown> | null | undefined,
  entityType: string
): { entityCode: string | null; summary: string } {
  if (!row) return { entityCode: null, summary: entityType };

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

  const summary = parts.length > 0 ? parts.slice(0, 4).join(" · ") : entityType;
  return { entityCode: code, summary };
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

function isMissingReasonColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("reason") && (m.includes("does not exist") || m.includes("não existe"));
}

function reasonFromPayload(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || typeof payload !== "object") return null;
  const nested = payload.__deletion_reason;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

/** Grava evento de exclusão. Motivo é obrigatório; se a coluna reason ainda não existir no banco, grava no payload. */
export async function recordDeletion(
  input: RecordDeletionInput
): Promise<{ error: string | null }> {
  const reason = input.reason?.trim().replace(/\s+/g, " ") || "";
  const reasonError = validateDeletionReason(reason);
  if (reasonError) return { error: reasonError };

  const actor = await resolveActor(input.supabase, input.companyId);
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
  };

  const { error } = await input.supabase.from("deletion_audit_events").insert({
    ...base,
    reason,
    payload_json: input.payload ?? null,
  });

  if (!error) return { error: null };

  if (isMissingReasonColumnError(error.message)) {
    const payloadWithReason = {
      ...(input.payload ?? {}),
      __deletion_reason: reason,
    };
    const retry = await input.supabase.from("deletion_audit_events").insert({
      ...base,
      payload_json: payloadWithReason,
    });
    // Log gravado sem a coluna reason (motivo fica no payload). Aplique o SQL 049 quando puder.
    return { error: retry.error?.message ?? null };
  }

  return { error: error.message };
}

export async function listDeletionAuditEvents(
  supabase: SupabaseClient,
  companyId: string,
  options?: { limit?: number; entityType?: string | null; fromDate?: string | null; toDate?: string | null }
): Promise<{ rows: DeletionAuditEvent[]; error: string | null; missingReasonColumn?: boolean }> {
  const selectWithReason =
    "id, company_id, occurred_at, actor_user_id, actor_name, actor_email, screen_key, entity_type, entity_id, entity_code, summary, reason, delete_mode, payload_json";
  const selectWithoutReason =
    "id, company_id, occurred_at, actor_user_id, actor_name, actor_email, screen_key, entity_type, entity_id, entity_code, summary, delete_mode, payload_json";

  const run = async (select: string) => {
    let query = supabase
      .from("deletion_audit_events")
      .select(select)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .limit(options?.limit ?? 200);

    if (options?.entityType) query = query.eq("entity_type", options.entityType);
    if (options?.fromDate) query = query.gte("occurred_at", `${options.fromDate}T00:00:00`);
    if (options?.toDate) query = query.lte("occurred_at", `${options.toDate}T23:59:59.999`);
    return query;
  };

  const first = await run(selectWithReason);
  let data = first.data;
  let error = first.error;
  let missingReasonColumn = false;

  if (error && isMissingReasonColumnError(error.message)) {
    missingReasonColumn = true;
    const second = await run(selectWithoutReason);
    data = second.data;
    error = second.error;
  }

  if (error) return { rows: [], error: error.message, missingReasonColumn };

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const payload = (row.payload_json as Record<string, unknown> | null) ?? null;
    const reason =
      (typeof row.reason === "string" && row.reason) || reasonFromPayload(payload) || null;
    return {
      ...(row as unknown as DeletionAuditEvent),
      reason,
    };
  });

  return { rows, error: null, missingReasonColumn };
}

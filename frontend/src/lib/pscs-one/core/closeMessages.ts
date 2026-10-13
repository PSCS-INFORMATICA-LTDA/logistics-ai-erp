export const CLOSE_SUCCESS_CREATED = "OS concluída e recebível registrado.";
export const CLOSE_SUCCESS_REPLAY = "OS concluída. Recebível já estava registrado.";
export const CLOSE_PARTY_MAPPING_MESSAGE =
  "Cliente ainda não está vinculado ao cadastro financeiro do PSCS One.";
export const CLOSE_CORE_UNAVAILABLE_MESSAGE =
  "Não foi possível registrar o recebível. A OS não foi concluída.";

const CORE_FAILURE_CODES = new Set([
  "core_unconfigured",
  "core_unauthenticated",
  "core_unauthorized",
  "core_unavailable",
  "core_invalid_response",
  "core_session_missing",
  "core_session_invalid",
  "IDEMPOTENCY_CONFLICT",
]);

export function closeIntegratedMessage(input: {
  ok: boolean;
  code?: string | null;
  receivableCreated?: boolean;
  fallback?: string | null;
}): string {
  if (input.ok) {
    return input.receivableCreated ? CLOSE_SUCCESS_CREATED : CLOSE_SUCCESS_REPLAY;
  }
  if (input.code === "CORE_PARTY_MAPPING_REQUIRED") return CLOSE_PARTY_MAPPING_MESSAGE;
  if (input.code && CORE_FAILURE_CODES.has(input.code)) return CLOSE_CORE_UNAVAILABLE_MESSAGE;
  return input.fallback || CLOSE_CORE_UNAVAILABLE_MESSAGE;
}

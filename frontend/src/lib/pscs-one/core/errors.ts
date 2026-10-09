export type CoreArErrorCode =
  | "core_unconfigured"
  | "core_unauthenticated"
  | "core_unauthorized"
  | "core_unavailable"
  | "core_invalid_response"
  | "tenant_mapping_missing"
  | "receivable_not_found"
  | "core_session_missing"
  | "core_session_invalid";

export class CoreArError extends Error {
  readonly code: CoreArErrorCode;
  readonly status: number;
  readonly detail?: string;

  constructor(code: CoreArErrorCode, message: string, status = 502, detail?: string) {
    super(message);
    this.name = "CoreArError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function mapCoreHttpError(status: number, body: unknown): CoreArError {
  const payload = body as { error?: { code?: string; message?: string } };
  const remoteCode = payload?.error?.code;
  const remoteMessage = payload?.error?.message;

  if (status === 401 || remoteCode === "UNAUTHENTICATED") {
    return new CoreArError(
      "core_unauthenticated",
      remoteMessage || "Core authentication required.",
      401,
    );
  }
  if (status === 403 || remoteCode === "UNAUTHORIZED") {
    return new CoreArError(
      "core_unauthorized",
      remoteMessage || "Core authorization denied.",
      403,
    );
  }
  if (status === 404 || remoteCode === "NOT_FOUND") {
    return new CoreArError(
      "receivable_not_found",
      remoteMessage || "Receivable not found in Core.",
      404,
    );
  }
  if (status >= 500) {
    return new CoreArError(
      "core_unavailable",
      remoteMessage || "Core AR service unavailable.",
      502,
    );
  }
  return new CoreArError(
    "core_invalid_response",
    remoteMessage || "Unexpected Core AR response.",
    status >= 400 ? status : 502,
  );
}

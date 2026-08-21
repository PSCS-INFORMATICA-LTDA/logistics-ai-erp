export function ssoErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function publicPscsOneSsoReason(error: unknown): string {
  const raw = ssoErrorText(error);
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 180);

  if (/service role|sso_admin_unconfigured|admin_unconfigured/i.test(text)) {
    return "sso_admin_unconfigured";
  }
  if (
    /pscs_one_user_id|schema cache|could not find the .* column|column .* does not exist/i.test(
      text,
    )
  ) {
    return "identity_schema_mismatch";
  }
  if (/null value in column/i.test(text)) {
    return "identity_row_rejected";
  }
  if (/already been registered|duplicate key|already exists/i.test(text)) {
    return "identity_conflict";
  }
  if (/row-level security|violates row-level/i.test(text)) {
    return "identity_policy_denied";
  }
  if (/violates foreign key/i.test(text)) {
    return "membership_fk_denied";
  }
  if (/violates check|violates not-null/i.test(text)) {
    return "identity_row_rejected";
  }
  if (/database error/i.test(text)) {
    return "identity_db_denied";
  }
  if (/redirect url|redirect_to/i.test(text)) {
    return "session_redirect_denied";
  }
  if (/token_payload_invalid|unsupported_contract/i.test(text)) {
    return text.includes("unsupported") ? "unsupported_contract" : "token_payload_invalid";
  }
  if (/fetch failed|failed to fetch|network/i.test(text)) {
    return "session_fetch_failed";
  }
  if (error instanceof TypeError) {
    return "session_type_failed";
  }
  if (/session_cookie_failed|cannot set cookie/i.test(text)) {
    return "session_cookie_failed";
  }
  if (/create_user_failed|user not allowed/i.test(text)) {
    return "create_user_failed";
  }
  if (/session_link_failed|hashed_token|verifyotp|otp/i.test(text)) {
    return "session_link_failed";
  }
  if (
    /denied|revoked|expired|replay|invalid|mismatch|conflict|missing|unconfigured|disabled/i.test(
      text,
    )
  ) {
    if (/^[a-z0-9_]{3,80}$/i.test(text)) return text;
    return "sso_failed";
  }
  return "sso_failed";
}

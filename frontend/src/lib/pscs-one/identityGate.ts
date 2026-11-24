/**
 * Reconhecimento do usuário do Logistics no Core.
 * Não cria usuário, não grava membership e não usa service_role.
 * O JWT do Logistics não autoriza o Core. O cookie de sessão do Core é outro projeto Auth.
 */

export type LogisticsRole = "admin" | "financeiro" | "operacional" | "socio";
export type CoreMembershipRole = "company_admin" | "platform_admin" | "member" | "branch_manager" | "auditor";

export type IdentityDecisionCode =
  | "recognized_admin"
  | "recognized_read_only"
  | "core_session_missing"
  | "identity_conflict"
  | "duplicate_user"
  | "identity_unbound"
  | "role_not_granted"
  | "company_mismatch"
  | "tenant_mapping_missing";

export type IdentityActor = {
  logisticsUserId: string;
  logisticsRole: LogisticsRole;
  logisticsCompanyId: string;
  pscsOneUserId: string | null;
  coreUserId: string | null;
  coreCompanyId: string | null;
  mappedLogisticsCompanyId: string | null;
  coreMembershipRole: CoreMembershipRole | null;
  coreMembershipActive: boolean;
  duplicateCoreEmail: boolean;
};

export type IdentityDecision = {
  code: IdentityDecisionCode;
  arWrite: boolean;
  coreRead: boolean;
};

const AR_WRITE_ROLES: readonly CoreMembershipRole[] = ["company_admin", "platform_admin"];

export function decideSharedIdentity(actor: IdentityActor): IdentityDecision {
  if (!actor.coreUserId) {
    return { code: "core_session_missing", arWrite: false, coreRead: false };
  }
  if (actor.duplicateCoreEmail) {
    return { code: "duplicate_user", arWrite: false, coreRead: false };
  }
  if (!actor.pscsOneUserId) {
    return { code: "identity_unbound", arWrite: false, coreRead: false };
  }
  if (actor.pscsOneUserId !== actor.coreUserId) {
    return { code: "identity_conflict", arWrite: false, coreRead: false };
  }
  if (!actor.mappedLogisticsCompanyId || actor.mappedLogisticsCompanyId !== actor.logisticsCompanyId) {
    return { code: "company_mismatch", arWrite: false, coreRead: false };
  }
  if (!actor.coreCompanyId || !actor.coreMembershipActive || !actor.coreMembershipRole) {
    return { code: "tenant_mapping_missing", arWrite: false, coreRead: false };
  }
  if (actor.logisticsRole !== "admin") {
    return { code: "role_not_granted", arWrite: false, coreRead: actor.coreMembershipRole === "member" };
  }
  if (!AR_WRITE_ROLES.includes(actor.coreMembershipRole)) {
    return { code: "role_not_granted", arWrite: false, coreRead: true };
  }
  return { code: "recognized_admin", arWrite: true, coreRead: true };
}

export type ReceivableLedger = {
  original: number;
  payments: Array<{ key: string; amount: number; companyId: string }>;
  reversals: Array<{ key: string; paymentKey: string; amount: number; reason: string }>;
};

export type LedgerStep =
  | { ok: true; balance: number; created: boolean; code: "POSTED" | "ALREADY_POSTED" | "REVERSED" | "ALREADY_REVERSED" }
  | { ok: false; balance: number; code: "AMOUNT_EXCEEDS_BALANCE" | "IDEMPOTENCY_CONFLICT" | "FORBIDDEN" };

export function postedBalance(ledger: ReceivableLedger, companyId: string): number {
  const paid = ledger.payments
    .filter((payment) => payment.companyId === companyId)
    .reduce((sum, payment) => {
      const reversed = ledger.reversals.some((reversal) => reversal.paymentKey === payment.key);
      return reversed ? sum : sum + payment.amount;
    }, 0);
  return roundMoney(ledger.original - paid);
}

export function postPartial(
  ledger: ReceivableLedger,
  input: { companyId: string; key: string; amount: number; actorCompanyId: string },
): { ledger: ReceivableLedger; step: LedgerStep } {
  const balance = postedBalance(ledger, input.companyId);
  if (input.actorCompanyId !== input.companyId) {
    return { ledger, step: { ok: false, balance, code: "FORBIDDEN" } };
  }
  const existing = ledger.payments.find((payment) => payment.key === input.key);
  if (existing) {
    if (existing.amount !== input.amount || existing.companyId !== input.companyId) {
      return { ledger, step: { ok: false, balance, code: "IDEMPOTENCY_CONFLICT" } };
    }
    return { ledger, step: { ok: true, balance, created: false, code: "ALREADY_POSTED" } };
  }
  if (input.amount <= 0 || input.amount > balance) {
    return { ledger, step: { ok: false, balance, code: "AMOUNT_EXCEEDS_BALANCE" } };
  }
  const next = {
    ...ledger,
    payments: [...ledger.payments, { key: input.key, amount: input.amount, companyId: input.companyId }],
  };
  return {
    ledger: next,
    step: { ok: true, balance: postedBalance(next, input.companyId), created: true, code: "POSTED" },
  };
}

export function reversePayment(
  ledger: ReceivableLedger,
  input: { companyId: string; paymentKey: string; key: string; reason: string; actorCompanyId: string },
): { ledger: ReceivableLedger; step: LedgerStep } {
  const balance = postedBalance(ledger, input.companyId);
  if (input.actorCompanyId !== input.companyId) {
    return { ledger, step: { ok: false, balance, code: "FORBIDDEN" } };
  }
  const payment = ledger.payments.find((row) => row.key === input.paymentKey && row.companyId === input.companyId);
  if (!payment) {
    return { ledger, step: { ok: false, balance, code: "FORBIDDEN" } };
  }
  const existing = ledger.reversals.find((row) => row.key === input.key || row.paymentKey === input.paymentKey);
  if (existing) {
    if (existing.key !== input.key || existing.reason !== input.reason || existing.amount !== payment.amount) {
      return { ledger, step: { ok: false, balance, code: "IDEMPOTENCY_CONFLICT" } };
    }
    return { ledger, step: { ok: true, balance, created: false, code: "ALREADY_REVERSED" } };
  }
  const next = {
    ...ledger,
    reversals: [...ledger.reversals, { key: input.key, paymentKey: input.paymentKey, amount: payment.amount, reason: input.reason }],
  };
  return {
    ledger: next,
    step: { ok: true, balance: postedBalance(next, input.companyId), created: true, code: "REVERSED" },
  };
}

export function logisticsApprovedResult(input: { freight: number; toll: number; driver: number; patio: number }): {
  withoutPatio: number;
  withPatio: number;
} {
  const withoutPatio = roundMoney(input.freight - input.toll - input.driver);
  return { withoutPatio, withPatio: roundMoney(withoutPatio + input.patio) };
}

export function reprocessServiceOrder(input: {
  receivableExists: boolean;
  localCompleted: boolean;
}): { createReceivable: boolean; completeLocal: boolean; code: "REUSED" | "LOCAL_CLOSE_FAILED" | "CREATE" } {
  if (input.receivableExists && input.localCompleted) {
    return { createReceivable: false, completeLocal: false, code: "REUSED" };
  }
  if (input.receivableExists && !input.localCompleted) {
    return { createReceivable: false, completeLocal: true, code: "LOCAL_CLOSE_FAILED" };
  }
  return { createReceivable: true, completeLocal: true, code: "CREATE" };
}

const REJECTED_EMAIL_SUFFIXES = [".local", ".test", ".invalid"];

export function recoveryAddressDecision(email: string): { ok: boolean; reason: "valid_homolog" | "local_domain" | "malformed" } {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1 || value.includes(" ")) {
    return { ok: false, reason: "malformed" };
  }
  const domain = value.slice(at + 1);
  if (REJECTED_EMAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix))) {
    return { ok: false, reason: "local_domain" };
  }
  if (!domain.includes(".")) return { ok: false, reason: "malformed" };
  return { ok: true, reason: "valid_homolog" };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

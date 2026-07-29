/**
 * Testes unitários Contas a Pagar (sem rede).
 * Uso: node scripts/test-accounts-payable.mjs
 */
import assert from "node:assert/strict";
import {
  AP_APPROVAL_LABELS,
  AP_STATUS_LABELS,
  calcNetAmount,
  payeeLabel,
  splitInstallments,
} from "../src/lib/accounts-payable.ts";
import { formatCurrency, formatDateBR } from "../src/lib/utils.ts";

assert.equal(formatDateBR("2026-07-29"), "29/07/2026");
assert.equal(formatDateBR(null), "—");
assert.equal(formatCurrency(150.5), "R$\u00a0150,50");

assert.equal(AP_APPROVAL_LABELS.draft, "Rascunho");
assert.equal(AP_APPROVAL_LABELS.submitted, "Pendente de aprovação");
assert.equal(AP_STATUS_LABELS.partially_paid, "Parcialmente pago");

const parts = splitInstallments(100, 3, "2026-01-15");
assert.equal(parts.length, 3);
assert.equal(parts[0].due_date, "2026-01-15");
assert.equal(parts[1].due_date, "2026-02-15");
assert.equal(parts[2].due_date, "2026-03-15");
assert.equal(
  Math.round((parts[0].amount + parts[1].amount + parts[2].amount) * 100),
  10000
);

assert.equal(calcNetAmount({ originalAmount: 100, discountAmount: 10 }), 90);
assert.equal(payeeLabel({ supplier_name: "Posto X" }), "Posto X");
assert.equal(payeeLabel({}), "—");

console.log("test-accounts-payable OK");

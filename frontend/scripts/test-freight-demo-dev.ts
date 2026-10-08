import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertDevTarget,
  DEMO_EMAIL,
  DRIVER_EXPENSE_AMOUNT,
  MARKER,
  OFFICIAL_DEV_REF,
  ORDER_CODE,
  PROD_REF,
  PROPOSAL_AMOUNT,
  TARGET_CLIENT_ID,
  TARGET_COMPANY_ID,
} from "./freight-demo-dev.mjs";

describe("freight demo fixture guard", () => {
  it("accepts only Logistics DEV", () => {
    assert.equal(assertDevTarget(`https://${OFFICIAL_DEV_REF}.supabase.co`), OFFICIAL_DEV_REF);
  });

  it("refuses production and any other project", () => {
    assert.throws(
      () => assertDevTarget(`https://${PROD_REF}.supabase.co`),
      /production supabase is forbidden/,
    );
    assert.throws(
      () => assertDevTarget("https://uvyaqklvqcakwfvfopof.supabase.co"),
      /not Logistics DEV/,
    );
    assert.throws(() => assertDevTarget(""), /not Logistics DEV/);
  });

  it("keeps the official marker and does not create schema", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "freight-demo-dev.mjs"), "utf8");
    assert.equal(MARKER, "PSCS_LOGISTICS_FREIGHT_DEMO_001");
    assert.equal(ORDER_CODE, "PSCS-FREIGHT-DEMO-001");
    assert.equal(TARGET_COMPANY_ID, "bcd3c6c9-0e4a-4356-addd-4af925725576");
    assert.equal(TARGET_CLIENT_ID, "8583bec2-0faa-4576-96dc-04ff0cf6d48e");
    assert.equal(DEMO_EMAIL, "dev.ap.b.admin@pscs.local");
    assert.equal(PROPOSAL_AMOUNT, 800);
    assert.equal(DRIVER_EXPENSE_AMOUNT, 150);
    assert.match(source, /TARGET_COMPANY_ID/);
    assert.match(source, /TARGET_CLIENT_ID/);
    assert.match(source, /status:\s*"Aberto"/);
    assert.match(source, /service_type:\s*"Frete"/);
    assert.doesNotMatch(source, /dev\.ap@pscs\.local/);
    assert.match(source, /\.eq\("id", TARGET_CLIENT_ID\)/);
    assert.match(source, /\.eq\("user_id", userData\.user\.id\)/);
    assert.match(source, /mark_proposal_sent/);
    assert.match(source, /respond_to_proposal/);
    assert.match(source, /send_driver_assignment/);
    assert.match(source, /respond_to_driver_assignment/);
    assert.match(source, /complete_service_order/);
    assert.match(source, /mark_driver_payment_paid/);
    assert.doesNotMatch(source, /create table/i);
    assert.doesNotMatch(source, /accounts_receivable/i);
    assert.doesNotMatch(source, /DEV_SEED_PASSWORD\s*=\s*["']/);
  });
});

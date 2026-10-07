import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { assertDevTarget, MARKER, OFFICIAL_DEV_REF, ORDER_CODE, PROD_REF } from "./freight-demo-dev.mjs";

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

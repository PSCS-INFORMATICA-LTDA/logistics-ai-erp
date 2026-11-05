import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDriverAssignmentWhatsAppText,
  formatDriverScheduleMoment,
  resolveDriverAssignmentSchedule,
} from "../src/lib/service-order-driver-assignment.ts";

const migrationPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "083_public_driver_assignment_schedule.sql",
);

describe("apresentação oficial da OS", () => {
  it("usa entry_date e entry_time mesmo quando a saída é 30 minutos depois", () => {
    const schedule = resolveDriverAssignmentSchedule({
      serviceDate: "2026-11-04",
      entryDate: "2026-11-04",
      entryTime: "18:00:00",
      exitDate: "2026-11-04",
      exitTime: "18:30:00",
    });

    assert.equal(schedule.presentationSource, "recorded");
    assert.equal(schedule.presentationDate, "2026-11-04");
    assert.equal(schedule.presentationTime, "18:00");
    assert.equal(schedule.departureTime, "18:30");
    assert.equal(
      formatDriverScheduleMoment(schedule.presentationDate, schedule.presentationTime),
      "04/11/2026 18:00",
    );
    assert.equal(
      formatDriverScheduleMoment(schedule.departureDate, schedule.departureTime),
      "04/11/2026 18:30",
    );
  });

  it("não substitui uma apresentação divergente da antecedência de 30 minutos", () => {
    const schedule = resolveDriverAssignmentSchedule({
      serviceDate: "2026-11-04",
      entryDate: "2026-11-04",
      entryTime: "10:00",
      exitDate: "2026-11-04",
      exitTime: "18:30",
    });

    assert.equal(schedule.presentationSource, "recorded");
    assert.equal(schedule.presentationTime, "10:00");
    assert.equal(schedule.departureTime, "18:30");
  });

  it("usa a data do serviço quando a apresentação tem hora e não tem data própria", () => {
    const schedule = resolveDriverAssignmentSchedule({
      serviceDate: "2026-11-04",
      entryTime: "18:00:00",
      exitTime: "18:30:00",
    });

    assert.equal(schedule.presentationSource, "recorded");
    assert.equal(schedule.presentationDate, "2026-11-04");
  });
});

describe("fallback visual de 30 minutos", () => {
  it("calcula a apresentação quando ela não foi cadastrada", () => {
    const schedule = resolveDriverAssignmentSchedule({
      serviceDate: "2026-11-04",
      exitDate: "2026-11-04",
      exitTime: "18:30:00",
    });

    assert.equal(schedule.presentationSource, "fallback");
    assert.equal(schedule.presentationDate, "2026-11-04");
    assert.equal(schedule.presentationTime, "18:00");
  });

  it("volta ao dia anterior quando a saída atravessa a meia-noite", () => {
    const tenPast = resolveDriverAssignmentSchedule({
      exitDate: "2026-11-05",
      exitTime: "00:10",
    });
    const midnight = resolveDriverAssignmentSchedule({
      exitDate: "2026-11-05",
      exitTime: "00:00",
    });
    const halfPast = resolveDriverAssignmentSchedule({
      exitDate: "2026-11-05",
      exitTime: "00:30",
    });

    assert.equal(tenPast.presentationDate, "2026-11-04");
    assert.equal(tenPast.presentationTime, "23:40");
    assert.equal(tenPast.departureDate, "2026-11-05");
    assert.equal(midnight.presentationDate, "2026-11-04");
    assert.equal(midnight.presentationTime, "23:30");
    assert.equal(halfPast.presentationDate, "2026-11-05");
    assert.equal(halfPast.presentationTime, "00:00");
  });

  it("mostra traço quando não há apresentação nem saída", () => {
    const schedule = resolveDriverAssignmentSchedule({
      serviceDate: "2026-11-04",
    });

    assert.equal(schedule.presentationSource, "missing");
    assert.equal(
      formatDriverScheduleMoment(schedule.presentationDate, schedule.presentationTime),
      "—",
    );
    assert.equal(
      formatDriverScheduleMoment(schedule.departureDate, schedule.departureTime),
      "—",
    );
  });
});

describe("WhatsApp e migration", () => {
  it("repete no WhatsApp a mesma data e hora do card", () => {
    const text = buildDriverAssignmentWhatsAppText(
      {
        code: "OS003",
        service_type: "Transporte",
        service_date: "2026-11-04",
        entry_date: "2026-11-04",
        entry_time: "18:00:00",
        exit_date: "2026-11-04",
        exit_time: "18:30:00",
        plate: "DEV0A01",
        client_name: "Cliente A DEV",
        freight_origin_address: null,
        freight_destination_address: null,
        freight_distance_km: null,
        freight_toll_amount: null,
      },
      "PSCS DEV",
      "Motorista A DEV",
      "https://example.test/designacao/token",
      { driverPayAmount: 100 },
    );

    assert.match(text, /Data: 04\/11\/2026/);
    assert.match(text, /Saída prevista: 04\/11\/2026 18:30/);
    assert.match(text, /Horário de apresentação: 04\/11\/2026 18:00/);
    assert.match(text, /Cliente: Cliente A DEV/);
  });

  it("a migration só acrescenta os quatro horários já existentes", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    assert.match(sql, /get_public_driver_assignment\(p_token text\)/);
    assert.match(sql, /length\(trim\(p_token\)\) < 32/);
    assert.match(sql, /driver_assignment_token = p_token/);
    assert.match(sql, /'entry_date', v_row\.entry_date/);
    assert.match(sql, /'entry_time', v_row\.entry_time/);
    assert.match(sql, /'exit_date', v_row\.exit_date/);
    assert.match(sql, /'exit_time', v_row\.exit_time/);
    assert.match(sql, /'can_respond'/);
    assert.match(sql, /'client_name', v_row\.client_name/);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.doesNotMatch(sql, /\bGRANT\b/i);
    assert.doesNotMatch(sql, /respond_to_driver_assignment/);
  });
});

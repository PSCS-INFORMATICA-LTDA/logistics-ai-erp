/** Agenda da frota — intervalos de tempo e disponibilidade. */

export const SCHEDULE_WORK_START_MIN = 6 * 60;
export const SCHEDULE_WORK_END_MIN = 22 * 60;

export type ScheduleSegment = {
  orderId: string;
  orderCode: string;
  clientName: string | null;
  serviceType: string;
  status: string;
  vehicleId: string;
  dayKey: string;
  startMin: number;
  endMin: number;
  isAllDay: boolean;
  /** Concluída = só registro de uso; não bloqueia disponibilidade. */
  isHistorical: boolean;
  blocksAvailability: boolean;
  originAddress: string | null;
  destinationAddress: string | null;
};

export const SCHEDULE_MORNING_END_MIN = 12 * 60;

export type DayPeriodAvailability = {
  morningFree: boolean;
  afternoonFree: boolean;
  morningLabel: string;
  afternoonLabel: string;
};

export type FreeSlot = {
  startMin: number;
  endMin: number;
};

export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekDayKeys(anchor: Date): string[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toDayKey(d);
  });
}

export function formatWeekRangeLabel(anchor: Date): string {
  const keys = weekDayKeys(anchor);
  const first = parseDayKey(keys[0]);
  const last = parseDayKey(keys[6]);
  const fmt = (dt: Date) =>
    dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return `${fmt(first)} — ${fmt(last)}`;
}

export function dayLabel(key: string): { weekday: string; date: string } {
  const d = parseDayKey(key);
  return {
    weekday: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
    date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
  };
}

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = String(value).trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesInDay(dateKey: string, timeMin: number): number {
  return timeMin;
}

function compareDateKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

export type ScheduleOrderInput = {
  id: string;
  code: string;
  client_name: string | null;
  service_type: string;
  status: string;
  service_date: string;
  entry_date: string | null;
  entry_time: string | null;
  exit_date: string | null;
  exit_time: string | null;
  vehicle_id: string | null;
  freight_origin_address?: string | null;
  freight_destination_address?: string | null;
};

export function isHistoricalScheduleStatus(status: string): boolean {
  return status === "Concluido";
}

export function blocksScheduleAvailability(status: string): boolean {
  return status !== "Cancelado" && !isHistoricalScheduleStatus(status);
}

export function buildSegmentsForOrder(
  order: ScheduleOrderInput,
  weekKeys: string[]
): ScheduleSegment[] {
  if (!order.vehicle_id || order.status === "Cancelado") return [];

  const weekSet = new Set(weekKeys);
  const startDate = order.entry_date || order.service_date;
  const endDate = order.exit_date || order.entry_date || order.service_date;
  if (!startDate) return [];

  const startTime = parseTimeToMinutes(order.entry_time) ?? SCHEDULE_WORK_START_MIN;
  const endTime =
    parseTimeToMinutes(order.exit_time) ??
    (compareDateKeys(endDate, startDate) > 0 ? SCHEDULE_WORK_END_MIN : startTime + 240);

  const segments: ScheduleSegment[] = [];
  let cursor = parseDayKey(startDate);
  const last = parseDayKey(endDate);

  while (cursor <= last) {
    const key = toDayKey(cursor);
    if (weekSet.has(key)) {
      const isFirst = key === startDate;
      const isLast = key === endDate;
      let segStart = isFirst ? startTime : SCHEDULE_WORK_START_MIN;
      let segEnd = isLast ? Math.max(endTime, segStart + 30) : SCHEDULE_WORK_END_MIN;
      if (!isFirst && !isLast) {
        segStart = SCHEDULE_WORK_START_MIN;
        segEnd = SCHEDULE_WORK_END_MIN;
      }
      segStart = Math.max(SCHEDULE_WORK_START_MIN, Math.min(segStart, SCHEDULE_WORK_END_MIN));
      segEnd = Math.max(segStart + 15, Math.min(segEnd, SCHEDULE_WORK_END_MIN));

      const historical = isHistoricalScheduleStatus(order.status);

      segments.push({
        orderId: order.id,
        orderCode: order.code,
        clientName: order.client_name,
        serviceType: order.service_type,
        status: order.status,
        vehicleId: order.vehicle_id!,
        dayKey: key,
        startMin: segStart,
        endMin: segEnd,
        isAllDay: !order.entry_time && !order.exit_time && compareDateKeys(startDate, endDate) === 0,
        isHistorical: historical,
        blocksAvailability: blocksScheduleAvailability(order.status),
        originAddress: order.freight_origin_address?.trim() || null,
        destinationAddress: order.freight_destination_address?.trim() || null,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return segments;
}

export function computeFreeSlots(segments: ScheduleSegment[]): FreeSlot[] {
  const blocking = segments.filter((s) => s.blocksAvailability);
  const busy = [...blocking]
    .map((s) => ({ startMin: s.startMin, endMin: s.endMin }))
    .sort((a, b) => a.startMin - b.startMin);

  const merged: FreeSlot[] = [];
  for (const block of busy) {
    const last = merged[merged.length - 1];
    if (last && block.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, block.endMin);
    } else {
      merged.push({ ...block });
    }
  }

  const free: FreeSlot[] = [];
  let cursor = SCHEDULE_WORK_START_MIN;
  for (const block of merged) {
    if (block.startMin > cursor) {
      free.push({ startMin: cursor, endMin: block.startMin });
    }
    cursor = Math.max(cursor, block.endMin);
  }
  if (cursor < SCHEDULE_WORK_END_MIN) {
    free.push({ startMin: cursor, endMin: SCHEDULE_WORK_END_MIN });
  }
  return free;
}

export function serviceTypeColor(type: string, historical = false): string {
  if (historical) {
    return "border-slate-300 bg-slate-100 text-slate-700 border-dashed";
  }
  switch (type) {
    case "Frete":
      return "bg-amber-100 border-amber-300 text-amber-950";
    case "Transporte":
      return "bg-sky-100 border-sky-300 text-sky-950";
    default:
      return "bg-brand-50 border-brand-200 text-brand-900";
  }
}

export function scheduleSegmentLabel(seg: ScheduleSegment): string {
  return seg.isHistorical ? "Uso registrado" : "Agendado";
}

export function orderHref(orderId: string): string {
  return `/operacional/ordens-servico?edit=${encodeURIComponent(orderId)}`;
}

export function routeSummary(seg: ScheduleSegment): string | null {
  if (!seg.originAddress && !seg.destinationAddress) return null;
  const from = seg.originAddress || "—";
  const to = seg.destinationAddress || "—";
  return `${from} → ${to}`;
}

/** Manhã 06–12 / tarde 12–22 — útil para ver se a placa pode fazer 2ª viagem no dia. */
export function dayPeriodAvailability(segments: ScheduleSegment[]): DayPeriodAvailability {
  const free = computeFreeSlots(segments);
  const covers = (from: number, to: number) =>
    free.some((slot) => slot.startMin <= from && slot.endMin >= to);

  const morningFree = covers(SCHEDULE_WORK_START_MIN, SCHEDULE_MORNING_END_MIN);
  const afternoonFree = covers(SCHEDULE_MORNING_END_MIN, SCHEDULE_WORK_END_MIN);

  const morningPartial = free.filter(
    (s) => s.endMin > SCHEDULE_WORK_START_MIN && s.startMin < SCHEDULE_MORNING_END_MIN
  );
  const afternoonPartial = free.filter(
    (s) => s.endMin > SCHEDULE_MORNING_END_MIN && s.startMin < SCHEDULE_WORK_END_MIN
  );

  const labelPart = (slots: FreeSlot[], full: boolean, fullLabel: string) => {
    if (full) return fullLabel;
    if (slots.length === 0) return "Ocupado";
    return slots
      .map((s) => `${formatMinutes(Math.max(s.startMin, SCHEDULE_WORK_START_MIN))}–${formatMinutes(Math.min(s.endMin, SCHEDULE_WORK_END_MIN))}`)
      .join(", ");
  };

  return {
    morningFree,
    afternoonFree,
    morningLabel: labelPart(morningPartial, morningFree, "Livre 06:00–12:00"),
    afternoonLabel: labelPart(afternoonPartial, afternoonFree, "Livre 12:00–22:00"),
  };
}

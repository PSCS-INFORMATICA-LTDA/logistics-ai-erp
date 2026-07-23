"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  computeFreeSlots,
  dayLabel,
  dayPeriodAvailability,
  formatMinutes,
  newOsFromScheduleHref,
  orderHref,
  scheduleSegmentLabel,
  serviceTypeColor,
  SCHEDULE_WORK_END_MIN,
  SCHEDULE_WORK_START_MIN,
  type FreeSlot,
  type ScheduleSegment,
} from "@/lib/vehicle-schedule";
import type { VehicleScheduleRow } from "@/lib/vehicle-schedule-api";
import { glassAction } from "@/lib/liquid-glass-styles";
import { cn } from "@/lib/utils";

type Selection = {
  vehicleId: string;
  dayKey: string;
} | null;

type Props = {
  vehicles: VehicleScheduleRow[];
  segments: ScheduleSegment[];
  weekKeys: string[];
  selection: Selection;
  onSelect: (next: Selection) => void;
  /** Quando filtrado por uma placa, destaca visão manhã/tarde da semana. */
  plateFocus?: boolean;
  /** false = só consulta (esconde CTAs de nova OS). */
  canCreateOs?: boolean;
};

function segmentsForCell(
  segments: ScheduleSegment[],
  vehicleId: string,
  dayKey: string
): ScheduleSegment[] {
  return segments
    .filter((s) => s.vehicleId === vehicleId && s.dayKey === dayKey)
    .sort((a, b) => a.startMin - b.startMin);
}

/** No quadro: só horário + nº da OS. Detalhes ao abrir a OS. */
function SegmentCard({ seg, compact = false }: { seg: ScheduleSegment; compact?: boolean }) {
  const time = `${formatMinutes(seg.startMin)}–${formatMinutes(seg.endMin)}`;
  return (
    <Link
      href={orderHref(seg.orderId)}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "block rounded-md border leading-tight transition hover:ring-2 hover:ring-brand-300",
        compact ? "px-1.5 py-1 text-[0.68rem]" : "px-3 py-2 text-sm",
        serviceTypeColor(seg.serviceType, seg.isHistorical)
      )}
      title={`Abrir OS ${seg.orderCode} · ${time}`}
    >
      <span className={cn("block font-semibold tabular-nums", !compact && "text-base")}>
        {time}
      </span>
      <span className="block truncate font-medium">{seg.orderCode}</span>
    </Link>
  );
}

export function VehicleScheduleBoard({
  vehicles,
  segments,
  weekKeys,
  selection,
  onSelect,
  plateFocus = false,
  canCreateOs = true,
}: Props) {
  const selectedSegments = useMemo(() => {
    if (!selection) return [];
    return segmentsForCell(segments, selection.vehicleId, selection.dayKey);
  }, [segments, selection]);

  const blockingSegments = useMemo(
    () => selectedSegments.filter((s) => s.blocksAvailability),
    [selectedSegments]
  );
  const historicalSegments = useMemo(
    () => selectedSegments.filter((s) => s.isHistorical),
    [selectedSegments]
  );

  const freeSlots = useMemo(() => computeFreeSlots(selectedSegments), [selectedSegments]);
  const period = useMemo(() => dayPeriodAvailability(selectedSegments), [selectedSegments]);

  const selectedVehicle = selection
    ? vehicles.find((v) => v.id === selection.vehicleId)
    : null;

  const focusVehicle = plateFocus && vehicles.length === 1 ? vehicles[0] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-sky-300 bg-sky-100" />
          Agendado (bloqueia horário)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-dashed border-slate-300 bg-slate-100" />
          Concluído — só registro de uso
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-emerald-200 bg-emerald-50" />
          Horário livre (pode usar de novo)
        </span>
        <span className="text-slate-500">
          No quadro: horário + nº da OS. Clique para abrir e ver os detalhes.
        </span>
      </div>

      {focusVehicle ? (
        <PlateWeekSummary
          vehicle={focusVehicle}
          weekKeys={weekKeys}
          segments={segments}
          selection={selection}
          onSelect={onSelect}
        />
      ) : null}

      <p className="text-xs text-slate-600">
        Arraste a barra horizontal/vertical do quadro para ver a semana toda em 100% de zoom.
        Coluna da <strong>placa</strong> e <strong>cabeçalho dos dias</strong> ficam fixos.
      </p>

      <div
        className="schedule-board-scroll relative w-full min-w-0 max-w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm [-webkit-overflow-scrolling:touch]"
        style={{ maxHeight: "min(70vh, calc(100dvh - 14rem))" }}
      >
        <table
          className="border-collapse text-sm"
          style={{ width: "max(100%, 72rem)", tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: "9.5rem" }} />
            {weekKeys.map((key) => (
              <col key={key} style={{ width: "10.5rem" }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200">
              <th className="sticky left-0 top-0 z-30 bg-slate-100 px-3 py-3 text-left font-semibold text-slate-800 shadow-[2px_0_8px_rgba(15,23,42,0.08)]">
                Veículo
              </th>
              {weekKeys.map((key) => {
                const { weekday, date } = dayLabel(key);
                return (
                  <th
                    key={key}
                    className="sticky top-0 z-20 bg-slate-100 px-2 py-3 text-center font-semibold text-slate-800 shadow-[0_2px_6px_rgba(15,23,42,0.06)]"
                  >
                    <span className="block capitalize">{weekday}</span>
                    <span className="text-xs font-normal text-slate-500">{date}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  Nenhum veículo ativo na frota.
                </td>
              </tr>
            ) : (
              vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="border-b border-slate-100 align-top">
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 shadow-[2px_0_8px_rgba(15,23,42,0.08)]">
                    <p className="truncate font-semibold text-slate-900">{vehicle.plate}</p>
                    <p className="truncate text-xs text-slate-500">
                      {vehicle.model || vehicle.vehicle_category}
                    </p>
                  </td>
                  {weekKeys.map((dayKey) => {
                    const cellSegments = segmentsForCell(segments, vehicle.id, dayKey);
                    const isSelected =
                      selection?.vehicleId === vehicle.id && selection.dayKey === dayKey;
                    const free = computeFreeSlots(cellSegments);
                    const periods = dayPeriodAvailability(cellSegments);
                    const hasFree = free.some((s) => s.endMin - s.startMin >= 60);

                    return (
                      <td key={dayKey} className="max-w-[10.5rem] px-1.5 py-2">
                        <button
                          type="button"
                          onClick={() =>
                            onSelect(
                              isSelected ? null : { vehicleId: vehicle.id, dayKey }
                            )
                          }
                          className={cn(
                            "min-h-[5.5rem] w-full max-w-full overflow-hidden rounded-lg border p-1.5 text-left transition",
                            isSelected
                              ? "border-brand-400 bg-brand-50/60 ring-2 ring-brand-200"
                              : "border-slate-200/80 bg-slate-50/40 hover:border-brand-200 hover:bg-white"
                          )}
                        >
                          {cellSegments.length === 0 ? (
                            <span className="block space-y-0.5 px-1 py-2 text-xs text-emerald-700">
                              <span className="block font-medium">Livre o dia</span>
                              <span className="block text-[0.65rem]">Manhã e tarde</span>
                              {canCreateOs ? (
                              <Link
                                href={newOsFromScheduleHref({
                                  vehicleId: vehicle.id,
                                  dayKey,
                                  startMin: SCHEDULE_WORK_START_MIN,
                                  endMin: SCHEDULE_WORK_END_MIN,
                                })}
                                onClick={(e) => e.stopPropagation()}
                                className={cn(glassAction("brand", true), "mt-1")}
                              >
                                Nova OS
                              </Link>
                              ) : null}
                            </span>
                          ) : (
                            <div className="min-w-0 space-y-1">
                              {cellSegments.map((seg) => (
                                <SegmentCard key={`${seg.orderId}-${seg.dayKey}`} seg={seg} compact />
                              ))}
                              <span className="block px-1 text-[0.62rem] text-slate-600">
                                Manhã: {periods.morningFree ? "livre" : "ocupada"} · Tarde:{" "}
                                {periods.afternoonFree ? "livre" : "ocupada"}
                              </span>
                              {hasFree ? (
                                <span className="block px-1 text-[0.65rem] text-emerald-700">
                                  + horários livres no dia
                                </span>
                              ) : null}
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selection && selectedVehicle ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {selectedVehicle.plate} · {dayLabel(selection.dayKey).weekday}{" "}
                {dayLabel(selection.dayKey).date}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Clique no nº da OS para abrir origem, destino, cliente e demais dados. Frete
                concluído não bloqueia; só registra o uso.
              </p>
            </div>
            <Link href="/operacional/ordens-servico" className={glassAction("brand", true)}>
              Lista de OS
            </Link>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                period.morningFree
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">Manhã (06–12)</p>
              <p className="mt-0.5 font-medium">{period.morningLabel}</p>
            </div>
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                period.afternoonFree
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">Tarde (12–22)</p>
              <p className="mt-0.5 font-medium">{period.afternoonLabel}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section>
              <h4 className="text-sm font-semibold text-slate-800">Reservado na agenda</h4>
              {blockingSegments.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Nenhuma OS aberta/agendada neste dia.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {blockingSegments.map((seg) => (
                    <li key={seg.orderId}>
                      <SegmentCard seg={seg} />
                      <p className="mt-1 px-1 text-xs text-slate-500">
                        {scheduleSegmentLabel(seg)} · {seg.status}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-sm font-semibold text-slate-800">Horários disponíveis</h4>
              {freeSlots.length === 0 ? (
                <p className="mt-2 text-sm text-amber-800">
                  Sem janela livre (há OS ainda não concluída neste dia).
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {freeSlots.map((slot, index) => (
                    <FreeSlotRow
                      key={index}
                      slot={slot}
                      vehicleId={selectedVehicle.id}
                      dayKey={selection.dayKey}
                      canCreateOs={canCreateOs}
                    />
                  ))}
                </ul>
              )}
              {canCreateOs ? (
              <p className="mt-2 text-xs text-slate-500">
                Clique em <strong>Nova OS neste horário</strong> para abrir o cadastro já com placa, data
                e janela. Se a manhã for SP → fora e a saída for à tarde, a tarde fica ocupada até a
                saída da OS.
              </p>
              ) : null}
            </section>
          </div>

          {historicalSegments.length > 0 ? (
            <section className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-3">
              <h4 className="text-sm font-semibold text-slate-800">Uso registrado (concluído)</h4>
              <p className="mt-1 text-xs text-slate-600">
                Frete já finalizado — consulta de quando a placa rodou. Clique para abrir a OS.
              </p>
              <ul className="mt-2 space-y-2">
                {historicalSegments.map((seg) => (
                  <li key={seg.orderId}>
                    <SegmentCard seg={seg} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-4 hidden sm:block">
            <h4 className="mb-2 text-sm font-semibold text-slate-800">Linha do tempo (dia)</h4>
            <VehicleDayTimeline
              blocking={blockingSegments}
              historical={historicalSegments}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Toque em um dia/placa para ver manhã/tarde livres. No bloco da OS, clique em{" "}
          <strong>abrir OS</strong> para ir ao cadastro.
        </p>
      )}
    </div>
  );
}

function FreeSlotRow({
  slot,
  vehicleId,
  dayKey,
  canCreateOs = true,
}: {
  slot: FreeSlot;
  vehicleId: string;
  dayKey: string;
  canCreateOs?: boolean;
}) {
  const href = newOsFromScheduleHref({
    vehicleId,
    dayKey,
    startMin: slot.startMin,
    endMin: slot.endMin,
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2">
      <span className="text-sm font-medium text-emerald-900">
        {formatMinutes(slot.startMin)} – {formatMinutes(slot.endMin)}
      </span>
      {canCreateOs ? (
      <Link href={href} className={glassAction("brand", true)}>
        Nova OS neste horário
      </Link>
      ) : null}
    </li>
  );
}

function PlateWeekSummary({
  vehicle,
  weekKeys,
  segments,
  selection,
  onSelect,
}: {
  vehicle: VehicleScheduleRow;
  weekKeys: string[];
  segments: ScheduleSegment[];
  selection: Selection;
  onSelect: (next: Selection) => void;
}) {
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <h3 className="text-sm font-semibold text-brand-950">
        Visão da placa {vehicle.plate} — manhã / tarde na semana
      </h3>
      <p className="mt-1 text-xs text-brand-900/80">
        Use para ver se o veículo pode fazer mais de um frete no mesmo dia (ex.: manhã ocupada, tarde
        livre).
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {weekKeys.map((dayKey) => {
          const cell = segmentsForCell(segments, vehicle.id, dayKey);
          const periods = dayPeriodAvailability(cell);
          const { weekday, date } = dayLabel(dayKey);
          const active = selection?.vehicleId === vehicle.id && selection.dayKey === dayKey;
          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelect(active ? null : { vehicleId: vehicle.id, dayKey })}
              className={cn(
                "rounded-lg border bg-white p-2 text-left text-xs transition",
                active ? "border-brand-400 ring-2 ring-brand-200" : "border-slate-200 hover:border-brand-200"
              )}
            >
              <p className="font-semibold capitalize text-slate-800">
                {weekday} {date}
              </p>
              <p
                className={cn(
                  "mt-1",
                  periods.morningFree ? "text-emerald-700" : "text-amber-800"
                )}
              >
                Manhã: {periods.morningFree ? "livre" : "ocupada"}
              </p>
              <p
                className={cn(
                  periods.afternoonFree ? "text-emerald-700" : "text-amber-800"
                )}
              >
                Tarde: {periods.afternoonFree ? "livre" : "ocupada"}
              </p>
              {cell.length > 0 ? (
                <p className="mt-1 truncate text-slate-500">{cell.length} OS</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VehicleDayTimeline({
  blocking,
  historical,
}: {
  blocking: ScheduleSegment[];
  historical: ScheduleSegment[];
}) {
  const total = SCHEDULE_WORK_END_MIN - SCHEDULE_WORK_START_MIN;

  const renderBar = (seg: ScheduleSegment, layer: "blocking" | "historical") => {
    const left = ((seg.startMin - SCHEDULE_WORK_START_MIN) / total) * 100;
    const width = ((seg.endMin - seg.startMin) / total) * 100;
    return (
      <Link
        key={`${layer}-${seg.orderId}`}
        href={orderHref(seg.orderId)}
        title={`${seg.orderCode} ${formatMinutes(seg.startMin)}–${formatMinutes(seg.endMin)} — abrir OS`}
        className={cn(
          "absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-[0.65rem] font-medium leading-tight hover:ring-2 hover:ring-brand-300",
          serviceTypeColor(seg.serviceType, layer === "historical"),
          layer === "historical" && "opacity-80"
        )}
        style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
      >
        {seg.orderCode}
      </Link>
    );
  };

  return (
    <div className="relative h-14 rounded-lg border border-slate-200 bg-slate-100/80">
      {historical.map((seg) => renderBar(seg, "historical"))}
      {blocking.map((seg) => renderBar(seg, "blocking"))}
      <div className="pointer-events-none absolute inset-x-0 -bottom-5 flex justify-between text-[0.65rem] text-slate-500">
        <span>06:00</span>
        <span>12:00</span>
        <span>22:00</span>
      </div>
    </div>
  );
}

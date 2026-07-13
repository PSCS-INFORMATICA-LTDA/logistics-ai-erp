"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  computeFreeSlots,
  dayLabel,
  formatMinutes,
  scheduleSegmentLabel,
  serviceTypeColor,
  SCHEDULE_WORK_END_MIN,
  SCHEDULE_WORK_START_MIN,
  type ScheduleSegment,
} from "@/lib/vehicle-schedule";
import type { VehicleScheduleRow } from "@/lib/vehicle-schedule-api";
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

export function VehicleScheduleBoard({
  vehicles,
  segments,
  weekKeys,
  selection,
  onSelect,
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

  const selectedVehicle = selection
    ? vehicles.find((v) => v.id === selection.vehicleId)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-sky-300 bg-sky-100" />
          Agendado (bloqueia horário)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-dashed border-slate-300 bg-slate-100" />
          Concluído — só registro de uso da placa
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-emerald-200 bg-emerald-50" />
          Horário livre
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/80 [-webkit-overflow-scrolling:touch]">
        <table className="min-w-[56rem] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <th className="sticky left-0 z-20 min-w-[8.5rem] bg-slate-50 px-3 py-3 text-left font-semibold text-slate-700">
                Veículo
              </th>
              {weekKeys.map((key) => {
                const { weekday, date } = dayLabel(key);
                return (
                  <th key={key} className="min-w-[9rem] px-2 py-3 text-center font-semibold text-slate-700">
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
                  <td className="sticky left-0 z-10 bg-white px-3 py-3">
                    <p className="font-semibold text-slate-900">{vehicle.plate}</p>
                    <p className="text-xs text-slate-500">{vehicle.model || vehicle.vehicle_category}</p>
                  </td>
                  {weekKeys.map((dayKey) => {
                    const cellSegments = segmentsForCell(segments, vehicle.id, dayKey);
                    const isSelected =
                      selection?.vehicleId === vehicle.id && selection.dayKey === dayKey;
                    const free = computeFreeSlots(cellSegments);
                    const hasFree = free.some((s) => s.endMin - s.startMin >= 60);

                    return (
                      <td key={dayKey} className="px-1.5 py-2">
                        <button
                          type="button"
                          onClick={() =>
                            onSelect(
                              isSelected ? null : { vehicleId: vehicle.id, dayKey }
                            )
                          }
                          className={cn(
                            "min-h-[5.5rem] w-full rounded-lg border p-1.5 text-left transition",
                            isSelected
                              ? "border-brand-400 bg-brand-50/60 ring-2 ring-brand-200"
                              : "border-slate-200/80 bg-slate-50/40 hover:border-brand-200 hover:bg-white"
                          )}
                        >
                          {cellSegments.length === 0 ? (
                            <span className="block px-1 py-2 text-xs text-emerald-700">
                              Livre (06:00–22:00)
                            </span>
                          ) : (
                            <div className="space-y-1">
                              {cellSegments.map((seg) => (
                                <div
                                  key={`${seg.orderId}-${seg.dayKey}`}
                                  className={cn(
                                    "rounded-md border px-1.5 py-1 text-[0.68rem] leading-tight",
                                    serviceTypeColor(seg.serviceType, seg.isHistorical)
                                  )}
                                >
                                  <span className="font-semibold">
                                    {formatMinutes(seg.startMin)}–{formatMinutes(seg.endMin)}
                                  </span>
                                  <span className="block truncate">{seg.orderCode}</span>
                                  {seg.isHistorical ? (
                                    <span className="block text-[0.62rem] uppercase tracking-wide opacity-75">
                                      Concluído
                                    </span>
                                  ) : null}
                                  {seg.clientName ? (
                                    <span className="block truncate opacity-80">{seg.clientName}</span>
                                  ) : null}
                                </div>
                              ))}
                              {hasFree ? (
                                <span className="block px-1 text-[0.65rem] text-emerald-700">
                                  + horários livres
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
                Janela {formatMinutes(SCHEDULE_WORK_START_MIN)}–{formatMinutes(SCHEDULE_WORK_END_MIN)}.
                Frete/OS <strong>concluída</strong> aparece só para consultar quando a placa foi usada — não
                bloqueia horário livre.
              </p>
            </div>
            <Link
              href="/operacional/ordens-servico"
              className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              Abrir Ordens de Serviço
            </Link>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section>
              <h4 className="text-sm font-semibold text-slate-800">Reservado na agenda</h4>
              {blockingSegments.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Nenhuma OS aberta/agendada neste dia.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {blockingSegments.map((seg) => (
                    <li
                      key={seg.orderId}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm",
                        serviceTypeColor(seg.serviceType, false)
                      )}
                    >
                      <p className="font-semibold">
                        {seg.orderCode} · {formatMinutes(seg.startMin)}–{formatMinutes(seg.endMin)}
                      </p>
                      <p className="text-xs opacity-90">
                        {scheduleSegmentLabel(seg)} · {seg.serviceType}
                        {seg.clientName ? ` · ${seg.clientName}` : ""} · {seg.status}
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
                <ul className="mt-2 flex flex-wrap gap-2">
                  {freeSlots.map((slot, index) => (
                    <li
                      key={index}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-900"
                    >
                      {formatMinutes(slot.startMin)} – {formatMinutes(slot.endMin)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {historicalSegments.length > 0 ? (
            <section className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-3">
              <h4 className="text-sm font-semibold text-slate-800">Uso registrado (concluído)</h4>
              <p className="mt-1 text-xs text-slate-600">
                Frete ou transporte já finalizado — consulta de data/hora em que o veículo foi utilizado.
              </p>
              <ul className="mt-2 space-y-2">
                {historicalSegments.map((seg) => (
                  <li
                    key={seg.orderId}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      serviceTypeColor(seg.serviceType, true)
                    )}
                  >
                    <p className="font-semibold">
                      {seg.orderCode} · {formatMinutes(seg.startMin)}–{formatMinutes(seg.endMin)}
                    </p>
                    <p className="text-xs opacity-90">
                      {seg.serviceType}
                      {seg.clientName ? ` · ${seg.clientName}` : ""}
                    </p>
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
          Toque em um dia/placa: OS em aberto bloqueiam horário; concluídas mostram só quando a placa foi usada.
        </p>
      )}
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
      <div
        key={`${layer}-${seg.orderId}`}
        title={`${seg.orderCode} ${formatMinutes(seg.startMin)}–${formatMinutes(seg.endMin)}`}
        className={cn(
          "absolute top-1 bottom-1 rounded border px-1 text-[0.65rem] font-medium leading-tight overflow-hidden",
          serviceTypeColor(seg.serviceType, layer === "historical"),
          layer === "historical" && "opacity-80"
        )}
        style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
      >
        {seg.orderCode}
      </div>
    );
  };

  return (
    <div className="relative h-14 rounded-lg border border-slate-200 bg-slate-100/80">
      {historical.map((seg) => renderBar(seg, "historical"))}
      {blocking.map((seg) => renderBar(seg, "blocking"))}
      <div className="pointer-events-none absolute inset-x-0 -bottom-5 flex justify-between text-[0.65rem] text-slate-500">
        <span>06:00</span>
        <span>14:00</span>
        <span>22:00</span>
      </div>
    </div>
  );
}

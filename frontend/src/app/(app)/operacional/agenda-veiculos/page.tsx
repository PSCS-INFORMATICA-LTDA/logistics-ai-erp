"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VehicleScheduleBoard } from "@/components/operacional/VehicleScheduleBoard";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { fetchVehicleScheduleData } from "@/lib/vehicle-schedule-api";
import { formatWeekRangeLabel } from "@/lib/vehicle-schedule";
import { useCompany } from "@/lib/company-context";
import { glassField, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";
import { SERVICE_ORDER_TYPES, SERVICE_ORDER_TYPE_LABELS } from "@/types/database";

export default function AgendaVeiculosPage() {
  const { companyId } = useCompany();
  const supabase = useMemo(() => createClient(), []);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [vehicleId, setVehicleId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Awaited<ReturnType<typeof fetchVehicleScheduleData>>["vehicles"]>([]);
  const [filterVehicles, setFilterVehicles] = useState<{ value: string; label: string }[]>([]);
  const [segments, setSegments] = useState<Awaited<ReturnType<typeof fetchVehicleScheduleData>>["segments"]>([]);
  const [weekKeys, setWeekKeys] = useState<string[]>([]);
  const [selection, setSelection] = useState<{ vehicleId: string; dayKey: string } | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    const { data: allVehicles } = await supabase
      .from("vehicles")
      .select("id, plate, plate_display")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .neq("status", "Inativo")
      .order("plate");

    setFilterVehicles(
      (allVehicles ?? []).map((v) => ({
        value: v.id as string,
        label: ((v.plate_display as string) || (v.plate as string) || "").toUpperCase(),
      }))
    );

    const result = await fetchVehicleScheduleData(supabase, companyId, weekAnchor, {
      vehicleId: vehicleId || null,
      serviceType: serviceType || null,
    });
    if (result.error) {
      setError(result.error);
      setVehicles([]);
      setSegments([]);
      setWeekKeys(result.weekKeys);
    } else {
      setVehicles(result.vehicles);
      setSegments(result.segments);
      setWeekKeys(result.weekKeys);
    }
    setLoading(false);
  }, [companyId, serviceType, supabase, vehicleId, weekAnchor]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftWeek = (delta: number) => {
    setSelection(null);
    setWeekAnchor((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  };

  const vehicleOptions = useMemo(
    () => [{ value: "", label: "— Todas as placas (visão geral) —" }, ...filterVehicles],
    [filterVehicles]
  );

  const selectedPlateLabel = useMemo(
    () => filterVehicles.find((v) => v.value === vehicleId)?.label ?? null,
    [filterVehicles, vehicleId]
  );

  const typeOptions = useMemo(
    () => [
      { value: "", label: "— Transporte e frete —" },
      ...SERVICE_ORDER_TYPES.filter((t) => t === "Transporte" || t === "Frete").map((t) => ({
        value: t,
        label: SERVICE_ORDER_TYPE_LABELS[t] ?? t,
      })),
    ],
    []
  );

  return (
    <Card>
      <CardHeader
        title="Agenda da frota"
        description="Quadro semanal por placa. Clique no código da OS para abrir o cadastro. Filtre por placa para ver manhã/tarde livres e se dá para usar o veículo mais de uma vez no dia."
      />
      <CardBody className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Como usar</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs sm:text-sm">
            <li>
              <strong>Filtro Placa</strong> — escolha uma placa para focar só nela (recomendado para
              ver 2ª viagem no dia).
            </li>
            <li>
              Clique no <strong>dia</strong> no quadro — vê manhã/tarde e horários livres.
            </li>
            <li>
              Clique em <strong>abrir OS</strong> no bloco — vai direto para a Ordem de Serviço
              (origem, destino, cliente, etc.).
            </li>
          </ol>
        </div>

        <div className={`flex flex-wrap items-end gap-3 p-4 ${glassFilterPanel()}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => shiftWeek(-1)}>
              ← Semana anterior
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSelection(null);
                setWeekAnchor(new Date());
              }}
            >
              Hoje
            </Button>
            <Button type="button" variant="secondary" onClick={() => shiftWeek(1)}>
              Próxima semana →
            </Button>
          </div>
          <p className="text-sm font-medium capitalize text-slate-700">
            {formatWeekRangeLabel(weekAnchor)}
          </p>
          <div className="min-w-[220px] flex-1">
            <GlassSelect
              label="Filtrar por placa"
              value={vehicleId}
              onChange={(v) => {
                setVehicleId(v);
                setSelection(null);
              }}
              options={vehicleOptions}
              searchable
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <GlassSelect
              label="Tipo"
              value={serviceType}
              onChange={(v) => {
                setServiceType(v);
                setSelection(null);
              }}
              options={typeOptions}
            />
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Ir para data</span>
            <input
              type="date"
              className={glassField()}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split("-").map(Number);
                setSelection(null);
                setWeekAnchor(new Date(y, (m ?? 1) - 1, d ?? 1));
              }}
            />
          </label>
          {vehicleId ? (
            <Button type="button" variant="ghost" onClick={() => { setVehicleId(""); setSelection(null); }}>
              Limpar placa
            </Button>
          ) : null}
          <Link
            href="/operacional/ordens-servico"
            className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            + Nova OS
          </Link>
        </div>

        {selectedPlateLabel ? (
          <Alert variant="info">
            Mostrando só a placa <strong>{selectedPlateLabel}</strong>. Veja o resumo manhã/tarde
            acima do quadro. Se a OS da manhã vai de SP para fora e a saída é à tarde, a tarde fica
            ocupada até o horário cadastrado na OS.
          </Alert>
        ) : null}

        {error ? <Alert variant="error">{error}</Alert> : null}

        {loading ? (
          <Loading />
        ) : (
          <VehicleScheduleBoard
            vehicles={vehicles}
            segments={segments}
            weekKeys={weekKeys}
            selection={selection}
            onSelect={setSelection}
            plateFocus={Boolean(vehicleId)}
          />
        )}

        <p className="text-xs text-slate-500">
          Status <strong>Concluído</strong> = registro de uso (não bloqueia). Demais status ativos
          reservam o horário. Origem → destino aparece no bloco quando cadastrado na OS.
        </p>
      </CardBody>
    </Card>
  );
}

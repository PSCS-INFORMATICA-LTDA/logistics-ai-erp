"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DRIVER_ASSIGNMENT_RESPONSE_LABELS,
  fetchPublicDriverAssignment,
  respondToDriverAssignment,
  type DriverAssignmentResponse,
} from "@/lib/service-order-driver-assignment";
import { formatServiceDate, resolveProposalAmount } from "@/lib/service-order-proposal";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { SERVICE_ORDER_TYPE_LABELS, type ServiceOrder } from "@/types/database";

type Props = {
  token: string;
};

export function PublicDriverAssignmentClient({ token }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Partial<ServiceOrder> | null>(null);
  const [companyName, setCompanyName] = useState("GRX Transportes e Logística");
  const [driverName, setDriverName] = useState<string | null>(null);
  const [assignmentResponse, setAssignmentResponse] =
    useState<DriverAssignmentResponse>("pending");
  const [canRespond, setCanRespond] = useState(false);
  const [responding, setResponding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchPublicDriverAssignment(supabase, token);

    if (fetchError) {
      setError(fetchError);
      setLoading(false);
      return;
    }

    if (!data?.found || !data.order) {
      setError("Designação não encontrada ou link inválido.");
      setLoading(false);
      return;
    }

    setOrder(data.order);
    setCompanyName(data.company_name ?? "GRX Transportes e Logística");
    setDriverName(data.driver_name ?? null);
    setAssignmentResponse(data.driver_assignment_response ?? "pending");
    setCanRespond(Boolean(data.can_respond));
    setLoading(false);
  }, [supabase, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRespond = async (action: "accept" | "reject") => {
    const label = action === "accept" ? "aceitar" : "recusar";
    if (!window.confirm(`Confirma ${label} esta designação?`)) return;

    setResponding(true);
    const { driverAssignmentResponse: next, error: respondError } =
      await respondToDriverAssignment(supabase, token, action);
    setResponding(false);

    if (respondError) {
      window.alert(respondError);
      return;
    }

    setAssignmentResponse(next ?? (action === "accept" ? "accepted" : "rejected"));
    setCanRespond(false);
  };

  if (loading) return <Loading />;
  if (error || !order) return <Alert variant="error">{error ?? "Designação indisponível."}</Alert>;

  const amount = resolveProposalAmount(order as ServiceOrder);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="flex justify-center">
          <BrandLogo variant="plaque3d" plaqueSurface="page" size="md" performanceLite />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
            Designação de ordem de serviço
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">OS {order.code}</h1>
          <p className="text-sm text-slate-500">{companyName}</p>
          {driverName ? (
            <p className="mt-2 text-sm text-slate-700">
              Motorista: <strong>{driverName}</strong>
            </p>
          ) : null}

          <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              <span className="text-slate-500">Cliente:</span> {order.client_name ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Data:</span>{" "}
              {order.service_date ? formatServiceDate(order.service_date) : "—"}
            </p>
            <p>
              <span className="text-slate-500">Placa:</span> {order.plate ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Tipo:</span>{" "}
              {SERVICE_ORDER_TYPE_LABELS[order.service_type ?? ""] ?? order.service_type ?? "—"}
            </p>
            {(order.freight_origin_address || order.freight_destination_address) && (
              <div className="space-y-1">
                <p>
                  <span className="text-slate-500">Origem (A):</span>{" "}
                  {order.freight_origin_address ?? "—"}
                </p>
                <p>
                  <span className="text-slate-500">Destino (B):</span>{" "}
                  {order.freight_destination_address ?? "—"}
                </p>
              </div>
            )}
            {amount != null && (
              <p className="text-base font-semibold text-brand-700">
                Valor: {formatCurrency(amount)}
              </p>
            )}
            {order.freight_toll_amount != null && order.freight_toll_amount > 0 && (
              <p>
                <span className="text-slate-500">Pedágio:</span>{" "}
                {formatCurrency(order.freight_toll_amount)}
              </p>
            )}
          </div>

          {canRespond && (
            <div className="mt-6 space-y-4 rounded-lg border-2 border-brand-200 bg-brand-50 p-5">
              <p className="text-sm font-medium text-slate-800">
                Por favor, confirme se você aceita ou recusa esta designação:
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" disabled={responding} onClick={() => void handleRespond("accept")}>
                  Aceitar designação
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={responding}
                  onClick={() => void handleRespond("reject")}
                >
                  Recusar designação
                </Button>
              </div>
            </div>
          )}

          {assignmentResponse !== "pending" && (
            <div
              className={`mt-6 rounded-lg px-4 py-3 text-sm ${
                assignmentResponse === "accepted"
                  ? "bg-green-50 text-green-900"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              <p className="font-medium">
                {DRIVER_ASSIGNMENT_RESPONSE_LABELS[assignmentResponse]}
              </p>
              <p className="mt-1">
                {assignmentResponse === "accepted"
                  ? "Sua confirmação foi registrada. A equipe GRX dará continuidade à operação."
                  : "Sua resposta foi registrada. A equipe GRX poderá convidar outro motorista."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

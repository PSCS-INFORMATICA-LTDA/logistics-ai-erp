"use client";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/Button";
import {
  serviceOrderShowsFlightData,
  serviceOrderShowsPassengers,
} from "@/lib/service-order-field-visibility";
import { normalizePassengers } from "@/lib/service-order-passengers";
import { formatServiceDate } from "@/lib/service-order-proposal";
import {
  SERVICE_ORDER_TYPE_LABELS,
  type ServiceOrder,
  type ServiceOrderPassenger,
} from "@/types/database";

export type DriverVoucherContext = {
  companyName: string;
  companyDocument?: string | null;
  driverName: string;
  driverDocument: string | null;
  driverPhone: string | null;
  driverPhotoUrl?: string | null;
  vehicleDescription: string;
};

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 5);
}

function formatPresentationDate(order: ServiceOrder): string {
  const date = order.entry_date ?? order.service_date;
  return date ? formatServiceDate(date) : "—";
}

function VoucherCell({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`border border-slate-300 p-2 text-xs ${className}`}>
      <p className="font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{value || "—"}</p>
    </div>
  );
}

function PassengersBlock({ passengers }: { passengers: ServiceOrderPassenger[] }) {
  if (passengers.length === 0) {
    return (
      <div className="border border-slate-300 p-2 text-sm text-slate-500">
        Nenhum passageiro cadastrado nesta OS.
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead>
        <tr className="border border-slate-300 bg-slate-50">
          <th className="border border-slate-300 px-2 py-1.5 font-semibold">#</th>
          <th className="border border-slate-300 px-2 py-1.5 font-semibold">Nome</th>
          <th className="border border-slate-300 px-2 py-1.5 font-semibold">Documento</th>
          <th className="border border-slate-300 px-2 py-1.5 font-semibold">Órgão emissor</th>
        </tr>
      </thead>
      <tbody>
        {passengers.map((passenger, index) => (
          <tr key={`${passenger.name}-${index}`}>
            <td className="border border-slate-300 px-2 py-1.5">{index + 1}</td>
            <td className="border border-slate-300 px-2 py-1.5">{passenger.name || "—"}</td>
            <td className="border border-slate-300 px-2 py-1.5">{passenger.document_number || "—"}</td>
            <td className="border border-slate-300 px-2 py-1.5">{passenger.document_issuer || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Props = {
  order: ServiceOrder;
  context: DriverVoucherContext;
  pendingDriverAcceptance?: boolean;
};

export function ServiceOrderDriverVoucherView({
  order,
  context,
  pendingDriverAcceptance = false,
}: Props) {
  const showPassengers = serviceOrderShowsPassengers(
    order.service_type,
    order.service_categories
  );
  const showFlight = serviceOrderShowsFlightData(
    order.service_type,
    order.service_categories
  );
  const passengers = showPassengers ? normalizePassengers(order.passengers) : [];
  const serviceLabel = SERVICE_ORDER_TYPE_LABELS[order.service_type] ?? order.service_type;
  const presentationAddress = order.freight_origin_address?.trim() || "—";
  const destinationAddress = order.freight_destination_address?.trim() || "—";
  const responsible = [order.attendant, order.client_name].filter(Boolean).join(" · ") || "—";
  const contactPhone = order.phone?.trim() || "—";

  return (
    <div className="driver-voucher-root mx-auto max-w-4xl space-y-4 print:max-w-none">
      <style jsx global>{`
        @media print {
          .driver-voucher-toolbar {
            display: none !important;
          }
          .app-header-shell,
          .sidebar-shell,
          nav {
            display: none !important;
          }
        }
      `}</style>

      <div className="driver-voucher-toolbar flex flex-wrap gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()}>
          Imprimir / Salvar PDF
        </Button>
      </div>

      {pendingDriverAcceptance ? (
        <p className="driver-voucher-toolbar rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 print:hidden">
          Aguardando aceite do motorista — envie este voucher junto com a designação. Os valores de
          motorista e ajudante ficam registrados na designação; neste voucher os campos permanecem em
          branco.
        </p>
      ) : null}

      <article className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="mb-4 flex flex-col gap-4 border-b-2 border-brand-600 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-[200px]">
            <BrandLogo variant="plaque3d" plaqueSurface="page" size="proposal" performanceLite unoptimized />
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Voucher operacional — motorista
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{context.companyName}</h1>
            {context.companyDocument ? (
              <p className="text-xs text-slate-600">{context.companyDocument}</p>
            ) : null}
            <p className="mt-2 text-lg font-semibold text-slate-800">OS {order.code}</p>
            <p className="text-sm text-slate-600">Emitido em {formatServiceDate(order.service_date)}</p>
          </div>
        </header>

        <div className="grid gap-0 sm:grid-cols-3">
          <VoucherCell label="Data de apresentação" value={formatPresentationDate(order)} />
          <VoucherCell label="Horário de apresentação" value={formatTime(order.entry_time)} />
          <VoucherCell label="Hora de saída" value={formatTime(order.exit_time)} />
        </div>

        <div className="mt-0 grid gap-0 sm:grid-cols-2">
          <VoucherCell label="Local de apresentação" value={presentationAddress} />
          <VoucherCell label="Endereço de destino" value={destinationAddress} />
        </div>

        {showFlight && order.flight_data ? (
          <div className="mt-0">
            <VoucherCell label="Dados do voo" value={order.flight_data} />
          </div>
        ) : null}

        <div className="mt-0 grid gap-0 sm:grid-cols-2">
          <VoucherCell label="Responsável" value={responsible} />
          <VoucherCell label="Telefone" value={contactPhone} />
        </div>

        {showPassengers ? (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Passageiros no veículo
            </p>
            <PassengersBlock passengers={passengers} />
          </div>
        ) : null}

        <div className="mt-4 grid gap-0 sm:grid-cols-[auto_1fr_1fr]">
          {context.driverPhotoUrl ? (
            <div className="border border-slate-300 p-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Foto
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={context.driverPhotoUrl}
                alt={context.driverName}
                className="h-28 w-28 rounded object-cover print:h-24 print:w-24"
              />
            </div>
          ) : null}
          <VoucherCell
            label="Motorista"
            value={[context.driverName, context.driverDocument, context.driverPhone]
              .filter(Boolean)
              .join("\n")}
          />
          <VoucherCell
            label="Veículo / placa"
            value={`${context.vehicleDescription}\nPlaca: ${order.plate}`}
          />
        </div>

        {order.monitoring_contact ? (
          <div className="mt-0">
            <VoucherCell label="Monitoria / coordenador" value={order.monitoring_contact} />
          </div>
        ) : null}

        <div className="mt-0 grid gap-0 sm:grid-cols-2">
          <VoucherCell label="Tipo de serviço" value={serviceLabel} />
          <VoucherCell
            label="Valores (motorista / ajudante)"
            value={"Motorista: ____________________\nAjudante: ____________________"}
          />
        </div>

        {order.notes ? (
          <div className="mt-4">
            <VoucherCell label="Observações" value={order.notes} className="min-h-[80px]" />
          </div>
        ) : null}

        <footer className="mt-8 grid gap-8 border-t border-slate-200 pt-6 sm:grid-cols-2">
          <div>
            <div className="border-t border-slate-400 pt-2 text-sm text-slate-700">
              Assinatura do motorista
            </div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2 text-sm text-slate-700">
              {context.companyName}
            </div>
          </div>
        </footer>
      </article>
    </div>
  );
}

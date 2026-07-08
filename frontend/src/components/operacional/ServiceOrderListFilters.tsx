"use client";

import { Input } from "@/components/ui/Input";
import {
  PROPOSAL_RESPONSE_LABELS,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE_LABELS,
  SERVICE_ORDER_TYPES,
} from "@/types/database";

const SERVICE_ORDER_STATUS_FILTER = [
  ...SERVICE_ORDER_STATUS,
  PROPOSAL_RESPONSE_LABELS.accepted,
  PROPOSAL_RESPONSE_LABELS.rejected,
] as const;

type Props = {
  search: string;
  status: string;
  serviceType: string;
  pendingProposals: boolean;
  totalCount: number;
  visibleCount: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onServiceTypeChange: (value: string) => void;
  onPendingProposalsChange: (value: boolean) => void;
};

export function ServiceOrderListFilters({
  search,
  status,
  serviceType,
  pendingProposals,
  totalCount,
  visibleCount,
  onSearchChange,
  onStatusChange,
  onServiceTypeChange,
  onPendingProposalsChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="min-w-[240px] flex-1">
        <Input
          label="Pesquisar"
          placeholder="Código (ex.: OS001), placa, cliente, rota…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <label className="block min-w-[180px] space-y-1">
        <span className="text-sm font-medium text-slate-700">Status</span>
        <select
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="">Todos</option>
          {SERVICE_ORDER_STATUS_FILTER.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="block min-w-[180px] space-y-1">
        <span className="text-sm font-medium text-slate-700">Tipo</span>
        <select
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={serviceType}
          onChange={(e) => onServiceTypeChange(e.target.value)}
        >
          <option value="">Todos</option>
          {SERVICE_ORDER_TYPES.map((item) => (
            <option key={item} value={item}>
              {SERVICE_ORDER_TYPE_LABELS[item] ?? item}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 pb-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={pendingProposals}
          onChange={(e) => onPendingProposalsChange(e.target.checked)}
        />
        <span className="text-sm text-slate-700">Propostas pendentes</span>
      </label>

      <p className="pb-2 text-sm text-slate-500">
        Exibindo {visibleCount} de {totalCount} ordem(ns)
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  driverFollowupBadgeVariant,
  formatDriverFollowupExpiry,
  listDriverDocumentsFollowup,
  type DriverFollowupRow,
} from "@/lib/driver-documents-followup";
import { glassAction, glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

type Filter =
  | "attention"
  | "all"
  | "cnh_expiry"
  | "missing_cnh"
  | "missing_avc";

type Props = {
  companyId: string;
};

export function DriverDocumentsFollowupPanel({ companyId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<DriverFollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("attention");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listDriverDocumentsFollowup(supabase, companyId);
    if (result.error) setError(result.error);
    setRows(result.rows);
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filter === "all") return true;
      if (filter === "attention") return row.needsAttention;
      if (filter === "cnh_expiry") {
        return (
          row.cnhStatus === "none" ||
          row.cnhStatus === "warning" ||
          row.cnhStatus === "critical" ||
          row.cnhStatus === "expired"
        );
      }
      if (filter === "missing_cnh") return !row.hasCnhFolder;
      if (filter === "missing_avc") return !row.hasCnhAvcFolder;
      return true;
    });
  }, [rows, filter]);

  const counts = useMemo(() => {
    return {
      attention: rows.filter((r) => r.needsAttention).length,
      cnhExpiry: rows.filter(
        (r) =>
          r.cnhStatus === "none" ||
          r.cnhStatus === "warning" ||
          r.cnhStatus === "critical" ||
          r.cnhStatus === "expired"
      ).length,
      missingCnh: rows.filter((r) => !r.hasCnhFolder).length,
      missingAvc: rows.filter((r) => !r.hasCnhAvcFolder).length,
    };
  }, [rows]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Acompanhe validade da CNH e envio de anexos nas pastas <strong>CNH</strong> e{" "}
        <strong>CNH-AVC</strong>. Abra o cadastro do motorista para renovar ou anexar.
      </p>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className={`grid gap-3 sm:grid-cols-2 ${glassFilterPanel()}`}>
        <GlassSelect
          label="Filtro"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "attention", label: `Em atenção (${counts.attention})` },
            { value: "cnh_expiry", label: `CNH a vencer / vencida (${counts.cnhExpiry})` },
            { value: "missing_cnh", label: `Pasta CNH sem anexo (${counts.missingCnh})` },
            { value: "missing_avc", label: `Pasta CNH-AVC sem anexo (${counts.missingAvc})` },
            { value: "all", label: `Todos ativos (${rows.length})` },
          ]}
        />
        <div className="flex items-end">
          <button
            type="button"
            className={glassAction("sky", true)}
            onClick={() => void load()}
          >
            Atualizar lista
          </button>
        </div>
      </div>

      <section className={glassFilterPanel()}>
        <h2 className="mb-2 text-sm font-semibold">Motoristas em acompanhamento</h2>
        <DataTableScroll stickyFirst stickyLast compact>
          <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
          <thead className="text-[10px] uppercase text-slate-500 sm:text-xs">
            <tr>
              <th className="px-1.5 py-2">Motorista</th>
              <th className="hidden px-1.5 py-2 md:table-cell">CNH</th>
              <th className="hidden px-1.5 py-2 lg:table-cell">Validade</th>
              <th className="px-1.5 py-2">Situação</th>
              <th className="hidden px-1.5 py-2 xl:table-cell">Pasta CNH</th>
              <th className="hidden px-1.5 py-2 xl:table-cell">Pasta CNH-AVC</th>
              <th className="hidden px-1.5 py-2 md:table-cell">Pendências</th>
              <th className="px-1.5 py-2">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-slate-500">
                  Nenhum motorista neste filtro.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="max-w-[9rem] px-1.5 py-1.5 sm:max-w-[14rem]">
                    <p className="truncate font-medium text-slate-800" title={row.name}>
                      {row.name}
                    </p>
                    {row.code ? (
                      <p className="text-[10px] text-slate-500 sm:text-xs">{row.code}</p>
                    ) : null}
                    <p className="mt-0.5 truncate text-[10px] text-slate-500 md:hidden">
                      {row.reasons.length ? row.reasons.join(" · ") : row.cnhLabel}
                    </p>
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1.5 md:table-cell">
                    {row.cnhNumber || "—"}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1.5 lg:table-cell">
                    {formatDriverFollowupExpiry(row.cnhExpiry)}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <Badge variant={driverFollowupBadgeVariant(row.cnhStatus)}>
                      {row.cnhLabel}
                    </Badge>
                  </td>
                  <td className="hidden px-1.5 py-1.5 xl:table-cell">
                    <Badge variant={row.hasCnhFolder ? "success" : "warning"}>
                      {row.hasCnhFolder ? "Com anexo" : "Enviar"}
                    </Badge>
                  </td>
                  <td className="hidden px-1.5 py-1.5 xl:table-cell">
                    <Badge variant={row.hasCnhAvcFolder ? "success" : "warning"}>
                      {row.hasCnhAvcFolder ? "Com anexo" : "Enviar"}
                    </Badge>
                  </td>
                  <td className="hidden max-w-[12rem] truncate px-1.5 py-1.5 text-xs text-slate-600 md:table-cell">
                    {row.reasons.length ? row.reasons.join(" · ") : "—"}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <div className="os-row-actions">
                      <Link
                        href={`/cadastros/motoristas?edit=${encodeURIComponent(row.id)}`}
                        className={`${glassAction("sky", true)} action-icon-btn !text-[10px] sm:!text-xs`}
                        title="Abrir cadastro"
                      >
                        <span className="sm:hidden">Abrir</span>
                        <span className="hidden sm:inline">Abrir cadastro</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </DataTableScroll>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import {
  driverFollowupBadgeVariant,
  formatDriverFollowupExpiry,
  listDriverDocumentsFollowup,
  type DriverFollowupRow,
} from "@/lib/driver-documents-followup";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
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
    <div className="min-w-0 space-y-4">
      <p className="text-sm leading-relaxed text-slate-600">
        Acompanhe validade da CNH e envio de anexos nas pastas <strong>CNH</strong> e{" "}
        <strong>CNH-AVC</strong>. Abra o cadastro do motorista para renovar ou anexar.
      </p>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className={`grid gap-3 sm:grid-cols-[1fr_auto] ${glassFilterPanel()}`}>
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
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => void load()}>
            Atualizar lista
          </Button>
        </div>
      </div>

      <section className={`min-w-0 space-y-3 ${glassFilterPanel()}`}>
        <h2 className="text-base font-semibold text-slate-900">Motoristas em acompanhamento</h2>

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum motorista neste filtro.
          </p>
        ) : (
          <>
            {/* Mobile: cartão legível — nome completo, situação e pendências. */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((row) => (
                <li
                  key={row.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-2">
                    <div className="min-w-0">
                      {row.code ? (
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {row.code}
                        </p>
                      ) : null}
                      <p className="text-base font-semibold leading-snug break-words text-slate-900">
                        {row.name}
                      </p>
                    </div>
                    <div className="w-fit max-w-full">
                      <Badge variant={driverFollowupBadgeVariant(row.cnhStatus)}>
                        {row.cnhLabel}
                      </Badge>
                    </div>
                  </div>

                  <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
                    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                      <dt className="text-xs font-medium text-slate-500">CNH</dt>
                      <dd className="break-words text-slate-800">{row.cnhNumber || "—"}</dd>
                    </div>
                    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                      <dt className="text-xs font-medium text-slate-500">Validade</dt>
                      <dd className="text-slate-800">{formatDriverFollowupExpiry(row.cnhExpiry)}</dd>
                    </div>
                    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                      <dt className="text-xs font-medium text-slate-500">Pasta CNH</dt>
                      <dd>
                        <Badge variant={row.hasCnhFolder ? "success" : "warning"}>
                          {row.hasCnhFolder ? "Com anexo" : "Enviar"}
                        </Badge>
                      </dd>
                    </div>
                    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                      <dt className="text-xs font-medium text-slate-500">CNH-AVC</dt>
                      <dd>
                        <Badge variant={row.hasCnhAvcFolder ? "success" : "warning"}>
                          {row.hasCnhAvcFolder ? "Com anexo" : "Enviar"}
                        </Badge>
                      </dd>
                    </div>
                    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                      <dt className="text-xs font-medium text-slate-500">Pendências</dt>
                      <dd className="break-words leading-snug text-slate-800">
                        {row.reasons.length ? row.reasons.join(" · ") : "Nenhuma"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <Link
                      href={`/cadastros/motoristas?edit=${encodeURIComponent(row.id)}`}
                      className="inline-flex w-full items-center justify-center rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800"
                    >
                      Abrir cadastro
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabela limpa. */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">Motorista</th>
                    <th className="px-3 py-2.5">CNH</th>
                    <th className="px-3 py-2.5">Validade</th>
                    <th className="px-3 py-2.5">Situação</th>
                    <th className="px-3 py-2.5">Pasta CNH</th>
                    <th className="px-3 py-2.5">Pasta CNH-AVC</th>
                    <th className="px-3 py-2.5">Pendências</th>
                    <th className="px-3 py-2.5">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">{row.name}</p>
                        {row.code ? (
                          <p className="text-xs text-slate-500">{row.code}</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">{row.cnhNumber || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatDriverFollowupExpiry(row.cnhExpiry)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={driverFollowupBadgeVariant(row.cnhStatus)}>
                          {row.cnhLabel}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={row.hasCnhFolder ? "success" : "warning"}>
                          {row.hasCnhFolder ? "Com anexo" : "Enviar"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={row.hasCnhAvcFolder ? "success" : "warning"}>
                          {row.hasCnhAvcFolder ? "Com anexo" : "Enviar"}
                        </Badge>
                      </td>
                      <td className="max-w-[16rem] break-words px-3 py-3 text-slate-700">
                        {row.reasons.length ? row.reasons.join(" · ") : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/cadastros/motoristas?edit=${encodeURIComponent(row.id)}`}
                          className="inline-flex rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800"
                        >
                          Abrir cadastro
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

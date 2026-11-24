"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { DELETION_REASON_OPTIONS } from "@/lib/deletion-audit";
import {
  correctApprovedLedgerEntry,
  type AuditedCorrectionPatch,
} from "@/lib/financial-approval";
import type { CompanyLedgerRow } from "@/lib/dre-company-ledger-api";
import { glassField } from "@/lib/liquid-glass-styles";
import { formatCurrency } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

type Props = {
  open: boolean;
  row: CompanyLedgerRow | null;
  supabase: SupabaseClient;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
};

export function AuditedLedgerCorrection({ open, row, supabase, onCancel, onSaved }: Props) {
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [description, setDescription] = useState("");
  const [reasonCode, setReasonCode] = useState("teste");
  const [justification, setJustification] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !row) return;
    setAmount(String(row.amount));
    setTransactionDate(row.transaction_date.slice(0, 10));
    setDescription(row.description ?? "");
    setReasonCode("teste");
    setJustification("");
    setConfirming(false);
    setBusy(false);
    setError(null);
  }, [open, row]);

  if (!open || !row) return null;

  const patch = (): AuditedCorrectionPatch => {
    const next: AuditedCorrectionPatch = {};
    const parsed = Number(amount.replace(",", "."));
    if (Number.isFinite(parsed) && parsed !== row.amount) next.amount = parsed;
    const date = transactionDate.slice(0, 10);
    if (date && date !== row.transaction_date.slice(0, 10)) next.transaction_date = date;
    const text = description.trim();
    if (text !== (row.description ?? "").trim()) next.description = text;
    return next;
  };

  const reasonLabel = DELETION_REASON_OPTIONS.find((item) => item.code === reasonCode)?.label ?? "Teste";
  const reason = `${reasonLabel}: ${justification.trim().replace(/\s+/g, " ")}`;

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await correctApprovedLedgerEntry({
      supabase,
      transactionId: row.id,
      patch: patch(),
      reason,
      reasonCode,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      setConfirming(false);
      return;
    }
    await onSaved();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Corrigir lançamento aprovado</h2>
        <p className="mt-1 text-sm text-slate-600">
          A alteração passa pela correção auditada. O lançamento aprovado não é editado direto.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-slate-500">Valor atual</dt>
            <dd className="font-medium">{formatCurrency(row.amount)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Data atual</dt>
            <dd className="font-medium">{row.transaction_date.slice(0, 10)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate-500">Descrição atual</dt>
            <dd className="font-medium">{row.description || "—"}</dd>
          </div>
        </dl>
        {confirming ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Confirmar a correção</p>
            <p className="mt-1">Valor: {formatCurrency(row.amount)} → {amount}</p>
            <p>Data: {row.transaction_date.slice(0, 10)} → {transactionDate}</p>
            <p>Descrição: {row.description || "—"} → {description || "—"}</p>
            <p className="mt-2">Motivo: {reason}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Valor</span>
              <input className={glassField(true)} value={amount} onChange={(event) => setAmount(event.target.value)} data-testid="correction-amount" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Data</span>
              <input type="date" className={glassField(true)} value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} data-testid="correction-date" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Descrição</span>
              <input className={glassField(false)} value={description} onChange={(event) => setDescription(event.target.value)} data-testid="correction-description" />
            </label>
            <GlassSelect
              label="Motivo *"
              value={reasonCode}
              onChange={setReasonCode}
              options={DELETION_REASON_OPTIONS.map((item) => ({ value: item.code, label: item.label }))}
            />
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Justificativa *</span>
              <textarea className={`${glassField(true)} min-h-[5rem]`} value={justification} onChange={(event) => setJustification(event.target.value)} data-testid="correction-justification" />
            </label>
          </div>
        )}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
          {confirming ? (
            <Button type="button" disabled={busy} data-testid="correction-save" onClick={() => void save()}>
              {busy ? "Salvando…" : "Confirmar correção"}
            </Button>
          ) : (
            <Button type="button" data-testid="correction-review" onClick={() => setConfirming(true)}>
              Revisar correção
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

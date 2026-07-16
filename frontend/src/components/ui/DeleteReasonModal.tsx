"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { glassField } from "@/lib/liquid-glass-styles";

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
};

export function DeleteReasonModal({
  open,
  title = "Confirmar exclusão",
  description = "Informe o motivo da exclusão. Esse texto fica registrado no histórico.",
  confirming = false,
  onCancel,
  onConfirm,
}: Props) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const auditStampLabel = useMemo(() => {
    if (!open) return "";
    return new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setReason("");
      setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setLocalError("Digite o motivo da exclusão (mínimo 3 caracteres).");
      return;
    }
    setLocalError(null);
    await onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${reasonId}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirming) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id={`${reasonId}-title`} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{description}</p>

        <div className="mt-3">
          <Alert variant="warning">
            Atenção: antes da exclusão, o sistema registra automaticamente{" "}
            <strong>seu nome/usuário</strong>, a <strong>data e a hora</strong>
            {auditStampLabel ? (
              <>
                {" "}
                (agora: <strong>{auditStampLabel}</strong>)
              </>
            ) : null}{" "}
            e o motivo abaixo no Histórico de exclusões. Essa informação não pode ser apagada.
          </Alert>
        </div>

        <label className="mt-4 block space-y-1">
          <span className="text-sm font-medium text-slate-700">Motivo da exclusão *</span>
          <textarea
            id={reasonId}
            className={`${glassField(true)} min-h-[6rem] resize-y`}
            value={reason}
            disabled={confirming}
            placeholder="Ex.: lançamento duplicado · erro de conta · solicitação do sócio"
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </label>
        {localError ? <p className="mt-2 text-sm text-red-600">{localError}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={confirming} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" disabled={confirming} onClick={() => void submit()}>
            {confirming ? "Excluindo…" : "Excluir com registro"}
          </Button>
        </div>
      </div>
    </div>
  );
}

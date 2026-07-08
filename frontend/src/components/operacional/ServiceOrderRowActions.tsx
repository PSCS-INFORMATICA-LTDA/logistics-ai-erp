"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { isPendingClientProposal } from "@/lib/service-order-display-status";
import {
  registerProposalFollowUp,
  resetProposalClientResponse,
  respondToProposal,
} from "@/lib/service-order-proposal-api";
import { createClient } from "@/lib/supabase/client";
import type { ServiceOrderListRow } from "@/lib/service-order-filters";
import type { ProposalResponse } from "@/types/database";

type ProposalResponsePatch = {
  proposal_response: ProposalResponse;
  status: string;
  proposal_accepted_at?: string | null;
  proposal_rejected_at?: string | null;
};

type Props = {
  row: ServiceOrderListRow;
  onFollowUpRegistered?: (orderId: string, count: number, lastAt: string | null) => void;
  onProposalResponseChanged?: (orderId: string, patch: ProposalResponsePatch) => void;
};

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ThumbUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.67 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function ThumbDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.33 2h13.67a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

function PhoneAcceptIcon() {
  return (
    <span className="inline-flex items-center gap-1">
      <PhoneIcon />
      <ThumbUpIcon />
    </span>
  );
}

function PhoneRejectIcon() {
  return (
    <span className="inline-flex items-center gap-1">
      <PhoneIcon />
      <ThumbDownIcon />
    </span>
  );
}

export function ServiceOrderRowActions({
  row,
  onFollowUpRegistered,
  onProposalResponseChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const canPhoneResponse = isPendingClientProposal(row);
  const canResetProposal =
    Boolean(row.proposal_sent_at) && (row.proposal_response ?? "pending") !== "pending";

  const requireProposalToken = (): string | null => {
    const token = row.proposal_token?.trim();
    if (!token || token.length < 32) {
      window.alert("Token da proposta indisponível. Abra PDF / Proposta e registre o envio.");
      return null;
    }
    if (!row.proposal_sent_at) {
      window.alert("Registre o envio da proposta antes de aceitar ou recusar.");
      return null;
    }
    return token;
  };

  const handleFollowUp = async () => {
    setLoading(true);
    const supabase = createClient();
    const { count, lastAt, error } = await registerProposalFollowUp(supabase, row.id);
    setLoading(false);

    if (error) {
      window.alert(error);
      return;
    }

    onFollowUpRegistered?.(row.id, count, lastAt);
    window.alert(`Follow-up registrado (${count} contato${count === 1 ? "" : "s"}).`);
  };

  const handlePhoneResponse = async (action: "accept" | "reject") => {
    const token = requireProposalToken();
    if (!token) return;

    const isAccept = action === "accept";
    if (
      !window.confirm(
        isAccept
          ? `Registrar aceite da proposta OS ${row.code} em nome do cliente (confirmação por telefone)?`
          : `Registrar recusa da proposta OS ${row.code} em nome do cliente (confirmação por telefone)?`
      )
    ) {
      return;
    }

    if (isAccept) setAccepting(true);
    else setRejecting(true);

    const supabase = createClient();
    const { proposalResponse, status, error } = await respondToProposal(supabase, token, action);

    if (isAccept) setAccepting(false);
    else setRejecting(false);

    if (error) {
      window.alert(error);
      return;
    }

    const now = new Date().toISOString();
    onProposalResponseChanged?.(row.id, {
      proposal_response: proposalResponse ?? (isAccept ? "accepted" : "rejected"),
      status: status ?? (isAccept ? "Aberto" : "Aguardando aprovação cliente"),
      proposal_accepted_at: isAccept ? now : null,
      proposal_rejected_at: isAccept ? null : now,
    });

    window.alert(
      isAccept
        ? "Aceite registrado. A ordem aparecerá como «Aceita pelo cliente»."
        : "Recusa registrada. A ordem aparecerá como «Recusada pelo cliente»."
    );
  };

  const handleResetProposal = async () => {
    if (
      !window.confirm(
        `Reabrir a proposta OS ${row.code} para novo aceite ou recusa (cliente ou telefone)?`
      )
    ) {
      return;
    }

    setResetting(true);
    const supabase = createClient();
    const { proposalResponse, status, error } = await resetProposalClientResponse(supabase, row.id);
    setResetting(false);

    if (error) {
      window.alert(error);
      return;
    }

    onProposalResponseChanged?.(row.id, {
      proposal_response: proposalResponse ?? "pending",
      status: status ?? "Aguardando aprovação cliente",
      proposal_accepted_at: null,
      proposal_rejected_at: null,
    });

    window.alert("Proposta reaberta. Use os botões de telefone ou envie o link ao cliente.");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/operacional/ordens-servico/${row.id}/proposta`}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        )}
      >
        PDF / Proposta
      </Link>
      {canPhoneResponse && (
        <>
          <button
            type="button"
            disabled={accepting || rejecting || resetting}
            title="Registrar aceite (telefone)"
            aria-label={`Registrar aceite por telefone — OS ${row.code}`}
            onClick={() => void handlePhoneResponse("accept")}
            className={cn(
              "inline-flex items-center justify-center rounded-lg border border-green-300 bg-green-50 px-2.5 py-1.5 text-green-900 transition-colors hover:bg-green-100 disabled:opacity-50"
            )}
          >
            <PhoneAcceptIcon />
          </button>
          <button
            type="button"
            disabled={accepting || rejecting || resetting}
            title="Registrar recusa (telefone)"
            aria-label={`Registrar recusa por telefone — OS ${row.code}`}
            onClick={() => void handlePhoneResponse("reject")}
            className={cn(
              "inline-flex items-center justify-center rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-red-800 transition-colors hover:bg-red-100 disabled:opacity-50"
            )}
          >
            <PhoneRejectIcon />
          </button>
        </>
      )}
      {canPhoneResponse && (
        <button
          type="button"
          disabled={loading || resetting}
          onClick={() => void handleFollowUp()}
          className={cn(
            "inline-flex items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
          )}
        >
          Registrar follow-up
        </button>
      )}
      {canResetProposal && (
        <button
          type="button"
          disabled={resetting || accepting || rejecting}
          title="Reabrir proposta para novo aceite ou recusa"
          onClick={() => void handleResetProposal()}
          className={cn(
            "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          )}
        >
          Reabrir proposta
        </button>
      )}
    </div>
  );
}

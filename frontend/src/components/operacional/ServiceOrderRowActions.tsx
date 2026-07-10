"use client";

import Link from "next/link";
import { useState } from "react";
import { AssignDriverModal } from "@/components/operacional/AssignDriverModal";
import { glassAction } from "@/lib/liquid-glass-styles";
import { cn } from "@/lib/utils";
import {
  canAssignDriverToServiceOrder,
  canViewDriverVoucher,
  isDriverAssignmentRejected,
  isFreightInExecution,
  isPendingClientProposal,
  isPendingDriverAssignment,
  isServiceOrderCompleted,
} from "@/lib/service-order-display-status";
import {
  resetDriverAssignment,
  respondToDriverAssignment,
} from "@/lib/service-order-driver-assignment";
import {
  completeServiceOrder,
  registerServiceOrderFollowUp,
} from "@/lib/service-order-operational-api";
import {
  registerProposalFollowUp,
  resetProposalClientResponse,
  respondToProposal,
} from "@/lib/service-order-proposal-api";
import { createClient } from "@/lib/supabase/client";
import type { ServiceOrderListRow } from "@/lib/service-order-filters";
import type { ProposalResponse, DriverAssignmentResponse } from "@/types/database";

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
  onDriverAssigned?: (orderId: string, driverId: string, driverName: string) => void;
  onAssignmentSent?: (orderId: string, driverId: string, driverName: string) => void;
  onDriverAssignmentReset?: (orderId: string) => void;
  onDriverAssignmentResponded?: (
    orderId: string,
    patch: {
      driver_assignment_response: DriverAssignmentResponse;
      driver_id: string | null;
      proposed_driver_id: string | null;
      driver_assignment_rejected_driver_ids?: string[];
    }
  ) => void;
  onServiceFollowUpRegistered?: (orderId: string, count: number, lastAt: string | null) => void;
  onServiceOrderCompleted?: (orderId: string, completedAt: string | null) => void;
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
  onDriverAssigned,
  onAssignmentSent,
  onDriverAssignmentReset,
  onDriverAssignmentResponded,
  onServiceFollowUpRegistered,
  onServiceOrderCompleted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [driverAccepting, setDriverAccepting] = useState(false);
  const [driverRejecting, setDriverRejecting] = useState(false);
  const [cancellingAssignment, setCancellingAssignment] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const canPhoneResponse = isPendingClientProposal(row);
  const canDriverPhoneResponse = isPendingDriverAssignment(row);
  const canAssignDriver = canAssignDriverToServiceOrder(row);
  const driverRejected = isDriverAssignmentRejected(row);
  const canResetProposal =
    Boolean(row.proposal_sent_at) && (row.proposal_response ?? "pending") !== "pending";
  const canOperationalFollowUp = isFreightInExecution(row);
  const canCompleteFreight = isFreightInExecution(row);
  const completed = isServiceOrderCompleted(row);
  const showDriverVoucher = canViewDriverVoucher(row);

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

  const handleDriverPhoneResponse = async (action: "accept" | "reject") => {
    const token = row.driver_assignment_token?.trim();
    if (!token || token.length < 32) {
      window.alert("Token da designação indisponível. Gere o link novamente em «Designar motorista».");
      return;
    }

    const isAccept = action === "accept";
    const driverLabel = row.driver_name ?? "motorista";
    if (
      !window.confirm(
        isAccept
          ? `Registrar aceite da designação OS ${row.code} em nome de ${driverLabel} (confirmação por telefone)?`
          : `Registrar recusa da designação OS ${row.code} em nome de ${driverLabel} (confirmação por telefone)?`
      )
    ) {
      return;
    }

    if (isAccept) setDriverAccepting(true);
    else setDriverRejecting(true);

    const supabase = createClient();
    const { driverAssignmentResponse, driverId, proposedDriverId, rejectedDriverIds, error } =
      await respondToDriverAssignment(supabase, token, action);

    if (isAccept) setDriverAccepting(false);
    else setDriverRejecting(false);

    if (error) {
      window.alert(error);
      return;
    }

    const next = driverAssignmentResponse ?? (isAccept ? "accepted" : "rejected");
    const refusedId = row.proposed_driver_id ?? driverId;
    const mergedRejectedIds =
      rejectedDriverIds.length > 0
        ? rejectedDriverIds
        : !isAccept && refusedId
          ? [...new Set([...(row.driver_assignment_rejected_driver_ids ?? []), refusedId])]
          : row.driver_assignment_rejected_driver_ids;

    onDriverAssignmentResponded?.(row.id, {
      driver_assignment_response: next,
      driver_id: isAccept ? driverId : null,
      proposed_driver_id: isAccept
        ? proposedDriverId ?? row.proposed_driver_id ?? driverId
        : proposedDriverId ?? row.proposed_driver_id,
      driver_assignment_rejected_driver_ids: mergedRejectedIds,
    });

    window.alert(
      isAccept
        ? "Aceite do motorista registrado. A ordem aparecerá como «Motorista confirmado»."
        : "Recusa do motorista registrada. Você pode designar outro motorista."
    );
  };

  const handleCancelDriverAssignment = async () => {
    if (
      !window.confirm(
        `Cancelar a designação pendente da OS ${row.code}? O status voltará para «Aguardando designação motorista» e você poderá escolher o motorista novamente.`
      )
    ) {
      return;
    }

    setCancellingAssignment(true);
    const supabase = createClient();
    const { error } = await resetDriverAssignment(supabase, row.id);
    setCancellingAssignment(false);

    if (error) {
      window.alert(error);
      return;
    }

    onDriverAssignmentReset?.(row.id);
    window.alert("Designação cancelada. Você pode designar o motorista novamente.");
  };

  const handleOperationalFollowUp = async () => {
    setOperationalLoading(true);
    const supabase = createClient();
    const { count, lastAt, error } = await registerServiceOrderFollowUp(supabase, row.id);
    setOperationalLoading(false);

    if (error) {
      window.alert(error);
      return;
    }

    onServiceFollowUpRegistered?.(row.id, count, lastAt);
    window.alert(
      `Acompanhamento operacional registrado (${count} registro${count === 1 ? "" : "s"}).`
    );
  };

  const handleCompleteFreight = async () => {
    if (
      !window.confirm(
        `Registrar conclusão do frete OS ${row.code}?\n\nA OS ficará como «Concluído» e você poderá salvar o PDF em «PDF / Proposta».`
      )
    ) {
      return;
    }

    setCompleting(true);
    const supabase = createClient();
    const { completedAt, error } = await completeServiceOrder(supabase, row.id);
    setCompleting(false);

    if (error) {
      window.alert(error);
      return;
    }

    onServiceOrderCompleted?.(row.id, completedAt);
    window.alert(
      `Frete concluído (OS ${row.code}).\n\nO pagamento ao motorista está disponível em DRE → Despesas motorista / ajudante, com Pix e dados bancários para o Rafael efetuar o pagamento.`
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
    onDriverAssignmentReset?.(row.id);

    window.alert(
      "Proposta reaberta. A designação do motorista também foi cancelada. Use os botões de telefone ou envie o link ao cliente."
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
        href={`/operacional/ordens-servico/${row.id}/proposta`}
        target="_blank"
        rel="noreferrer"
        className={glassAction("neutral")}
      >
        PDF / {completed ? "OS concluída" : "Proposta"}
      </Link>
      {showDriverVoucher && (
        <Link
          href={`/operacional/ordens-servico/${row.id}/voucher-motorista`}
          target="_blank"
          rel="noreferrer"
          title="Voucher operacional para enviar ao motorista"
          className={glassAction("emerald")}
        >
          Voucher motorista
        </Link>
      )}
      {completed && (
        <Link
          href="/dre/despesas-motorista"
          className={glassAction("brand")}
        >
          Pagamento DRE
        </Link>
      )}
      {canAssignDriver && (
        <button
          type="button"
          title={
            driverRejected
              ? "Designar outro motorista (anterior recusou)"
              : "Designar motorista disponível"
          }
          onClick={() => setAssignOpen(true)}
          className={glassAction(driverRejected ? "red" : "brand")}
        >
          {driverRejected ? "Designar outro motorista" : "Designar motorista"}
        </button>
      )}
      {canDriverPhoneResponse && (
        <>
          <button
            type="button"
            disabled={cancellingAssignment || driverAccepting || driverRejecting || accepting || rejecting}
            title="Cancelar designação pendente (ex.: fechou o WhatsApp sem enviar)"
            onClick={() => void handleCancelDriverAssignment()}
            className={glassAction("neutral")}
          >
            {cancellingAssignment ? "Cancelando…" : "Cancelar designação"}
          </button>
          <button
            type="button"
            disabled={driverAccepting || driverRejecting || accepting || rejecting}
            title="Registrar aceite do motorista (telefone)"
            aria-label={`Motorista aceitou por telefone — OS ${row.code}`}
            onClick={() => void handleDriverPhoneResponse("accept")}
            className={glassAction("emerald", true)}
          >
            <PhoneAcceptIcon />
          </button>
          <button
            type="button"
            disabled={driverAccepting || driverRejecting || accepting || rejecting}
            title="Registrar recusa do motorista (telefone)"
            aria-label={`Motorista recusou por telefone — OS ${row.code}`}
            onClick={() => void handleDriverPhoneResponse("reject")}
            className={glassAction("orange", true)}
          >
            <PhoneRejectIcon />
          </button>
        </>
      )}
      {canOperationalFollowUp && (
        <>
          <button
            type="button"
            disabled={operationalLoading || completing}
            title="Registrar acompanhamento do frete em execução"
            onClick={() => void handleOperationalFollowUp()}
            className={glassAction("amber")}
          >
            {operationalLoading ? "Registrando…" : "Registrar acompanhamento"}
          </button>
          <button
            type="button"
            disabled={completing || operationalLoading}
            title="Concluir frete e liberar PDF da OS"
            onClick={() => void handleCompleteFreight()}
            className={glassAction("emerald")}
          >
            {completing ? "Concluindo…" : "Concluir frete"}
          </button>
        </>
      )}
      {canPhoneResponse && (
        <>
          <button
            type="button"
            disabled={accepting || rejecting || resetting}
            title="Registrar aceite (telefone)"
            aria-label={`Registrar aceite por telefone — OS ${row.code}`}
            onClick={() => void handlePhoneResponse("accept")}
            className={glassAction("green", true)}
          >
            <PhoneAcceptIcon />
          </button>
          <button
            type="button"
            disabled={accepting || rejecting || resetting}
            title="Registrar recusa (telefone)"
            aria-label={`Registrar recusa por telefone — OS ${row.code}`}
            onClick={() => void handlePhoneResponse("reject")}
            className={glassAction("red-soft", true)}
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
          className={glassAction("amber")}
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
          className={glassAction("neutral")}
        >
          Reabrir proposta
        </button>
      )}
      </div>

      <AssignDriverModal
        open={assignOpen}
        order={row}
        onClose={() => setAssignOpen(false)}
        onAssigned={(driverId, driverName) => {
          onDriverAssigned?.(row.id, driverId, driverName);
          window.alert(`Motorista ${driverName} designado para ${row.code}.`);
        }}
        onAssignmentSent={(driverId, driverName) => {
          onAssignmentSent?.(row.id, driverId, driverName);
        }}
      />
    </>
  );
}

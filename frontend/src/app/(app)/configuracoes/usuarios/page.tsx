"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Alert, Badge, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTableScroll } from "@/components/ui/DataTableScroll";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { Input } from "@/components/ui/Input";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import {
  listCompanyMembers,
  roleLabel,
  setCompanyMemberRole,
  type CompanyMemberRow,
  type ManageableRole,
} from "@/lib/company-members-access";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";
import { createClient } from "@/lib/supabase/client";

export default function UsuariosAcessosPage() {
  const { companyId } = useCompany();
  const { isAdmin, loading: accessLoading, refreshAccess } = useAccess();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<CompanyMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ManageableRole>("operacional");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    setLoading(true);
    setError(null);
    const [{ rows: list, error: listErr }, auth] = await Promise.all([
      listCompanyMembers(supabase, companyId),
      supabase.auth.getUser(),
    ]);
    if (listErr) setError(listErr);
    setRows(list);
    setCurrentUserId(auth.data.user?.id ?? null);
    setLoading(false);
  }, [companyId, isAdmin, supabase]);

  useEffect(() => {
    if (accessLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load();
  }, [accessLoading, isAdmin, load]);

  const adminCount = rows.filter((r) => r.ui_role === "admin").length;

  async function changeRole(row: CompanyMemberRow, next: ManageableRole) {
    if (!companyId || next === row.ui_role) return;
    setBusyId(row.id);
    setError(null);
    setMsg(null);
    const { error: err } = await setCompanyMemberRole(supabase, companyId, row.id, next);
    if (err) {
      setError(err);
      setBusyId(null);
      return;
    }
    setMsg(
      next === "admin"
        ? `${row.email || "Usuário"} agora é Administrador e pode aprovar lançamentos.`
        : `${row.email || "Usuário"} voltou a Operacional.`
    );
    await load();
    if (row.user_id === currentUserId) {
      await refreshAccess();
    }
    setBusyId(null);
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/company/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || "Falha ao convidar.");
        setInviting(false);
        return;
      }
      setMsg(data?.message || "Convite processado.");
      setInviteEmail("");
      await load();
    } catch {
      setError("Falha de rede ao convidar.");
    }
    setInviting(false);
  }

  if (accessLoading || !companyId) return <Loading />;

  if (!isAdmin) {
    return (
      <Alert variant="warning">
        Usuários e acessos disponível apenas para administradores da empresa.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Usuários e acessos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Promova um substituto a Administrador para aprovar despesas (ex.: férias). Aprovação de
          lançamentos:{" "}
          <Link href="/dre/aprovacoes" className="font-medium text-brand-700 underline">
            DRE → Aprovações
          </Link>
          .
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="info">{msg}</Alert> : null}

      <Card>
        <CardHeader
          title="Membros da empresa"
          description="Admin pode aprovar lançamentos manuais. Operacional lança, mas não aprova (salvo Senha Máster nos parâmetros de alçada)."
        />
        <CardBody>
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum usuário vinculado.</p>
          ) : (
            <>
              <ul className="space-y-3 md:hidden">
                {rows.map((row) => {
                  const isSelf = row.user_id === currentUserId;
                  const demoteBlocked = row.ui_role === "admin" && adminCount <= 1;
                  return (
                    <li
                      key={row.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-snug break-words text-slate-900">
                            {row.full_name || "—"}
                            {isSelf ? (
                              <span className="ml-2 text-xs font-normal text-slate-400">
                                (você)
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 break-all text-sm text-slate-600">
                            {row.email || row.user_id}
                          </p>
                          {row.role !== "admin" && row.role !== "operacional" ? (
                            <p className="mt-1 text-xs text-slate-400">
                              Registro: {roleLabel(row.role)}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant={row.ui_role === "admin" ? "success" : "default"}>
                              {row.ui_role === "admin" ? "Administrador" : "Operacional"}
                            </Badge>
                            <span className="text-xs text-slate-600">
                              Aprova lançamentos:{" "}
                              {row.can_approve_launches ? (
                                <span className="font-medium text-emerald-700">Sim</span>
                              ) : (
                                <span className="text-slate-500">Não</span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        {row.ui_role === "admin" ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busyId === row.id || demoteBlocked}
                            onClick={() => void changeRole(row, "operacional")}
                            title={
                              demoteBlocked
                                ? "Promova outro Admin antes de rebaixar o último."
                                : "Tornar operacional"
                            }
                          >
                            Tornar operacional
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busyId === row.id}
                            title="Promover a Admin"
                            onClick={() => void changeRole(row, "admin")}
                          >
                            Promover a Admin
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="hidden md:block">
            <DataTableScroll stickyFirst stickyLast compact>
              <table className="w-full text-left text-[11px] leading-snug sm:text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="px-1.5 py-2 font-medium">Nome / e-mail</th>
                    <th className="hidden px-1.5 py-2 font-medium md:table-cell">Papel</th>
                    <th className="hidden px-1.5 py-2 font-medium lg:table-cell">Aprova lançamentos</th>
                    <th className="px-1.5 py-2 font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelf = row.user_id === currentUserId;
                    const demoteBlocked = row.ui_role === "admin" && adminCount <= 1;
                    return (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="px-1.5 py-2">
                          <div className="max-w-[10rem] truncate font-medium text-slate-900 sm:max-w-none">
                            {row.full_name || "—"}
                            {isSelf ? (
                              <span className="ml-2 text-xs font-normal text-slate-400">
                                (você)
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-slate-500" title={row.email || row.user_id}>
                            {row.email || row.user_id}
                          </div>
                          {row.role !== "admin" && row.role !== "operacional" ? (
                            <div className="mt-0.5 text-xs text-slate-400">
                              Registro: {roleLabel(row.role)}
                            </div>
                          ) : null}
                        </td>
                        <td className="hidden px-1.5 py-2 md:table-cell">
                          <Badge variant={row.ui_role === "admin" ? "success" : "default"}>
                            {row.ui_role === "admin" ? "Administrador" : "Operacional"}
                          </Badge>
                        </td>
                        <td className="hidden px-1.5 py-2 lg:table-cell">
                          {row.can_approve_launches ? (
                            <span className="text-emerald-700">Sim</span>
                          ) : (
                            <span className="text-slate-500">Não</span>
                          )}
                        </td>
                        <td className="px-1.5 py-2">
                          <div className="os-row-actions">
                          {row.ui_role === "admin" ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="action-icon-btn"
                              disabled={busyId === row.id || demoteBlocked}
                              onClick={() => void changeRole(row, "operacional")}
                              title={
                                demoteBlocked
                                  ? "Promova outro Admin antes de rebaixar o último."
                                  : "Tornar operacional"
                              }
                            >
                              <span className="sm:hidden">Op.</span>
                              <span className="hidden sm:inline">Tornar operacional</span>
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              className="action-icon-btn"
                              disabled={busyId === row.id}
                              title="Promover a Admin"
                              onClick={() => void changeRole(row, "admin")}
                            >
                              <span className="sm:hidden">Admin</span>
                              <span className="hidden sm:inline">Promover a Admin</span>
                            </Button>
                          )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTableScroll>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Convidar por e-mail"
          description="Envia convite (Auth) e vincula à empresa. Se a pessoa já tiver login, só entra no vínculo."
        />
        <CardBody>
          <form onSubmit={onInvite} className={`grid gap-3 sm:grid-cols-3 ${glassFilterPanel()}`}>
            <Input
              label="E-mail"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="pessoa@empresa.com"
            />
            <GlassSelect
              label="Papel inicial"
              value={inviteRole}
              onChange={(v) => setInviteRole(v as ManageableRole)}
              options={[
                { value: "operacional", label: "Operacional" },
                { value: "admin", label: "Administrador" },
              ]}
            />
            <div className="flex items-end">
              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? "Enviando…" : "Convidar"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

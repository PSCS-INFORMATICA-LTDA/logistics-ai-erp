"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CrudPage } from "@/components/crud/CrudPage";
import { DriverFormPanel } from "@/components/drivers/DriverFormPanel";
import { DriverListFilters } from "@/components/drivers/DriverListFilters";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  formatCnh,
  formatCnhExpiryDate,
  getCnhExpiryStatus,
  isCnhExpiryDanger,
  sortCnhCategories,
} from "@/lib/cnh";
import {
  enrichDriversWithServiceOrders,
  isDriverAvailableForContact,
  isDriverInActiveServiceOrder,
  matchesDriverFilters,
  type DriverAvailabilityFilter,
  type DriverListRow,
} from "@/lib/driver-filters";
import { fetchActiveServiceOrdersByDriver } from "@/lib/driver-service-orders";
import { useAccess } from "@/lib/access-context";
import { useCompany } from "@/lib/company-context";
import { DRIVERS_SEED, importDriversFromSpreadsheet } from "@/lib/import-drivers";
import { createClient } from "@/lib/supabase/client";
import type { Driver } from "@/types/database";

function ImportDriversButton({
  onDone,
  autoRun = false,
}: {
  onDone: () => void;
  autoRun?: boolean;
}) {
  const { companyId } = useCompany();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const supabase = createClient();

  const runImport = async () => {
    if (!companyId) return;

    setLoading(true);
    setMsg(null);
    setDetail(null);

    try {
      const result = await importDriversFromSpreadsheet(companyId, supabase);
      const lines = [
        result.imported > 0
          ? `${result.imported} motorista(s) importado(s).`
          : "Nenhum motorista novo para importar.",
        result.skipped > 0 ? `${result.skipped} já existiam (ignorados).` : null,
        ...result.warnings.slice(0, 5),
        result.warnings.length > 5 ? `... e mais ${result.warnings.length - 5} aviso(s).` : null,
        ...result.errors,
      ].filter(Boolean);

      if (result.imported > 0 || (result.skipped > 0 && result.errors.length === 0)) {
        setMsg("Importação concluída.");
        onDone();
      } else {
        setMsg("Importação não realizada.");
      }
      setDetail(lines.join(" "));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erro na importação.");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!companyId) return;
    if (
      !confirm(
        `Importar motoristas da planilha Cadastro_Motoristas?\n\n` +
          `${DRIVERS_SEED.length} registros na planilha. Códigos já cadastrados serão ignorados (sem duplicidade).`
      )
    ) {
      return;
    }
    await runImport();
  };

  useEffect(() => {
    if (autoRun && companyId) runImport();
  }, [autoRun, companyId]);

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={handleImport} disabled={loading}>
        {loading ? "Importando..." : "Importar da planilha"}
      </Button>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {detail && <p className="max-w-2xl text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function MotoristasPageContent() {
  const { companyId } = useCompany();
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("cadastros.motoristas");
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoImport = searchParams.get("importDrivers") === "1";
  const [refreshKey, setRefreshKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<DriverAvailabilityFilter>("all");
  const [listRows, setListRows] = useState<DriverListRow[]>([]);

  useEffect(() => {
    if (autoImport) router.replace("/cadastros/motoristas");
  }, [autoImport, router]);

  const transformItems = useCallback(
    async (items: Driver[], currentCompanyId: string) => {
      const activeOrders = await fetchActiveServiceOrdersByDriver(currentCompanyId);
      const rows = enrichDriversWithServiceOrders(items, activeOrders);
      setListRows(rows);
      return rows;
    },
    []
  );

  const filterItem = useCallback(
    (driver: DriverListRow) =>
      matchesDriverFilters(driver, {
        category: categoryFilter,
        availability: availabilityFilter,
      }),
    [categoryFilter, availabilityFilter]
  );

  const visibleCount = useMemo(
    () => listRows.filter(filterItem).length,
    [listRows, filterItem]
  );

  const columns = useMemo(
    () => [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "driver_type", label: "Tipo" },
      {
        key: "status",
        label: "Status",
        render: (r: DriverListRow) => (
          <Badge variant={r.status === "Ativo" ? "success" : "default"}>{r.status}</Badge>
        ),
      },
      {
        key: "availability",
        label: "Disponibilidade",
        render: (r: DriverListRow) => {
          if (isDriverInActiveServiceOrder(r)) {
            return (
              <Badge variant="warning">
                Em OS {r.active_service_order_code ? `— ${r.active_service_order_code}` : ""}
              </Badge>
            );
          }
          if (isDriverAvailableForContact(r)) {
            return <Badge variant="success">Disponível</Badge>;
          }
          return <Badge variant="default">Indisponível</Badge>;
        },
      },
      { key: "phone", label: "Telefone" },
      { key: "email", label: "E-mail" },
      { key: "pix_key", label: "Chave Pix", render: (r: DriverListRow) => r.pix_key ?? "—" },
      { key: "bank_code", label: "Cód. banco", render: (r: DriverListRow) => r.bank_code ?? "—" },
      { key: "bank_agency", label: "Agência", render: (r: DriverListRow) => r.bank_agency ?? "—" },
      { key: "bank_account", label: "Conta corrente", render: (r: DriverListRow) => r.bank_account ?? "—" },
      { key: "address", label: "Endereço" },
      {
        key: "cnh_number",
        label: "CNH",
        render: (r: DriverListRow) => (r.cnh_number ? formatCnh(r.cnh_number) : "—"),
      },
      {
        key: "cnh_categories",
        label: "Categorias",
        render: (r: DriverListRow) => {
          const categories = r.cnh_categories ?? [];
          if (!categories.length) return "—";
          return (
            <span className="flex flex-wrap gap-1">
              {sortCnhCategories(categories).map((cat) => (
                <Badge key={cat} variant="default">
                  {cat}
                </Badge>
              ))}
            </span>
          );
        },
      },
      {
        key: "cnh_expiry_date",
        label: "Venc. CNH",
        render: (r: DriverListRow) => {
          if (!r.cnh_expiry_date) return "—";
          const status = getCnhExpiryStatus(r.cnh_expiry_date);
          const variant = isCnhExpiryDanger(status)
            ? "danger"
            : status === "warning"
              ? "warning"
              : "default";
          return <Badge variant={variant}>{formatCnhExpiryDate(r.cnh_expiry_date)}</Badge>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {canEdit ? (
      <ImportDriversButton
        autoRun={autoImport}
        onDone={() => setRefreshKey((k) => k + 1)}
      />
      ) : null}
      <CrudPage<DriverListRow>
        key={refreshKey}
        title="Motoristas"
        description="Código numérico sequencial de 8 dígitos (editável) · filtre por CNH e disponibilidade"
        table="drivers"
        auditScreenKey="cadastros.motoristas"
        orderBy="name"
        transformItems={transformItems}
        filterItem={filterItem}
        toolbar={
          <DriverListFilters
            category={categoryFilter}
            availability={availabilityFilter}
            totalCount={listRows.length}
            visibleCount={visibleCount}
            onCategoryChange={setCategoryFilter}
            onAvailabilityChange={setAvailabilityFilter}
          />
        }
        columns={columns}
        renderForm={({ item, onSave, onCancel, saving }) => (
          <DriverFormPanel
            item={item}
            companyId={companyId}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
          />
        )}
      />
    </div>
  );
}

export default function MotoristasPage() {
  return (
    <Suspense fallback={null}>
      <MotoristasPageContent />
    </Suspense>
  );
}

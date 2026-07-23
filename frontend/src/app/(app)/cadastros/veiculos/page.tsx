"use client";

import { useEffect, useState } from "react";
import { NumericCodeField } from "@/components/cadastros/NumericCodeField";
import { VehicleComplianceDocumentsPanel } from "@/components/compliance/VehicleComplianceDocumentsPanel";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Alert, Badge } from "@/components/ui/Badge";
import { VehiclePhotoUpload } from "@/components/vehicles/VehiclePhotoUpload";
import { useAccess } from "@/lib/access-context";
import {
  formatDuplicateCodeError,
  isEntityCodeTaken,
  resolveEntityNumericCode,
} from "@/lib/codes";
import { ANTT_AXLE_OPTIONS } from "@/lib/antt-freight";
import { vehicleDocSummaryMap } from "@/lib/compliance-documents-api";
import { useCompany } from "@/lib/company-context";
import { useSeedNumericCode } from "@/lib/use-seed-numeric-code";
import { createClient } from "@/lib/supabase/client";
import { uploadVehiclePhoto } from "@/lib/vehicle-photo";
import { cn, normalizePlate } from "@/lib/utils";
import type { Partner, Vehicle } from "@/types/database";
import { STATUS_OPTIONS, VEHICLE_CATEGORIES } from "@/types/database";

type FormTab = "dados" | "documentos" | "manutencao" | "fotos";

export default function VeiculosPage() {
  const { companyId } = useCompany();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [docBadges, setDocBadges] = useState<
    Map<string, { expired: number; expiring: number; missingRequired: number }>
  >(new Map());
  const supabase = createClient();

  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("partners")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "Ativo")
      .then(({ data }) => setPartners((data as Partner[]) ?? []));
  }, [companyId, supabase]);

  return (
    <CrudPage<Vehicle>
      title="Veículos"
      description="Código 8 dígitos · documentos e licenças na aba Documentos"
      table="vehicles"
      auditScreenKey="cadastros.veiculos"
      orderBy="plate"
      transformItems={async (items) => {
        if (!companyId || !items.length) {
          setDocBadges(new Map());
          return items;
        }
        const map = await vehicleDocSummaryMap(
          supabase,
          companyId,
          items.map((r) => r.id)
        );
        setDocBadges(map);
        return items;
      }}
      columns={[
        { key: "code", label: "Código" },
        { key: "plate", label: "Placa" },
        { key: "model", label: "Marca / modelo" },
        { key: "vehicle_category", label: "Categoria" },
        {
          key: "docs",
          label: "Documentos",
          render: (r) => {
            const s = docBadges.get(r.id);
            if (!s) return <span className="text-slate-400">—</span>;
            if (s.expired > 0 || s.missingRequired > 0) {
              return (
                <Badge variant="danger">
                  {s.expired > 0 ? `${s.expired} venc.` : ""}
                  {s.expired > 0 && s.missingRequired > 0 ? " · " : ""}
                  {s.missingRequired > 0 ? `${s.missingRequired} falt.` : ""}
                </Badge>
              );
            }
            if (s.expiring > 0) {
              return <Badge variant="warning">{s.expiring} a vencer</Badge>;
            }
            return <Badge variant="success">OK</Badge>;
          },
        },
        {
          key: "status",
          label: "Status",
          render: (r) => (
            <Badge variant={r.status === "Ativo" ? "success" : "default"}>{r.status}</Badge>
          ),
        },
      ]}
      renderForm={({ item, onSave, onCancel, saving }) => (
        <VehicleForm
          item={item ?? null}
          companyId={companyId}
          partners={partners}
          saving={saving}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    />
  );
}

function VehicleForm({
  item,
  companyId,
  partners,
  saving,
  onSave,
  onCancel,
}: {
  item: Partial<Vehicle> | null;
  companyId: string | null;
  partners: Partner[];
  saving: boolean;
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { canEditScreen } = useAccess();
  const canEdit = canEditScreen("cadastros.veiculos");
  const { seedCode, codeReady } = useSeedNumericCode("vehicles", companyId, item);
  const [codeDupError, setCodeDupError] = useState<string | null>(null);
  const [photoStoragePath, setPhotoStoragePath] = useState<string | null>(
    item?.photo_storage_path ?? null
  );
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [tab, setTab] = useState<FormTab>("dados");
  const [savedVehicleId, setSavedVehicleId] = useState<string | null>(item?.id ?? null);

  useEffect(() => {
    setPhotoStoragePath(item?.photo_storage_path ?? null);
    setPendingPhotoFile(null);
    setCodeDupError(null);
    setSavedVehicleId(item?.id ?? null);
    setTab("dados");
  }, [item?.id, item?.photo_storage_path]);

  if (!codeReady) {
    return <p className="text-sm text-slate-500">Gerando próximo código...</p>;
  }

  const tabs: { key: FormTab; label: string }[] = [
    { key: "dados", label: "Dados Principais" },
    { key: "documentos", label: "Documentos" },
    { key: "manutencao", label: "Manutenção" },
    { key: "fotos", label: "Fotos" },
  ];

  return (
    <EntityForm
      key={item?.id ?? `new-${seedCode}`}
      saving={saving}
      onCancel={onCancel}
      initial={{
        code: seedCode,
        plate: item?.plate ?? "",
        plate_display: item?.plate_display ?? "",
        model: item?.model ?? "",
        year: item?.year ?? "",
        vehicle_category: item?.vehicle_category ?? "Van",
        axle_count: item?.axle_count ?? "",
        operational_partner_id: item?.operational_partner_id ?? "",
        status: item?.status ?? "Ativo",
        notes: item?.notes ?? "",
      }}
      onSubmit={async (data) => {
        const resolved = resolveEntityNumericCode(data.code, { existingCode: item?.code });
        if (!resolved.ok) {
          window.alert("Informe um código numérico com até 8 dígitos (ex.: 00000001).");
          return;
        }
        data.code = resolved.code;

        if (companyId) {
          const codeCheck = await isEntityCodeTaken(
            "vehicles",
            companyId,
            resolved.code,
            item?.id ?? null
          );
          if (codeCheck.taken) {
            setCodeDupError(formatDuplicateCodeError(resolved.code));
            return;
          }
        }
        setCodeDupError(null);

        if (data.plate) {
          data.plate = normalizePlate(String(data.plate));
          if (!data.plate_display) data.plate_display = data.plate;
        }
        if (data.year === "") data.year = null;
        if (data.operational_partner_id === "") data.operational_partner_id = null;
        if (data.vehicle_category !== "Caminhao") {
          data.axle_count = null;
        } else if (data.axle_count === "") {
          data.axle_count = null;
        } else {
          data.axle_count = Number(data.axle_count);
        }

        const vehicleId = await onSave(data);
        if (!vehicleId || !companyId) return;
        setSavedVehicleId(vehicleId);

        if (pendingPhotoFile) {
          const { error: photoError } = await uploadVehiclePhoto({
            companyId,
            vehicleId,
            file: pendingPhotoFile,
            previousPath: photoStoragePath,
          });
          if (photoError) {
            window.alert(`Veículo salvo, mas a foto não foi enviada: ${photoError}`);
          } else {
            setPendingPhotoFile(null);
          }
        }
      }}
    >
      {({ form, set }) => {
        const isCaminhao = String(form.vehicle_category) === "Caminhao";
        const setField = (key: string, value: unknown) => {
          if (key === "vehicle_category" && value !== "Caminhao") {
            set("axle_count", "");
          }
          set(key, value);
        };
        const vehicleId = savedVehicleId ?? item?.id ?? null;

        return (
          <>
            {codeDupError ? <Alert variant="error">{codeDupError}</Alert> : null}

            <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    tab === t.key
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "dados" ? (
              <div className="space-y-4">
                <NumericCodeField
                  value={String(form.code ?? "")}
                  onChange={(v) => {
                    set("code", v);
                    setCodeDupError(null);
                  }}
                  onBlur={async (code) => {
                    if (!companyId || !code) return;
                    const check = await isEntityCodeTaken(
                      "vehicles",
                      companyId,
                      code,
                      item?.id ?? null
                    );
                    setCodeDupError(check.taken ? formatDuplicateCodeError(code) : null);
                  }}
                />
                <FormFields
                  form={form}
                  set={setField}
                  fields={[
                    { name: "plate", label: "Placa", required: true },
                    { name: "plate_display", label: "Placa (exibição)" },
                    { name: "model", label: "Marca / modelo", placeholder: "Ex.: Mercedes Sprinter" },
                    { name: "year", label: "Ano", type: "number" },
                    {
                      name: "vehicle_category",
                      label: "Categoria",
                      type: "select",
                      options: VEHICLE_CATEGORIES.map((c) => ({ value: c, label: c })),
                    },
                    {
                      name: "operational_partner_id",
                      label: "Responsável operacional",
                      type: "select",
                      options: [
                        { value: "", label: "— Nenhum —" },
                        ...partners.map((p) => ({ value: p.id, label: p.name })),
                      ],
                    },
                    {
                      name: "status",
                      label: "Status",
                      type: "select",
                      options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
                    },
                    { name: "notes", label: "Observações", type: "textarea" },
                  ]}
                />
                {isCaminhao && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-sm font-medium text-slate-700">
                        Quantidade de eixos
                      </span>
                      <select
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={String(form.axle_count ?? "")}
                        onChange={(e) =>
                          setField("axle_count", e.target.value ? Number(e.target.value) : "")
                        }
                      >
                        <option value="">— Selecione —</option>
                        {ANTT_AXLE_OPTIONS.map((axle) => (
                          <option key={axle} value={axle}>
                            {axle} eixos
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            ) : null}

            {tab === "documentos" && companyId ? (
              <VehicleComplianceDocumentsPanel
                companyId={companyId}
                vehicleId={vehicleId}
                vehicleCategory={String(form.vehicle_category || "")}
                canEdit={canEdit}
              />
            ) : null}

            {tab === "manutencao" ? (
              <Alert variant="info">
                Histórico de manutenção operacional continua em{" "}
                <a href="/dre/despesas-veiculo" className="font-medium underline">
                  DRE → Despesas do Veículo
                </a>
                . Esta aba agrupa a navegação do cadastro.
              </Alert>
            ) : null}

            {tab === "fotos" ? (
              <VehiclePhotoUpload
                companyId={companyId}
                vehicleId={vehicleId}
                photoStoragePath={photoStoragePath}
                pendingFile={pendingPhotoFile}
                onPendingFileChange={setPendingPhotoFile}
                onPhotoPathChange={setPhotoStoragePath}
              />
            ) : null}
          </>
        );
      }}
    </EntityForm>
  );
}

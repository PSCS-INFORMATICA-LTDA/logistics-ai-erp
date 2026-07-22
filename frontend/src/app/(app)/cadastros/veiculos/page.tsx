"use client";

import { useEffect, useState } from "react";
import { NumericCodeField } from "@/components/cadastros/NumericCodeField";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Alert, Badge } from "@/components/ui/Badge";
import {
  uploadPendingVehicleDocuments,
  VehicleDocumentsSection,
  type PendingVehicleDocument,
} from "@/components/vehicles/VehicleDocumentsSection";
import { VehiclePhotoUpload } from "@/components/vehicles/VehiclePhotoUpload";
import { resolveEntityNumericCode } from "@/lib/codes";
import { ANTT_AXLE_OPTIONS } from "@/lib/antt-freight";
import { useCompany } from "@/lib/company-context";
import {
  formatDuplicatePlateError,
  isVehiclePlateTaken,
} from "@/lib/party-document-uniqueness";
import { useSeedNumericCode } from "@/lib/use-seed-numeric-code";
import { createClient } from "@/lib/supabase/client";
import { glassField } from "@/lib/liquid-glass-styles";
import { uploadVehiclePhoto } from "@/lib/vehicle-photo";
import { normalizePlate } from "@/lib/utils";
import type { Partner, Vehicle } from "@/types/database";
import { STATUS_OPTIONS, VEHICLE_CATEGORIES } from "@/types/database";

export default function VeiculosPage() {
  const { companyId } = useCompany();
  const [partners, setPartners] = useState<Partner[]>([]);
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
      description="Código numérico sequencial de 8 dígitos (editável) · placa única por empresa"
      table="vehicles"
      auditScreenKey="cadastros.veiculos"
      orderBy="plate"
      columns={[
        { key: "code", label: "Código" },
        { key: "plate", label: "Placa" },
        { key: "model", label: "Modelo" },
        { key: "vehicle_category", label: "Categoria" },
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
  const { seedCode, codeReady } = useSeedNumericCode("vehicles", companyId, item);
  const [plateDupError, setPlateDupError] = useState<string | null>(null);
  const [photoStoragePath, setPhotoStoragePath] = useState<string | null>(
    item?.photo_storage_path ?? null
  );
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingDocs, setPendingDocs] = useState<PendingVehicleDocument[]>([]);
  const [docsRefreshKey, setDocsRefreshKey] = useState(0);

  useEffect(() => {
    setPhotoStoragePath(item?.photo_storage_path ?? null);
    setPendingPhotoFile(null);
    setPlateDupError(null);
    pendingDocs.forEach((d) => URL.revokeObjectURL(d.previewUrl));
    setPendingDocs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset só ao trocar veículo
  }, [item?.id, item?.photo_storage_path]);

  if (!codeReady) {
    return <p className="text-sm text-slate-500">Gerando próximo código...</p>;
  }

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

        const plate = normalizePlate(String(data.plate ?? ""));
        if (!plate) {
          window.alert("Informe a placa do veículo.");
          return;
        }
        data.plate = plate;
        if (!data.plate_display) data.plate_display = plate;

        if (companyId) {
          const plateCheck = await isVehiclePlateTaken(companyId, plate, item?.id ?? null);
          if (plateCheck.taken) {
            setPlateDupError(formatDuplicatePlateError(plateCheck.plate));
            return;
          }
        }
        setPlateDupError(null);

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

        if (pendingDocs.length > 0) {
          const { uploaded, errors } = await uploadPendingVehicleDocuments({
            companyId,
            vehicleId,
            docs: pendingDocs,
          });
          pendingDocs.forEach((d) => URL.revokeObjectURL(d.previewUrl));
          setPendingDocs([]);
          setDocsRefreshKey((k) => k + 1);
          if (errors > 0) {
            window.alert(
              `Veículo salvo. Documentos: ${uploaded} enviados, ${errors} com falha.`
            );
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

        return (
          <>
            {plateDupError ? <Alert variant="error">{plateDupError}</Alert> : null}

            <NumericCodeField
              value={String(form.code ?? "")}
              onChange={(v) => set("code", v)}
            />

            <label className="block space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">
                Placa (única por empresa)
              </span>
              <input
                className={glassField(true)}
                value={String(form.plate ?? "")}
                autoComplete="off"
                placeholder="ABC1D23"
                onChange={(e) => {
                  const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
                  set("plate", next);
                  setPlateDupError(null);
                  if (!String(form.plate_display ?? "").trim()) {
                    set("plate_display", next);
                  }
                }}
                onBlur={async (e) => {
                  const plate = normalizePlate(e.target.value);
                  if (!plate || !companyId) return;
                  set("plate", plate);
                  const check = await isVehiclePlateTaken(companyId, plate, item?.id ?? null);
                  setPlateDupError(
                    check.taken ? formatDuplicatePlateError(check.plate) : null
                  );
                }}
              />
              <span className="text-xs text-slate-500">
                Identificação do veículo — não é permitido cadastrar a mesma placa duas vezes nesta
                empresa.
              </span>
            </label>

            <VehiclePhotoUpload
              companyId={companyId}
              vehicleId={item?.id ?? null}
              photoStoragePath={photoStoragePath}
              pendingFile={pendingPhotoFile}
              onPendingFileChange={setPendingPhotoFile}
              onPhotoPathChange={setPhotoStoragePath}
            />

            <VehicleDocumentsSection
              companyId={companyId}
              vehicleId={item?.id ?? null}
              disabled={saving}
              pendingDocs={pendingDocs}
              onPendingDocsChange={setPendingDocs}
              refreshKey={docsRefreshKey}
              onUploaded={() => setDocsRefreshKey((k) => k + 1)}
            />

            <FormFields
              form={form}
              set={setField}
              fields={[
                { name: "plate_display", label: "Placa (exibição)" },
                { name: "model", label: "Modelo" },
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
                  <span className="text-sm font-medium text-slate-700">Quantidade de eixos</span>
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
          </>
        );
      }}
    </EntityForm>
  );
}

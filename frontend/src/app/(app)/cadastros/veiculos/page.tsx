"use client";

import { useEffect, useState } from "react";
import { CrudPage } from "@/components/crud/CrudPage";
import { EntityForm, FormFields } from "@/components/crud/EntityForm";
import { Badge } from "@/components/ui/Badge";
import { VehiclePhotoUpload } from "@/components/vehicles/VehiclePhotoUpload";
import { nextCode } from "@/lib/codes";
import { ANTT_AXLE_OPTIONS } from "@/lib/antt-freight";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";
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
      description="Cadastro oficial da frota — foto mestre + placa normalizada automaticamente"
      table="vehicles"
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
  const [photoStoragePath, setPhotoStoragePath] = useState<string | null>(
    item?.photo_storage_path ?? null
  );
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);

  useEffect(() => {
    setPhotoStoragePath(item?.photo_storage_path ?? null);
    setPendingPhotoFile(null);
  }, [item?.id, item?.photo_storage_path]);

  return (
    <EntityForm
      saving={saving}
      onCancel={onCancel}
      initial={{
        code: item?.code ?? "",
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
        if (!item?.id && companyId && !data.code) {
          data.code = await nextCode("vehicles", companyId, "VEI");
        }
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
        if (!vehicleId || !companyId || !pendingPhotoFile) return;

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
            <VehiclePhotoUpload
              companyId={companyId}
              vehicleId={item?.id ?? null}
              photoStoragePath={photoStoragePath}
              pendingFile={pendingPhotoFile}
              onPendingFileChange={setPendingPhotoFile}
              onPhotoPathChange={setPhotoStoragePath}
            />

            <FormFields
              form={form}
              set={setField}
              fields={[
                { name: "code", label: "Código", required: true },
                { name: "plate", label: "Placa", required: true },
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

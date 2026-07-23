"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { glassField } from "@/lib/liquid-glass-styles";

type EntityFormRenderProps = {
  form: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
};

type Props = {
  children: ReactNode | ((ctx: EntityFormRenderProps) => ReactNode);
  onSubmit: (data: Record<string, unknown>) => Promise<void | string | null>;
  onCancel: () => void;
  saving: boolean;
  initial?: Record<string, unknown>;
  /** Consulta (Agenda / status bloqueado): sem Salvar; botão Fechar. */
  readOnly?: boolean;
};

export function EntityForm({
  children,
  onSubmit,
  onCancel,
  saving,
  initial = {},
  readOnly = false,
}: Props) {
  const [form, setForm] = useState<Record<string, unknown>>(initial);

  const set = (key: string, value: unknown) => {
    if (readOnly) return;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {typeof children === "function" ? children({ form, set }) : children}
      <div className="entity-form-actions sticky bottom-0 z-10 -mx-1 mt-2 flex flex-col-reverse gap-2 border-t border-slate-200/80 bg-white/95 px-1 py-3 backdrop-blur-md sm:static sm:flex-row sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-2 sm:backdrop-blur-none">
        {!readOnly ? (
          <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        ) : null}
        <Button type="button" variant={readOnly ? "primary" : "secondary"} className="w-full sm:w-auto" onClick={onCancel}>
          {readOnly ? "Fechar" : "Cancelar"}
        </Button>
      </div>
    </form>
  );
}

export function FormFields({
  form,
  set,
  fields,
}: {
  form: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  fields: Array<{
    name: string;
    label: string;
    type?: "text" | "email" | "number" | "date" | "checkbox" | "select" | "textarea";
    options?: { value: string; label: string }[];
    required?: boolean;
    colSpan?: 1 | 2;
    readOnly?: boolean;
    placeholder?: string;
    hint?: string;
  }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.name}
          className={field.colSpan === 2 || field.type === "textarea" ? "sm:col-span-2" : ""}
        >
          {field.type === "select" ? (
            <GlassSelect
              label={field.label}
              value={String(form[field.name] ?? "")}
              onChange={(next) => set(field.name, next)}
              options={field.options ?? []}
              required={field.required}
            />
          ) : field.type === "checkbox" ? (
            <label className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={Boolean(form[field.name])}
                onChange={(e) => set(field.name, e.target.checked)}
              />
              <span className="text-sm text-slate-700">{field.label}</span>
            </label>
          ) : field.type === "textarea" ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{field.label}</span>
              <textarea
                className={glassField(Boolean(field.required))}
                rows={3}
                value={String(form[field.name] ?? "")}
                onChange={(e) => set(field.name, e.target.value)}
                required={field.required}
              />
            </label>
          ) : field.type === "date" ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{field.label}</span>
              <input
                type="date"
                className={glassField(Boolean(field.required))}
                value={String(form[field.name] ?? "")}
                onChange={(e) => set(field.name, e.target.value)}
                required={field.required}
              />
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{field.label}</span>
              <input
                type={field.type ?? "text"}
                readOnly={field.readOnly}
                placeholder={field.placeholder}
                className={`${glassField(Boolean(field.required))} ${field.readOnly ? "opacity-80" : ""}`}
                value={String(form[field.name] ?? "")}
                onChange={(e) =>
                  set(field.name, field.type === "number" ? Number(e.target.value) : e.target.value)
                }
                required={field.required}
              />
              {field.hint && <span className="text-xs text-slate-500">{field.hint}</span>}
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

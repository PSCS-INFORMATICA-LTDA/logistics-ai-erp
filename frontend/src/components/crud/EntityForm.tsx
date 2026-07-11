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
};

export function EntityForm({ children, onSubmit, onCancel, saving, initial = {} }: Props) {
  const [form, setForm] = useState<Record<string, unknown>>(initial);

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {typeof children === "function" ? children({ form, set }) : children}
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
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
                className={glassField()}
                rows={3}
                value={String(form[field.name] ?? "")}
                onChange={(e) => set(field.name, e.target.value)}
              />
            </label>
          ) : field.type === "date" ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{field.label}</span>
              <input
                type="date"
                className={glassField()}
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
                className={`${glassField()} ${field.readOnly ? "opacity-80" : ""}`}
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

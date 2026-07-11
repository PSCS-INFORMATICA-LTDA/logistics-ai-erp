"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { glassField } from "@/lib/liquid-glass-styles";

export type GlassSelectOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: GlassSelectOption[];
  label?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  searchable?: boolean;
};

export function GlassSelect({
  value,
  onChange,
  options,
  label,
  id,
  required,
  disabled,
  className,
  placeholder = "Selecione…",
  searchable,
}: Props) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);
  const showSearch = searchable ?? options.length > 8;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative space-y-1", className)}>
      {label ? (
        <span className="block text-sm font-medium text-slate-700">{label}</span>
      ) : null}
      <button
        type="button"
        id={selectId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          glassField(),
          "flex w-full items-center justify-between gap-2 text-left",
          disabled && "cursor-not-allowed opacity-60"
        )}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className={cn("truncate", !selected?.label && "text-slate-500")}>
          {selected?.label ?? placeholder}
        </span>
        <span className="shrink-0 text-slate-400" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-[100] mt-1 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xl ring-1 ring-slate-900/5">
          {showSearch ? (
            <div className="border-b border-slate-100 p-2">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar…"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30"
              />
            </div>
          ) : null}
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1" aria-labelledby={selectId}>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">Nenhuma opção encontrada.</li>
            ) : (
              filtered.map((option) => (
                <li key={option.value || "__empty__"} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50",
                      option.value === value && "bg-brand-50 font-medium text-brand-800"
                    )}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      {/* Validação nativa do formulário */}
      <select
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        value={value}
        required={required}
        onChange={() => undefined}
      >
        {options.map((o) => (
          <option key={o.value || "__empty__"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

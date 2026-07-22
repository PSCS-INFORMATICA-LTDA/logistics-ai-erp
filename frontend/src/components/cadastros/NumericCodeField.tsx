"use client";

import { glassField } from "@/lib/liquid-glass-styles";

type Props = {
  value: string;
  onChange: (value: string) => void;
  digits?: number;
};

/** Código sequencial numérico (8 posições), campo aberto/editável — padrão Philippe. */
export function NumericCodeField({ value, onChange, digits = 8 }: Props) {
  return (
    <label className="block space-y-1 sm:col-span-2">
      <span className="text-sm font-medium text-slate-700">
        Código (numérico · {digits} posições)
      </span>
      <input
        className={glassField(false)}
        value={value}
        inputMode={/^\d*$/.test(value) ? "numeric" : "text"}
        maxLength={Math.max(digits, value.length)}
        onChange={(e) => {
          const next = e.target.value;
          // Código legado (ex.: VEI001): ao editar, passa a aceitar só dígitos.
          if (/\D/.test(value) && next !== value) {
            onChange(next.replace(/\D/g, "").slice(0, digits));
            return;
          }
          onChange(next.replace(/\D/g, "").slice(0, digits));
        }}
        placeholder={"0".repeat(digits - 1) + "1"}
      />
      <span className="text-xs text-slate-500">
        Sequencial automático (next number). Campo aberto — pode alterar, mas não pode repetir um
        código já usado nesta empresa.
      </span>
    </label>
  );
}

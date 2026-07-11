import { GlassSelect } from "@/components/ui/GlassSelect";
import type { ChangeEvent, SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: { value: string; label: string }[];
};

/** @deprecated Prefira GlassSelect — mantido para compatibilidade. */
export function Select({ className, label, options, id, value, onChange, required, disabled }: Props) {
  const selectId = id ?? label?.toLowerCase().replace(/\s/g, "-");
  return (
    <GlassSelect
      id={selectId}
      label={label}
      className={className}
      options={options}
      value={String(value ?? "")}
      onChange={(next) => onChange?.({ target: { value: next } } as ChangeEvent<HTMLSelectElement>)}
      required={required}
      disabled={disabled}
    />
  );
}

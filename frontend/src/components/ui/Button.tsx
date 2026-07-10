import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "liquid-glass-btn relative z-0 inline-flex items-center justify-center rounded-xl font-medium disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm",
        variant === "primary" && "liquid-glass-btn--primary",
        variant === "secondary" && "liquid-glass-btn--secondary",
        variant === "danger" && "liquid-glass-btn--danger",
        variant === "ghost" && "liquid-glass-btn--ghost",
        className
      )}
      {...props}
    />
  );
}

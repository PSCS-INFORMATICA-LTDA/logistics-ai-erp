import type { CSSProperties, ReactNode } from "react";
import { dataTableScroll } from "@/lib/liquid-glass-styles";
import { cn } from "@/lib/utils";

/**
 * Padrão mobile das listagens:
 * - fitWidth + compact (defaults)
 * - colunas secundárias: `hidden md|lg|xl:table-cell`
 * - nomes longos: truncate + title
 * - ações: `os-row-actions` + `action-icon-btn` + rótulo curto no mobile
 */
type Props = {
  children: ReactNode;
  /** Coluna da esquerda fixa no scroll horizontal (ex.: OS, código). */
  stickyFirst?: boolean;
  /** Coluna da direita fixa (ex.: Ações). */
  stickyLast?: boolean;
  /** Cabe na largura da tela (sem min-width que força barra horizontal). */
  fitWidth?: boolean;
  /** Fonte/padding densos + coluna Ações com wrap (listas com muitos botões). */
  compact?: boolean;
  /** Override da altura máxima do quadro (CSS). */
  maxHeight?: string;
  className?: string;
  /** Texto curto acima do quadro (opcional). */
  hint?: ReactNode;
};

/**
 * Quadro de tabela com scroll próprio + cabeçalho sticky
 * (padrão Agenda da Frota / Rateio por OS — menu lateral não some).
 */
export function DataTableScroll({
  children,
  stickyFirst = false,
  stickyLast = false,
  /** Padrão: cabe em 100% (sem forçar barra horizontal). */
  fitWidth = true,
  /** Padrão mobile: fonte/padding densos + ações com wrap. */
  compact = true,
  maxHeight,
  className,
  hint,
}: Props) {
  const style: CSSProperties | undefined = maxHeight ? { maxHeight } : undefined;

  return (
    <div className="min-w-0 space-y-2">
      {hint ? <div className="text-xs text-slate-600">{hint}</div> : null}
      <div
        className={cn(
          dataTableScroll({ stickyFirst, stickyLast, fitWidth }),
          compact && "data-table-scroll--compact",
          className
        )}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}

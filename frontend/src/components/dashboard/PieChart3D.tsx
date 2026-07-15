"use client";

import { formatCurrency } from "@/lib/utils";

export type PieSlice = {
  key: string;
  label: string;
  value: number;
  color?: string;
};

type Props = {
  slices: PieSlice[];
  size?: number;
};

const PALETTE = ["#d0001f", "#0d9488", "#d97706", "#0369a1", "#7c3aed", "#64748b"];

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${e.x} ${e.y} A ${r} ${r} 0 ${large} 1 ${s.x} ${s.y} Z`;
}

/** Pizza com “espessura” 3D (camada inferior deslocada). */
export function PieChart3D({ slices, size = 200 }: Props) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const cx = size / 2;
  const cy = size / 2 - 6;
  const r = size * 0.34;
  const depth = 10;

  if (total <= 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-500">
        Sem resultado atribuído no período.
      </div>
    );
  }

  let angle = 0;
  const arcs = slices.map((slice, i) => {
    const portion = (Math.max(0, slice.value) / total) * 360;
    const start = angle;
    const end = angle + portion;
    angle = end;
    return {
      ...slice,
      start,
      end,
      color: slice.color || PALETTE[i % PALETTE.length],
    };
  });

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto h-48 w-48 shrink-0"
        role="img"
        aria-label="Gráfico de participação"
      >
        {/* camada de profundidade */}
        {arcs.map((a) =>
          a.end - a.start < 0.5 ? null : (
            <path
              key={`d-${a.key}`}
              d={arcPath(cx, cy + depth, r, a.start, a.end)}
              fill={a.color}
              opacity={0.35}
            />
          )
        )}
        {arcs.map((a) =>
          a.end - a.start < 0.5 ? null : (
            <path key={a.key} d={arcPath(cx, cy, r, a.start, a.end)} fill={a.color} />
          )
        )}
        <circle cx={cx} cy={cy} r={r * 0.42} fill="white" opacity={0.92} />
      </svg>
      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {arcs.map((a) => {
          const pct = total > 0 ? (Math.max(0, a.value) / total) * 100 : 0;
          return (
            <li key={a.key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: a.color }}
                />
                <span className="truncate font-medium text-slate-800">{a.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {pct.toFixed(1)}% · {formatCurrency(a.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

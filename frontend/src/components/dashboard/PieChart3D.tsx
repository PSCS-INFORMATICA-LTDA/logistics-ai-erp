"use client";

import { useId } from "react";
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
  compact?: boolean;
};

const PALETTE = ["#2563eb", "#f97316", "#ef4444", "#22c55e", "#eab308", "#a855f7"];

function shade(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const n = parseInt(raw, 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (n & 255) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${e.x} ${e.y} A ${r} ${r} 0 ${large} 1 ${s.x} ${s.y} Z`;
}

function wallPath(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  depth: number
) {
  const a = polar(cx, cy, r, start);
  const b = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return [
    `M ${a.x} ${a.y}`,
    `A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`,
    `L ${b.x} ${b.y + depth}`,
    `A ${r} ${r} 0 ${large} 0 ${a.x} ${a.y + depth}`,
    "Z",
  ].join(" ");
}

/**
 * Pizza 3D explodida (referência escolhida): espessura uniforme,
 * fatias separadas, mate opaco, sombra suave. Sem branco (laranja no lugar).
 */
export function PieChart3D({ slices, size = 340, compact = false }: Props) {
  const uid = useId().replace(/:/g, "");
  const chartSize = compact ? Math.max(size, 340) : size;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);

  if (total <= 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-slate-500 ${
          compact ? "h-80" : "h-72"
        }`}
      >
        Sem resultado atribuído no período.
      </div>
    );
  }

  const cx = chartSize / 2;
  const cy = chartSize * 0.46;
  const r = chartSize * 0.3;
  const depth = Math.max(34, chartSize * 0.125);
  const explode = r * 0.18;
  const gapDeg = Math.min(4.5, 14 / Math.max(slices.length, 1));

  let angle = -25;
  const arcs = slices
    .map((slice, i) => {
      const value = Math.max(0, slice.value);
      const portion = (value / total) * 360;
      const rawStart = angle;
      const rawEnd = angle + portion;
      angle = rawEnd;
      const start = rawStart + gapDeg / 2;
      const end = rawEnd - gapDeg / 2;
      if (end - start < 0.4) return null;
      const mid = (start + end) / 2;
      const off = polar(0, 0, explode, mid);
      return {
        ...slice,
        value,
        start,
        end,
        portion,
        mid,
        ox: off.x,
        oy: off.y * 0.7,
        color: slice.color || PALETTE[i % PALETTE.length],
        idx: i,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a != null && a.portion > 0.35);

  const drawOrder = [...arcs].sort((a, b) => {
    const ay = Math.sin(((a.mid - 90) * Math.PI) / 180);
    const by = Math.sin(((b.mid - 90) * Math.PI) / 180);
    return ay - by;
  });

  const viewH = chartSize + depth + 20;

  return (
    <div
      className={
        compact
          ? "flex flex-col items-stretch gap-3"
          : "flex flex-col gap-4 sm:flex-row sm:items-center"
      }
    >
      <svg
        viewBox={`0 0 ${chartSize} ${viewH}`}
        className={compact ? "mx-auto h-80 w-80" : "mx-auto h-[22rem] w-[22rem]"}
        role="img"
        aria-label="Gráfico de pizza 3D explodida"
      >
        <defs>
          <filter id={`${uid}-soft`} x="-45%" y="-35%" width="190%" height="190%">
            <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#94a3b8" floodOpacity="0.32" />
          </filter>
          {arcs.map((a) => (
            <linearGradient
              key={`side-${a.key}`}
              id={`${uid}-side-${a.idx}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={shade(a.color, -14)} />
              <stop offset="100%" stopColor={shade(a.color, -52)} />
            </linearGradient>
          ))}
        </defs>

        <ellipse
          cx={cx}
          cy={cy + depth + 16}
          rx={r * 1.12}
          ry={r * 0.24}
          fill="rgba(148,163,184,0.24)"
          filter={`url(#${uid}-soft)`}
        />

        {drawOrder.map((a) => {
          const scx = cx + a.ox;
          const scy = cy + a.oy;
          const pStart = polar(scx, scy, r, a.start);
          const pEnd = polar(scx, scy, r, a.end);
          const center = { x: scx, y: scy };

          return (
            <g key={a.key} filter={`url(#${uid}-soft)`}>
              <path
                d={wallPath(scx, scy, r, a.start, a.end, depth)}
                fill={`url(#${uid}-side-${a.idx})`}
              />
              <polygon
                points={`${center.x},${center.y} ${pStart.x},${pStart.y} ${pStart.x},${
                  pStart.y + depth
                } ${center.x},${center.y + depth}`}
                fill={shade(a.color, -32)}
              />
              <polygon
                points={`${center.x},${center.y} ${pEnd.x},${pEnd.y} ${pEnd.x},${
                  pEnd.y + depth
                } ${center.x},${center.y + depth}`}
                fill={shade(a.color, -42)}
              />
              <path
                d={sectorPath(scx, scy, r, a.start, a.end)}
                fill={a.color}
                stroke="rgba(15,23,42,0.06)"
                strokeWidth={0.6}
              />
              <path
                d={sectorPath(scx, scy, r, a.start, a.end)}
                fill="rgba(255,255,255,0.16)"
                style={{ mixBlendMode: "soft-light" }}
              />
            </g>
          );
        })}
      </svg>

      <ul
        className={
          compact
            ? "min-w-0 space-y-1.5 text-xs"
            : "min-w-0 flex-1 space-y-2 text-sm"
        }
      >
        {arcs.map((a) => {
          const pct = (a.value / total) * 100;
          return (
            <li key={a.key} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm shadow-sm ring-1 ring-black/5"
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

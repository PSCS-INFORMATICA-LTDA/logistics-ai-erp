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

/** Azul / laranja / vermelho (laranja no lugar do branco da referência). */
const PALETTE = ["#2f6bff", "#f97316", "#ef4444", "#22c55e", "#eab308", "#a855f7"];

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

/** Anel externo do topo (efeito bisel / borda arredondada). */
function rimPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number
) {
  const o1 = polar(cx, cy, rOuter, start);
  const o2 = polar(cx, cy, rOuter, end);
  const i2 = polar(cx, cy, rInner, end);
  const i1 = polar(cx, cy, rInner, start);
  const large = end - start > 180 ? 1 : 0;
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i1.x} ${i1.y}`,
    "Z",
  ].join(" ");
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
 * Gráfico 3D explodido — referência confirmada:
 * espessura uniforme, gaps entre fatias, mate, bisel suave, sombra no chão.
 * Branco da referência → laranja.
 */
export function PieChart3D({ slices, size = 360, compact = false }: Props) {
  const uid = useId().replace(/:/g, "");
  const chartSize = compact ? Math.max(size, 360) : size;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);

  if (total <= 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-slate-500 ${
          compact ? "h-[22rem]" : "h-80"
        }`}
      >
        Sem resultado atribuído no período.
      </div>
    );
  }

  const cx = chartSize / 2;
  const cy = chartSize * 0.44;
  const r = chartSize * 0.31;
  const depth = Math.max(40, chartSize * 0.14);
  const explode = r * 0.22;
  const gapDeg = Math.min(5.5, 16 / Math.max(slices.length, 1));
  const bevel = Math.max(5, r * 0.055);

  let angle = -28;
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
        oy: off.y * 0.68,
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

  const viewH = chartSize + depth + 28;
  const svgClass = compact
    ? "mx-auto h-[22rem] w-[22rem]"
    : "mx-auto h-[24rem] w-[24rem]";

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
        className={svgClass}
        role="img"
        aria-label="Gráfico de pizza 3D explodida"
      >
        <defs>
          <filter id={`${uid}-floor`} x="-50%" y="-40%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id={`${uid}-soft`} x="-40%" y="-30%" width="180%" height="180%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#64748b" floodOpacity="0.28" />
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
              <stop offset="0%" stopColor={shade(a.color, -8)} />
              <stop offset="45%" stopColor={shade(a.color, -28)} />
              <stop offset="100%" stopColor={shade(a.color, -58)} />
            </linearGradient>
          ))}
          {arcs.map((a) => (
            <radialGradient
              key={`top-${a.key}`}
              id={`${uid}-top-${a.idx}`}
              cx="32%"
              cy="28%"
              r="78%"
            >
              <stop offset="0%" stopColor={shade(a.color, 28)} />
              <stop offset="55%" stopColor={a.color} />
              <stop offset="100%" stopColor={shade(a.color, -8)} />
            </radialGradient>
          ))}
        </defs>

        {/* sombra coletiva no chão */}
        <ellipse
          cx={cx}
          cy={cy + depth + 18}
          rx={r * 1.18}
          ry={r * 0.26}
          fill="rgba(100,116,139,0.22)"
          filter={`url(#${uid}-floor)`}
        />

        {drawOrder.map((a) => {
          const scx = cx + a.ox;
          const scy = cy + a.oy;
          const pStart = polar(scx, scy, r, a.start);
          const pEnd = polar(scx, scy, r, a.end);
          const center = { x: scx, y: scy };
          const sliceMid = polar(scx, scy, r * 0.45, a.mid);

          return (
            <g key={a.key}>
              {/* sombra individual sob a fatia */}
              <ellipse
                cx={sliceMid.x}
                cy={scy + depth + 10}
                rx={r * 0.42}
                ry={r * 0.12}
                fill="rgba(100,116,139,0.18)"
                filter={`url(#${uid}-floor)`}
              />

              <g filter={`url(#${uid}-soft)`}>
                <path
                  d={wallPath(scx, scy, r, a.start, a.end, depth)}
                  fill={`url(#${uid}-side-${a.idx})`}
                />
                <polygon
                  points={`${center.x},${center.y} ${pStart.x},${pStart.y} ${pStart.x},${
                    pStart.y + depth
                  } ${center.x},${center.y + depth}`}
                  fill={shade(a.color, -30)}
                />
                <polygon
                  points={`${center.x},${center.y} ${pEnd.x},${pEnd.y} ${pEnd.x},${
                    pEnd.y + depth
                  } ${center.x},${center.y + depth}`}
                  fill={shade(a.color, -45)}
                />
                {/* topo mate com luz suave */}
                <path
                  d={sectorPath(scx, scy, r, a.start, a.end)}
                  fill={`url(#${uid}-top-${a.idx})`}
                />
                {/* bisel claro na borda externa */}
                <path
                  d={rimPath(scx, scy, r, r - bevel, a.start, a.end)}
                  fill="rgba(255,255,255,0.22)"
                  style={{ mixBlendMode: "soft-light" }}
                />
                {/* bisel interno (corte da fatia) */}
                <path
                  d={rimPath(scx, scy, bevel * 1.6, 0.01, a.start, a.end)}
                  fill="rgba(255,255,255,0.1)"
                  style={{ mixBlendMode: "soft-light" }}
                />
              </g>
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

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

const PALETTE = ["#2f6bff", "#ff8a1f", "#22c55e", "#a855f7", "#06b6d4", "#ef4444"];

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

/** Face superior do setor (pizza plana). */
function sectorPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${e.x} ${e.y} A ${r} ${r} 0 ${large} 1 ${s.x} ${s.y} Z`;
}

/** Parede lateral curva do setor (extrusão 3D). */
function wallPath(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  depth: number
) {
  const outerTopA = polar(cx, cy, r, start);
  const outerTopB = polar(cx, cy, r, end);
  const outerBotA = { x: outerTopA.x, y: outerTopA.y + depth };
  const outerBotB = { x: outerTopB.x, y: outerTopB.y + depth };
  const large = end - start > 180 ? 1 : 0;
  return [
    `M ${outerTopA.x} ${outerTopA.y}`,
    `A ${r} ${r} 0 ${large} 1 ${outerTopB.x} ${outerTopB.y}`,
    `L ${outerBotB.x} ${outerBotB.y}`,
    `A ${r} ${r} 0 ${large} 0 ${outerBotA.x} ${outerBotA.y}`,
    "Z",
  ].join(" ");
}

/**
 * Pizza 3D estilo referência: disco espesso, gradiente suave, sombra e fatia “explodida”.
 */
export function PieChart3D({ slices, size = 260, compact = false }: Props) {
  const uid = useId().replace(/:/g, "");
  const chartSize = compact ? Math.max(size, 260) : size;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);

  if (total <= 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-slate-500 ${
          compact ? "h-56" : "h-52"
        }`}
      >
        Sem resultado atribuído no período.
      </div>
    );
  }

  const cx = chartSize / 2;
  const cy = chartSize / 2 - 6;
  const r = chartSize * 0.34;
  const depth = Math.max(22, chartSize * 0.1);

  let angle = -20; // leve rotação para combinar com o exemplo
  const arcs = slices
    .map((slice, i) => {
      const value = Math.max(0, slice.value);
      const portion = (value / total) * 360;
      const start = angle;
      const end = angle + portion;
      angle = end;
      return {
        ...slice,
        value,
        start,
        end,
        portion,
        color: slice.color || PALETTE[i % PALETTE.length],
        idx: i,
      };
    })
    .filter((a) => a.portion > 0.2);

  // Explode a 2ª fatia (ou a menor relevante), como no exemplo
  const explodeIdx =
    arcs.length >= 2
      ? arcs.slice().sort((a, b) => a.portion - b.portion)[0]?.idx ?? 1
      : -1;

  const offsetFor = (start: number, end: number, idx: number) => {
    if (idx !== explodeIdx) return { ox: 0, oy: 0 };
    const mid = (start + end) / 2;
    const p = polar(0, 0, r * 0.16, mid);
    return { ox: p.x, oy: p.y * 0.85 };
  };

  return (
    <div
      className={
        compact
          ? "flex flex-col items-stretch gap-3"
          : "flex flex-col gap-4 sm:flex-row sm:items-center"
      }
    >
      <svg
        viewBox={`0 0 ${chartSize} ${chartSize + depth}`}
        className={compact ? "mx-auto h-56 w-56" : "mx-auto h-60 w-60"}
        role="img"
        aria-label="Gráfico de pizza 3D"
      >
        <defs>
          <filter id={`${uid}-shadow`} x="-30%" y="-20%" width="160%" height="160%">
            <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#64748b" floodOpacity="0.28" />
          </filter>
          {arcs.map((a) => (
            <radialGradient
              key={`g-${a.key}`}
              id={`${uid}-top-${a.idx}`}
              cx="38%"
              cy="32%"
              r="78%"
            >
              <stop offset="0%" stopColor={shade(a.color, 70)} />
              <stop offset="55%" stopColor={a.color} />
              <stop offset="100%" stopColor={shade(a.color, -35)} />
            </radialGradient>
          ))}
          <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(148,163,184,0.18)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.02)" />
          </linearGradient>
        </defs>

        {/* sombra difusa no chão */}
        <ellipse
          cx={cx}
          cy={cy + depth + 14}
          rx={r * 0.95}
          ry={r * 0.22}
          fill={`url(#${uid}-floor)`}
          filter={`url(#${uid}-shadow)`}
        />

        {/* paredes laterais (atrás) — desenha primeiro para profundidade */}
        {arcs.map((a) => {
          const { ox, oy } = offsetFor(a.start, a.end, a.idx);
          return (
            <path
              key={`w-${a.key}`}
              d={wallPath(cx + ox, cy + oy, r, a.start, a.end, depth)}
              fill={shade(a.color, -55)}
            />
          );
        })}

        {/* faces radiais internas da fatia explodida */}
        {arcs.map((a) => {
          if (a.idx !== explodeIdx) return null;
          const { ox, oy } = offsetFor(a.start, a.end, a.idx);
          const p1 = polar(cx + ox, cy + oy, r, a.start);
          const p2 = polar(cx + ox, cy + oy, r, a.end);
          const c = { x: cx + ox, y: cy + oy };
          return (
            <g key={`cut-${a.key}`}>
              <polygon
                points={`${c.x},${c.y} ${p1.x},${p1.y} ${p1.x},${p1.y + depth} ${c.x},${c.y + depth}`}
                fill={shade(a.color, -40)}
              />
              <polygon
                points={`${c.x},${c.y} ${p2.x},${p2.y} ${p2.x},${p2.y + depth} ${c.x},${c.y + depth}`}
                fill={shade(a.color, -30)}
              />
            </g>
          );
        })}

        {/* topo suave */}
        {arcs.map((a) => {
          const { ox, oy } = offsetFor(a.start, a.end, a.idx);
          return (
            <path
              key={`t-${a.key}`}
              d={sectorPath(cx + ox, cy + oy, r, a.start, a.end)}
              fill={`url(#${uid}-top-${a.idx})`}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={0.8}
            />
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
                  className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ring-1 ring-black/5"
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

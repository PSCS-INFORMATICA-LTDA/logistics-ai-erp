"use client";

import { useId } from "react";
import { formatCurrency } from "@/lib/utils";

export type IsoBarItem = {
  key: string;
  label: string;
  value: number;
  color: string;
  topColor: string;
  sideColor: string;
};

type Props = {
  items: IsoBarItem[];
  height?: number;
};

function shade(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const n = parseInt(raw, 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (n & 255) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Barras 3D lisas (mesmo idioma visual da pizza de referência). */
export function IsoBarChart3D({ items, height = 200 }: Props) {
  const uid = useId().replace(/:/g, "");
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const barW = 40;
  const gap = 30;
  const depth = 16;
  const baseY = height - 32;
  const chartW = Math.max(240, items.length * (barW + gap) + 48);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${chartW} ${height}`}
        className="mx-auto block h-auto w-full max-w-md"
        role="img"
        aria-label="Gráfico de barras 3D"
      >
        <defs>
          <filter id={`${uid}-shadow`} x="-20%" y="-10%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#64748b" floodOpacity="0.22" />
          </filter>
          <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(148,163,184,0.16)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.02)" />
          </linearGradient>
          {items.map((item, i) => (
            <linearGradient key={item.key} id={`${uid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={shade(item.color, 55)} />
              <stop offset="45%" stopColor={item.color} />
              <stop offset="100%" stopColor={shade(item.color, -25)} />
            </linearGradient>
          ))}
        </defs>

        <ellipse
          cx={chartW / 2}
          cy={baseY + 10}
          rx={chartW * 0.4}
          ry={14}
          fill={`url(#${uid}-floor)`}
        />

        {items.map((item, index) => {
          const h = Math.max(16, (Math.abs(item.value) / max) * (height - 78));
          const x = 32 + index * (barW + gap);
          const y = baseY - h;
          const front = `${x},${y} ${x + barW},${y} ${x + barW},${baseY} ${x},${baseY}`;
          const top = `${x},${y} ${x + depth},${y - depth} ${x + barW + depth},${y - depth} ${x + barW},${y}`;
          const side = `${x + barW},${y} ${x + barW + depth},${y - depth} ${x + barW + depth},${baseY - depth} ${x + barW},${baseY}`;

          return (
            <g key={item.key} filter={`url(#${uid}-shadow)`}>
              <polygon points={side} fill={shade(item.color, -45)} />
              <polygon points={front} fill={`url(#${uid}-bar-${index})`} />
              <polygon points={top} fill={shade(item.topColor || item.color, 40)} />
              <text
                x={x + barW / 2 + depth / 4}
                y={y - depth - 8}
                textAnchor="middle"
                className="fill-slate-700"
                style={{ fontSize: 10, fontWeight: 600 }}
              >
                {formatCurrency(item.value)}
              </text>
              <text
                x={x + barW / 2}
                y={baseY + 20}
                textAnchor="middle"
                className="fill-slate-500"
                style={{ fontSize: 10 }}
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const GRX_BAR_COLORS = {
  revenue: { color: "#22c55e", topColor: "#86efac", sideColor: "#15803d" },
  expense: { color: "#ef4444", topColor: "#fca5a5", sideColor: "#b91c1c" },
  result: { color: "#2f6bff", topColor: "#93c5fd", sideColor: "#1d4ed8" },
} as const;

"use client";

import { formatCurrency } from "@/lib/utils";

export type IsoBarItem = {
  key: string;
  label: string;
  value: number;
  color: string; // front face
  topColor: string;
  sideColor: string;
};

type Props = {
  items: IsoBarItem[];
  height?: number;
};

/** Barras isométricas 3D (SVG) — visual GRX, sem lib externa. */
export function IsoBarChart3D({ items, height = 180 }: Props) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const barW = 36;
  const gap = 28;
  const depth = 14;
  const baseY = height - 28;
  const chartW = Math.max(220, items.length * (barW + gap) + 40);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${chartW} ${height}`}
        className="mx-auto block h-auto w-full max-w-md"
        role="img"
        aria-label="Gráfico de barras 3D"
      >
        <defs>
          <linearGradient id="isoFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(148,163,184,0.12)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.02)" />
          </linearGradient>
        </defs>
        <ellipse
          cx={chartW / 2}
          cy={baseY + 8}
          rx={chartW * 0.42}
          ry={12}
          fill="url(#isoFloor)"
        />

        {items.map((item, index) => {
          const h = Math.max(8, (Math.abs(item.value) / max) * (height - 70));
          const x = 28 + index * (barW + gap);
          const y = baseY - h;
          const front = `${x},${y} ${x + barW},${y} ${x + barW},${baseY} ${x},${baseY}`;
          const top = `${x},${y} ${x + depth},${y - depth} ${x + barW + depth},${y - depth} ${x + barW},${y}`;
          const side = `${x + barW},${y} ${x + barW + depth},${y - depth} ${x + barW + depth},${baseY - depth} ${x + barW},${baseY}`;

          return (
            <g key={item.key}>
              <polygon points={side} fill={item.sideColor} />
              <polygon points={front} fill={item.color} />
              <polygon points={top} fill={item.topColor} />
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
                y={baseY + 18}
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
  revenue: { color: "#059669", topColor: "#34d399", sideColor: "#047857" },
  expense: { color: "#d0001f", topColor: "#f87171", sideColor: "#9f1239" },
  result: { color: "#0369a1", topColor: "#38bdf8", sideColor: "#075985" },
} as const;

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
  compact?: boolean;
};

/** Paleta da referência: azul / laranja (no lugar do branco) / vermelho. */
const PALETTE = ["#1e3a8a", "#f97316", "#ef4444", "#22c55e", "#eab308", "#a855f7"];

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
 * Pizza 3D fiel à imagem de referência:
 * explodida, espessura rasa (~6–8% do diâmetro), mate sólido, sem liquid glass.
 * Branco da foto → laranja (contraste no fundo claro).
 */
export function PieChart3D({ slices, size = 300, compact = false }: Props) {
  const chartSize = Math.min(Math.max(size, 280), 320);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);

  if (total <= 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        Sem resultado atribuído no período.
      </div>
    );
  }

  const cx = chartSize / 2;
  const cy = chartSize * 0.48;
  const r = chartSize * 0.34;
  // Espessura rasa como na foto (não “bloco”).
  const depth = Math.max(10, chartSize * 0.055);
  const explode = r * 0.14;
  const gapDeg = Math.min(4.2, 12 / Math.max(slices.length, 1));

  let angle = -20;
  const arcs = slices
    .map((slice, i) => {
      const value = Math.max(0, slice.value);
      const portion = (value / total) * 360;
      const rawStart = angle;
      const rawEnd = angle + portion;
      angle = rawEnd;
      const start = rawStart + gapDeg / 2;
      const end = rawEnd - gapDeg / 2;
      if (end - start < 0.4 || portion <= 0.35) return null;
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
        oy: off.y * 0.62,
        color: slice.color || PALETTE[i % PALETTE.length],
        idx: i,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a != null);

  const drawOrder = [...arcs].sort((a, b) => {
    const ay = Math.sin(((a.mid - 90) * Math.PI) / 180);
    const by = Math.sin(((b.mid - 90) * Math.PI) / 180);
    return ay - by;
  });

  const viewH = chartSize + depth + 14;

  return (
    <div
      className={
        compact
          ? "flex flex-col items-stretch gap-2"
          : "flex flex-col gap-3 sm:flex-row sm:items-center"
      }
    >
      <svg
        viewBox={`0 0 ${chartSize} ${viewH}`}
        className="mx-auto h-64 w-64 shrink-0 sm:h-72 sm:w-72"
        role="img"
        aria-label="Gráfico de pizza 3D no estilo da referência"
      >
        {/* sombra suave no chão — sem filtro glass */}
        <ellipse
          cx={cx}
          cy={cy + depth + 12}
          rx={r * 1.05}
          ry={r * 0.2}
          fill="rgba(148,163,184,0.28)"
        />

        {drawOrder.map((a) => {
          const scx = cx + a.ox;
          const scy = cy + a.oy;
          const pStart = polar(scx, scy, r, a.start);
          const pEnd = polar(scx, scy, r, a.end);
          const center = { x: scx, y: scy };

          return (
            <g key={a.key}>
              {/* parede externa mate (só um tom mais escuro) */}
              <path
                d={wallPath(scx, scy, r, a.start, a.end, depth)}
                fill={shade(a.color, -38)}
              />
              {/* faces do corte */}
              <polygon
                points={`${center.x},${center.y} ${pStart.x},${pStart.y} ${pStart.x},${
                  pStart.y + depth
                } ${center.x},${center.y + depth}`}
                fill={shade(a.color, -28)}
              />
              <polygon
                points={`${center.x},${center.y} ${pEnd.x},${pEnd.y} ${pEnd.x},${
                  pEnd.y + depth
                } ${center.x},${center.y + depth}`}
                fill={shade(a.color, -48)}
              />
              {/* topo sólido mate — sem highlight glass */}
              <path d={sectorPath(scx, scy, r, a.start, a.end)} fill={a.color} />
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
                  className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/5"
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

"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
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

/** Azul / laranja / vermelho — laranja no lugar do branco da referência. */
const PALETTE = ["#2f6bff", "#f97316", "#ef4444", "#22c55e", "#eab308", "#a855f7"];

type Arc = {
  key: string;
  label: string;
  value: number;
  portion: number;
  start: number;
  end: number;
  mid: number;
  color: string;
};

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function makeSliceGeometry(startDeg: number, endDeg: number, radius: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const steps = Math.max(20, Math.ceil((endDeg - startDeg) / 2.5));
  for (let i = 0; i <= steps; i++) {
    const a = degToRad(startDeg + ((endDeg - startDeg) * i) / steps);
    const x = Math.cos(a - Math.PI / 2) * radius;
    const y = Math.sin(a - Math.PI / 2) * radius;
    shape.lineTo(x, y);
  }
  shape.lineTo(0, 0);

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 28,
  });
}

function buildArcs(slices: PieSlice[]): Arc[] {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return [];
  let angle = -20;
  const gap = Math.min(5, 14 / Math.max(slices.length, 1));
  return slices
    .map((slice, i) => {
      const value = Math.max(0, slice.value);
      const portion = (value / total) * 360;
      const rawStart = angle;
      const rawEnd = angle + portion;
      angle = rawEnd;
      const start = rawStart + gap / 2;
      const end = rawEnd - gap / 2;
      if (end - start < 0.5 || portion <= 0.35) return null;
      return {
        key: slice.key,
        label: slice.label,
        value,
        portion,
        start,
        end,
        mid: (start + end) / 2,
        color: slice.color || PALETTE[i % PALETTE.length],
      };
    })
    .filter((a): a is Arc => a != null);
}

/**
 * Pizza 3D WebGL mate (sem liquid glass), container quadrado (sem ovalar),
 * tamanho contido no dashboard.
 */
export function PieChart3D({ slices, compact = false }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const arcs = useMemo(() => buildArcs(slices), [slices]);
  const sceneKey = useMemo(
    () => arcs.map((a) => `${a.key}:${a.value}:${a.color}`).join("|"),
    [arcs]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || arcs.length === 0) return;

    const sizePx = () => {
      const side = Math.min(host.clientWidth || 240, host.clientHeight || 240, 260);
      return Math.max(180, side);
    };

    let side = sizePx();
    const scene = new THREE.Scene();

    // Ortográfica + visão alta: círculo redondo, sem “esticar” nem brilho de perspectiva.
    const frustum = 2.35;
    const camera = new THREE.OrthographicCamera(
      -frustum,
      frustum,
      frustum,
      -frustum,
      0.1,
      40
    );
    camera.position.set(0, 5.2, 3.2);
    camera.lookAt(0, 0.05, 0);
    camera.zoom = 1;
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(side, side, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Sem ACES/filmic — evita “vidro” brilhante nas fatias.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.replaceChildren(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      width: `${side}px`,
      height: `${side}px`,
      display: "block",
      margin: "0 auto",
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(1.8, 5.5, 2.0);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xf8fafc, 0.25);
    fill.position.set(-2.4, 2.0, -1.6);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48),
      new THREE.ShadowMaterial({ opacity: 0.12 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    const pie = new THREE.Group();
    scene.add(pie);

    const radius = 1.35;
    const explode = 0.09;
    const disposables: Array<THREE.BufferGeometry | THREE.Material> = [
      ground.geometry,
      ground.material,
    ];

    for (const arc of arcs) {
      const geom = makeSliceGeometry(arc.start, arc.end, radius);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(arc.color),
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.rotation.x = -Math.PI / 2;
      const midRad = degToRad(arc.mid - 90);
      mesh.position.x = Math.cos(midRad) * explode;
      mesh.position.z = Math.sin(midRad) * explode;
      mesh.position.y = 0;
      pie.add(mesh);
      disposables.push(geom, mat);
    }

    const paint = () => renderer.render(scene, camera);
    paint();

    let frame = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      frame = requestAnimationFrame(tick);
      paint();
    };
    tick();

    const onResize = () => {
      side = sizePx();
      renderer.setSize(side, side, false);
      Object.assign(renderer.domElement.style, {
        width: `${side}px`,
        height: `${side}px`,
      });
      paint();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      ro.disconnect();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, compact]);

  if (total <= 0) {
    return (
      <div className="flex h-52 items-center justify-center text-sm text-slate-500">
        Sem resultado atribuído no período.
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "flex flex-col items-stretch gap-2"
          : "flex flex-col gap-3 sm:flex-row sm:items-center"
      }
    >
      <div
        ref={hostRef}
        className="mx-auto aspect-square h-52 w-52 shrink-0 sm:h-56 sm:w-56"
        role="img"
        aria-label="Gráfico de pizza 3D explodida"
      />
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

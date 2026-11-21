"use client";
import { useEffect, useRef, useState } from "react";
import { Vector3 } from "three";

export type Residue = {
  number: number;
  name: string;
  chain?: string;
  xyz: [number, number, number];
};
export type Protein = {
  model: string;
  pdb: string;
  title: string;
  chain: string;
  organism: string;
  source_url: string;
  trace: Residue[];
  first: number;
  last: number;
  hinges: number[];
  start_angles: number[];
};

export function fold(chain: Residue[], hinges: number[], angles: number[]) {
  const points = chain.map((r) => new Vector3(...r.xyz));
  const moving = points.filter((_, i) => chain[i].chain === "B");
  if (moving.length) {
    const center = moving
      .reduce((sum, p) => sum.add(p), new Vector3())
      .divideScalar(moving.length);
    for (const p of moving)
      p.sub(center)
        .applyAxisAngle(new Vector3(1, 0, 0), (angles[0] * Math.PI) / 180)
        .applyAxisAngle(new Vector3(0, 1, 0), (angles[1] * Math.PI) / 180)
        .add(center);
    return points;
  }
  hinges.forEach((k, i) => {
    const pivot = points[k];
    const axis = pivot
      .clone()
      .sub(points[k - 1])
      .normalize();
    for (const tail of points.slice(k + 1))
      tail
        .sub(pivot)
        .applyAxisAngle(axis, (angles[i] * Math.PI) / 180)
        .add(pivot);
  });
  return points;
}

const palette = ["#43d4bb", "#75abff", "#ffbe68"];

export default function ProteinView({
  chain,
  points,
  overlay,
  fragment,
  camera,
  onRotate,
}: {
  chain: Residue[];
  points: Vector3[];
  overlay: boolean;
  fragment: boolean;
  camera: [number, number, number];
  onRotate: (dx: number, dy: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = el.getContext("2d");
    if (!g) return;
    const height = el.clientHeight;
    const dpi = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(width * dpi);
    el.height = Math.round(height * dpi);
    g.scale(dpi, dpi);
    const ref = chain.map((r) => new Vector3(...r.xyz));
    const center = ref
      .reduce((sum, p) => sum.add(p), new Vector3())
      .divideScalar(ref.length);
    const radius = Math.max(...ref.map((p) => p.distanceTo(center)));
    const scale = ((Math.min(width, height) * 0.4) / radius) * camera[2];
    const project = (v: Vector3) => {
      const p = v
        .clone()
        .sub(center)
        .applyAxisAngle(new Vector3(0, 1, 0), camera[0])
        .applyAxisAngle(new Vector3(1, 0, 0), camera[1]);
      return {
        x: width / 2 + p.x * scale,
        y: height / 2 - p.y * scale,
        z: p.z,
      };
    };
    const native = ref.map(project);
    const coordinates = points.map(project);
    function connected(i: number) {
      return (
        i > 0 &&
        chain[i].chain === chain[i - 1].chain &&
        chain[i].number === chain[i - 1].number + 1 &&
        ref[i].distanceTo(ref[i - 1]) < 4.5
      );
    }
    function line(
      a: { x: number; y: number },
      b: { x: number; y: number },
      color: string,
      thickness: number,
    ) {
      if (!g) return;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokeStyle = color;
      g.lineWidth = thickness;
      g.lineCap = "round";
      g.stroke();
    }
    if (overlay) {
      g.setLineDash([4, 5]);
      native.forEach((p, i) => {
        if (connected(i)) line(native[i - 1], p, "#b0c4d9", 2);
      });
      g.setLineDash([]);
    }
    // Sort bonds and atoms together so nearer sections hide distant geometry.
    const draw: { depth: number; paint: () => void }[] = [];
    coordinates.forEach((p, i) => {
      const section = chain[i].chain
        ? Number(chain[i].chain === "B")
        : fragment
          ? Math.min(2, Math.floor(i / 4))
          : Math.min(2, Math.floor((i / coordinates.length) * 3));
      const color = palette[section];
      const r = Math.max(
        2,
        (fragment ? 7.5 : 3.3) *
          Math.min(1.4, camera[2]) *
          (1 + (0.18 * p.z) / radius),
      );
      if (connected(i)) {
        const a = coordinates[i - 1];
        draw.push({
          depth: (a.z + p.z) / 2 - 0.05,
          paint: () => line(a, p, color, fragment ? 4 : 2.5),
        });
      }
      draw.push({
        depth: p.z,
        paint: () => {
          const fill = g.createRadialGradient(
            p.x - r * 0.3,
            p.y - r * 0.35,
            0,
            p.x,
            p.y,
            r,
          );
          fill.addColorStop(0, "#effffc");
          fill.addColorStop(0.34, color);
          fill.addColorStop(1, "#274666");
          g.fillStyle = fill;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, 2 * Math.PI);
          g.fill();
        },
      });
    });
    draw.sort((a, b) => a.depth - b.depth).forEach((item) => item.paint());
    if (fragment)
      [0, chain.length - 1].forEach((i) => {
        const p = coordinates[i];
        g.font = "bold 11px system-ui";
        g.fillStyle = "#f0fafb";
        g.fillText(chain[i].name + " " + chain[i].number, p.x + 11, p.y - 9);
      });
  }, [width, chain, points, overlay, fragment, camera]);

  return (
    <canvas
      ref={canvas}
      className="protein-canvas"
      aria-label="แบบจำลองโปรตีนสามมิติ ลากเพื่อหมุน หรือใช้ปุ่มลูกศร"
      tabIndex={0}
      onKeyDown={(e) => {
        const deltas: Record<string, [number, number]> = {
          ArrowLeft: [-0.15, 0],
          ArrowRight: [0.15, 0],
          ArrowUp: [0, -0.15],
          ArrowDown: [0, 0.15],
        };
        if (deltas[e.key]) {
          e.preventDefault();
          onRotate(...deltas[e.key]);
        }
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onRotate(
          (e.clientX - drag.current.x) * 0.012,
          (e.clientY - drag.current.y) * 0.012,
        );
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}

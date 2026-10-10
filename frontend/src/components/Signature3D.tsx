'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Signature3D — a dependency-free "3D" element for the RetailFlow overview.
 *
 * Draws a slowly rotating wireframe warehouse cube in perspective, with data
 * particles flowing along the pipeline edges (source -> staging -> warehouse).
 * Pure Canvas 2D with manual perspective projection: no three.js, no WebGL, no
 * extra dependencies, so it is tiny and safe to lazy-load.
 *
 * Honesty + accessibility:
 *  - If Canvas is unavailable, renders the CSS `.rf-signature-fallback`.
 *  - Respects `prefers-reduced-motion`: draws a single static frame, no rAF loop.
 *  - Pauses the animation while offscreen (IntersectionObserver) to save CPU.
 */

const CUBE: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function project(x: number, y: number, z: number, cx: number, cy: number, scale: number) {
  const d = 3.2;
  const p = d / (d - z);
  return { x: cx + x * scale * p, y: cy + y * scale * p, s: p };
}

export function Signature3D({ height = 240 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setFailed(true);
      return;
    }

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = host.getBoundingClientRect();
      w = Math.max(1, Math.floor(r.width));
      h = Math.max(1, Math.floor(r.height || height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Particle positions along the 12 edges (t in [0,1)).
    const particles = EDGES.map((_, i) => ({ e: i, t: (i * 0.137) % 1, sp: 0.0016 + (i % 3) * 0.0006 }));

    let raf = 0;
    let visible = true;
    let start = performance.now();

    const draw = (now: number) => {
      const time = reduce ? 0 : (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.24;

      const ry = time * 0.35 + 0.6;
      const rx = Math.sin(time * 0.22) * 0.35 - 0.35;
      const cosY = Math.cos(ry), sinY = Math.sin(ry);
      const cosX = Math.cos(rx), sinX = Math.sin(rx);

      const pts = CUBE.map(([x, y, z]) => {
        let X = x * cosY - z * sinY;
        let Z = x * sinY + z * cosY;
        let Y = y * cosX - Z * sinX;
        Z = y * sinX + Z * cosX;
        return project(X, Y, Z, cx, cy, scale);
      });

      // Back-to-front-ish edge rendering with depth fade.
      EDGES.forEach(([a, b]) => {
        const pa = pts[a];
        const pb = pts[b];
        const depth = ((pa.s + pb.s) / 2 - 0.7) / 0.6;
        const alpha = Math.max(0.12, Math.min(0.9, depth));
        ctx.strokeStyle = `rgba(67, 134, 217, ${alpha})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      });

      // Nodes at each vertex.
      pts.forEach((p) => {
        const r = Math.max(1.6, 2.6 * p.s);
        ctx.fillStyle = 'rgba(23, 23, 23, 0.85)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      });

      // Data particles flowing along edges.
      particles.forEach((pt) => {
        if (!reduce) pt.t = (pt.t + pt.sp) % 1;
        const [a, b] = EDGES[pt.e];
        const pa = pts[a];
        const pb = pts[b];
        const x = pa.x + (pb.x - pa.x) * pt.t;
        const y = pa.y + (pb.y - pa.y) * pt.t;
        const s = pa.s + (pb.s - pa.s) * pt.t;
        ctx.fillStyle = 'rgba(216, 155, 94, 0.95)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.4, 2.2 * s), 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const loop = (now: number) => {
      draw(now);
      if (visible && !reduce) raf = requestAnimationFrame(loop);
    };

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible && !reduce) {
          start = performance.now();
          raf = requestAnimationFrame(loop);
        } else {
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.01 },
    );
    io.observe(host);

    draw(performance.now());
    if (!reduce) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [height]);

  if (failed) {
    return (
      <div className="rf-signature-fallback" ref={hostRef as never}>
        RetailFlow warehouse — source → staging → warehouse
      </div>
    );
  }

  return (
    <div className="rf-signature" ref={hostRef} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

export default Signature3D;

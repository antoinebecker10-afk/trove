import { useRef, useEffect, useMemo } from "react";

interface Vec3 { x: number; y: number; z: number }

function buildDiamond(r: number) {
  const tableR = r * 0.45;
  const girdleR = r;
  const crownH = r * 0.35;
  const pavilionH = r * 0.9;
  const N = 8;
  const verts: Vec3[] = [];
  const faces: number[][] = [];

  // 0: bottom tip
  verts.push({ x: 0, y: pavilionH, z: 0 });
  // 1..8: girdle
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    verts.push({ x: Math.cos(a) * girdleR, y: 0, z: Math.sin(a) * girdleR });
  }
  // 9..16: table ring
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    verts.push({ x: Math.cos(a) * tableR, y: -crownH, z: Math.sin(a) * tableR });
  }

  // Pavilion (8 triangles)
  for (let i = 0; i < N; i++) faces.push([0, 1 + i, 1 + (i + 1) % N]);
  // Crown (8 quads)
  for (let i = 0; i < N; i++) faces.push([1 + i, 1 + (i + 1) % N, 9 + (i + 1) % N, 9 + i]);
  // Table (octagon)
  const table: number[] = [];
  for (let i = 0; i < N; i++) table.push(9 + i);
  faces.push(table);

  return { verts, faces };
}

// Static light vectors — never change
const LIGHT1: Vec3 = { x: 0.4, y: -0.6, z: 0.7 };
const LIGHT2: Vec3 = { x: -0.3, y: -0.4, z: -0.5 };
const VIEW_DIR: Vec3 = { x: 0, y: 0, z: -1 };
const TILT_X = 0.22;

function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}
function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}
function proj(v: Vec3, fov: number, cx: number, cy: number) {
  const z = v.z + fov;
  const sc = fov / z;
  return { x: cx + v.x * sc, y: cy + v.y * sc };
}
function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = c.x - a.x, wy = c.y - a.y, wz = c.z - a.z;
  return { x: uy * wz - uz * wy, y: uz * wx - ux * wz, z: ux * wy - uy * wx };
}
function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function dot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// Reflect vector r = d - 2(d·n)n
function reflect(d: Vec3, n: Vec3): Vec3 {
  const dn = dot(d, n) * 2;
  return { x: d.x - dn * n.x, y: d.y - dn * n.y, z: d.z - dn * n.z };
}

const PAV = ["#fb923c", "#fdba74", "#f97316", "#fbbf24", "#fb923c", "#fdba74", "#f97316", "#fbbf24"];
const CRO = ["#fb923c", "#f97316", "#fdba74", "#fbbf24", "#fb923c", "#f97316", "#fdba74", "#fbbf24"];
const TBL = "#fed7aa";

export function Diamond3D({ size = 80, glow = true }: { size?: number; glow?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const rafRef = useRef(0);
  const timeRef = useRef(0);

  const pad = glow ? size * 0.4 : 0;
  const canvasSize = size + pad * 2;
  const r = size * 0.32;
  const fov = size * 2.5;
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;

  // Memoize geometry — only rebuild when size changes
  const { verts, faces } = useMemo(() => buildDiamond(r), [r]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas!.width = canvasSize * dpr;
      canvas!.height = canvasSize * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvasSize, canvasSize);

      const time = timeRef.current;

      // Pulsing glow (only when enabled)
      if (glow) {
        const glowPulse = 0.2 + Math.sin(time * 0.8) * 0.08;
        const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, canvasSize * 0.45);
        glowGrad.addColorStop(0, `rgba(249,115,22,${glowPulse})`);
        glowGrad.addColorStop(0.5, `rgba(251,191,36,${glowPulse * 0.4})`);
        glowGrad.addColorStop(1, "transparent");
        ctx.fillStyle = glowGrad;
        ctx.fillRect(0, 0, canvasSize, canvasSize);
      }

      const angle = angleRef.current;

      const transformed = verts.map((v) => rotX(rotY(v, angle), TILT_X));
      const projected = transformed.map((v) => proj(v, fov, cx, cy));

      const facesData = faces.map((face, fi) => {
        const avgZ = face.reduce((s, vi) => s + transformed[vi].z, 0) / face.length;
        const n = normalize(normal(transformed[face[0]], transformed[face[1]], transformed[face[2]]));

        // Diffuse from two lights
        const diff1 = Math.max(0, -dot(n, LIGHT1));
        const diff2 = Math.max(0, -dot(n, LIGHT2)) * 0.4;
        const diffuse = Math.min(1, diff1 + diff2);

        // Specular highlight (Phong) from main light
        const refl = normalize(reflect(LIGHT1, n));
        const spec = Math.pow(Math.max(0, dot(refl, VIEW_DIR)), 32) * 0.9;

        const brightness = 0.85 + diffuse * 0.25;

        let baseColor: string;
        if (fi < 8) baseColor = PAV[fi];
        else if (fi < 16) baseColor = CRO[fi - 8];
        else baseColor = TBL;

        return { face, fi, avgZ, brightness, spec, baseColor };
      });

      facesData.sort((a, b) => b.avgZ - a.avgZ);

      for (const { face, brightness, spec, baseColor } of facesData) {
        ctx.beginPath();
        const p0 = projected[face[0]];
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < face.length; i++) {
          const p = projected[face[i]];
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();

        // Fill with adjusted brightness
        ctx.fillStyle = adjustBrightness(baseColor, brightness);
        ctx.fill();

        // Specular white overlay
        if (spec > 0.05) {
          ctx.fillStyle = `rgba(255,255,255,${spec})`;
          ctx.fill();
        }

        // Edge highlight
        ctx.strokeStyle = `rgba(255,255,255,${0.1 + brightness * 0.15})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      angleRef.current -= 0.002;
      timeRef.current += 0.016;
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [verts, faces, canvasSize, glow, fov, cx, cy]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: canvasSize,
        height: canvasSize,
        margin: -pad,
        position: "relative",
        zIndex: 1,
        pointerEvents: "none",
      }}
    />
  );
}

function adjustBrightness(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const cl = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  return `rgb(${cl(r * factor)},${cl(g * factor)},${cl(b * factor)})`;
}

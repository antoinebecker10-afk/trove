/**
 * Generate a 256x256 PNG icon of the 3D diamond.
 * Run: node scripts/generate-icon.mjs
 * Requires: npm install canvas (node-canvas)
 */

import { createCanvas } from "canvas";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 256;

// --- Diamond geometry (same as Diamond3D.tsx) ---
function buildDiamond(r) {
  const tableR = r * 0.45;
  const girdleR = r;
  const crownH = r * 0.35;
  const pavilionH = r * 0.9;
  const N = 8;
  const verts = [];
  const faces = [];

  verts.push({ x: 0, y: pavilionH, z: 0 });
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    verts.push({ x: Math.cos(a) * girdleR, y: 0, z: Math.sin(a) * girdleR });
  }
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    verts.push({ x: Math.cos(a) * tableR, y: -crownH, z: Math.sin(a) * tableR });
  }
  for (let i = 0; i < N; i++) faces.push([0, 1 + i, 1 + (i + 1) % N]);
  for (let i = 0; i < N; i++) faces.push([1 + i, 1 + (i + 1) % N, 9 + (i + 1) % N, 9 + i]);
  const table = [];
  for (let i = 0; i < N; i++) table.push(9 + i);
  faces.push(table);
  return { verts, faces };
}

function rotY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}
function rotX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}
function proj(v, fov, cx, cy) {
  const z = v.z + fov;
  const sc = fov / z;
  return { x: cx + v.x * sc, y: cy + v.y * sc };
}
function normal(a, b, c) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = c.x - a.x, wy = c.y - a.y, wz = c.z - a.z;
  return { x: uy * wz - uz * wy, y: uz * wx - ux * wz, z: ux * wy - uy * wx };
}
function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function reflect(d, n) {
  const dn = dot(d, n) * 2;
  return { x: d.x - dn * n.x, y: d.y - dn * n.y, z: d.z - dn * n.z };
}

function adjustBrightness(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const cl = (n) => Math.min(255, Math.max(0, Math.round(n)));
  return `rgb(${cl(r * factor)},${cl(g * factor)},${cl(b * factor)})`;
}

const PAV = ["#fb923c", "#fdba74", "#f97316", "#fbbf24", "#fb923c", "#fdba74", "#f97316", "#fbbf24"];
const CRO = ["#fb923c", "#f97316", "#fdba74", "#fbbf24", "#fb923c", "#f97316", "#fdba74", "#fbbf24"];
const TBL = "#fed7aa";

const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d");

const r = SIZE * 0.45;
const { verts, faces } = buildDiamond(r);
const fov = SIZE * 2.5;
const cx = SIZE / 2;
const cy = SIZE / 2;
const tiltX = 0.22;
const angle = 0.5; // fixed angle for nice view

const light1 = { x: 0.4, y: -0.6, z: 0.7 };
const light2 = { x: -0.3, y: -0.4, z: -0.5 };
const viewDir = { x: 0, y: 0, z: -1 };

// Clear with transparency
ctx.clearRect(0, 0, SIZE, SIZE);

// Glow
const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.45);
glow.addColorStop(0, "rgba(249,115,22,0.25)");
glow.addColorStop(0.5, "rgba(251,191,36,0.08)");
glow.addColorStop(1, "transparent");
ctx.fillStyle = glow;
ctx.fillRect(0, 0, SIZE, SIZE);

const transformed = verts.map((v) => rotX(rotY(v, angle), tiltX));
const projected = transformed.map((v) => proj(v, fov, cx, cy));

const facesData = faces.map((face, fi) => {
  const avgZ = face.reduce((s, vi) => s + transformed[vi].z, 0) / face.length;
  const n = normalize(normal(transformed[face[0]], transformed[face[1]], transformed[face[2]]));
  const diff1 = Math.max(0, -dot(n, light1));
  const diff2 = Math.max(0, -dot(n, light2)) * 0.4;
  const diffuse = Math.min(1, diff1 + diff2);
  const refl = normalize(reflect(light1, n));
  const spec = Math.pow(Math.max(0, dot(refl, viewDir)), 32) * 0.9;
  const brightness = 0.85 + diffuse * 0.25;
  let baseColor;
  if (fi < 8) baseColor = PAV[fi];
  else if (fi < 16) baseColor = CRO[fi - 8];
  else baseColor = TBL;
  return { face, avgZ, brightness, spec, baseColor };
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
  ctx.fillStyle = adjustBrightness(baseColor, brightness);
  ctx.fill();
  if (spec > 0.05) {
    ctx.fillStyle = `rgba(255,255,255,${spec})`;
    ctx.fill();
  }
  ctx.strokeStyle = `rgba(255,255,255,${0.1 + brightness * 0.15})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

const outPath = resolve(__dirname, "..", "public", "trove-icon.png");
writeFileSync(outPath, canvas.toBuffer("image/png"));
console.log(`Icon saved to ${outPath}`);

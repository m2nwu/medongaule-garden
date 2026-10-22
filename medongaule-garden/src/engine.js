/* ===================== Médongaule garden — hand-written WebGL2 renderer ===================== */
(function () {
'use strict';
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) { document.documentElement.classList.add('no-gl'); return; }

const SMALL = Math.min(innerWidth, innerHeight) < 700;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TEST = !!window.__TEST;

/* ---------------- math ---------------- */
const M = {
  persp(fy, a, n, f) { const t = 1 / Math.tan(fy / 2), r = new Float32Array(16);
    r[0] = t / a; r[5] = t; r[10] = (f + n) / (n - f); r[11] = -1; r[14] = 2 * f * n / (n - f); return r; },
  ortho(l, r_, b, t, n, f) { const r = new Float32Array(16);
    r[0] = 2 / (r_ - l); r[5] = 2 / (t - b); r[10] = -2 / (f - n);
    r[12] = -(r_ + l) / (r_ - l); r[13] = -(t + b) / (t - b); r[14] = -(f + n) / (f - n); r[15] = 1; return r; },
  look(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  mul(a, b) { const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; r[i * 4 + j] = s; }
    return r; },
  inv(m) { const r = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; d = 1 / d;
    r[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; r[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
    r[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; r[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    r[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; r[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
    r[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; r[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    r[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; r[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
    r[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; r[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    r[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; r[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
    r[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; r[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return r; }
};
const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const lin = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.pow(c / 255, 2.2)); };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, y) { let s = 0, a = .5, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s; }

/* ---------------- catmull-rom path ---------------- */
function spline(pts) {
  const n = pts.length - 1;
  const at = t => { t = clamp(t) * n; const i = Math.min(n - 1, Math.floor(t)), u = t - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const u2 = u * u, u3 = u2 * u;
    return [0, 1, 2].map(k => .5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3)); };
  // arc-length table so the camera moves at an even pace
  const N = 600, len = [0]; let prev = at(0);
  for (let i = 1; i <= N; i++) { const p = at(i / N); len.push(len[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])); prev = p; }
  const total = len[N];
  return { raw: at, at(s) { const d = clamp(s) * total; let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < d) lo = m; else hi = m; }
    const f = (d - len[lo]) / Math.max(1e-6, len[hi] - len[lo]); return at((lo + f) / N); } };
}

/* ---------------- the garden master plan ----------------
   World units are metres. The origin sits on the colonnade pavilion (A); x runs east, z runs south,
   so the whole valley opens toward the south with the mountain to the north, as in the aerial photograph.
   Every stop on the tour is one STATION: where it is, how much ground it clears, which builder draws it
   and the camera beat that visits it. When detailed photos of a building arrive, only its builder changes. */
const WATER_Y = 0.05;
// --- A: the colonnade pavilion (detailed model, matched to its photograph) ---
const POOL = { x0: -7, x1: 24, z0: 3.6, z1: 24 };
const PIV = [4.6, 3.2], ROT_A = 11 * Math.PI / 180, RCA = Math.cos(ROT_A), RSA = Math.sin(ROT_A);
const toWorld = (x, z) => { const dx = x - PIV[0], dz = z - PIV[1]; return [PIV[0] + dx * RCA - dz * RSA, PIV[1] + dx * RSA + dz * RCA]; };
const toPlan = (x, z) => { const dx = x - PIV[0], dz = z - PIV[1]; return [PIV[0] + dx * RCA + dz * RSA, PIV[1] - dx * RSA + dz * RCA]; };
const SITE_RECTS = [[6, 26, -18, -2], [-8, 25, 3, 25], [-12, 9, -5, 6], [22, 64, -20, -1], [-40, -14, 13, 36], [-2, 9, -3, 6]];
const ARM = [7.4, -15.6, -20.4, 10.3];
function siteDistA(x, z) {
  const [px, pz] = toPlan(x, z); let d = 1e9;
  for (const [x0, x1, z0, z1] of SITE_RECTS) d = Math.min(d, Math.hypot(Math.max(0, x0 - px, px - x1), Math.max(0, z0 - pz, pz - z1)));
  const [ax, az, bx, bz] = ARM, vx = bx - ax, vz = bz - az, t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz));
  return Math.min(d, Math.max(0, Math.hypot(px - ax - vx * t, pz - az - vz * t) - 3.2));
}
// --- the contemporary garden's oval valley floor and its white promenade ---
const BASIN = { cx: 30, cz: 222, rx: 222, rz: 190 };
const LOOP = { cx: 34, cz: 218, rx: 182, rz: 152, w: 6 };
const basinN = (x, z) => Math.hypot((x - BASIN.cx) / BASIN.rx, (z - BASIN.cz) / BASIN.rz);
const loopDist = (x, z) => { const a = Math.atan2((z - LOOP.cz) / LOOP.rz, (x - LOOP.cx) / LOOP.rx);
  return Math.hypot(x - (LOOP.cx + Math.cos(a) * LOOP.rx), z - (LOOP.cz + Math.sin(a) * LOOP.rz)); };
const POND = { x: -196, z: 452, rx: 46, rz: 26 };   // the reservoir at the valley mouth
// --- stations: position (m), clearing radius (m), placeholder builder, camera beat ---
const STATIONS = [
  { id: 'H', name: '마름모 정원',      x: -80, z: 292, r: 46 },
  { id: 'P', name: '석조 파빌리온',    x: 50,  z: 322, r: 30 },
  { id: 'G', name: '원형 극장',        x: 10,  z: 226, r: 32 },
  { id: 'K', name: '콘크리트 큐브',    x: 70,  z: 165, r: 24 },
  { id: 'F', name: '한국정원',         x: -92, z: 48,  r: 48 },
  { id: 'C', name: '테라코타 원형관',  x: 94,  z: 72,  r: 25 },
  { id: 'D', name: '캐노피 파빌리온',  x: 116, z: 120, r: 19 },
  { id: 'B', name: '위버하우스',       x: 198, z: 14,  r: 44 },
  { id: 'A', name: '열주 회랑',        x: 8,   z: -4,  r: 0 }
];
const ST = Object.fromEntries(STATIONS.map(s => [s.id, s]));
// the tour: [scroll progress, camera position, look-at]. Opening wide on the whole valley, then station by station,
// ending on the colonnade pavilion in the framing of its photograph.
const KEYS = [
  [0.000, [18, 235, 640],  [24, 10, 175]],        // the whole garden under the mountain
  [0.045, [-40, 105, 470], [-80, 0, 300]],        // descend toward the sculpture garden
  [0.080, [-124, 30, 348], [-80, 0, 292]],        // H  the diamond of marble sculptures
  [0.115, [-80, 1.8, 318], [-80, 2.6, 288]],      //    at eye level on the flagstone path
  [0.145, [-80, 9.5, 294], [-78, 2, 266]],
  [0.162, [-14, 16, 336],  [50, 3, 322]],
  [0.180, [50, 1.8, 348],  [50, 2.4, 320]],       // P  the stone pavilion, through its doorway
  [0.210, [80, 15, 300],   [50, 3, 320]],         //    over its wisteria pergolas
  [0.245, [10, 8.5, 252],  [10, 0, 226]],         // G  from the rim, down into the amphitheatre
  [0.272, [-16, 15, 206],  [10, 1, 228]],
  [0.305, [52, 4.2, 186],  [70, 4.6, 165]],       // K  the concrete cube among its terraces
  [0.335, [-20, 42, 128],  [-90, 0, 60]],         //    lift away to the west
  [0.365, [-55, 36, 104],  [-97, 2, 43]],         // F  the Korean garden from above, as in its autumn photograph
  [0.392, [-130, 13, 74],  [-112, 3, 36]],        //    around its western terraces
  [0.418, [-132, 5.2, 36], [-112, 2.4, 20]],      //    across the stream pond to the pavilion on posts
  [0.445, [-90, 30, 8],    [-40, 6, 40]],         //    up over the walls
  [0.475, [10, 32, 95],    [94, 5, 72]],
  [0.500, [62, 15, 112],   [94, 5, 72]],          // C  terracotta court
  [0.525, [124, 11, 98],   [94, 5, 70]],
  [0.550, [128, 7, 152],   [116, 2, 120]],        // D  the canopy pavilion
  [0.578, [118.8, 1.8, 134], [114.8, 2.2, 114]],  //    at eye level, looking under the canopy
  [0.608, [150, 18, 140],  [198, 8, 40]],
  [0.640, [198, 3.4, 92],  [198, 8, 14]],         // B  Überhaus, its long elevation
  [0.666, [194.4, 11, 40], [196, 9, 14]],         //    up over the parapet
  [0.696, [186, 8.3, 13.3], [223, 11, 15.5]],     //    on the roof deck among the towers
  [0.730, [190, 34, 22],   [198, 8, 12]],
  [0.790, [118, 32, 44],   [40, 8, 0]],           //    along the hillside toward A
  [0.850, [56, 11, 30],    [18, 5, 4]],
  [0.885, [30, 6.5, 12],   [4.5, 9, 3]],          // A  the colonnade pavilion
  [0.915, [13, 2.3, 11.8], [-6, 6, 4]],
  [0.945, [-8, 2.6, 11.5], [-0.5, 7, 3]],
  [0.972, [-14, 18, 40],   [4, 3, -2]],
  [1.000, [0.4, 43, 46.5], [6, 0, -5.5]]          // the photograph's view
];
const posS = spline(KEYS.map(k => k[1])), tgtS = spline(KEYS.map(k => k[2]));
function camAt(q) {
  let i = 0; while (i < KEYS.length - 2 && q > KEYS[i + 1][0]) i++;
  const f = clamp((q - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]));
  const e = f + ((f * f * (3 - 2 * f)) - f) * .45;          // linger a little at every beat
  const t = (i + e) / (KEYS.length - 1);
  return [posS.raw(t), tgtS.raw(t)];
}
const corridor = []; for (let i = 0; i <= 700; i++) { const p = camAt(i / 700)[0]; if (p[1] < 26) corridor.push(p); }
function corridorDist(x, z) { let m = 1e9; for (const p of corridor) { const d = (p[0] - x) ** 2 + (p[2] - z) ** 2; if (d < m) m = d; } return Math.sqrt(m); }
function stationDist(x, z) { let d = 1e9; for (const s of STATIONS) if (s.r) d = Math.min(d, Math.hypot(x - s.x, z - s.z) - s.r); return d; }
const siteDist = siteDistA;
function flatness(x, z) {
  const a = 1 - sstep(1, 20, siteDistA(x, z));
  const b = 1 - sstep(.96, 1.16, basinN(x, z));
  const p = 1 - sstep(1.0, 1.5, Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz));
  const st = 1 - sstep(0, 24, stationDist(x, z));
  return Math.max(a, b, p, st);
}
function heightAt(x, z) {
  const hills = (fbm(x * .0055 + 3, z * .0055 + 9) - .38) * 120;
  const north = sstep(-40, -720, z) * 250;                                  // the mountain behind
  const behindA = sstep(-20, -150, z) * 46 * (1 - sstep(90, 260, Math.abs(x - 10)));
  const east = sstep(260, 700, x) * 120, west = sstep(-280, -700, x) * 140;
  const fine = fbm(x * .045, z * .045) * 6 + fbm(x * .16, z * .16) * 1.6;    // canopy texture
  const valley = sstep(.98, 1.85, basinN(x, z));
  let h = (Math.max(-6, hills) * valley + north + behindA + east * valley + west * valley) + fine * valley;
  h *= 1 - flatness(x, z);
  if (basinN(x, z) > .95) h *= 1 - .7 * (1 - sstep(8, 40, corridorDist(x, z)));
  return h;
}

/* ---------------- geometry builder: interleaved pos(3) nor(3) col(3) ---------------- */
const K = { STATIC: 0, TERRAIN: 1, DRY: 2, LAWN: 3, ROCK: 4, LEAF: 5, PINE: 6, TRUNK: 7 };
function Geo() { this.d = []; this.meta = []; this.kind = K.STATIC; this.v = 0; }
Geo.prototype.tri = function (a, b, c, col, n) {
  if (!n) { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    n = norm([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]); }
  for (const p of [a, b, c]) this.d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  this.meta.push(this.kind, n[1], this.v, col[0], col[1], col[2]);
};
Geo.prototype.quad = function (a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); };
// box with local length along x, rotated about y by `rot`
Geo.prototype.box = function (cx, cy, cz, sx, sy, sz, col, rot = 0, topCol) {
  if (this.site) { [cx, cz] = toWorld(cx, cz); rot -= ROT_A; }
  const c = Math.cos(rot), s = Math.sin(rot), hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
  const tc = topCol || col;
  this.quad(v[4], v[5], v[6], v[7], col); this.quad(v[1], v[0], v[3], v[2], col);
  this.quad(v[0], v[4], v[7], v[3], col); this.quad(v[5], v[1], v[2], v[6], col);
  this.quad(v[7], v[6], v[2], v[3], tc); this.quad(v[0], v[1], v[5], v[4], col);
};
const ICO = (() => { // icosphere detail 1
  const t = (1 + Math.sqrt(5)) / 2; let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = {}, m = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (mid[k] == null) { mid[k] = V.length; V.push(norm(V[a].map((x, i) => (x + V[b][i]) / 2))); } return mid[k]; };
  const F0 = F.map(f => f.slice());
  const F2 = []; for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  return { V, F: F2, F0 };
})();
Geo.prototype.blob = function (cx, cy, cz, sx, sy, sz, col, jit = .14, lod = 1) {
  if (this.site) [cx, cz] = toWorld(cx, cz);
  const r = rnd() * 6.28, c = Math.cos(r), s = Math.sin(r);
  const V = ICO.V.map(v => { const k = 1 + (rnd() - .5) * jit * 2; const x = v[0] * k * sx, z = v[2] * k * sz; return [cx + x * c + z * s, cy + v[1] * k * sy, cz - x * s + z * c]; });
  for (const [a, b, d] of (lod ? ICO.F : ICO.F0)) this.tri(V[a], V[b], V[d], col);
};
Geo.prototype.cone = function (cx, cy, cz, r, h, col, seg = 7) {
  const tip = [cx, cy + h, cz];
  for (let i = 0; i < seg; i++) { const a0 = i / seg * 6.283, a1 = (i + 1) / seg * 6.283;
    const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
    this.tri(p0, tip, p1, col); }
};

// cylinder (side + top), annular wall, flat disc and an elliptical band — the round buildings need these
Geo.prototype.cyl = function (cx, y0, cz, r, h, col, seg = 32, topCol) {
  const tc = topCol || col;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832;
    const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
    const q0 = [p0[0], y0 + h, p0[2]], q1 = [p1[0], y0 + h, p1[2]];
    this.quad(p0, q0, q1, p1, col);
    this.tri([cx, y0 + h, cz], q1, q0, tc);
  }
};
Geo.prototype.ring = function (cx, y0, cz, r0, r1, h, col, seg = 40, topCol, a0 = 0, a1 = 6.2832) {
  const tc = topCol || col;
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg;
    const P = (r, t, y) => [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r];
    this.quad(P(r1, t0, y0), P(r1, t0, y0 + h), P(r1, t1, y0 + h), P(r1, t1, y0), col);      // outer face
    this.quad(P(r0, t1, y0), P(r0, t1, y0 + h), P(r0, t0, y0 + h), P(r0, t0, y0), col);      // inner face
    this.quad(P(r0, t1, y0 + h), P(r1, t1, y0 + h), P(r1, t0, y0 + h), P(r0, t0, y0 + h), tc); // top
  }
};
Geo.prototype.disc = function (cx, y, cz, rx, rz, col, seg = 40) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832;
    this.tri([cx, y, cz], [cx + Math.cos(a1) * rx, y, cz + Math.sin(a1) * rz], [cx + Math.cos(a0) * rx, y, cz + Math.sin(a0) * rz], col);
  }
};
Geo.prototype.band = function (cx, cz, rx, rz, w, y, h, col, seg = 160) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832;
    const P = (a, d, yy) => [cx + Math.cos(a) * (rx + d), yy, cz + Math.sin(a) * (rz + d)];
    this.quad(P(a1, -w / 2, y + h), P(a1, w / 2, y + h), P(a0, w / 2, y + h), P(a0, -w / 2, y + h), col);
    this.quad(P(a0, w / 2, y), P(a0, w / 2, y + h), P(a1, w / 2, y + h), P(a1, w / 2, y), col);
  }
};
// a gabled tile roof (triangular prism with overhang) — the hanok roofs
Geo.prototype.gable = function (cx, y, cz, L, W, H, col, rot = 0, gableCol) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (x, yy, z) => [cx + x * c + z * s, y + yy, cz - x * s + z * c];
  const a = P(-L / 2, 0, -W / 2), b = P(L / 2, 0, -W / 2), d = P(L / 2, 0, W / 2), e = P(-L / 2, 0, W / 2);
  const r0 = P(-L / 2 + W * .25, H, 0), r1 = P(L / 2 - W * .25, H, 0);   // hipped ends
  this.quad(a, r0, r1, b, col); this.quad(d, r1, r0, e, col);
  this.tri(e, r0, a, gableCol || col); this.tri(b, r1, d, gableCol || col);
};

/* ---------------- palette (linear) ---------------- */
const C = {
  stone: lin('#ECE5D6'), stoneTop: lin('#F4EFE4'), stele: lin('#CDBFA6'), glass: lin('#5E5A52'), plinth: lin('#D9D0BD'),
  paving: lin('#CFC6B1'), dry: lin('#B59A62'), lawn: lin('#4C8424'), path: lin('#D3C6A6'), rock: lin('#5F5C55'),
  trunk: lin('#3B2C1E'), pine: lin('#2C3F21'), pine2: lin('#38502A')
};
const AUTUMN_HILL = [['#C1122B', 20], ['#D8203A', 12], ['#A50F2D', 8], ['#E9BE2C', 16], ['#F0D24A', 8], ['#D46A1F', 10], ['#5B6B2A', 14], ['#3F5225', 12]];
const AUTUMN_NEAR = [['#4F6A27', 26], ['#3D5524', 16], ['#C1122B', 12], ['#E9BE2C', 12], ['#D46A1F', 10], ['#B58A2A', 10], ['#6F7F2E', 14]];
const pick = pal => { const tot = pal.reduce((a, b) => a + b[1], 0); let r = rnd() * tot; for (const [c, w] of pal) if ((r -= w) < 0) return lin(c); return lin(pal[0][0]); };
const jitter = (c, k = .12) => c.map(x => x * (1 + (rnd() - .5) * k));

/* ---------------- build the scene ---------------- */
const G = new Geo();
// terrain: the valley floor, forested hills and the mountain behind
{
  const X0 = -760, X1 = 820, Z0 = -860, Z1 = 820, NX = SMALL ? 170 : 250, NZ = SMALL ? 170 : 250;
  const H = [], COL = [], FOR = [];
  G.kind = K.TERRAIN;
  const CANOPY = ['#6E2418', '#8A3A1A', '#7A5A1E', '#4E5424', '#36421E', '#5C2A1E'].map(lin);   // autumn hillsides, seen from afar
  const OPEN = lin('#7C8048'), OPEN2 = lin('#9A8C5A');
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = X0 + (X1 - X0) * i / NX, z = Z0 + (Z1 - Z0) * j / NZ, h = heightAt(x, z);
    H.push([x, h, z]);
    const n = fbm(x * .02 + 7, z * .02 + 3);
    // forest everywhere except the garden floor and the colonnade's clearing
    const forest = clamp(Math.min(sstep(.97, 1.12, basinN(x, z)), 1 - flatness(x, z) * .9) * (1 - (1 - sstep(1, 1.6, Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz)))));
    const can = CANOPY[Math.floor(clamp(fbm(x * .03, z * .03) * 1.4 - .2) * (CANOPY.length - .01))];
    let c = [0, 1, 2].map(k => OPEN[k] * (1 - n) + OPEN2[k] * n);
    c = c.map((v, k) => v * (1 - forest) + can[k] * forest * (.8 + n * .4));
    COL.push(jitter(c, .1)); FOR.push(forest);
  }
  const id = (i, j) => j * (NX + 1) + i;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = H[id(i, j)], b = H[id(i + 1, j)], c = H[id(i + 1, j + 1)], d = H[id(i, j + 1)];
    G.v = FOR[id(i, j)]; G.tri(a, d, c, COL[id(i, j)]); G.tri(a, c, b, COL[id(i, j)]);
  }
}
// ground surfaces of the site
G.site = true; G.v = 0;
G.kind = K.DRY; G.box(-27, 0.02, 25, 30, 0.12, 26, C.dry, 0.1);           // dry-grass rock garden
G.kind = K.STATIC;
G.box(-5.5, 0.04, 0.6, 30, 0.14, 9, C.paving, Math.atan2(-25.9, -27.8)); // plaza along the wing
G.box(1.5, 0.05, 0.5, 14, 0.14, 7, C.paving);              // forecourt by the stele
G.kind = K.LAWN; G.box(44, 0.03, -10, 44, 0.12, 18, C.lawn, 0.08); G.kind = K.STATIC; // lawn
G.box(36, 0.07, -0.2, 26, 0.16, 3.2, C.paving, 0.12);      // terrace walk along the lawn
G.box(-36, 0.06, 2, 32, 0.12, 2.6, C.path, -0.35);          // path climbing west
G.box(66, 0.06, -15, 34, 0.12, 2.6, C.path, 0.28);         // path climbing east

// colonnade building
const BH = 5.0, ROOF = .85, BW = 3.8, STEP = 1.75;
function bar(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), rot = Math.atan2(-dz, dx), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ux = dx / L, uz = dz / L, px = -uz, pz = ux;
  G.box(cx, BH + ROOF / 2, cz, L + BW * 0 + .4, ROOF, BW + .4, C.stone, rot, C.stoneTop);   // roof slab with slight overhang
  G.box(cx, .25, cz, L + .8, .5, BW + .8, C.plinth, rot);                                   // plinth
  G.box(cx, BH / 2 + .5, cz, L - .6, BH - .5, BW - 1.4, C.glass, rot);                        // dark glazed core
  const n = Math.max(2, Math.round(L / STEP));
  for (let i = 0; i <= n; i++) {
    const t = -L / 2 + .35 + (L - .7) * i / n;
    for (const side of [-1, 1]) {
      const ox = cx + ux * t + px * side * (BW / 2 - .3), oz = cz + uz * t + pz * side * (BW / 2 - .3);
      G.box(ox, BH / 2 + .5, oz, .5, BH - .5, .62, C.stone, rot);
    }
  }
}
// courtyard ring
bar(6, -16.2, 26, -16.2);
bar(6, -3.9, 26, -3.9);
bar(7.9, -14.3, 7.9, -5.8);
bar(24.1, -14.3, 24.1, -5.8);
// long wing reaching south-west, and its short return at the far end
bar(7.4, -15.6, -20.4, 10.3);
G.box(16, .12, -10, 14.4, .2, 8.6, C.paving);   // inner court
// the stele: a tall cast block standing at the head of the pool
G.box(4.6, 8.6, 3.2, 2.6, 17.2, 2.6, C.stele, 0.0, lin('#DCD0B8'));
G.box(5.9, 5.2, 3.2, 1.0, 6.5, 1.8, C.stele);
G.box(4.6, .35, 3.2, 3.6, .7, 3.6, C.plinth);
// stairs down to the forecourt
for (let i = 0; i < 5; i++) G.box(-1.5 - i * .55, .5 - i * .1, -2.4, .55, .2 + (4 - i) * .1, 3.2, C.plinth);
// pool rim
{
  const r = .7, { x0, x1, z0, z1 } = POOL;
  G.box((x0 + x1) / 2, .2, z0 - r / 2, x1 - x0 + 2 * r, .4, r, C.plinth);
  G.box((x0 + x1) / 2, .2, z1 + r / 2, x1 - x0 + 2 * r, .4, r, C.plinth);
  G.box(x0 - r / 2, .2, (z0 + z1) / 2, r, .4, z1 - z0, C.plinth);
  G.box(x1 + r / 2, .2, (z0 + z1) / 2, r, .4, z1 - z0, C.plinth);
  // stepping stones running from the stele across the water
  for (let i = 0; i < 7; i++) G.blob(3.2 - i * 1.25, .12, 6.8 + i * 2.1, 1.0, .28, .8, jitter(lin('#B9AE98')), .08);
  G.box(-1.4, .3, 4.6, 5.2, .25, 1.0, C.plinth, -.5);
}
// boulders in the dry garden
G.kind = K.ROCK;
for (let i = 0; i < 52; i++) {
  const x = -40 + rnd() * 25, z = 14 + rnd() * 21, s = .8 + rnd() * 1.6;
  G.blob(x, s * .35, z, s * (1 + rnd() * .3), s * (.75 + rnd() * .35), s * (.9 + rnd() * .3), jitter(C.rock, .3), .22);
}
/* ---------------- stations: placeholder massing for every building in the garden ----------------
   Each builder draws one place at its station position. They are deliberately simple volumes read from the
   aerial photograph (footprint, height, material); swap a builder for a detailed one as photos arrive. */
const M_ = {
  terracotta: lin('#B4553A'), terracottaTop: lin('#C9785A'), brick: lin('#A64A32'), tier: lin('#C2664A'), tierTop: lin('#D88C6C'),
  concrete: lin('#A6A39A'), concreteTop: lin('#8F8C84'), slate: lin('#5B6068'), slateTop: lin('#7A8089'), dark: lin('#2E3032'),
  white: lin('#EEEAE0'), glass: lin('#4E5452'), teal: lin('#5E9A8E'), tealTop: lin('#86B8AB'), tealCol: lin('#A7CDC2'),
  timber: lin('#7A5636'), hanokWall: lin('#E6DECB'), tile: lin('#3C3F41'), granite: lin('#BDB6A6'), promenade: lin('#DCD8CC')
};
const BUILD = {
  // J — a round pond with a dark stone disc floating at its centre
  J(s) {
    G.ring(s.x, 0, s.z, 20, 21.6, .55, M_.granite, 48);
    G.ring(s.x, 0, s.z, 21.6, 27, .14, C.paving, 48);
    G.cyl(s.x, 0, s.z, 7.5, .32, M_.dark, 40);
    WATERS.push({ type: 'disc', x: s.x, z: s.z, rx: 20, rz: 20 });
  },
  // H — a diamond field of ridged slate rows inside a stone border
  H(s) {
    const A = 46, B = 31;                       // half-diagonals: east-west, north-south
    const inside = (u, v) => Math.abs(u) / A + Math.abs(v) / B <= 1;
    const P = (u, v) => [s.x + u, s.z + v];
    // border kerb
    const edge = [[A, 0], [0, B], [-A, 0], [0, -B], [A, 0]];
    for (let i = 0; i < 4; i++) { const [u0, v0] = edge[i], [u1, v1] = edge[i + 1];
      const L = Math.hypot(u1 - u0, v1 - v0); G.box(s.x + (u0 + u1) / 2, .3, s.z + (v0 + v1) / 2, L + 1.2, .6, 1.2, M_.granite, Math.atan2(-(v1 - v0), u1 - u0)); }
    // base and ridges running on the diagonal
    G.kind = K.STATIC;
    for (let k = -40; k <= 40; k++) {
      const off = k * 1.9; const pts = [];
      for (let t = -70; t <= 70; t += .5) { const u = (t + off) * .7071, v = (t - off) * .7071 * (B / A) * 1.25; if (inside(u, v)) pts.push([u, v]); }
      if (pts.length < 2) continue;
      const [u0, v0] = pts[0], [u1, v1] = pts[pts.length - 1], L = Math.hypot(u1 - u0, v1 - v0);
      const [cx, cz] = P((u0 + u1) / 2, (v0 + v1) / 2);
      G.box(cx, .2, cz, L, .4 + (k & 1) * .35, 1.05, k & 1 ? M_.slate : M_.slateTop, Math.atan2(-(v1 - v0), u1 - u0));
    }
  },
  // I — a concrete cylinder with a slatted roof, wrapped in a ring garden
  I(s) {
    G.cyl(s.x, 0, s.z, 13, 7.8, M_.concrete, 44, M_.concreteTop);
    for (let i = 0; i < 22; i++) { const a = i / 22 * 6.2832;
      G.box(s.x + Math.cos(a) * 7.5, 8.1, s.z + Math.sin(a) * 7.5, 9.5, .5, .55, M_.concrete, -a); }
    G.kind = K.LAWN; G.ring(s.x, 0, s.z, 13, 25, .18, C.lawn, 48); G.kind = K.STATIC;
    G.ring(s.x, 0, s.z, 25, 28.5, .12, C.paving, 48);
    G.ring(s.x, 0, s.z, 28.5, 29.4, 1.2, M_.granite, 48);
  },
  // G — a sunken-looking amphitheatre of terracotta tiers rising to a ring
  G(s) {
    G.cyl(s.x, 0, s.z, 6.5, .2, M_.tierTop, 32);
    for (let k = 0; k < 9; k++) { const r0 = 6.5 + k * 1.7; G.ring(s.x, 0, s.z, r0, r0 + 1.7, .35 + k * .42, k % 2 ? M_.tier : M_.terracotta, 44, M_.tierTop); }
    G.ring(s.x, 0, s.z, 21.8, 24.5, .12, C.paving, 44);
  },
  // F — the Korean garden: stepped rice terraces below a cluster of hanok under hipped tile roofs
  F(s) {
    const rot = .12, c = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
    for (let k = 0; k < 6; k++) {                          // rice terraces stepping down toward the valley
      const top = .3 + k * .42, [x, z] = at(-4 + k * 1.2, 44 - k * 5.2);
      G.kind = K.LAWN; G.box(x, top / 2, z, 60 - k * 3, top, 5.2, C.lawn, rot); G.kind = K.STATIC;
      const [ex, ez] = at(-4 + k * 1.2, 46.6 - k * 5.2); G.box(ex, (top + .2) / 2, ez, 60 - k * 3, top + .2, .5, M_.granite, rot);
    }
    { const [x, z] = at(0, -2); G.box(x, 1.3, z, 66, 2.6, 30, M_.granite, rot, lin('#CFC8B8')); }   // stone platform
    const hanok = [[-17, -8, 13, 6.5, 0], [4, -10, 11, 6, 0], [21, 1, 9, 5.5, 1.5708], [-1, 5, 8, 5, 0], [-23, 6, 7, 4.5, 1.5708]];
    for (const [lx, lz, L, W, r] of hanok) {
      const [x, z] = at(lx, lz), rr = rot + r;
      G.box(x, 2.9, z, L + 2, .6, W + 2, lin('#D8D1C1'), rr);
      G.box(x, 4.4, z, L, 2.4, W, M_.hanokWall, rr);
      for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const ox = px * (L / 2 - .2), oz = pz * (W / 2 - .2);
        G.box(x + ox * Math.cos(rr) + oz * Math.sin(rr), 4.4, z - ox * Math.sin(rr) + oz * Math.cos(rr), .45, 2.4, .45, M_.timber, rr);
      }
      G.gable(x, 5.55, z, L + 3.2, W + 3.4, 2.7, M_.tile, rr, M_.tile);
    }
  },
  // C — a terracotta brick drum around an open court
  C(s) {
    G.ring(s.x, 0, s.z, 15, 22, 6.8, M_.brick, 56, M_.terracottaTop);
    for (let i = 0; i < 28; i++) { const a = i / 28 * 6.2832 + .05;
      G.box(s.x + Math.cos(a) * 21.95, 3.6, s.z + Math.sin(a) * 21.95, .3, 3.6, .8, M_.dark, -a); }
    G.disc(s.x, .1, s.z, 15, 15, C.paving, 40);
    G.ring(s.x, 0, s.z, 22, 25.5, .12, C.paving, 48);
  },
  // D — a low white pavilion with a deep roof
  D(s) {
    G.box(s.x, .25, s.z, 28, .5, 15, C.plinth, .2);
    G.box(s.x, 2.4, s.z, 22, 3.8, 10, M_.glass, .2);
    G.box(s.x, 4.6, s.z, 27, .7, 14.5, M_.white, .2, lin('#F5F2EA'));
  },
  // E — an oval lawn in a pale rim
  E(s) {
    G.kind = K.LAWN; G.disc(s.x, .12, s.z, 30, 17, C.lawn, 48); G.kind = K.STATIC;
    G.band(s.x, s.z, 31.5, 18.5, 3, 0, .14, C.paving, 64);
  },
  // B — the house of columns: a long green hall with sixteen tall columns rising through the roof
  B(s) {
    const rot = -.06;
    G.box(s.x, .3, s.z + 18, 74, .3, 16, C.paving, rot);
    G.box(s.x, 3.2, s.z, 58, 6.4, 25, M_.teal, rot, M_.tealTop);
    G.box(s.x, 2.4, s.z + 12.6, 56, 3.6, .4, M_.glass, rot);
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 8; i++) {
      const lx = -24.5 + i * 7, lz = row ? 5.5 : -5.5;
      G.box(s.x + lx * c + lz * sn, 11, s.z - lx * sn + lz * c, 2.8, 22, 2.8, M_.tealCol, rot, lin('#C8E0D8'));
    }
  }
};
const WATERS = [];
/* ---------------- detailed builders, from the close-up photographs ---------------- */
Object.assign(M_, {
  tile: lin('#3F4346'), tile2: lin('#4B5054'), ridgeWhite: lin('#E6E4DE'), timberWarm: lin('#B07B4A'), door: lin('#C08E5C'),
  wallStone: lin('#8D887C'), wallStone2: lin('#9E988A'), earth: lin('#C8AC82'), sand: lin('#D9CBAA'),
  uSlab: lin('#7C9487'), uDeck: lin('#B8C3C1'), uCol: lin('#86A795'), uCol2: lin('#7B9C8B'), uCol3: lin('#91B19F'), uGlass: lin('#5B5447'),
  canopy: lin('#E2DFD7'), canopyTop: lin('#EDEBE5'), mirror: lin('#B4C2C6'), cube: lin('#A39E91'), inlay: lin('#8E908C'),
  floorTerracotta: lin('#C27C5C'), flowerA: lin('#E58AB2'), flowerB: lin('#F4EEF0'), flowerC: lin('#C04C86')
});
const frame2 = (s, rot) => { const c = Math.cos(rot), sn = Math.sin(rot); return (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c]; };

// a Korean tile roof: hipped mass with a concave sweep and eaves that lift at the corners.
// Tiles read as alternating channels running down the slope; the timber underside shows below the eaves.
Geo.prototype.hanokRoof = function (cx, y, cz, L, W, H, rot, o = {}) {
  const ov = o.ov ?? 1.2, lift = o.lift ?? .55, under = o.under === false ? null : (o.under || M_.timberWarm);
  const Lx = L / 2 + ov, Wz = W / 2 + ov, c = Math.cos(rot), s = Math.sin(rot);
  const nx = Math.max(6, Math.round(2 * Lx / .5)), nz = Math.max(4, Math.round(2 * Wz / .65));
  const pt = (x, z, dy) => {
    const u = Math.abs(x) / Lx, v = Math.abs(z) / Wz;
    const a = Math.abs(z) / Wz, b = (Math.abs(x) - (Lx - Wz)) / Wz, t = clamp(1 - Math.max(a, b));
    const h = H * Math.pow(t, 1.45) + lift * Math.pow(u * v, 3);
    const xx = x * (1 + .05 * Math.pow(v, 4)), zz = z * (1 + .05 * Math.pow(u, 4));
    return [cx + xx * c + zz * s, y + h + dy, cz - xx * s + zz * c];
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = -Lx + 2 * Lx * i / nx, x1 = -Lx + 2 * Lx * (i + 1) / nx, z0 = -Wz + 2 * Wz * j / nz, z1 = -Wz + 2 * Wz * (j + 1) / nz;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, side = Math.abs(mz) / Wz >= (Math.abs(mx) - (Lx - Wz)) / Wz ? 0 : 1;
    const col = (side ? j : i) % 2 ? M_.tile : M_.tile2;
    this.quad(pt(x0, z0, 0), pt(x0, z1, 0), pt(x1, z1, 0), pt(x1, z0, 0), col);
    if (under) this.quad(pt(x0, z0, -.24), pt(x1, z0, -.24), pt(x1, z1, -.24), pt(x0, z1, -.24), under);
  }
  // ridge with pale end caps, or a finial on a pyramid roof
  const rl = Lx - Wz, top = y + H;
  if (rl > .3) {
    this.box(cx, top + .14, cz, 2 * rl + .5, .42, .5, M_.tile, rot);
    for (const e of [-1, 1]) this.box(cx + e * (rl + .2) * c, top + .2, cz - e * (rl + .2) * s, .32, .5, .56, M_.ridgeWhite, rot);
  } else this.box(cx, top + .25, cz, .45, .6, .45, M_.tile, rot);
};

// a hanok hall: stone base, timber posts, white walls with timber frames, lattice doors, tile roof
function hanok(x, z, L, W, rot, o = {}) {
  const base = o.base ?? .9, colH = o.colH ?? 2.8, y0 = o.y ?? 0, c = Math.cos(rot), s = Math.sin(rot);
  const off = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  G.box(x, y0 + base / 2, z, L + 1.8, base, W + 1.8, M_.wallStone2, rot, lin('#CFC8B8'));
  let yb = y0 + base;
  if (o.stilts) {                                         // a pavilion raised on posts with a balcony
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) {
      const [qx, qz] = off(px * (L / 2 - .2), pz * (W / 2 - .2)); G.box(qx, yb + o.stilts / 2, qz, .42, o.stilts, .42, M_.timberWarm, rot); }
    yb += o.stilts;
    G.box(x, yb + .1, z, L + 1.6, .2, W + 1.6, M_.timberWarm, rot);
    for (const [lx, lz, len, r] of [[0, W / 2 + .8, L + 1.6, 0], [0, -W / 2 - .8, L + 1.6, 0], [L / 2 + .8, 0, W + 1.6, 1.5708], [-L / 2 - .8, 0, W + 1.6, 1.5708]]) {
      const [qx, qz] = off(lx, lz); G.box(qx, yb + .75, qz, len, .12, .12, M_.timberWarm, rot + r); G.box(qx, yb + .45, qz, len, .5, .05, lin('#A87246'), rot + r); }
  }
  G.box(x, yb + colH / 2, z, L - .4, colH, W - .4, M_.hanokWall, rot);
  const nC = Math.max(2, Math.round(L / 2.6));
  for (let i = 0; i <= nC; i++) for (const sd of [-1, 1]) {
    const [qx, qz] = off(-L / 2 + L * i / nC, sd * (W / 2 - .15)); G.box(qx, yb + colH / 2, qz, .36, colH, .36, M_.timberWarm, rot); }
  G.box(x, yb + colH - .18, z, L + .1, .36, W + .1, M_.timberWarm, rot);
  G.box(x, yb + .18, z, L + .1, .2, W + .1, M_.timberWarm, rot);
  for (let i = 0; i < nC; i++) { const [qx, qz] = off(-L / 2 + L * (i + .5) / nC, W / 2 - .17);
    G.box(qx, yb + colH * .45, qz, L / nC * .62, colH * .62, .08, M_.door, rot); }
  G.hanokRoof(x, yb + colH, z, L, W, o.H ?? Math.min(L, W) * .42 + .4, rot, { ov: o.ov ?? 1.3, lift: o.lift ?? .55 });
}
// a stone-and-earth wall with a small tile coping; gaps (as fractions along the wall) become gates
function wallLine(at, rot, x0, z0, x1, z1, y0 = 0, gaps = []) {
  const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, r = rot + Math.atan2(-(z1 - z0), x1 - x0);
  const cuts = [0]; for (const g of gaps) cuts.push(g * L - 1.6, g * L + 1.6); cuts.push(L);
  for (let i = 0; i < cuts.length; i += 2) {
    const a = cuts[i], b = cuts[i + 1]; if (b - a < .4) continue;
    const [mx, mz] = at(x0 + ux * (a + b) / 2, z0 + uz * (a + b) / 2);
    G.box(mx, y0 + .45, mz, b - a, .9, .72, M_.wallStone, r);
    G.box(mx, y0 + 1.35, mz, b - a, .9, .58, M_.earth, r);
    G.hanokRoof(mx, y0 + 1.8, mz, b - a, .5, .38, r, { ov: .32, lift: .06, under: false });
  }
  for (const g of gaps) { const [gx, gz] = at(x0 + ux * g * L, z0 + uz * g * L); gate(gx, gz, r, y0); }
}
function gate(x, z, rot, y0 = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const e of [-1, 1]) G.box(x + e * 1.35 * c, y0 + 1.6, z - e * 1.35 * s, .38, 3.2, .38, M_.timberWarm, rot);
  G.box(x, y0 + 3.1, z, 3.1, .3, .5, M_.timberWarm, rot);
  for (const e of [-1, 1]) G.box(x + e * .62 * c, y0 + 1.4, z - e * .62 * s, 1.1, 2.6, .1, M_.door, rot);
  G.hanokRoof(x, y0 + 3.25, z, 3.4, 1.4, 1.0, rot, { ov: .7, lift: .32 });
}
// curved stone terraces, following gently wandering contour lines
function terraces(at, xa, xb, z0, n, depth, h0, dh, amp, ph, crop) {
  const zE = (k, x) => z0 + k * depth + Math.sin(x * .085 + k * .9 + ph) * amp + Math.sin(x * .23 + k * 1.7) * amp * .35;
  const P = (x, z, y) => { const [wx, wz] = at(x, z); return [wx, y, wz]; };
  const STONES = [lin('#A79F8F'), lin('#8D877A'), lin('#BAB3A4'), lin('#9A927F'), lin('#C4BDAE')];
  const step = .8, cap = .38, wt = .45;
  for (let k = 0; k < n; k++) {
    const h = Math.max(.15, h0 - k * dh), hn = k + 1 < n ? Math.max(.15, h0 - (k + 1) * dh) : 0;
    for (let x = xa, i = 0; x < xb - 1e-6; x += step, i++) {
      const x1 = Math.min(xb, x + step), a0 = zE(k, x), a1 = zE(k, x1), b0 = zE(k + 1, x), b1 = zE(k + 1, x1);
      if (crop && i % 2) { G.kind = K.STATIC; G.quad(P(x, a0, h), P(x, b0 - wt, h), P(x1, b1 - wt, h), P(x1, a1, h), lin('#7F6C4E')); }
      else { G.kind = K.LAWN; G.quad(P(x, a0, h + .06), P(x, b0 - wt, h + .06), P(x1, b1 - wt, h + .06), P(x1, a1, h + .06), C.lawn); }
      G.kind = K.STATIC;
      // dry-stone riser in two courses of varied stones, with a stone top standing proud of the bed
      const ym = (h + cap + hn) / 2;
      G.quad(P(x, b0, h + cap), P(x, b0, ym), P(x1, b1, ym), P(x1, b1, h + cap), STONES[Math.floor(hash(x * 1.7, k) * 5)]);
      G.quad(P(x, b0, ym), P(x, b0, hn), P(x1, b1, hn), P(x1, b1, ym), STONES[Math.floor(hash(x * 2.3 + 5, k + 9) * 5)]);
      G.quad(P(x, b0 - wt, h + cap), P(x, b0, h + cap), P(x1, b1, h + cap), P(x1, b1 - wt, h + cap), STONES[Math.floor(hash(x, k + 3) * 5)]);
      G.quad(P(x1, b1 - wt, h + cap), P(x1, b1 - wt, h), P(x, b0 - wt, h), P(x, b0 - wt, h + cap), STONES[1]);
      if (k === 0) G.quad(P(x1, a1, h + .12), P(x1, a1, 0), P(x, a0, 0), P(x, a0, h + .12), STONES[(i % 5)]);
    }
  }
}
const littleTree = (x, z, y = 0, col) => {
  const th = 1.6 + rnd(), sz = 1.5 + rnd() * 1.2;
  G.kind = K.TRUNK; G.box(x, y + th / 2, z, .3, th, .3, C.trunk);
  G.kind = K.LEAF; G.v = rnd();
  G.blob(x, y + th + sz * .55, z, sz * .75, sz * .7, sz * .75, jitter(col || pick(AUTUMN_NEAR), .1), .1, 1);
  G.kind = K.STATIC;
};

Object.assign(BUILD, {
  // B — Überhaus: a green board-formed concrete plate on piers over a recessed glass hall; sixteen tall
  //     towers stand on the terrazzo roof deck in four rows of four, with round skylights between them
  B(s) {
    const rot = -.06, at = frame2(s, rot), L = 62, W = 40, Y0 = 4.2, T = 2.4, YT = Y0 + T;
    let [x, z] = at(0, 0);
    G.box(x, .05, z, L + 26, .1, W + 24, C.paving, rot);
    G.box(x, Y0 / 2, z, L - 10, Y0, W - 10, M_.uGlass, rot);
    for (let i = 0; i <= 17; i++) for (const sd of [-1, 1]) { const [mx, mz] = at(-(L - 10) / 2 + (L - 10) * i / 17, sd * ((W - 10) / 2 + .05));
      G.box(mx, Y0 / 2, mz, .18, Y0, .22, M_.uSlab, rot); }
    for (const lx of [-21, 0, 21]) for (const lz of [-13.2, 13.2]) { const [px, pz] = at(lx, lz); G.box(px, Y0 / 2, pz, 2.6, Y0, 2.6, M_.uSlab, rot); }
    G.box(x, Y0 + T / 2, z, L, T, W, M_.uSlab, rot, M_.uDeck);
    for (const [lx, lz, len, r] of [[0, W / 2 - .2, L, 0], [0, -W / 2 + .2, L, 0], [L / 2 - .2, 0, W, 1.5708], [-L / 2 + .2, 0, W, 1.5708]]) {
      const [rx, rz] = at(lx, lz);
      G.box(rx, YT + .17, rz, len, .34, .4, M_.uSlab, rot + r);
      G.box(rx, YT + 1.15, rz, len, .07, .07, lin('#2E3331'), rot + r);
      for (let k = 0; k <= len / 2.4; k++) { const t = -len / 2 + k * 2.4, c2 = Math.cos(rot + r), s2 = Math.sin(rot + r);
        G.box(rx + t * c2, YT + .75, rz - t * s2, .05, .8, .05, lin('#2E3331'), rot + r); }
    }
    for (const [lx, lz] of [[-15, 0], [0, 0], [15, 0], [-22.5, 8.8], [7.5, 8.8], [-7.5, -8.8], [22.5, -8.8], [0, 17]]) {
      const [hx, hz] = at(lx, lz); G.disc(hx, YT + .02, hz, 1.25, 1.25, lin('#2B3233'), 24); }
    const rows = [-13.2, -4.4, 4.4, 13.2], cols = [-22.5, -7.5, 7.5, 22.5];
    const HH = [[14, 11.5, 12.5, 15], [11, 9.5, 10, 12], [12, 10, 9.5, 11], [15, 12.5, 11.5, 14]];
    const shades = [M_.uCol, M_.uCol2, M_.uCol3, M_.uCol];
    rows.forEach((lz, ri) => cols.forEach((lx, ci) => {
      const [cx, cz] = at(lx, lz), h = HH[ri][ci];
      for (let y = 0, b = 0; y < h - 1e-3; y += .42, b++) {     // board-formed lifts
        const bh = Math.min(.42, h - y), sh = shades[(b * 7 + ci * 3 + ri) % 4];
        G.box(cx, YT + y + bh / 2, cz, 3 + (b % 3 === 0 ? .04 : 0), bh, 3 + (b % 3 === 0 ? .04 : 0), sh, rot);
      }
      const [dx, dz] = at(lx, lz + (lz < 0 ? 1.53 : -1.53));
      G.box(dx, YT + 1.1, dz, .95, 2.2, .06, lin('#2C3230'), rot);
    }));
  },
  // F — the Korean garden: walled courtyards on sandy ground, a main hall facing a square pond, a raised upper
  //     court, gates in the walls, curved terraces below, and a stream pond with a pavilion on posts behind
  F(s) {
    const rot = .12, at = frame2(s, rot);
    let [x, z] = at(-6, -8); G.box(x, .05, z, 82, .1, 66, M_.sand, rot);
    // lower court
    wallLine(at, rot, -20, 20, 20, 20, 0, [.5]);
    wallLine(at, rot, -20, -2, -20, 20, 0, [.45]);
    wallLine(at, rot, 20, -2, 20, 20, 0);
    hanok(...at(3, 8), 9, 6.5, rot, { H: 3.1 });
    { const p = [[-14, 6], [-14, 13], [-7, 13], [-7, 6]].map(([a, b]) => at(a, b)); WATERS.push({ type: 'poly', pts: p, y: .16 });
      for (const [lx, lz, len, r] of [[-10.5, 5.6, 7.8, 0], [-10.5, 13.4, 7.8, 0], [-14.4, 9.5, 7, 1.5708], [-6.6, 9.5, 7, 1.5708]]) {
        const [wx, wz] = at(lx, lz); G.box(wx, .2, wz, len, .4, .8, M_.wallStone2, rot + r); } }
    littleTree(...at(-16, 17), 0, lin('#C1122B')); littleTree(...at(14, 15)); littleTree(...at(-3, 16), 0, lin('#E9BE2C'));
    // upper court, raised on a stone terrace
    [x, z] = at(3, -13); G.box(x, .6, z, 46, 1.2, 22, M_.wallStone, rot, M_.sand);
    wallLine(at, rot, -20, -2, 26, -2, 1.2, [.56]);
    wallLine(at, rot, -20, -24, 26, -24, 1.2);
    wallLine(at, rot, 26, -24, 26, -2, 1.2, [.5]);
    wallLine(at, rot, -20, -24, -20, -2, 1.2);
    hanok(...at(9, -14), 12, 5.5, rot, { y: 1.2 });
    hanok(...at(-10, -16), 7, 4.5, rot + 1.5708, { y: 1.2, H: 2.4 });
    hanok(...at(21, -19), 3.4, 3.4, rot, { y: 1.2, H: 2.2, colH: 2.4, ov: 1, lift: .45 });   // little gate pavilion
    littleTree(...at(-2, -9), 1.2, lin('#A50F2D')); littleTree(...at(18, -8), 1.2);
    // the stream pond behind, with rocks, a pavilion on posts and a square pyramid-roofed pavilion
    { const [px, pz] = at(-27, -31); WATERS.push({ type: 'disc', x: px, z: pz, rx: 11, rz: 6, y: .16 });
      for (let i = 0; i < 34; i++) { const a = rnd() * 6.283, r = 1 + rnd() * .25;
        G.kind = K.ROCK; G.blob(px + Math.cos(a) * 11.6 * r, .5, pz + Math.sin(a) * 6.6 * r, 1 + rnd(), .7 + rnd() * .6, 1 + rnd(), jitter(lin('#B9B3A6'), .2), .25); }
      G.kind = K.STATIC; }
    hanok(...at(-13, -33), 6.5, 4.2, rot, { stilts: 1.5, base: .7, H: 2.6 });
    hanok(...at(-40, -27), 4, 4, rot, { H: 2.6, colH: 2.6, lift: .5 });
    // curved terraces stepping down toward the valley
    terraces(at, -46, 16, 24, 6, 4.6, 2.3, .38, 2.6, .4, true);
    terraces(at, -46, -24, -6, 3, 4.2, 1.2, .35, 1.8, 2.2, true);
  },
  // C — the terracotta court: an outer drum with overlapping circular rooms inside and a planted round garden
  C(s) {
    G.disc(s.x, .12, s.z, 21, 21, M_.floorTerracotta, 56);
    G.ring(s.x, 0, s.z, 20.2, 22, 6.2, M_.brick, 72, M_.terracottaTop);
    for (const [dx, dz, r0, r1, h] of [[0, 2, 15.5, 16.4, 4.2], [-9, -9, 4, 4.8, 3.4], [-1, -14.5, 2.4, 3.1, 2.8], [10.5, -6, 5.4, 6.2, 3.6], [13.5, 5, 2.8, 3.5, 3], [-13, 4, 2.6, 3.3, 2.8], [0, 6, 7, 7.8, 3]])
      G.ring(s.x + dx, 0, s.z + dz, r0, r1, h, M_.brick, 44, M_.terracottaTop);
    G.kind = K.LAWN; G.disc(s.x, .2, s.z + 6, 7, 7, C.lawn, 36); G.kind = K.STATIC;
    littleTree(s.x - 2, s.z + 5); littleTree(s.x + 2.5, s.z + 7.5, 0, lin('#C1122B'));
    for (let i = 0; i < 28; i++) { const a = i / 28 * 6.2832 + .05;
      G.box(s.x + Math.cos(a) * 21.95, 3.4, s.z + Math.sin(a) * 21.95, .3, 3.2, .8, M_.dark, -a); }
    G.ring(s.x, 0, s.z, 22, 25.5, .12, C.paving, 48);
  },
  // D — a white canopy with round openings over round flower beds, segmented square columns and a mirror wall
  D(s) {
    const rot = .2, at = frame2(s, rot), L = 30, W = 16, Y = 3.6, T = .45;
    let [x, z] = at(0, 0); G.box(x, .1, z, L + 4, .2, W + 4, M_.canopy, rot);
    const holes = [[-9.5, 0, 4.3], [0, 0, 4.3], [9.5, 0, 4.3], [-4.75, 8.6, 2.6], [4.75, 8.6, 2.6], [-4.75, -8.6, 2.6], [4.75, -8.6, 2.6], [-15.6, 0, 2.6], [15.6, 0, 2.6]];
    const solid = (lx, lz) => holes.every(([hx, hz, r]) => Math.hypot(lx - hx, lz - hz) > r);
    const cell = .4;
    for (let lz = -W / 2 + cell / 2; lz < W / 2; lz += cell) {
      let run = null;
      for (let lx = -L / 2 + cell / 2; lx <= L / 2 + cell; lx += cell) {
        const ok = lx < L / 2 && solid(lx, lz);
        if (ok && run === null) run = lx;
        if (!ok && run !== null) { const a = run - cell / 2, b = lx - cell / 2, [cx, cz] = at((a + b) / 2, lz);
          G.box(cx, Y + T / 2, cz, b - a, T, cell + .01, M_.canopy, rot, M_.canopyTop); run = null; }
      }
    }
    for (const lx of [-14.3, -4.75, 4.75, 14.3]) for (const lz of [-5.6, 5.6]) {
      const [cx, cz] = at(lx, lz);
      for (let k = 0; k < 4; k++) G.box(cx, .2 + k * .86 + .41, cz, .62, .82, .62, k % 2 ? M_.canopy : lin('#D6D2C8'), rot);
    }
    for (const [hx, hz, r] of holes.slice(0, 3)) {
      const [bx, bz] = at(hx, hz);
      G.ring(bx, .2, bz, r - .9, r - .65, .32, M_.canopy, 36);
      G.kind = K.LAWN; G.disc(bx, .42, bz, r - .9, r - .9, C.lawn, 32); G.kind = K.STATIC;
      for (let i = 0; i < 46; i++) { const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * (r - 1.1);
        G.blob(bx + Math.cos(a) * rr, .55, bz + Math.sin(a) * rr, .28, .2, .28, [M_.flowerA, M_.flowerB, M_.flowerC][i % 3], .2, 0); }
    }
    for (const lx of [-4.75, 4.75]) { const [dx, dz] = at(lx, 0); G.disc(dx, .21, dz, .8, .8, lin('#F4F2EC'), 24); }
    [x, z] = at(0, -W / 2 - .3); G.box(x, Y / 2 + .2, z, L, Y, .25, M_.mirror, rot, M_.canopyTop);
  },
  // K — a concrete cube set among curved stone-walled planting terraces
  K(s) {
    const rot = .55, at = frame2(s, rot);
    G.box(s.x, 4.6, s.z, 9.2, 9.2, 9.2, M_.cube, rot, lin('#B1AC9F'));
    terraces(at, -22, 22, 6, 4, 3.4, 1.0, .2, 1.4, .3, true);
    terraces(frame2(s, rot + 3.1416), -22, 22, 6, 4, 3.4, 1.0, .2, 1.4, 1.9, true);
    const [wx, wz] = at(0, -24); G.box(wx, .7, wz, 40, 1.4, .8, M_.wallStone, rot);
  }
});

/* ---------------- second round of close-up photographs ---------------- */
Object.assign(M_, {
  marble: [lin('#8F9398'), lin('#A5A8AC'), lin('#7E8287'), lin('#B3B5B7')],
  dryGround: lin('#C8B48E'), flag: lin('#BDB7AA'), terrace: lin('#9DA2A3'), terrace2: lin('#B2B4B0'),
  rough: [lin('#A39C8E'), lin('#ADA697'), lin('#958F82'), lin('#B6AF9F')], gravel: lin('#CDB592'), post: lin('#6E6458'),
  brickFloor: lin('#B5654A'), brickFloor2: lin('#C67A5C'), seat: lin('#9C5038')
});
// a triangle whose normal is forced to point up (for ground patches drawn as fans)
Geo.prototype.triUp = function (a, b, c, col) {
  const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
  if (uz * vx - ux * vz < 0) this.tri(a, c, b, col); else this.tri(a, b, c, col);
};
// T-shaped marble sculpture: a faceted hexagonal bar with gem-cut ends, balanced on a single post
function sculpture(x, z, rot, s = 1) {
  const c = Math.cos(rot), sn = Math.sin(rot), L = 5.6 * s, w = 1.5 * s, h = 1.15 * s, y0 = 2.3 * s + h;
  G.box(x, 1.15 * s + .02, z, 1.15 * s, 2.3 * s, 1.35 * s, M_.marble[2], rot);
  const P = (lx, ly, lz) => [x + lx * c + lz * sn, y0 + ly, z - lx * sn + lz * c];
  const sec = [[w, 0], [w * .45, h], [-w * .45, h], [-w, 0], [-w * .45, -h], [w * .45, -h]];   // (lz, ly)
  const rings = [[-L / 2, .42], [-L / 2 + .75 * s, 1], [L / 2 - .75 * s, 1], [L / 2, .42]];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
    const [x0, k0] = rings[r], [x1, k1] = rings[r + 1], a = sec[k], b = sec[(k + 1) % 6];
    G.quad(P(x0, a[1] * k0, a[0] * k0), P(x0, b[1] * k0, b[0] * k0), P(x1, b[1] * k1, b[0] * k1), P(x1, a[1] * k1, a[0] * k1), M_.marble[(k + r) % 4]);
  }
  for (const [ex, ek] of [rings[0], rings[3]]) for (let k = 0; k < 6; k++) {
    const a = sec[k], b = sec[(k + 1) % 6];
    G.tri(P(ex, 0, 0), P(ex, a[1] * ek, a[0] * ek), P(ex, b[1] * ek, b[0] * ek), M_.marble[k % 4]);
  }
}
Object.assign(BUILD, {
  // G — a sunken brick amphitheatre: concentric steps down to a radial brick floor with a white disc at its heart
  G(s) {
    const P = (r, a, y) => [s.x + Math.cos(a) * r, y, s.z + Math.sin(a) * r];
    for (let i = 0; i < 40; i++) { const a0 = i / 40 * 6.2832, a1 = (i + 1) / 40 * 6.2832;
      G.triUp(P(0, 0, .1), P(6.5, a0, .1), P(6.5, a1, .1), i % 2 ? M_.brickFloor : M_.brickFloor2); }
    G.disc(s.x, .14, s.z, .8, .8, lin('#F2EFE8'), 24);
    for (let k = 0; k < 9; k++) {
      const r0 = 6.5 + k * 1.7, h = .38 + k * .4;
      G.ring(s.x, 0, s.z, r0, r0 + 1.7, h, k % 2 ? M_.tier : M_.terracotta, 56, k % 2 ? M_.tierTop : M_.brickFloor2);
      if (k % 3 === 1) for (let j = 0; j < 10 + k * 2; j++) {                 // little seat blocks
        const a = j / (10 + k * 2) * 6.2832 + k; const [bx, , bz] = P(r0 + .85, a, 0);
        G.box(bx, h + .18, bz, .8, .36, .7, M_.seat, -a); }
    }
    G.ring(s.x, 0, s.z, 21.8, 24.6, 3.95, C.paving, 56, lin('#D9D3C4'));
    G.kind = K.LAWN;                                                          // grassed berm falling away outside
    for (let i = 0; i < 64; i++) { const a0 = i / 64 * 6.2832, a1 = (i + 1) / 64 * 6.2832;
      G.quad(P(24.6, a0, 3.95), P(24.6, a1, 3.95), P(32, a1, 0), P(32, a0, 0), C.lawn); }
    G.kind = K.STATIC;
  },
  // H — a diamond-shaped dry garden planted with rows of faceted marble sculptures, cut by a flagstone path
  H(s) {
    const A = 46, B = 31, inside = (u, v, m = 0) => Math.abs(u) / (A - m) + Math.abs(v) / (B - m * .67) <= 1;
    const D = [[A, 0], [0, B], [-A, 0], [0, -B]].map(([u, v]) => [s.x + u, .06, s.z + v]);
    for (let i = 0; i < 4; i++) G.triUp([s.x, .06, s.z], D[i], D[(i + 1) % 4], M_.dryGround);
    const edge = [[A, 0], [0, B], [-A, 0], [0, -B], [A, 0]];
    for (let i = 0; i < 4; i++) { const [u0, v0] = edge[i], [u1, v1] = edge[i + 1], L = Math.hypot(u1 - u0, v1 - v0);
      G.box(s.x + (u0 + u1) / 2, .25, s.z + (v0 + v1) / 2, L + 1, .5, .9, M_.flag, Math.atan2(-(v1 - v0), u1 - u0)); }
    G.box(s.x, .1, s.z, 3.2, .1, 2 * B, M_.flag);                             // flagstone path, north–south
    G.box(s.x, .12, s.z, 11, .12, 11, M_.terrace, .7854);                    // square paved terrace at the centre
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if ((i + j) % 2 === 0) {
      const u = i * 1.9, v = j * 1.9; G.box(s.x + (u - v) * .7071, .19, s.z + (u + v) * .7071, 1.7, .02, 1.7, M_.terrace2, .7854); }
    for (let gu = -5; gu <= 5; gu++) for (let gv = -4; gv <= 4; gv++) {
      const u = gu * 8.4 + (gv % 2 ? 4.2 : 0), v = gv * 6.6;
      if (!inside(u, v, 6) || Math.abs(u) < 5 || Math.abs(u) + Math.abs(v) < 12) continue;
      sculpture(s.x + u, s.z + v, 0, .92 + hash(gu, gv) * .16);
    }
    for (let i = 0; i < 220; i++) {                                          // grasses and low shrubs
      const u = (rnd() - .5) * 2 * A, v = (rnd() - .5) * 2 * B;
      if (!inside(u, v, 2) || Math.abs(u) < 2.6) continue;
      const r = .35 + rnd() * .5; G.kind = K.LEAF; G.v = rnd();
      G.blob(s.x + u, r * .4, s.z + v, r, r * .7, r, jitter(pick(AUTUMN_NEAR), .25), .2, 0); G.kind = K.STATIC;
    }
  },
  // P — a pavilion of rough stone blocks with a doorway straight through, in a gravel court ringed by wisteria pergolas
  P(s) {
    const W = 10.5, D = 7, H = 4.6, door = 1.9, doorH = 3.1;
    G.box(s.x, .05, s.z, 44, .1, 44, M_.gravel);
    G.box(s.x, .14, s.z, W + 3, .1, D + 3, C.paving);
    for (let k = 0; k < 9; k++) G.box(s.x + (rnd() - .5) * .5, .16, s.z + D / 2 + 2.2 + k * 1.6, 2.2 + rnd() * .6, .06, 1.3, M_.flag, rnd() * .4);
    // walls of coursed rough blocks
    const course = .92, wallT = .7;
    const wall = (x0, x1, zc, along) => {
      for (let y = 0, row = 0; y < H - 1e-3; y += course, row++) {
        const ch = Math.min(course, H - y);
        for (let t = x0 + (row % 2 ? -.45 : 0); t < x1 - 1e-3;) {
          const a = Math.max(t, x0), len0 = 1.1 + hash(t * 3.1, row) * .9, b = Math.min(x1, t + len0), mid = (a + b) / 2;
          if (b - a > .2) { const col = M_.rough[Math.floor(hash(t * 7.3, row * 1.7) * 4)];
            if (along) G.box(s.x + mid, .2 + y + ch / 2, s.z + zc, b - a - .04, ch - .04, wallT, col);
            else G.box(s.x + zc, .2 + y + ch / 2, s.z + mid, wallT, ch - .04, b - a - .04, col); }
          t += len0;
        }
      }
    };
    // front and back walls are split around the doorway; the lintel courses run over it
    for (const zc of [D / 2 - wallT / 2, -D / 2 + wallT / 2]) { wall(-W / 2, -door / 2, zc, true); wall(door / 2, W / 2, zc, true);
      G.box(s.x, .2 + doorH + (H - doorH) / 2, s.z + zc, door + .2, H - doorH - .04, wallT, M_.rough[1]); }
    wall(-D / 2 + wallT, D / 2 - wallT, -W / 2 + wallT / 2, false);
    wall(-D / 2 + wallT, D / 2 - wallT, W / 2 - wallT / 2, false);
    G.box(s.x, .2 + H + .1, s.z, W, .2, D, M_.rough[3], 0, lin('#BDB6A6'));
    G.box(s.x, .22, s.z, W - 2 * wallT, .04, D - 2 * wallT, lin('#E3DED2'));
    // wisteria pergolas on three sides of the court
    for (const [ax, az, bx, bz] of [[-17, -14, -17, 14], [17, -14, 17, 14], [-17, -14, 17, -14]]) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.round(L / 3.6);
      for (let i = 0; i <= n; i++) { const x = s.x + ax + (bx - ax) * i / n, z = s.z + az + (bz - az) * i / n;
        G.box(x, 1.6, z, .32, 3.2, .32, M_.post); }
      const r = Math.atan2(-(bz - az), bx - ax);
      G.box(s.x + (ax + bx) / 2, 3.25, s.z + (az + bz) / 2, L + .6, .18, 2.6, M_.post, r);
      G.kind = K.LEAF;
      for (let i = 0; i < L / 1.4; i++) { const t = (i + .5) / (L / 1.4), x = s.x + ax + (bx - ax) * t, z = s.z + az + (bz - az) * t;
        G.v = rnd(); G.blob(x, 3.45, z, 1.1, .45, 1.6, jitter(lin('#5E8A35'), .2), .25, 0);
        if (i % 2) G.blob(x, 2.7, z + .9, .35, .8, .35, jitter(lin('#4F7A2E'), .2), .2, 0); }
      G.kind = K.STATIC;
    }
  }
});

// the colonnade pavilion's pool (rotated with its site plan)
WATERS.push({ type: 'poly', pts: [[POOL.x0, POOL.z0], [POOL.x0, POOL.z1], [POOL.x1, POOL.z1], [POOL.x1, POOL.z0]].map(([x, z]) => toWorld(x, z)) });
G.site = false;
for (const s of STATIONS) if (BUILD[s.id]) { G.kind = K.STATIC; G.v = 0; BUILD[s.id](s); }
const PATHS = [];
const pathDist = (x, z) => { let d = 1e9; for (const [ax, az, bx, bz] of PATHS) { const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)); d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t)); } return d; };
// white paths from each station to the promenade, as in the aerial photograph
for (const s of STATIONS) {
  if (!s.r || s.id === 'B') continue;
  let best = null;
  for (let i = 0; i < 360; i++) { const a = i / 360 * 6.2832, x = LOOP.cx + Math.cos(a) * LOOP.rx, z = LOOP.cz + Math.sin(a) * LOOP.rz, d = Math.hypot(x - s.x, z - s.z); if (!best || d < best[2]) best = [x, z, d]; }
  const dx = best[0] - s.x, dz = best[1] - s.z, L = Math.hypot(dx, dz) - s.r;
  if (L < 2) continue;
  const ux = dx / (L + s.r), uz = dz / (L + s.r), cx = s.x + ux * (s.r + L / 2), cz = s.z + uz * (s.r + L / 2);
  G.box(cx, .08, cz, L + 2, .16, 3.4, M_.promenade, Math.atan2(-dz, dx));
  PATHS.push([s.x, s.z, best[0], best[1]]);
}
for (const [a, b] of [['G', 'P'], ['G', 'F'], ['C', 'D']]) {
  const p = ST[a], q = ST[b], dx = q.x - p.x, dz = q.z - p.z, D = Math.hypot(dx, dz), L = D - p.r - q.r;
  if (L > 2) { G.box(p.x + dx / D * (p.r + L / 2), .08, p.z + dz / D * (p.r + L / 2), L + 2, .16, 3, M_.promenade, Math.atan2(-dz, dx)); PATHS.push([p.x, p.z, q.x, q.z]); }
}
// patterned square stones set into the promenade every few metres
for (let i = 0; i < 200; i++) {
  const a = i / 200 * 6.2832, x = LOOP.cx + Math.cos(a) * LOOP.rx, z = LOOP.cz + Math.sin(a) * LOOP.rz;
  if (stationDist(x, z) < 2) continue;
  const tx = -Math.sin(a) * LOOP.rx, tz = Math.cos(a) * LOOP.rz;
  G.box(x, .18, z, 1.5, .05, 1.5, i % 4 ? M_.inlay : lin('#A88F7A'), Math.atan2(-tz, tx) + .7854);
  G.disc(x, .215, z, .48, .48, lin('#C9C6BE'), 16);
}
// the white promenade around the contemporary garden, and the reservoir at the valley mouth
G.kind = K.STATIC; G.band(LOOP.cx, LOOP.cz, LOOP.rx, LOOP.rz, LOOP.w, 0, .16, M_.promenade, 220);
WATERS.push({ type: 'disc', x: POND.x, z: POND.z, rx: POND.rx, rz: POND.rz });
G.band(POND.x, POND.z, POND.rx + 1.2, POND.rz + 1.2, 2.4, 0, .3, M_.granite, 80);
G.site = false; G.kind = K.STATIC;
// trees: dense around the colonnade pavilion, garden plantings around every station, a forest rim around the
// valley and a thin scatter on the far hills (the hillside colour itself carries the distant forest)
{
  const M = SMALL ? .5 : 1;
  const nearA = (x, z) => Math.hypot((x - 6) / 1.15, z + 6);
  const inForeground = (x, z) => z > 27 && z < 42 && ((x > -16 && x < -2) || (x > 15 && x < 27));
  const inPoolside = (x, z) => z > 12 && z < 36 && x > 28 && x < 46;
  const blocked = (x, z, pad = 4) => stationDist(x, z) < pad || loopDist(x, z) < LOOP.w / 2 + 3 ||
    Math.hypot((x - POND.x) / (POND.rx + 4), (z - POND.z) / (POND.rz + 4)) < 1;
  // around the main buildings every tree stands on its own: one trunk, one clean crown, never touching a
  // building or another tree's crown
  const NEAR_B = (x, z) => stationDist(x, z) < 32 || siteDistA(x, z) < 34;
  const PLACED = [], CELL = 12, grid = new Map();
  const key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  const crowded = (x, z, r) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const L = grid.get((Math.floor(x / CELL) + i) + ',' + (Math.floor(z / CELL) + j)); if (!L) continue;
      for (const [px, pz, pr] of L) if (Math.hypot(x - px, z - pz) < r + pr + .6) return true; } return false; };
  const place = (x, z, r) => { const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z, r]); };
  const soloTree = (x, z, hill) => {
    const conifer = rnd() < (inForeground(x, z) ? (x < 0 ? .7 : .45) : .22);
    const r = conifer ? 2.4 + rnd() * 1.1 : 2.2 + rnd() * 1.6;
    if (stationDist(x, z) < r + 2.5 || siteDistA(x, z) < r + 2 || crowded(x, z, r)) return false;
    place(x, z, r);
    const y = heightAt(x, z) - .3;
    if (conifer) {
      const h = 11 + rnd() * 7, col = jitter(rnd() < .5 ? C.pine : C.pine2, .2);
      G.kind = K.TRUNK; G.box(x, y + 1.2, z, .5, 2.4, .5, C.trunk);
      G.kind = K.PINE; for (let k = 0; k < 3; k++) G.cone(x, y + 1.8 + k * h * .25, z, r * (1 - k * .25), h * .48, col, 7);
    } else {
      const th = 2.2 + rnd() * 1.2, col = hill ? pick(AUTUMN_HILL) : pick(AUTUMN_NEAR);
      G.kind = K.TRUNK; G.box(x, y + th / 2, z, .45, th, .45, C.trunk);
      G.kind = K.LEAF; G.v = rnd() + (hill ? 2 : 0);
      G.blob(x, y + th + r * .8, z, r, r * (.95 + rnd() * .2), r, jitter(col, .12), .1, 1);
    }
    G.kind = K.STATIC;
    return true;
  };
  const tree = (x, z, lod, hill) => {
    if (NEAR_B(x, z)) return soloTree(x, z, hill);
    const fore = inForeground(x, z) || inPoolside(x, z);
    const y = heightAt(x, z) - .3;
    const pc = inPoolside(x, z) ? .12 : inForeground(x, z) ? (x < 0 ? .75 : .45) : hill ? .2 : .14;
    if (rnd() < pc) {                                           // conifer
      const h = 10 + rnd() * 9, r = 2.3 + rnd() * 1.3, col = jitter(rnd() < .5 ? C.pine : C.pine2, .22);
      if (lod) { G.kind = K.TRUNK; G.box(x, y + 1.2, z, .5, 2.4, .5, C.trunk); }
      G.kind = K.PINE; for (let k = 0; k < (lod ? 3 : 2); k++) G.cone(x, y + 1.8 + k * h * .25, z, r * (1 - k * .25), h * .48, col, lod ? 7 : 5);
    } else {
      const col = hill ? pick(AUTUMN_HILL) : pick(AUTUMN_NEAR), sz = (lod ? 1.9 : 2.8) + rnd() * (lod ? 2.2 : 2.6), th = 1.8 + rnd() * 1.4;
      G.kind = K.TRUNK; if (lod) G.box(x, y + th / 2, z, .45, th, .45, C.trunk);
      G.kind = K.LEAF; G.v = rnd() + (hill ? 2 : 0);
      const k = lod ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2);
      for (let j = 0; j < k; j++) {
        const r = sz * (lod ? .62 + rnd() * .4 : .85);
        G.blob(x + (rnd() - .5) * sz * .9, y + th + sz * (.55 + rnd() * .5), z + (rnd() - .5) * sz * .9, r, r * (.85 + rnd() * .35), r, jitter(col, .16), .14, lod);
      }
    }
    return true;
  };
  const scatter = (count, sample, accept) => { let n = 0, tries = 0; while (n < count && tries < count * 60) { tries++; const p = sample(); if (p && accept(p[0], p[1]) && tree(p[0], p[1], p[2], p[3])) n++; } };
  // 1) the colonnade pavilion's forest, as matched to its photograph
  scatter(2600 * M, () => { const a = rnd() * 6.283, rr = 22 + Math.pow(rnd(), 1.25) * 125, x = 6 + Math.cos(a) * rr * 1.15, z = -6 + Math.sin(a) * rr;
    return [x, z, nearA(x, z) < 85 ? 1 : 0, z < -18]; },
    (x, z) => { const fore = inForeground(x, z) || inPoolside(x, z);
      return siteDistA(x, z) >= (fore ? 0 : 3) && corridorDist(x, z) >= (fore ? 5 : 7) && !blocked(x, z) && (basinN(x, z) > 1 || rnd() < .2); });
  // 2) plantings around each station on the valley floor
  for (const s of STATIONS) if (s.r) scatter(150 * M, () => { const a = rnd() * 6.283, rr = s.r + 5 + Math.pow(rnd(), .8) * 55;
      return [s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, 1, false]; },
    (x, z) => !blocked(x, z) && corridorDist(x, z) >= 7 && nearA(x, z) > 60 && rnd() < (basinN(x, z) < 1 ? .55 : 1));
  // 3) the forest rim that holds the valley
  scatter(2600 * M, () => { const a = rnd() * 6.283, e = 1.0 + Math.pow(rnd(), 1.3) * .9;
      const x = BASIN.cx + Math.cos(a) * BASIN.rx * e, z = BASIN.cz + Math.sin(a) * BASIN.rz * e;
      return [x, z, 0, true]; },
    (x, z) => !blocked(x, z) && corridorDist(x, z) >= 9 && nearA(x, z) > 150);
  // 3b) low shrubs and grasses across the garden floor
  { let n = 0, tries = 0; const N = 1600 * M;
    while (n < N && tries < N * 20) { tries++;
      const a = rnd() * 6.283, e = Math.sqrt(rnd()) * .97, x = BASIN.cx + Math.cos(a) * BASIN.rx * e, z = BASIN.cz + Math.sin(a) * BASIN.rz * e;
      if (blocked(x, z, 2) || corridorDist(x, z) < 4) continue;
      const r = .7 + rnd() * 1.2; G.kind = K.LEAF; G.v = rnd();
      G.blob(x, r * .45, z, r * 1.3, r * .7, r * 1.1, jitter(pick(AUTUMN_NEAR), .2), .2, 0); n++; } }
  // 3c) fill the open garden floor with trees: a jittered grid so no clearing is left bare
  { const STEP = SMALL ? 12 : 8.5;
    for (let gx = BASIN.cx - BASIN.rx; gx <= BASIN.cx + BASIN.rx; gx += STEP)
      for (let gz = BASIN.cz - BASIN.rz - 40; gz <= BASIN.cz + BASIN.rz; gz += STEP) {
        const x = gx + (rnd() - .5) * STEP * .9, z = gz + (rnd() - .5) * STEP * .9;
        if (basinN(x, z) > 1.02 && nearA(x, z) > 60) continue;           // outside the valley floor: the rim pass covers it
        if (blocked(x, z, 6) || pathDist(x, z) < 4 || corridorDist(x, z) < 8 || siteDistA(x, z) < 6) continue;
        if (rnd() < .12) continue;                                        // a few natural gaps
        tree(x, z, corridorDist(x, z) < 45 ? 1 : 0, false);
      } }
  // 4) a thin scatter over the far hills
  scatter(1800 * M, () => [-700 + rnd() * 1450, -780 + rnd() * 1500, 0, true],
    (x, z) => basinN(x, z) > 1.7 && nearA(x, z) > 150 && corridorDist(x, z) >= 12);
}
const sceneData = new Float32Array(G.d); G.d = null;
const META = new Float32Array(G.meta); G.meta = null;
const TRIS = META.length / 6;
const sceneCount = sceneData.length / 9;

/* ---------------- seasons ---------------- */
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const P_ = h => lin(h);
const SPRING_LEAF = [[.2, '#F2B3C4'], [.3, '#F6EEE8'], [.36, '#E9A2B6'], [.55, '#B9D96C'], [.78, '#93C34B'], [1, '#6FA83A']].map(([t, c]) => [t, P_(c)]);
const SUMMER_LEAF = [[.2, '#2F5A1F'], [.42, '#3E6E25'], [.62, '#4C7E2B'], [.82, '#5C8B30'], [1, '#2A4F1C']].map(([t, c]) => [t, P_(c)]);
const band = (pal, t) => { for (const [e, c] of pal) if (t <= e) return c; return pal[pal.length - 1][1]; };
const SNOW = P_('#E9EEF2'), SNOW_SH = P_('#CFD8E0');
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const TERR = { spring: [P_('#7D9A45'), P_('#62803A'), P_('#3E6A2E'), P_('#577F38')], summer: [P_('#5E7F2E'), P_('#4A6A26'), P_('#24461E'), P_('#335A26')] };
function seasonColors(season) {
  const out = new Float32Array(TRIS * 9);
  for (let i = 0; i < TRIS; i++) {
    const o = i * 6, k = META[o], ny = META[o + 1], v = META[o + 2];
    let c = [META[o + 3], META[o + 4], META[o + 5]];
    const j = hash(i * .731, i * .117);                  // stable per-face variation
    if (season !== 'autumn') switch (k) {
      case K.TERRAIN: {
        if (season === 'winter') { c = mixc(mixc(SNOW, SNOW_SH, j), mixc(P_('#8C969C'), P_('#B4BDC3'), j), v * .85); }
        else { const T = TERR[season]; c = mixc(mixc(T[0], T[1], j), mixc(T[2], T[3], j), v); }
        break; }
      case K.DRY: c = season === 'winter' ? SNOW : P_(season === 'spring' ? '#A9A86C' : '#98975A'); break;
      case K.LAWN: c = season === 'winter' ? SNOW : P_(season === 'spring' ? '#7BB23A' : '#3F7F22'); break;
      case K.STATIC: case K.ROCK:
        if (season === 'winter' && ny > (k === K.ROCK ? .3 : .6)) c = SNOW; break;
      case K.PINE: if (season === 'winter') c = mixc(c, SNOW_SH, .16 + j * .22); else if (season === 'spring') c = mixc(c, P_('#4F6B2E'), .25); break;
      case K.LEAF: {
        const t = v % 1;
        if (season === 'spring') c = band(SPRING_LEAF, t);
        else if (season === 'summer') c = band(SUMMER_LEAF, t);
        else c = ny > .5 ? mixc(SNOW, SNOW_SH, .3 + j * .5) : mixc(P_('#4A3C31'), P_('#6B5A4B'), j);
        c = c.map(x => x * (.88 + j * .24));
        break; }
    }
    for (let q = 0; q < 3; q++) out.set(c, i * 9 + q * 3);
  }
  return out;
}
// light, sky and water for each season (linear)
const LIGHTS = {
  spring: { sunCol: [3.0, 2.85, 2.5], sky: [.62, .72, .84], ground: [.3, .3, .2], fog: P_('#E3E6E0'), zenith: P_('#8DB6D9'), deep: [.02, .035, .035], exposure: 1.0, fogMul: .8, ice: 0 },
  summer: { sunCol: [3.4, 3.15, 2.7], sky: [.58, .7, .88], ground: [.24, .27, .15], fog: P_('#D9E4E8'), zenith: P_('#6FA2D6'), deep: [.012, .03, .03], exposure: 1.0, fogMul: .7, ice: 0 },
  autumn: { sunCol: [3.1, 2.55, 1.85], sky: [.62, .68, .78], ground: [.30, .24, .15], fog: P_('#D9CBB0'), zenith: P_('#8FA9BE'), deep: [.018, .028, .026], exposure: 1.0, fogMul: 1, ice: 0 },
  winter: { sunCol: [2.3, 2.38, 2.55], sky: [.7, .77, .88], ground: [.48, .5, .54], fog: P_('#D3DAE1'), zenith: P_('#9DAEC0'), deep: [.03, .04, .05], exposure: .86, fogMul: 1.3, ice: 1 }
};
const PARTICLES = {
  spring: { cols: ['#F6C6D3', '#F9E2E8', '#FFFFFF', '#F2B3C4'], size: 1.0, speed: .5, frac: 1 },
  summer: { cols: ['#9BC45A', '#E9F0C8', '#7FAF3F'], size: .7, speed: .55, frac: .3 },
  autumn: { cols: ['#C1122B', '#E9BE2C', '#D46A1F', '#A50F2D', '#F0D24A'], size: 1.0, speed: 1.0, frac: 1 },
  winter: { cols: ['#FFFFFF', '#EEF4FA', '#F7FAFF'], size: .62, speed: .42, frac: 1 }
};

/* ---------------- shaders ---------------- */
const TONE = `
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
vec3 display(vec3 c){ vec3 d=pow(aces(c*uExposure), vec3(1./2.2)); float l=dot(d,vec3(.299,.587,.114)); d=mix(vec3(l),d,.9); d=d*vec3(1.03,1.0,.95)+vec3(.012,.008,0.); return clamp(d,0.,1.); }`;
const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol; layout(location=3) in vec3 aCol2;
uniform mat4 uVP, uModel, uLVP; uniform float uMix;
out vec3 vW; out vec3 vN; out vec3 vC; out vec4 vL;
void main(){ vW=aPos; vN=aNor; vC=mix(aCol,aCol2,uMix); vL=uLVP*vec4(aPos,1.); gl_Position=uVP*uModel*vec4(aPos,1.); }`;
const SCENE_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vW; in vec3 vN; in vec3 vC; in vec4 vL;
uniform vec3 uEye, uSun, uSunCol, uSky, uGround, uFog; uniform float uFogD, uClip, uExposure, uShadowTexel;
uniform sampler2DShadow uShadow;
out vec4 o;
${TONE}
float shade(){ vec3 p=vL.xyz/vL.w*.5+.5; if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.) return 1.;
  float s=0.; for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) s+=texture(uShadow, vec3(p.xy+vec2(i,j)*uShadowTexel*1.2, p.z-.0012)); return s/9.; }
void main(){
  if(vW.y<uClip) discard;
  vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n;
  float nd=dot(n,uSun);
  float sh=shade();
  vec3 amb=mix(uGround,uSky,n.y*.5+.5);
  float wrap=max(nd*.85+.15,0.);
  float ao=mix(1., mix(.58,1.,smoothstep(0.,2.6,vW.y)), 1.-abs(n.y));
  ao*=mix(.8,1.,smoothstep(0.,1.2,vW.y)+step(.9,n.y)*.0);
  vec3 c=vC*(amb*ao + uSunCol*wrap*sh*mix(1.,ao,.5));
  // warm translucency for foliage-like saturated surfaces when backlit
  vec3 v=normalize(uEye-vW); float back=pow(max(dot(-v,uSun),0.),6.);
  c+=vC*uSunCol*back*.35*sh;
  float d=length(vW-uEye); float f=1.-exp(-pow(d*uFogD,1.6));
  f*=mix(1., .55, clamp((vW.y-10.)/80.,0.,1.));
  c=mix(c,uFog,f);
  o=vec4(display(c),1.);
}`;
const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uLVP; void main(){ gl_Position=uLVP*vec4(aPos,1.); }`;
const DEPTH_FS = `#version 300 es
precision mediump float; out vec4 o; void main(){ o=vec4(1.); }`;
const SKY_VS = `#version 300 es
const vec2 P[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3)); out vec2 vP; void main(){ vP=P[gl_VertexID]; gl_Position=vec4(P[gl_VertexID],.9999,1.); }`;
const SKY_FS = `#version 300 es
precision highp float; in vec2 vP; uniform mat4 uInv; uniform vec3 uFog, uZenith, uSun, uSunCol; uniform float uExposure, uFlipY; out vec4 o;
${TONE}
void main(){ vec4 a=uInv*vec4(vP.x,vP.y*uFlipY,-1,1), b=uInv*vec4(vP.x,vP.y*uFlipY,1,1); vec3 d=normalize(b.xyz/b.w-a.xyz/a.w);
  d.y*=uFlipY;
  vec3 c=mix(uFog,uZenith,smoothstep(-.02,.55,d.y));
  float s=max(dot(d,uSun),0.); c+=uSunCol*(pow(s,600.)*8.+pow(s,24.)*.18);
  o=vec4(display(c),1.); }`;
const WATER_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uVP; out vec3 vW; void main(){ vW=aPos; gl_Position=uVP*vec4(aPos,1.); }`;
const WATER_FS = `#version 300 es
precision highp float; in vec3 vW; uniform sampler2D uRefl; uniform vec2 uRes; uniform float uTime, uExposure, uFogD;
uniform vec3 uEye, uSun, uSunCol, uDeep, uFog; uniform float uIce; out vec4 o;
${TONE}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float t=uTime;
  float r1=sin(vW.x*1.1+t*.9)*cos(vW.z*1.4-t*.7), r2=sin(vW.x*2.7-t*1.4+vW.z*2.1), r3=sin(vW.z*4.3+t*2.1+vW.x*.7);
  vec3 n=normalize(vec3(r1*.018+r2*.009+r3*.004, 1., r2*.016+r1*.01-r3*.003));
  vec3 v=normalize(uEye-vW);
  vec3 refl=texture(uRefl, uv+n.xz*vec2(.05,.05)).rgb;
  float fr=.06+.94*pow(1.-max(dot(n,v),0.),3.);
  vec3 deep=display(uDeep);
  vec3 c=mix(deep, refl*vec3(.8,.84,.82), clamp(fr*1.1+.06,0.,.92));
  vec3 h=normalize(uSun+v); float nh=max(dot(n,h),0.);
  vec3 glint=uSunCol*(pow(nh,2400.)*60.+pow(nh,700.)*2.2);
  c=1.-(1.-c)*(1.-display(glint));
  vec3 ice=display(vec3(.62,.7,.78)*(1.+.08*r1)); ice=mix(ice, refl, .12);
  c=mix(c, ice, uIce*.88);
  float d=length(vW-uEye); float f=1.-exp(-pow(d*uFogD,1.6));
  c=mix(c, display(uFog), f);
  o=vec4(c,1.);
}`;
function prog(vs, fs) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const U = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); U[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, U };
}
const P_SCENE = prog(SCENE_VS, SCENE_FS), P_DEPTH = prog(DEPTH_VS, DEPTH_FS), P_SKY = prog(SKY_VS, SKY_FS), P_WATER = prog(WATER_VS, WATER_FS);

function vao(data, dynamic) {
  const v = gl.createVertexArray(), b = gl.createBuffer(); gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12); }
  gl.bindVertexArray(null); return { v, b };
}
const VA_SCENE = vao(sceneData);
const COL_A = gl.createBuffer(), COL_B = gl.createBuffer();
{
  const autumn = seasonColors('autumn');
  gl.bindVertexArray(VA_SCENE.v);
  for (const [loc, buf] of [[2, COL_A], [3, COL_B]]) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, autumn, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 12, 0);
  }
  gl.bindVertexArray(null);
}
const water = new Float32Array(WATERS.flatMap(w => {
  const wy = w.y ?? WATER_Y, v = (x, z) => [x, wy, z, 0, 1, 0, 0, 0, 0], out = [];
  if (w.type === 'poly') { const p = w.pts; for (let i = 1; i < p.length - 1; i++) out.push(...v(...p[0]), ...v(...p[i]), ...v(...p[i + 1])); }
  else for (let i = 0; i < 48; i++) { const a0 = i / 48 * 6.2832, a1 = (i + 1) / 48 * 6.2832;
    out.push(...v(w.x, w.z), ...v(w.x + Math.cos(a0) * w.rx, w.z + Math.sin(a0) * w.rz), ...v(w.x + Math.cos(a1) * w.rx, w.z + Math.sin(a1) * w.rz)); }
  return out;
}));
const WATER_COUNT = water.length / 9;
const WATER_CENTRES = WATERS.map(w => w.type === 'poly' ? [w.pts.reduce((a, p) => a + p[0], 0) / w.pts.length, w.pts.reduce((a, p) => a + p[1], 0) / w.pts.length] : [w.x, w.z]);
const VA_WATER = vao(water);
const LEAVES = SMALL ? 50 : 90;
const leafData = new Float32Array(LEAVES * 6 * 9);
const VA_LEAF = vao(leafData, true);
gl.bindVertexArray(VA_LEAF.v); gl.bindBuffer(gl.ARRAY_BUFFER, VA_LEAF.b); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24); gl.bindVertexArray(null);
const leaves = Array.from({ length: LEAVES }, (_, i) => ({ a: rnd() * 6.28, r: 4 + rnd() * 26, ph: rnd() * 6.28, sp: .5 + rnd() * .9, sw: .5 + rnd() * 1.4, h: rnd(), col: [1, 1, 1], s: .1 + rnd() * .09, i }));
let PART = PARTICLES.autumn;
function paintParticles() { const cols = PART.cols.map(lin); leaves.forEach((f, i) => { f.col = cols[i % cols.length]; }); }
paintParticles();

/* ---------------- render targets ---------------- */
const SH = SMALL ? 1024 : 2048;
const shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SH, SH);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const shadowFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

let reflTex = null, reflDepth = null, reflFB = null, RW = 0, RH = 0;
function makeRefl(w, h) {
  if (reflFB) { gl.deleteFramebuffer(reflFB); gl.deleteTexture(reflTex); gl.deleteRenderbuffer(reflDepth); }
  RW = w; RH = h;
  reflTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, reflTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  reflDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, reflDepth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  reflFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, reflFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflDepth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ---------------- lighting ---------------- */
const SUN = norm([0.06, 0.74, -0.67]);
const L = Object.assign({ sun: SUN }, JSON.parse(JSON.stringify(LIGHTS.autumn)));
const lerpL = (a, b, t) => { const r = {}; for (const k in b) r[k] = Array.isArray(b[k]) ? b[k].map((x, i) => a[k][i] + (x - a[k][i]) * t) : a[k] + (b[k] - a[k]) * t; return r; };
let LC = [6, 0, -4], LVP = null;
function aimShadow(c) { LC = [Math.round(c[0] / 8) * 8, 0, Math.round(c[2] / 8) * 8];
  LVP = M.mul(M.ortho(-115, 115, -115, 115, 1, 700), M.look([LC[0] + SUN[0] * 320, LC[1] + SUN[1] * 320, LC[2] + SUN[2] * 320], LC, [0, 1, 0])); }
aimShadow(LC);
const REFLECT = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 2 * WATER_Y, 0, 1]);

/* ---------------- frame ---------------- */
let W = 0, H = 0, DPR = 1, scaleQ = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, SMALL ? 1.5 : 1.6) * scaleQ;
  W = Math.round(innerWidth * DPR); H = Math.round(innerHeight * DPR);
  canvas.width = W; canvas.height = H;
  makeRefl(Math.max(2, Math.round(W * .5)), Math.max(2, Math.round(H * .5)));
}
resize(); addEventListener('resize', resize);

function drawScene(VP, model, clip, eye) {
  const { p, U } = P_SCENE; gl.useProgram(p);
  gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniformMatrix4fv(U.uModel, false, model); gl.uniformMatrix4fv(U.uLVP, false, LVP);
  gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uSun, L.sun); gl.uniform3fv(U.uSunCol, L.sunCol); gl.uniform3fv(U.uSky, L.sky);
  gl.uniform3fv(U.uGround, L.ground); gl.uniform3fv(U.uFog, L.fog); gl.uniform1f(U.uFogD, FOG_D); gl.uniform1f(U.uClip, clip);
  gl.uniform1f(U.uExposure, L.exposure); gl.uniform1f(U.uShadowTexel, 1 / SH); gl.uniform1f(U.uMix, mixNow);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex); gl.uniform1i(U.uShadow, 0);
  gl.bindVertexArray(VA_SCENE.v); gl.drawArrays(gl.TRIANGLES, 0, sceneCount);
  gl.bindVertexArray(VA_LEAF.v); gl.drawArrays(gl.TRIANGLES, 0, LEAVES * 6);
}
function drawSky(VP, flip) {
  const { p, U } = P_SKY; gl.useProgram(p);
  gl.uniformMatrix4fv(U.uInv, false, M.inv(VP)); gl.uniform3fv(U.uFog, L.fog); gl.uniform3fv(U.uZenith, L.zenith);
  gl.uniform3fv(U.uSun, L.sun); gl.uniform3fv(U.uSunCol, L.sunCol); gl.uniform1f(U.uExposure, L.exposure); gl.uniform1f(U.uFlipY, flip);
  gl.depthMask(false); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.depthMask(true);
}

let FOG_D = .0025;
let season = 'autumn', mixNow = 0, mixFrom = 0, mixTo = 0, tr = 1, lFrom = null, lTo = null, partSwapped = true;
function setSeason(next) {
  if (!LIGHTS[next] || next === season) return;
  if (tr < 1) { mixNow = mixTo; Object.assign(L, lTo); tr = 1; }
  const cols = seasonColors(next);
  const intoB = mixNow < .5;                      // write the new season into whichever stream is hidden
  gl.bindBuffer(gl.ARRAY_BUFFER, intoB ? COL_B : COL_A); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cols);
  mixFrom = mixNow; mixTo = intoB ? 1 : 0;
  lFrom = JSON.parse(JSON.stringify(L)); delete lFrom.sun; lTo = LIGHTS[next];
  season = next; tr = (REDUCE || TEST) ? .999 : 0; partSwapped = false;
}
function stepSeason(dt) {
  if (tr >= 1) return;
  tr = Math.min(1, tr + dt / 1.8);
  const e = tr < .5 ? 4 * tr * tr * tr : 1 - Math.pow(-2 * tr + 2, 3) / 2;
  mixNow = mixFrom + (mixTo - mixFrom) * e;
  Object.assign(L, lerpL(lFrom, lTo, e));
  if (!partSwapped && tr > .45) { PART = PARTICLES[season]; paintParticles(); partSwapped = true; }
  if (TEST) { tr = 1; mixNow = mixTo; Object.assign(L, lTo); PART = PARTICLES[season]; paintParticles(); }
}
function updateLeaves(t, tgt, vis) {
  let o = 0; const d = leafData;
  for (const f of leaves) {
    if (f.i >= LEAVES * PART.frac) { for (let k = 0; k < 6; k++) { d.fill(0, o, o + 9); o += 9; } continue; }
    const fall = (t * f.sp * 1.1 * PART.speed + f.h * 30) % 20;
    const cx = tgt[0] + Math.cos(f.a) * f.r + Math.sin(t * .6 + f.ph) * f.sw;
    const cy = Math.max(.3, tgt[1] + 11 - fall);
    const cz = tgt[2] + Math.sin(f.a) * f.r + Math.cos(t * .5 + f.ph) * f.sw;
    const a = t * f.sp * 1.8 + f.ph, b = t * f.sp * 1.1 + f.ph * 2;
    const fs = f.s * vis * PART.size; const ux = Math.cos(a) * fs, uy = Math.sin(b) * fs * .6, uz = Math.sin(a) * fs;
    const vx = -Math.sin(a) * fs * .55, vy = Math.cos(b) * fs * .5, vz = Math.cos(a) * fs * .55;
    const P = [[cx - ux - vx, cy - uy - vy, cz - uz - vz], [cx + ux - vx, cy + uy - vy, cz + uz - vz], [cx + ux + vx, cy + uy + vy, cz + uz + vz], [cx - ux + vx, cy - uy + vy, cz - uz + vz]];
    const n = norm([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    for (const k of [0, 1, 2, 0, 2, 3]) { const p = P[k]; d.set([p[0], p[1], p[2], n[0], n[1], n[2], f.col[0], f.col[1], f.col[2]], o); o += 9; }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, VA_LEAF.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, leafData);
}

gl.enable(gl.DEPTH_TEST);
let shadowDirty = true, smooth = 0, last = performance.now(), px = 0, py = 0, mx = 0, my = 0;
addEventListener('pointermove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });
const easeIO = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const g = (window.__garden && window.__garden.progress) || 0;
  const q = clamp(g);
  if (window.__garden && window.__garden.snap) { smooth = q; window.__garden.snap = false; }
  smooth += (q - smooth) * (TEST || REDUCE ? 1 : 1 - Math.exp(-dt * 3.2));
  const u = smooth;
  const [P, T] = camAt(u);
  P[1] = Math.max(P[1], heightAt(P[0], P[2]) + 2.0);
  // intro: we start further back and higher, and dolly in as the portal opens
  const ii = window.__garden && window.__garden.intro != null ? window.__garden.intro : 1, back = 1 - ii;
  if (back > 0) { const dv = norm([P[0] - T[0], P[1] - T[1], P[2] - T[2]]); P[0] += dv[0] * back * 260; P[1] += dv[1] * back * 260 + back * 60; P[2] += dv[2] * back * 260; }
  px += (mx - px) * (1 - Math.exp(-dt * 2.5)); py += (my - py) * (1 - Math.exp(-dt * 2.5));
  const sway = TEST ? 0 : (1 - sstep(.96, 1, u)) * (1 - sstep(40, 140, P[1]) * .7);
  const t = TEST ? 3.0 : now / 1000;
  const drift = REDUCE || TEST ? 0 : Math.sin(t * .35) * .25;
  const eye = [P[0] + px * 1.8 * sway, P[1] - py * 1.0 * sway + drift * sway, P[2]];
  const tgt = [T[0] + px * 2.6 * sway, T[1] - py * 1.4 * sway, T[2]];
  const aspect = W / H;
  const fovY = (window.__FOVY || 44) * Math.PI / 180 * (aspect < 1 ? 1.45 : aspect < 1.3 ? 1.18 : 1) * (1 + .22 * back);
  const PROJ = M.persp(fovY, aspect, .3, 3200);
  const VP = M.mul(PROJ, M.look(eye, tgt, [0, 1, 0]));
  FOG_D = (.0019 - .0012 * sstep(10, 200, eye[1])) * L.fogMul * (1 - sstep(.97, 1, u) * .3);
  stepSeason(dt);
  updateLeaves(t, eye.map((e, i) => e + (tgt[i] - e) * .35), (1 - sstep(.975, .995, u)) * (1 - sstep(30, 70, eye[1])));
  if (Math.hypot(tgt[0] - LC[0], tgt[2] - LC[2]) > 28) { aimShadow(tgt); shadowDirty = true; }

  if (shadowDirty) { // static scene: the shadow map only needs one pass (leaves cast none)
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB); gl.viewport(0, 0, SH, SH); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(P_DEPTH.p); gl.uniformMatrix4fv(P_DEPTH.U.uLVP, false, LVP);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    gl.bindVertexArray(VA_SCENE.v); gl.drawArrays(gl.TRIANGLES, 0, sceneCount);
    gl.disable(gl.POLYGON_OFFSET_FILL); shadowDirty = false;
  }
  // reflection pass (only while the pool is close enough to read)
  gl.bindFramebuffer(gl.FRAMEBUFFER, reflFB); gl.viewport(0, 0, RW, RH); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const VPr = M.mul(VP, REFLECT);
  drawSky(VPr, 1.0);
  if (WATER_CENTRES.some(c => Math.hypot(eye[0] - c[0], eye[1], eye[2] - c[1]) < 170)) drawScene(VP, REFLECT, WATER_Y - .02, eye);
  // main pass
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawSky(VP, 1.0);
  drawScene(VP, I4, -1e4, eye);
  { const { p, U } = P_WATER; gl.useProgram(p);
    gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uTime, t); gl.uniform1f(U.uExposure, L.exposure); gl.uniform1f(U.uFogD, FOG_D);
    gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uSun, L.sun); gl.uniform3fv(U.uSunCol, L.sunCol); gl.uniform3fv(U.uDeep, L.deep); gl.uniform3fv(U.uFog, L.fog); gl.uniform1f(U.uIce, L.ice);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, reflTex); gl.uniform1i(U.uRefl, 0);
    gl.bindVertexArray(VA_WATER.v); gl.drawArrays(gl.TRIANGLES, 0, WATER_COUNT); }
  if (!TEST) {
    // adaptive resolution: drop the pixel ratio if frames run long, nudge it back when there is headroom
    ft = ft * .92 + dt * .08;
    if (++fc % 90 === 0) {
      if (ft > 1 / 38 && scaleQ > .55) { scaleQ -= .12; resize(); }
      else if (ft < 1 / 57 && scaleQ < 1) { scaleQ = Math.min(1, scaleQ + .06); resize(); }
    }
    requestAnimationFrame(frame);
  }
}
let ft = 1 / 60, fc = 0;
window.__garden3d = { ok: true, tris: sceneCount / 3, frame: () => frame(performance.now()), setSeason, get season() { return season; }, stations: STATIONS, camAt };
document.documentElement.classList.add('gl-ready');
if (TEST) frame(performance.now()); else requestAnimationFrame(frame);
})();

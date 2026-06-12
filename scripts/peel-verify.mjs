// 数值验证"穿透度加权外鼓贝塞尔"剥橘子路径是否消除穿模
// 用法：node scripts/peel-verify.mjs
//
// 检查项（每种投影 × 每个 uPeelStrength）：
//   1. 端点精确：B(0) == P0（球面）、B(1) == P2（平面）
//   2. 接缝"清扫者"全程在球外：|lon|>=120° 的顶点，min_t |B(t)| >= 1（防穿模核心保证）
//   3. 赤道不自相交：lat=0 的等距 lon 折线在 peel 中段不发生非邻接段相交（原 bug 的直接检验）
//   4. 目标在球外却钻入球：|P2|>=1 但路径半径 < 1 的顶点计数
//   5. 正射南极 d 门控回归：南极 P0≈P2 时 dGate 把 L→0，不引入新穿模（应=0）
//
// 注意：缓动(easeInOutCubic)与纬度延迟只改变 slider→t 的映射，不改变每个顶点走过的路径形状，
//       故路径形状验证直接用 t∈[0,1]，与动画时序无关。
//       路径求值调用真实 src/utils/peel.js 的 peelPath（消除副本漂移）。

import { peelPath } from '../src/utils/peel.js';

const PI = Math.PI;
const D2R = PI / 180;

// ===== 向量运算（3D，数组 [x,y,z]；仅保留 verifyProjection 仍用的两个） =====
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vLen = (a) => Math.hypot(a[0], a[1], a[2]);

// ===== 球面坐标 → 笛卡尔（与项目约定一致：lon 0° → +x） =====
function spherePos(la, lo) {
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

// ===== 5 种投影（JS 副本，逐字对齐 greatCircleRoutes.js / projections.glsl） =====
function jsMercator(lon, lat) {
  return [lon, Math.max(-PI, Math.min(PI, Math.log(Math.tan(PI / 4 + lat / 2)))), 0];
}
function jsPlateCarree(lon, lat) { return [lon, lat, 0]; }
function jsConic(lon, lat) {
  const stdLat = 30 * D2R;
  const n = Math.sin(Math.max(0.1, Math.min(1.4, stdLat)));
  const tanStd = Math.max(0.001, Math.tan(PI / 4 + stdLat / 2));
  const F = Math.cos(stdLat) * Math.pow(tanStd, n) / Math.max(0.01, n);
  const cl = Math.max(-1.3, Math.min(1.56, lat));
  const tanLat = Math.max(0.001, Math.tan(PI / 4 + cl / 2));
  const rho = F / Math.pow(tanLat, n);
  const tanEq = Math.max(0.001, Math.tan(PI / 4));
  const rhoEq = F / Math.pow(tanEq, n);
  const theta = n * lon;
  return [rho * Math.sin(theta), rhoEq - rho * Math.cos(theta), 0];
}
function jsAzOrtho(lon, lat) {
  const z = Math.min(Math.cos(lat) * Math.cos(lon), 0) * 0.08;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), z];
}
function jsAzStereo(lon, lat) {
  const cl = Math.max(-1.4, Math.min(1.4, lat));
  const k = 2 / Math.max(0.01, 1 + Math.sin(cl));
  return [k * Math.cos(cl) * Math.sin(lon), k * Math.cos(cl) * Math.cos(lon), 0];
}

const PROJECTIONS = {
  mercator: jsMercator,
  plateCarree: jsPlateCarree,
  conic: jsConic,
  'azimuthal-ortho': jsAzOrtho,
  'azimuthal-stereo': jsAzStereo,
};

// ===== 采样网格 =====
const STRENGTHS = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
const TS = [];
for (let t = 0; t <= 1.0001; t += 0.02) TS.push(t);
const LATS = []; for (let la = -90; la <= 90; la += 10) LATS.push(la * D2R);
const LONS = []; for (let lo = -180; lo <= 180; lo += 10) LONS.push(lo * D2R);
const SWEEPER_LON = 120 * D2R; // |lon|>=120° 视为"清扫者"（接缝附近、会横扫正面的顶点）

function deg(rad) { return (rad * 180 / PI).toFixed(0); }

function verifyProjection(name, projFn) {
  const out = { projection: name, endpointMaxErr: 0, details: [] };
  // 端点精确性（与强度无关，用 S=1.0 算一次即可）
  for (const la of LATS) for (const lo of LONS) {
    const p0 = spherePos(la, lo);
    const p2 = projFn(lo, la);
    const path = (t) => peelPath(p0, p2, la, lo, t, 1.0);
    out.endpointMaxErr = Math.max(out.endpointMaxErr, vLen(vSub(path(0), p0)), vLen(vSub(path(1), p2)));
  }

  for (const S of STRENGTHS) {
    let sweeperMin = Infinity, sweeperMinV = null;
    let globalMin = Infinity, globalMinV = null;
    let outsidePenetrate = 0;

    for (const la of LATS) for (const lo of LONS) {
      const p0 = spherePos(la, lo);
      const p2 = projFn(lo, la);
      const path = (t) => peelPath(p0, p2, la, lo, t, S);
      let mr = Infinity;
      for (const t of TS) mr = Math.min(mr, vLen(path(t)));
      const vinfo = { lat: deg(la), lon: deg(lo) };
      if (mr < globalMin) { globalMin = mr; globalMinV = vinfo; }
      if (Math.abs(lo) >= SWEEPER_LON && mr < sweeperMin) { sweeperMin = mr; sweeperMinV = vinfo; }
      if (vLen(p2) >= 1 && mr < 0.999) outsidePenetrate++;
    }

    // 赤道自交：lat=0，lon 步长 5°，peel 中段几个 t；用 2D(x,y) 严格相交判定（排除闭合端点重合伪阳性）
    let eqIntersect = false;
    const eqLons = []; for (let lo = -180; lo <= 180; lo += 5) eqLons.push(lo * D2R);
    function seg2dIntersect(a1, a2, b1, b2) {
      // 仅当线段严格相交（交点在两段内部，t,u∈(1e-4,1-1e-4)）返回 true
      const d1x = a2[0]-a1[0], d1y = a2[1]-a1[1];
      const d2x = b2[0]-b1[0], d2y = b2[1]-b1[1];
      const denom = d1x*d2y - d1y*d2x;
      if (Math.abs(denom) < 1e-9) return false;
      const dx = b1[0]-a1[0], dy = b1[1]-a1[1];
      const t = (dx*d2y - dy*d2x) / denom;
      const u = (dx*d1y - dy*d1x) / denom;
      return t > 1e-4 && t < 1-1e-4 && u > 1e-4 && u < 1-1e-4;
    }
    for (const t of [0.25, 0.35, 0.5]) {
      const pts = eqLons.map((lo) => peelPath(spherePos(0, lo), projFn(lo, 0), 0, lo, t, S));
      for (let i = 0; i < pts.length - 1 && !eqIntersect; i++) {
        for (let j = i + 2; j < pts.length - 1 && !eqIntersect; j++) {
          if (seg2dIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) eqIntersect = true;
        }
      }
    }

    out.details.push({
      strength: S,
      sweeperMinRadius: +sweeperMin.toFixed(4),
      sweeperMinVertex: sweeperMinV,
      globalMinRadius: +globalMin.toFixed(4),
      globalMinVertex: globalMinV,
      equatorSelfIntersects: eqIntersect,
      outsidePenetrateCount: outsidePenetrate,
    });
  }

  // 最小安全强度
  let minSafe = null;
  for (const d of out.details) {
    if (d.sweeperMinRadius >= 0.999 && !d.equatorSelfIntersects) { minSafe = d.strength; break; }
  }
  out.minSafeStrength = minSafe;

  // 正射南极 d 门控回归（修正①）：南极 P0≈P2 时 dGate 把 L→0，不引入新穿模（应为 0）
  if (name === 'azimuthal-ortho') {
    let southPolePenetrate = 0;
    for (const lo of LONS) {
      if (Math.abs(lo) < SWEEPER_LON) continue;          // 只看清扫者 |lon|>=120°
      const la = -Math.PI / 2 + 0.01;                     // 南极附近（避开精确极点退化）
      const p0 = spherePos(la, lo), p2 = projFn(lo, la);
      let mr = Infinity;
      for (const t of TS) mr = Math.min(mr, vLen(peelPath(p0, p2, la, lo, t, 1.5)));
      if (mr < 0.999) southPolePenetrate++;
    }
    out.orthoSouthPolePenetrate = southPolePenetrate;     // 修正①生效时应为 0
  }

  return out;
}

const report = {};
let globalMinSafe = 0;
for (const [name, fn] of Object.entries(PROJECTIONS)) {
  const r = verifyProjection(name, fn);
  report[name] = r;
  if (r.minSafeStrength != null) globalMinSafe = Math.max(globalMinSafe, r.minSafeStrength);
}
report.__globalMinSafeStrength__ = globalMinSafe;

process.stdout.write(JSON.stringify(report, null, 2));

// 数值验证"穿透度加权外鼓贝塞尔"剥橘子路径是否消除穿模
// 用法：node scripts/peel-verify.mjs
//
// 检查项（每种投影 × 每个 uPeelStrength × 两种退化分支）：
//   1. 端点精确：B(0) == P0（球面）、B(1) == P2（平面）
//   2. 接缝"清扫者"全程在球外：|lon|>=120° 的顶点，min_t |B(t)| >= 1（防穿模核心保证）
//   3. 赤道不自相交：lat=0 的等距 lon 折线在 peel 中段不发生非邻接段相交（原 bug 的直接检验）
//   4. 目标在球外却钻入球：|P2|>=1 但路径半径 < 1 的顶点计数
//
// 注意：缓动(easeInOutCubic)与纬度延迟只改变 slider→t 的映射，不改变每个顶点走过的路径形状，
//       故路径形状验证直接用 t∈[0,1]，与动画时序无关。

const PI = Math.PI;
const D2R = PI / 180;

// ===== 向量运算（3D，数组 [x,y,z]） =====
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vLen = (a) => Math.hypot(a[0], a[1], a[2]);
const vNorm = (a) => { const l = vLen(a); return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; };

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

// ===== 方案 B：穿透度加权外鼓贝塞尔路径 =====
// 返回求值函数 path(t)。fallback: 'crossDZ'（沿 cross(d,极轴)→±Z，推荐）或 'poleAxisY'（沿极轴 ±Y）
function makePath(p0, p2, la, S, fallback) {
  const r = vNorm(p0);          // 球面径向 = 外法线（p0 已单位化）
  const d = vSub(p2, p0);       // 位移
  const dPerp = vSub(d, vScale(r, vDot(d, r))); // 切向分量
  const pen = Math.max(0, -vDot(d, r));         // 向内穿透深度
  let liftDir;
  if (vLen(dPerp) > 1e-3) {
    liftDir = vNorm(dPerp);
  } else if (fallback === 'crossDZ') {
    const cz = vCross(d, [0, 1, 0]);
    liftDir = vLen(cz) > 1e-3 ? vNorm(cz) : [0, la >= 0 ? 1 : -1, 0];
  } else {
    liftDir = [0, la >= 0 ? 1 : -1, 0];
  }
  const L = S * (0.6 + 0.4 * pen);
  const C = vAdd(p0, vScale(liftDir, L));
  return (t) => {
    const u = 1 - t;
    return vAdd(vAdd(vScale(p0, u * u), vScale(C, 2 * u * t)), vScale(p2, t * t));
  };
}

// 两线段最短距离（采样近似，够用）
function segSegDist(a, b, c, d) {
  let m = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = vAdd(a, vScale(vSub(b, a), t));
    for (let j = 0; j <= 8; j++) {
      const s = j / 8;
      const q = vAdd(c, vScale(vSub(d, c), s));
      m = Math.min(m, vLen(vSub(p, q)));
    }
  }
  return m;
}

// ===== 采样网格 =====
const STRENGTHS = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
const FALLBACKS = ['crossDZ', 'poleAxisY'];
const TS = [];
for (let t = 0; t <= 1.0001; t += 0.02) TS.push(t);
const LATS = []; for (let la = -90; la <= 90; la += 10) LATS.push(la * D2R);
const LONS = []; for (let lo = -180; lo <= 180; lo += 10) LONS.push(lo * D2R);
const SWEEPER_LON = 120 * D2R; // |lon|>=120° 视为"清扫者"（接缝附近、会横扫正面的顶点）

function deg(rad) { return (rad * 180 / PI).toFixed(0); }

function verifyProjection(name, projFn) {
  const out = { projection: name, endpointMaxErr: 0, details: [] };
  // 端点精确性（与强度无关，用 S=1.0、crossDZ 算一次即可）
  for (const la of LATS) for (const lo of LONS) {
    const p0 = spherePos(la, lo);
    const p2 = projFn(lo, la);
    const path = makePath(p0, p2, la, 1.0, 'crossDZ');
    out.endpointMaxErr = Math.max(out.endpointMaxErr, vLen(vSub(path(0), p0)), vLen(vSub(path(1), p2)));
  }

  for (const S of STRENGTHS) {
    for (const fb of FALLBACKS) {
      let sweeperMin = Infinity, sweeperMinV = null;
      let globalMin = Infinity, globalMinV = null;
      let outsidePenetrate = 0;

      for (const la of LATS) for (const lo of LONS) {
        const p0 = spherePos(la, lo);
        const p2 = projFn(lo, la);
        const path = makePath(p0, p2, la, S, fb);
        let mr = Infinity;
        for (const t of TS) mr = Math.min(mr, vLen(path(t)));
        const vinfo = { lat: deg(la), lon: deg(lo) };
        if (mr < globalMin) { globalMin = mr; globalMinV = vinfo; }
        if (Math.abs(lo) >= SWEEPER_LON && mr < sweeperMin) { sweeperMin = mr; sweeperMinV = vinfo; }
        if (vLen(p2) >= 1 && mr < 0.999) outsidePenetrate++;
      }

      // 赤道自相交：lat=0，lon 步长 5°，peel 中段几个 t
      let eqIntersect = false;
      const eqLons = []; for (let lo = -180; lo <= 180; lo += 5) eqLons.push(lo * D2R);
      for (const t of [0.25, 0.35, 0.5]) {
        const pts = eqLons.map((lo) => makePath(spherePos(0, lo), projFn(lo, 0), 0, S, fb)(t));
        for (let i = 0; i < pts.length - 1 && !eqIntersect; i++) {
          for (let j = i + 2; j < pts.length - 1 && !eqIntersect; j++) {
            if (segSegDist(pts[i], pts[i + 1], pts[j], pts[j + 1]) < 1e-3) eqIntersect = true;
          }
        }
      }

      out.details.push({
        strength: S, fallback: fb,
        sweeperMinRadius: +sweeperMin.toFixed(4),
        sweeperMinVertex: sweeperMinV,
        globalMinRadius: +globalMin.toFixed(4),
        globalMinVertex: globalMinV,
        equatorSelfIntersects: eqIntersect,
        outsidePenetrateCount: outsidePenetrate,
      });
    }
  }

  // 推荐 crossDZ 下的最小安全强度
  let minSafe = null;
  for (const d of out.details) {
    if (d.fallback !== 'crossDZ') continue;
    if (d.sweeperMinRadius >= 0.999 && !d.equatorSelfIntersects) { minSafe = d.strength; break; }
  }
  out.minSafeStrength_crossDZ = minSafe;
  return out;
}

const report = {};
let globalMinSafe = 0;
for (const [name, fn] of Object.entries(PROJECTIONS)) {
  const r = verifyProjection(name, fn);
  report[name] = r;
  if (r.minSafeStrength_crossDZ != null) globalMinSafe = Math.max(globalMinSafe, r.minSafeStrength_crossDZ);
}
report.__globalMinSafeStrength_crossDZ__ = globalMinSafe;

process.stdout.write(JSON.stringify(report, null, 2));

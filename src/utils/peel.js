// 剥橘子路径数学（穿透度加权外鼓二次贝塞尔）— 纯 JS 单源，无 THREE 依赖
// GLSL 镜像在 src/shaders/common/projections.glsl 的 peelPath()，二者由 scripts/glsl-lint.mjs 护栏守护一致。
// 详见 docs/superpowers/specs/2026-06-12-peeling-animation-fix-design.md

// ===== 关键常量（与 GLSL 对齐；glsl-lint 断言两端一致）=====
export const PEEL_DGATE_MAX = 0.05;   // 修正① d 门控：|d|<此值时 L→0（极点/正射南极）
export const PEEL_LONW_A = 0.3;       // lonWeight smoothstep 下限（必须 [0.3,1.0]，上调会在 120° 边界穿模）
export const PEEL_LONW_B = 1.0;       // lonWeight smoothstep 上限
export const PEEL_LATBAND = 0.0349;   // 修正② 接缝 y 混合纬度带宽（2°，弧度）
export const PEEL_LONBAND = 2.967;    // 接缝 y 混合经度带宽（170°，弧度）

// ===== 3D 向量运算（[x,y,z] 数组）=====
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a); return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; };

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 穿透度加权外鼓二次贝塞尔剥橘子路径
 * @param {[number,number,number]} p0 - 球面位置（单位球）
 * @param {[number,number,number]} p2 - 平面投影目标
 * @param {number} lat - 纬度（弧度）
 * @param {number} lon - 经度（弧度）
 * @param {number} t - 缓动后的局部进度 ∈[0,1]
 * @param {number} strength - uPeelStrength（默认 1.5）
 * @returns {[number,number,number]} t 处的变形位置；t=0→p0，t=1→p2
 */
export function peelPath(p0, p2, lat, lon, t, strength) {
  const PI = Math.PI;
  const r = norm3(p0);
  const d = sub3(p2, p0);
  const dLen = len3(d);
  const dGate = smoothstep(0.0, PEEL_DGATE_MAX, dLen);          // 修正①

  const dr = dot3(d, r);
  const dPerp = sub3(d, scale3(r, dr));                          // 位移切向分量
  const pen = Math.max(0, -dr);                                  // 向内穿透深度

  const poleY = [0, lat >= 0 ? 1 : -1, 0];                       // 退化分支：极轴 ±Y（赤道取 +1）
  const liftDir0 = len3(dPerp) > 1e-3 ? norm3(dPerp) : poleY;

  const latGate = 1 - smoothstep(0, PEEL_LATBAND, Math.abs(lat)); // 修正② 接缝窄带 y 混合
  const lonGate = smoothstep(PEEL_LONBAND, PI, Math.abs(lon));
  const yBlend = latGate * lonGate;
  const liftDir = norm3(add3(scale3(liftDir0, 1 - yBlend), scale3(poleY, yBlend)));

  const lonWeight = smoothstep(PEEL_LONW_A, PEEL_LONW_B, Math.abs(lon) / PI);
  const L = strength * (0.6 + 0.4 * pen) * lonWeight * dGate;
  const C = add3(p0, scale3(liftDir, L));

  const u = 1 - t;                                               // de Casteljau 二次贝塞尔
  return add3(add3(scale3(p0, u * u), scale3(C, 2 * u * t)), scale3(p2, t * t));
}

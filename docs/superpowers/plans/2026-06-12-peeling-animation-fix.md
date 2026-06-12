# 剥橘子穿模修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把剥橘子展开动画从"直线插值穿过"改为"穿透度加权外鼓贝塞尔"，几何性消除墨卡托/等距柱状/圆锥下的表面穿模，并修复因此失配的光照法线。

**Architecture:** 新增纯 JS 单源 `src/utils/peel.js`（剥橘子路径数学，含 d 门控 / 接缝 y 混合 / lonWeight 三个修正项），GLSL `projections.glsl` 镜像同名 `peelPath`（由 `glsl-lint.mjs` 护栏守护一致）。`globe.vert` 位置改用 `peelPath`，法线/切线/副切线从贝塞尔曲面数值偏导重算（端点天然匹配球面/平面切线基，全程连续）。`indicator.vert` 与 `greatCircleRoutes.js` 各自同步复刻路径，保持指标与地球贴合。

**Tech Stack:** Three.js ^0.170、GLSL（`#include` 共享）、Vite、pnpm。无 JS 测试框架——验证靠 `pnpm lint:glsl` + `scripts/peel-verify.mjs`（数值 oracle）+ 浏览器实机（`pnpm dev` → localhost:3000）。

**Spec:** `docs/superpowers/specs/2026-06-12-peeling-animation-fix-design.md`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/utils/peel.js` | 新建 | 纯 JS 剥橘子路径 `peelPath` + 常量（JS 单源，无 THREE 依赖，可被 node 直接 import） |
| `src/shaders/common/projections.glsl` | 修改 | 镜像 `peelPath` + 新增 `applyProjection`（从 indicator.vert 上提）、`sphereFromLatLon`、`peeledAt` |
| `src/shaders/globe.vert` | 修改 | 位置用 `peelPath`；法线/切线/副切线数值重算；加 `uPeelStrength` uniform |
| `src/shaders/indicator.vert` | 修改 | 位置用 `peelPath`；删本地 `applyProjection`（改用 include）；加 `uPeelStrength` uniform |
| `src/indicators/greatCircleRoutes.js` | 修改 | `computeLabelPosition` 改用 `peel.js` 的 `peelPath` |
| `src/main.js` | 修改 | `sharedUniforms` 加 `uPeelStrength`（默认 1.5）；globe uniforms 引用；滑块接线 |
| `index.html` | 修改 | `#controls` 加剥橘子强度滑块 |
| `scripts/glsl-lint.mjs` | 修改 | 加贝塞尔常量 GLSL↔JS 一致性护栏 |
| `scripts/peel-verify.mjs` | 修改 | 改用 `peel.js`（测真实代码）；修赤道自交检测器；加正射南极回归 |
| `CLAUDE.md` | 修改 | 同步 uniform 列表与"半单源"说明 |

---

## Task 1: 创建纯 JS 剥橘子路径单源 `src/utils/peel.js`

**Files:**
- Create: `src/utils/peel.js`

- [ ] **Step 1: 写 `src/utils/peel.js`**

```js
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
```

- [ ] **Step 2: node 自检（端点精确 + 接缝清扫者半径≥1）**

Run:
```bash
node --input-type=module -e "
import { peelPath } from './src/utils/peel.js';
const P0 = (la,lo)=>[Math.cos(la)*Math.cos(lo), Math.sin(la), -Math.cos(la)*Math.sin(lo)];
const P2 = (lo,la)=>[lo, Math.log(Math.tan(Math.PI/4+la/2)), 0]; // mercator
const p0=P0(0,Math.PI), p2=P2(Math.PI,0);
const e0=peelPath(p0,p2,0,Math.PI,0,1.5), e1=peelPath(p0,p2,0,Math.PI,1,1.5);
console.log('端点误差', Math.hypot(...sub(e0,p0)), Math.hypot(...sub(e1,p2)));
let minR=9; for(let t=0;t<=1;t+=0.02) minR=Math.min(minR, Math.hypot(...peelPath(p0,p2,0,Math.PI,t,1.5)));
console.log('接缝赤道清扫者最小半径', minR.toFixed(4), '(应 >=1)');
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
"
```
Expected output: `端点误差 0 0` 和 `接缝赤道清扫者最小半径 1.0xxx (应 >=1)`（半径 ≥1 即通过）。

- [ ] **Step 3: Commit**

```bash
git add src/utils/peel.js
git commit -m "feat(peel): 新增纯 JS 剥橘子贝塞尔路径单源 src/utils/peel.js"
```

---

## Task 2: 重构 `scripts/peel-verify.mjs` 用真实 `peel.js`，修赤道检测器，加正射南极回归

> 现脚本（`scripts/peel-verify.mjs`）的向量运算是 v-前缀（`vLen`/`vSub`/`vAdd`/`vScale`/`vDot`/`vCross`/`vNorm`），`makePath` 与 `segSegDist` 都用到它们。重构后 `makePath`/`segSegDist` 删除，仅 `vLen`/`vSub` 仍被 `verifyProjection` 使用——保留这两个，其余向量函数随 `makePath`/`segSegDist` 一起删。

**Files:**
- Modify: `scripts/peel-verify.mjs`

- [ ] **Step 1: 顶部导入 `peelPath`，删除 `makePath` 函数**

在 `scripts/peel-verify.mjs` 文件最顶部加：

```js
import { peelPath } from '../src/utils/peel.js';
```

删除整个 `makePath(p0, p2, la, S, fallback)` 函数定义（原约第 56-66 行）。保留 `spherePos`、5 个 `jsXxx` 投影、`PROJECTIONS`、`segSegDist`（暂留，Step 4 后删）、采样常量（`STRENGTHS`/`FALLBACKS`/`TS`/`LATS`/`LONS`/`SWEEPER_LON`）、`deg`、`verifyProjection` 骨架。

- [ ] **Step 2: `verifyProjection` 内所有 `makePath(...)` 调用改为 `peelPath`**

原代码里 `makePath` 出现在 3 处，逐一替换（`la`/`lo` 在循环作用域内可见）：

端点精确性段：
```js
const path = (t) => peelPath(p0, p2, la, lo, t, 1.0);
out.endpointMaxErr = Math.max(out.endpointMaxErr, vLen(vSub(path(0), p0)), vLen(vSub(path(1), p2)));
```

半径扫描段（在 `for (const la of LATS) for (const lo of LONS)` 内）：
```js
const path = (t) => peelPath(p0, p2, la, lo, t, S);
```
其下 `vLen(path(t))` 等保持不变。

赤道自交段的求值改为 `peelPath(spherePos(0, lo), projFn(lo, 0), 0, lo, t, S)`（见 Step 4 整段替换）。

- [ ] **Step 3: 删除 `FALLBACKS` 双层循环与 `fallback` 字段**

把 `verifyProjection` 中 `for (const S of STRENGTHS) { for (const fb of FALLBACKS) { ... } }` 改为单层 `for (const S of STRENGTHS) { ... }`。`out.details.push({...})` 对象里删掉 `fallback` 字段。把 `minSafeStrength_crossDZ` 改名 `minSafeStrength`，去掉 `d.fallback !== 'crossDZ'` 条件：

```js
let minSafe = null;
for (const d of out.details) {
  if (d.sweeperMinRadius >= 0.999 && !d.equatorSelfIntersects) { minSafe = d.strength; break; }
}
out.minSafeStrength = minSafe;
```

同步：删除常量 `const FALLBACKS = [...]`；底部 `report.__globalMinSafeStrength_crossDZ__` → `__globalMinSafeStrength__`，`r.minSafeStrength_crossDZ` → `r.minSafeStrength`。

- [ ] **Step 4: 修赤道自交检测器（真·2D 相交判定，排除闭合端点重合伪阳性）**

把 `verifyProjection` 中原赤道自交段（用 `segSegDist < 1e-3` 的那段）整段替换为：

```js
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
```

替换后 `segSegDist` 不再被引用——删除 `segSegDist` 函数定义，并删除向量区里仅被它使用的 `vAdd`/`vScale`。`makePath` 删除后 `vDot`/`vCross`/`vNorm` 也不再被引用，一并删除。**仅保留 `vLen`、`vSub`**（`verifyProjection` 仍用）。

- [ ] **Step 5: 加正射南极 d 门控回归断言**

在 `verifyProjection` 末尾、`return out;` 之前加（验证修正①——南极 P0≈P2 时 dGate 把 L→0，不引入新穿模）：

```js
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
```

- [ ] **Step 6: 运行验证脚本**

Run: `node scripts/peel-verify.mjs`
Expected:
- `mercator`/`plateCarree`/`conic` 的 `minSafeStrength` ≤ 1.0，且 S=1.5 的 `sweeperMinRadius` ≥ 1、`equatorSelfIntersects`=false、`outsidePenetrateCount`=0。
- `azimuthal-ortho`/`azimuthal-stereo` 的 `equatorSelfIntersects` 全为 **false**（修了伪阳性），`minSafeStrength`=null（投影固有，预期）。
- `azimuthal-ortho.orthoSouthPolePenetrate` = **0**（修正①生效）。
- `__globalMinSafeStrength__` ≤ 1.0。

- [ ] **Step 7: Commit**

```bash
git add scripts/peel-verify.mjs
git commit -m "test(peel): peel-verify 改用真实 peel.js + 修赤道检测器 + 正射南极回归"
```

---

## Task 3: GLSL 基础——`projections.glsl` 加路径函数；`globe.vert` 接线（位置+法线+uniform）

**Files:**
- Modify: `src/shaders/common/projections.glsl`
- Modify: `src/shaders/globe.vert`
- Modify: `src/shaders/indicator.vert`（仅删本地 `applyProjection`）

- [ ] **Step 1: `projections.glsl` 末尾追加共享函数**

在 `src/shaders/common/projections.glsl` 末尾（`projectAzimuthal` 之后）追加：

```glsl
// ===== 投影分派（globe.vert / indicator.vert 共用）=====
vec3 applyProjection(float lon, float lat) {
  if (uProjectionID < 0.5) return projectMercator(lon, lat);
  else if (uProjectionID < 1.5) return projectPlateCarree(lon, lat);
  else if (uProjectionID < 2.5) return projectConic(lon, lat, uConicStdLat);
  else return projectAzimuthal(lon, lat, uAzimuthalType);
}

// 球面位置（lon 0° → +x，与 SphereGeometry 约定一致）
vec3 sphereFromLatLon(float lat, float lon) {
  return vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
}

// ===== 剥橘子路径（穿透度加权外鼓二次贝塞尔）=====
// 与 src/utils/peel.js 的 peelPath() 逐项一致，由 scripts/glsl-lint.mjs 护栏守护。
const float PEEL_DGATE_MAX = 0.05;
const float PEEL_LONW_A = 0.3;
const float PEEL_LONW_B = 1.0;
const float PEEL_LATBAND = 0.0349;   // 2°
const float PEEL_LONBAND = 2.967;    // 170°

vec3 peelPath(vec3 p0, vec3 p2, float lat, float lon, float t, float strength) {
  vec3 r = normalize(p0);
  vec3 d = p2 - p0;
  float dLen = length(d);
  float dGate = smoothstep(0.0, PEEL_DGATE_MAX, dLen);

  float dr = dot(d, r);
  vec3 dPerp = d - dr * r;
  float pen = max(0.0, -dr);

  vec3 poleY = vec3(0.0, lat >= 0.0 ? 1.0 : -1.0, 0.0);
  vec3 liftDir0 = length(dPerp) > 1e-3 ? normalize(dPerp) : poleY;

  float latGate = 1.0 - smoothstep(0.0, PEEL_LATBAND, abs(lat));
  float lonGate = smoothstep(PEEL_LONBAND, PI, abs(lon));
  float yBlend = latGate * lonGate;
  vec3 liftDir = normalize(mix(liftDir0, poleY, yBlend));

  float lonWeight = smoothstep(PEEL_LONW_A, PEEL_LONW_B, abs(lon) / PI);
  float L = strength * (0.6 + 0.4 * pen) * lonWeight * dGate;
  vec3 C = p0 + L * liftDir;

  float u = 1.0 - t;
  return u * u * p0 + 2.0 * u * t * C + t * t * p2;
}

// 给定 lat/lon/t 求 peeled 位置（数值法线用：对 lat/lon 求邻域）
vec3 peeledAt(float lat, float lon, float t, float strength) {
  vec3 sp = sphereFromLatLon(lat, lon);
  vec3 fp = applyProjection(lon, lat);
  return peelPath(sp, fp, lat, lon, t, strength);
}
```

> 注：`applyProjection` 引用的 `uProjectionID`/`uConicStdLat`/`uAzimuthalType` 在 `globe.vert`/`indicator.vert` 都已声明为 uniform，include 后可见。

- [ ] **Step 2: `indicator.vert` 删除本地 `applyProjection`**

删除 `src/shaders/indicator.vert` 第 20-26 行的本地 `vec3 applyProjection(...)`（现在由 `#include common/projections.glsl` 提供，否则重定义编译错误）。`computeAreaDistortion` 内对 `applyProjection` 的调用保持不变。

- [ ] **Step 3: `globe.vert` 加 `uPeelStrength` uniform**

在 `src/shaders/globe.vert` 顶部 uniform 区（第 9 行 `uAzimuthalType` 之后）加：

```glsl
uniform float uPeelStrength;  // 剥橘子外鼓强度（默认 1.5，范围 1.2~2.0）
```

- [ ] **Step 4: `globe.vert` 位置改用 `peelPath`，flatPos 改用 `applyProjection`**

把 `globe.vert` main 中（原第 39-60 行）：

```glsl
  // 根据投影类型选择目标平面坐标
  vec3 flatPos;
  if (uProjectionID < 0.5) {
    flatPos = projectMercator(longitude, latitude);
  } else if (uProjectionID < 1.5) {
    flatPos = projectPlateCarree(longitude, latitude);
  } else if (uProjectionID < 2.5) {
    flatPos = projectConic(longitude, latitude, uConicStdLat);
  } else {
    flatPos = projectAzimuthal(longitude, latitude, uAzimuthalType);
  }
```

替换为：

```glsl
  // 根据投影类型选择目标平面坐标（共享分派）
  vec3 flatPos = applyProjection(longitude, latitude);
```

把（原第 59-60 行）：

```glsl
  // 在球面和平面之间插值位置
  vec3 finalPos = mix(spherePos, flatPos, localProgress);
```

替换为：

```glsl
  // 在球面和平面之间用"穿透度加权外鼓贝塞尔"变形（消除接缝穿模）
  vec3 finalPos = peelPath(spherePos, flatPos, latitude, longitude, localProgress, uPeelStrength);
```

- [ ] **Step 5: `globe.vert` 法线/切线/副切线改为数值重算**

把 `globe.vert` main 中（原第 62-89 行，从 `// 法线插值` 到 `vBitangent = normalize(normalMatrix * finalBitangent);`）**整段替换**为：

```glsl
  // ===== 法线/切线/副切线：从贝塞尔曲面数值偏导重算 =====
  // 端点天然匹配：t=0 → 球面切线基（cross(∂lon,∂lat)=球面外法线），t=1 → 平面切线基（+Z）。
  // 故全程连续，无需端点线性混合（spec §5 的 [0.15,0.85] 方案被此简化替代；A/B 实机确认光照正确）。
  float nEps = 0.001;
  vec3 pLat = peeledAt(latitude + nEps, longitude, localProgress, uPeelStrength);
  vec3 pLon = peeledAt(latitude, longitude + nEps, localProgress, uPeelStrength);
  vec3 T_lon = pLon - finalPos;                 // 经度切向（对应 sphereTangent）
  vec3 T_lat = pLat - finalPos;                 // 纬度切向（对应 sphereBitangent）
  vec3 finalNormal   = normalize(cross(T_lon, T_lat));  // cross 顺序保证 t=0 朝外、t=1 朝 +Z
  vec3 finalTangent   = normalize(T_lon);
  vec3 finalBitangent = normalize(T_lat);

  vNormal = normalize(normalMatrix * finalNormal);
  vTangent = normalize(normalMatrix * finalTangent);
  vBitangent = normalize(normalMatrix * finalBitangent);
```

（原计算 `sphereTangent`/`sphereBitangent`/`flatTangent`/`flatBitangent`/`flatNormal` 的中间变量随整段删除；`cosLat`/`sinLat`/`cosLon`/`sinLon` 若仅服务于此段也一并删除——它们原本在第 70-73 行，确认无其它引用后删除。）

- [ ] **Step 6: 跑 GLSL lint**

Run: `pnpm lint:glsl`
Expected: `globe.vert` 与 `indicator.vert` 均 `✓`，0 错误。（`globe.frag` 等不变。）

- [ ] **Step 7: 实机 A/B 验证（核心光照检查）**

Run: `pnpm dev`，打开 `http://localhost:3000`。
1. 默认墨卡托投影，缓慢拖动底部"球体→平面"滑块 0→100%，反复在 20%~50% 区间停留：
   - **穿模**：±180° 接缝处表面**不再互相穿过**（对比修改前 ~30% 的穿模）。✓
   - **光照**：剥橘子中段（~40%）地球表面**无错误高光带/黑斑**，法线贴图凹凸方向与球态一致（陆地迎光面一致）。✗ 若凹凸反向或高光异常 → 把 `finalBitangent` 改为 `normalize(cross(finalNormal, finalTangent))`（手性翻转）再验；仍异常则回退到 spec §5 的 [0.15,0.85] 线性混合方案。
2. 切到等距柱状、圆锥投影重复 1，确认都无穿模。
3. 切到方位（正射/立体）投影：接受终态前后半球重叠为已知限制（投影固有），仅确认剥橘子过程不比现状更差。

记录 A/B 截图（spec §8 残留④要求）。

- [ ] **Step 8: Commit**

```bash
git add src/shaders/common/projections.glsl src/shaders/globe.vert src/shaders/indicator.vert
git commit -m "feat(peel): GLSL peelPath + globe.vert 位置/法线接线（消除穿模 + 光照法线重算）"
```

---

## Task 4: `indicator.vert` 位置用 `peelPath`，加 `uPeelStrength` uniform

**Files:**
- Modify: `src/shaders/indicator.vert`

- [ ] **Step 1: 加 uniform**

在 `src/shaders/indicator.vert` 顶部 uniform 区（第 7 行 `uAzimuthalType` 之后）加：

```glsl
uniform float uPeelStrength;
```

- [ ] **Step 2: 位置改用 `peelPath`**

把 `indicator.vert` main 中（原第 66-67 行）：

```glsl
  // 球面 ↔ 平面插值
  vec3 finalPos = mix(spherePos, flatPos, localProgress);
```

替换为：

```glsl
  // 球面 ↔ 平面：穿透度加权外鼓贝塞尔（与 globe.vert 一致，指标贴合地球表面）
  vec3 finalPos = peelPath(spherePos, flatPos, latitude, longitude, localProgress, uPeelStrength);
```

（朝索/面积/航线的背面剔除法线 `interpNormal` 保持原线性插值——精度要求低，spec §5 允许。）

- [ ] **Step 3: lint + 实机**

Run: `pnpm lint:glsl` → `indicator.vert` `✓`，0 错误。
Run: `pnpm dev`，打开左侧面板开启"朝索变形椭圆"与"面积比较"，拖动滑块：朝索椭圆/国家轮廓在剥橘子全程**贴合地球表面**（不悬空、不穿球）。✓

- [ ] **Step 4: Commit**

```bash
git add src/shaders/indicator.vert
git commit -m "feat(peel): indicator.vert 位置改用 peelPath + uPeelStrength"
```

---

## Task 5: `greatCircleRoutes.js` 的 `computeLabelPosition` 改用 `peel.js`

**Files:**
- Modify: `src/indicators/greatCircleRoutes.js`

- [ ] **Step 1: 导入 `peelPath`**

在 `src/indicators/greatCircleRoutes.js` 顶部 import 区（第 4 行 `import { PI, DEG2RAD } from '../utils/math.js';` 之后）加：

```js
import { peelPath } from '../utils/peel.js';
```

- [ ] **Step 2: `computeLabelPosition` 改用 `peelPath`**

把（原第 230-243 行）：

```js
function computeLabelPosition(lat, lon, progress, uniforms) {
  const sphere = latLonToXYZ(lat, lon);
  const flat = jsApplyProjection(lon, lat, uniforms);
  const spreadDelay = uniforms.uSpreadDelay.value;
  const normalizedLat = Math.abs(lat) / (PI / 2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = Math.max(0, Math.min(1, (progress - localDelay) / (1 - spreadDelay + 0.001)));
  const eased = easeInOutCubic(localProgress);
  return [
    sphere[0] + (flat[0] - sphere[0]) * eased,
    sphere[1] + (flat[1] - sphere[1]) * eased,
    sphere[2] + (flat[2] - sphere[2]) * eased,
  ];
}
```

替换为：

```js
function computeLabelPosition(lat, lon, progress, uniforms) {
  const sphere = latLonToXYZ(lat, lon);
  const flat = jsApplyProjection(lon, lat, uniforms);
  const spreadDelay = uniforms.uSpreadDelay.value;
  const normalizedLat = Math.abs(lat) / (PI / 2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = Math.max(0, Math.min(1, (progress - localDelay) / (1 - spreadDelay + 0.001)));
  const eased = easeInOutCubic(localProgress);
  // 与 globe.vert/indicator.vert 的 peelPath 一致（含 d 门控/接缝 y 混合/lonWeight）
  return peelPath(sphere, flat, lat, lon, eased, uniforms.uPeelStrength.value);
}
```

- [ ] **Step 3: 实机**

Run: `pnpm dev`，开启左侧"大圆航线"，拖动滑块在 20%~60% 停留：城市标签精灵与发光粒子**与大圆航线（GPU 投影）对齐**，剥橘子中段不错位。✓

- [ ] **Step 4: Commit**

```bash
git add src/indicators/greatCircleRoutes.js
git commit -m "feat(peel): 城市标签/发光粒子位置改用共享 peelPath（消除 JS 副本漂移）"
```

---

## Task 6: `main.js` 加 `uPeelStrength` 共享 uniform + `index.html` 强度滑块

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`

- [ ] **Step 1: `sharedUniforms` 加 `uPeelStrength`**

在 `src/main.js`（第 23-29 行 `sharedUniforms` 对象内，`uAzimuthalType` 之后）加：

```js
  uPeelStrength: { value: 1.5 },   // 剥橘子外鼓强度（1.2~2.0，默认 1.5）
```

- [ ] **Step 2: globe uniforms 引用**

在 `createGlobe` 的 `uniforms` 对象内（第 85-100 行，`uAzimuthalType` 之后）加：

```js
    uPeelStrength: sharedUniforms.uPeelStrength,
```

- [ ] **Step 3: `index.html` 加强度滑块**

在 `index.html` 的 `<div id="controls">`（第 437-442 行）内，`<span id="progress-value">0%</span>` 之后追加：

```html
      <label style="margin-left: 12px; opacity: 0.5;">剥开</label>
      <input type="range" id="peel-slider" min="120" max="200" value="150" style="-webkit-appearance:none;appearance:none;width:90px;height:5px;border-radius:3px;background:rgba(255,255,255,0.2);outline:none;cursor:pointer;" />
      <span id="peel-value" style="color:#fff;font-family:'SF Mono',monospace;font-size:13px;min-width:32px;text-align:right;opacity:0.6;">1.5</span>
```

- [ ] **Step 4: `main.js` 接线滑块**

在 `src/main.js` 滑块交互区（第 353-359 行 progress 滑块监听之后）加：

```js
const peelSlider = document.getElementById('peel-slider');
const peelLabel = document.getElementById('peel-value');
peelSlider.addEventListener('input', (e) => {
  sharedUniforms.uPeelStrength.value = parseInt(e.target.value) / 100;
  peelLabel.textContent = (parseInt(e.target.value) / 100).toFixed(1);
});
```

- [ ] **Step 5: 实机**

Run: `pnpm dev`：底部控制条出现"剥开"滑块（范围 1.2~2.0，默认 1.5）。拖到 1.2（外鼓弱）→ 接缝附近剥橘子更"贴"；拖到 2.0（外鼓强）→ 表面翻起更明显；全程无穿模。✓

- [ ] **Step 6: Commit**

```bash
git add src/main.js index.html
git commit -m "feat(peel): uPeelStrength 共享 uniform + 底部剥开强度滑块（1.2~2.0）"
```

---

## Task 7: `glsl-lint.mjs` 加贝塞尔常量一致性护栏

**Files:**
- Modify: `scripts/glsl-lint.mjs`

- [ ] **Step 1: 在 clamp 护栏段之后追加 peel 常量断言**

在 `scripts/glsl-lint.mjs` 末尾（第 131 行 conic 断言块之后、`process.exit(...)` 之前）加：

```js
// ── 剥橘子贝塞尔常量一致性护栏（peel.js ↔ projections.glsl）──
const peelJsSrc = readFileSync(resolve(rootDir, 'src/utils/peel.js'), 'utf-8');

function assertConst(name, jsRe, glslRe) {
  const jsVal = extractNum(jsRe, peelJsSrc);
  const glslVal = extractNum(glslRe, glslProjSrc);
  if (jsVal && glslVal && jsVal !== glslVal) {
    console.log(`\x1b[31m✗ 贝塞尔常量漂移\x1b[0m: ${name} peel.js=${jsVal} ≠ projections.glsl=${glslVal}`);
    console.log(`  请对齐 src/utils/peel.js 与 src/shaders/common/projections.glsl`);
    errorCount++;
  }
}
assertConst('PEEL_DGATE_MAX', /PEEL_DGATE_MAX\s*=\s*([\d.]+)/, /PEEL_DGATE_MAX\s*=\s*([\d.]+)/);
assertConst('PEEL_LONW_A',    /PEEL_LONW_A\s*=\s*([\d.]+)/,    /PEEL_LONW_A\s*=\s*([\d.]+)/);
assertConst('PEEL_LONW_B',    /PEEL_LONW_B\s*=\s*([\d.]+)/,    /PEEL_LONW_B\s*=\s*([\d.]+)/);
assertConst('PEEL_LATBAND',   /PEEL_LATBAND\s*=\s*([\d.]+)/,   /PEEL_LATBAND\s*=\s*([\d.]+)/);
assertConst('PEEL_LONBAND',   /PEEL_LONBAND\s*=\s*([\d.]+)/,   /PEEL_LONBAND\s*=\s*([\d.]+)/);
```

- [ ] **Step 2: 跑 lint，确认通过**

Run: `pnpm lint:glsl`
Expected: 0 错误（5 个 peel 常量两端一致）。

- [ ] **Step 3: 验证护栏能抓漂移（负向测试）**

临时把 `projections.glsl` 的 `PEEL_LONW_A` 改成 `0.4`，跑 `pnpm lint:glsl`：
Expected: 输出 `✗ 贝塞尔常量漂移: PEEL_LONW_A peel.js=0.3 ≠ projections.glsl=0.4`，并以非零码退出。
然后**改回 `0.3`**，再跑确认 0 错误。

- [ ] **Step 4: Commit**

```bash
git add scripts/glsl-lint.mjs
git commit -m "test(peel): glsl-lint 加贝塞尔常量 GLSL↔JS 一致性护栏"
```

---

## Task 8: 最终验证 + 更新 `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 全量验证**

Run: `pnpm lint:glsl` → 0 错误。
Run: `node scripts/peel-verify.mjs` → mercator/plateCarree/conic `minSafeStrength`≤1.0、S=1.5 全绿；方位投影赤道自交=false、正射南极回归=0。
Run: `pnpm dev` → 墨卡托/等距柱状/圆锥剥橘子全程无穿模、光照正确、指标贴合、城市精灵对齐、强度滑块工作。

- [ ] **Step 2: 更新 `CLAUDE.md` 的 uniform 列表与说明**

在 `CLAUDE.md`「编码规范」的 uniform 命名列表里，把 `uAzimuthalType` 之后补上 `uPeelStrength`。

在「⚠️ 重要：投影函数的"半单源"维护」一节，把"JS 层有手写副本须手动同步"那条更新为：

```markdown
- **JS 层单源化**：剥橘子路径数学抽到 `src/utils/peel.js`（`peelPath`，纯 JS 无 THREE 依赖），
  `greatCircleRoutes.js` 的 `computeLabelPosition` 直接 import 复用——不再有手写副本漂移。
  GLSL `projections.glsl` 的 `peelPath` 是其镜像。
- **构建期护栏**：`glsl-lint.mjs` 除原有 clamp 边界断言外，新增贝塞尔常量
  （`PEEL_DGATE_MAX`/`PEEL_LONW_A`/`PEEL_LONW_B`/`PEEL_LATBAND`/`PEEL_LONBAND`）
  GLSL↔JS 一致性断言，漂移即 `pnpm lint:glsl` 失败。
```

在「关键实现」加一条：

```markdown
- **剥橘子穿模修复（穿透度加权外鼓贝塞尔）**：变形从直线 `mix` 改为二次贝塞尔，控制点按"向内穿透深度"加权外鼓，
  消除 ±180° 接缝穿模。三个必须修正项：① d 门控（极点/正射南极 P0≈P2 时 L→0）；
  ② 接缝窄带（|lat|<2°∩|lon|>170°）liftDir 沿 ±Y 连续混合；③ 法线/切线从贝塞尔曲面数值偏导重算。
  详见 `docs/superpowers/specs/2026-06-12-peeling-animation-fix-design.md`。
  `uPeelStrength`（默认 1.5，滑块 1.2~2.0）控制外鼓强度。方位投影终态穿模为投影固有（|P2|<1）。
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 同步 CLAUDE.md（peelPath 半单源化、贝塞尔护栏、穿模修复说明）"
```

---

## 完成标准

- `pnpm lint:glsl` 0 错误（含贝塞尔常量护栏）。
- `node scripts/peel-verify.mjs`：mercator/plateCarree/conic 全绿；方位赤道自交=false；正射南极回归=0。
- 浏览器：墨卡托/等距柱状/圆锥剥橘子全程无穿模、光照正确、指标与航线贴合、强度滑块工作。
- 9 处文件改动均已提交，commit 粒度清晰。

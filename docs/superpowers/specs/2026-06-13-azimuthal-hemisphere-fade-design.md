# 方位投影远端半球淡出（单一圆盘）设计

> 用顶点着色器 + alpha 淡出，让方位投影（正射/立体）只保留"有效半球"作为干净的单一圆盘，远端半球在剥开过程中平滑淡出，消除压扁全球时的穿模与重叠。地球与全部指标系统（朝索/面积/航线/精灵/发光粒子）一并处理。

- 分支：`feat/azimuthal-hemisphere-fade`
- 日期：2026-06-13
- 方案：方案 1（远端半球淡出 → 单一圆盘）+ 指标一致性（用户选项 i，含发光粒子改造）

---

## 1. 背景与问题

方位投影（azimuthal）当前在完全展平时存在严重视觉问题：

- **正射投影**（`uAzimuthalType=0`）：`x=cos(lat)·sin(lon), y=sin(lat)`。本初子午线赤道点 `(lon=0,lat=0)→(0,0)` 与其对跖点 `(lon=π,lat=0)→(0,0)` 落在**同一像素**。现有 `z=min(cosC,0)·0.08` 只把背面往后推 0.08，远小于三角形尺度 → 正背两面几乎叠合，产生 z-fighting 与双重纹理穿透。
- **立体投影**（`uAzimuthalType=1`）：北极为中心，`k=2/(1+sin(lat))`。南半球 `k` 发散（`lat=-1.4` 时 k≈137，即便被 clamp 仍是 ~133 倍半径）→ 远端半球炸成巨大外环，飞出屏幕。

## 2. 根因分析

**方位投影是"穿透投影"，不是"展开投影"。** 墨卡托/等距柱状/圆锥是可展曲面展开，球面每点在平面有唯一归属；方位投影是"从视点/切点穿透到切平面"，**数学上只能 1-to-1 覆盖一个半球**，对面的半球没有合法平面落点：

- 正射：远端半球映射到与近端**同一圆盘** → 重叠。
- 立体：远端半球 `k` 发散 → 爆炸。

**统一规律**：两个子类型都有一个"有效半球"（正射=面向相机的 `cosC>0` 半球；立体=以投影中心（北极）为极的 `lat>0` 北半球），远端半球在平面上无处安放。**所有解法的本质都是回答"远端半球怎么办"**——本设计选择：随剥开进度将其 alpha 淡出，最终留下单一有效半球的干净圆盘。

## 3. 目标与非目标

**目标**
1. 方位投影展平后呈现单一干净圆盘，无穿模/重叠/z-fighting。
2. 远端半球随剥开动画（纬度延迟展开）平滑淡出，过渡自然。
3. 指标系统（朝索/面积/航线/城市精灵/发光粒子）在远端半球同步淡出，无悬空残留。
4. 顺带修复发光粒子（CPU/JS 投影）与航线（GPU 投影）的已知漂移。
5. 其他三种投影（墨卡托/等距柱状/圆锥）完全不受影响。

**非目标**
- 不新增 UI 切换方位投影中心（仍固定：正射中心 (0,0)、立体中心北极）。
- 不新增方位子类型切换 UI（沿用现有"代码支持但无控件"状态）。
- 不改其他三种投影的任何行为。

## 4. 设计总览

引入一个统一的 **远端半球标记 `vFarMask ∈ [0,1]`**：0=有效半球（保留），1=远端半球（淡出）。在 `localProgress`（剥橘子局部进度，已存在）驱动下：

```
alpha = 1.0 - vFarMask * vLocalProgress
```

- 球面态（localProgress=0）：alpha=1，完整地球（背半本就被深度遮挡）。
- 完全展平（localProgress=1）：远端 alpha=0，只剩有效半球的单一圆盘。
- 中间：随各纬度的剥开节奏平滑淡出。

用 `localProgress` 而非全局 `uProgress`，使淡出与剥橘子的纬度延迟同步（赤道先展平区域，其背面也先淡出）。

### 4.1 远端标记公式（单一事实来源）

| 子类型 | 投影中心 | 有效半球 | 远端判定 | vFarMask 公式 |
|---|---|---|---|---|
| 正射 (type=0) | (lat=0, lon=0) | `cos(lat)·cos(lon) > 0` | `cosC < 0`（背面） | `smoothstep(0.0, 0.2, -cosC)`，`cosC=cos(lat)·cos(lon)` |
| 立体 (type=1) | 北极 (lat=π/2) | `lat > 0`（北半球） | `lat < 0`（南半球） | `smoothstep(0.0, 0.2, -sin(lat))` |

- 非方位投影（`uProjectionID < 2.5`）：`vFarMask = 0.0`（恒不淡出）。
- `smoothstep` 的 0.2 过渡带用于在地平圈/赤道分界处抗锯齿；该常量**可调**。

## 5. 详细设计

### 5.1 地球着色器（核心修复）

**`src/shaders/globe.vert`**
- 新增 `varying float vFarMask;`
- 在 `main()` 中（计算 `latitude`/`longitude` 之后、`flatPos` 之后）按投影类型计算：
  ```glsl
  float farMask = 0.0;
  if (uProjectionID > 2.5) {
    if (uAzimuthalType < 0.5) {
      float cosC = cos(latitude) * cos(longitude);
      farMask = smoothstep(0.0, 0.2, -cosC);
    } else {
      farMask = smoothstep(0.0, 0.2, -sin(latitude));
    }
  }
  vFarMask = farMask;
  ```

**`src/shaders/globe.frag`**
- 新增 `varying float vFarMask;`（`vLocalProgress` 已存在）。
- 末尾输出改为：
  ```glsl
  float alpha = 1.0 - vFarMask * vLocalProgress;
  gl_FragColor = vec4(color, alpha);
  ```

**`src/main.js` — `createGlobe()`**
- `ShaderMaterial` 增加 `transparent: true`（保留现有 `side: THREE.DoubleSide`）。
- 保留 `depthWrite` 默认 true：有效半球（不透明）正常写深度，远端半球渐隐至 0；与指标（depthWrite=false）协作良好，需在验证阶段确认无排序伪影。

### 5.2 立体投影半径钳制（`projections.glsl` + JS 副本 + lint）

光靠 alpha 淡出无法解决立体投影的几何爆炸（顶点先飞出屏幕），必须先钳制半径。

**`src/shaders/common/projections.glsl` — `projectAzimuthal` 立体分支**
```glsl
// 立体投影 (Stereographic) — 保角，极地地图常用
float clampedLat = clamp(lat, -1.4, 1.4);
float k = 2.0 / max(1.0 + sin(clampedLat), 0.01);
vec2 p = vec2(
  k * cos(clampedLat) * sin(lon),
  k * cos(clampedLat) * cos(lon)
);
// 半径钳制：南半球 k 发散，钳到北半球圆盘（半径≈2）外缘的窄环，配合远端淡出
float stereoMaxR = 2.3;
float r = length(p);
if (r > stereoMaxR) p *= stereoMaxR / r;
return vec3(p.x, p.y, 0.0);
```

**`src/indicators/greatCircleRoutes.js` — `jsProjectAzimuthal` 立体分支**（半单源同步）
- 镜像同样的半径钳制（`stereoMaxR = 2.3`），供城市精灵 JS 投影使用。

**`scripts/glsl-lint.mjs`**
- 在现有方位投影 clamp 护栏（±1.4）旁，新增 `stereoMaxR`（2.3）一致性断言：正则比对 `projections.glsl` 与 `greatCircleRoutes.js` 中的 `stereoMaxR` 数值，漂移即 `pnpm lint:glsl` 失败。

### 5.3 指标共用着色器（`indicator.vert` 一处覆盖大部分）

**`src/shaders/indicator.vert`**
- 新增 `varying float vFarMask;`（`vLocalProgress` 已存在）。
- 在 `main()` 中（已有 `latitude`/`longitude`/`localProgress`）加同样计算：
  ```glsl
  float farMask = 0.0;
  if (uProjectionID > 2.5) {
    if (uAzimuthalType < 0.5) {
      float cosC = cos(latitude) * cos(longitude);
      farMask = smoothstep(0.0, 0.2, -cosC);
    } else {
      farMask = smoothstep(0.0, 0.2, -sin(latitude));
    }
  }
  vFarMask = farMask;
  ```
- 此改动自动覆盖：朝索填充/边线、面积比较填充/边线、大圆航线/恒向线（均共用 `indicator.vert`）。

**片元着色器 alpha 乘淡出因子：**

- **`src/shaders/tissot.frag`**：已有 `vLocalProgress`，补 `varying float vFarMask;`；改：
  ```glsl
  float alpha = (0.55 + vLocalProgress * 0.15) * (1.0 - vFarMask * vLocalProgress);
  ```
- **`src/shaders/outline.frag`**：补 `varying float vLocalProgress;` 和 `varying float vFarMask;`；改：
  ```glsl
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - vFarMask * vLocalProgress));
  ```
- **`src/shaders/route.frag`**：与 outline.frag 完全相同的改动（补两个 varying + alpha 乘因子）。

### 5.4 城市精灵（JS，`greatCircleRoutes.js`）

精灵走 JS 投影（`SpriteMaterial`），用 `material.opacity` 作为淡出杠杆。

**新增 `jsAzimuthalFarMask(lat, uniforms)`**（镜像 GLSL 公式）：
```js
function jsAzimuthalFarMask(lat, lon, uniforms) {
  if (uniforms.uProjectionID.value <= 2.5) return 0;
  if (uniforms.uAzimuthalType.value < 0.5) {
    const cosC = Math.cos(lat) * Math.cos(lon);
    return smoothstepJS(0.0, 0.2, -cosC);
  }
  return smoothstepJS(0.0, 0.2, -Math.sin(lat));
}
```
（`smoothstepJS` 为标准 GLSL smoothstep 的 JS 实现，新增小工具函数。）

**抽取 `computeLocalProgress(lat, progress, uniforms)`**：把 `computeLabelPosition` 内部的 `localDelay → localProgress → easeInOutCubic` 逻辑抽成独立函数（返回 eased）。`computeLabelPosition` 内部改调它（仍只返回位置）；`updateLabels` 计算淡出时复用同一函数，避免重复推导 / 公式漂移。

**`updateLabels` 精灵循环**：在现有背面隐藏逻辑基础上叠加远端淡出：
```js
const farMask = jsAzimuthalFarMask(lat, lon, uniforms);
const fade = 1 - farMask * eased;
sprite.material.opacity = fade;   // SpriteMaterial.opacity 乘纹理 alpha
```
- 与现有 `isFrontFacing`/`progress<0.3` 隐藏逻辑合并：方位投影下，远端半球精灵随进度淡出；其他投影 farMask=0，opacity=1，行为不变。

### 5.5 发光粒子改造（最大一块；顺带修漂移）

`PointsMaterial` 的 opacity 是 uniform，无法逐点淡出 → 必须上自定义 shader。一旦上 shader 便复用 `projections.glsl`（GLSL 真单源），让发光粒子也走 GPU 投影，**消除与航线（indicator.vert）的 CPU↔GPU 漂移**（CLAUDE.md 已标注的已知问题）。

**新增 `src/shaders/glow.vert`**
- `#include common/projections.glsl`；uniform：投影相关 `uProgress/uSpreadDelay/uProjectionID/uConicStdLat/uAzimuthalType`（与 `indicator.vert` 对齐，`applyProjection` 圆锥分支需 `uConicStdLat`）+ glow 专属 `uPointSize/uViewportHeight/uBaseOpacity/uColor`；attribute：`position/aLatitude/aLongitude`。
- 复用 `indicator.vert` 的处理逻辑：`spherePos` 绕 Y 旋转 -π/2（`(x,y,z)→(-z,y,x)`）→ `applyProjection` → 纬度延迟 `localProgress` → `vFarMask`。
- 输出：
  ```glsl
  varying float vGlowAlpha;
  // ...
  vGlowAlpha = (1.0 - vFarMask * localProgress) * uBaseOpacity;
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_PointSize = uPointSize * uViewportHeight * 0.5 / max(-mvPosition.z, 0.001);
  gl_Position = projectionMatrix * mvPosition;
  ```
- `gl_PointSize` 衰减公式近似 Three.js `PointsMaterial.sizeAttenuation`（`scale = drawingBufferHeight * 0.5`）；常量可调。

**新增 `src/shaders/glow.frag`**
```glsl
uniform sampler2D uGlowTexture;
uniform vec3 uColor;
varying float vGlowAlpha;
void main() {
  vec4 tex = texture2D(uGlowTexture, gl_PointCoord);
  gl_FragColor = vec4(tex.rgb * uColor, tex.a * vGlowAlpha);
}
```
- `tex.rgb * uColor` 复刻原 `PointsMaterial` 的 `map * color` 着色（`uColor=GC_COLOR`）。
- 材质：`AdditiveBlending`、`transparent:true`、`depthWrite:false`、`depthTest:true`（复刻现 `createGlowPoints` 的 PointsMaterial 配置）。

**`greatCircleRoutes.js — createGlowPoints` / `createGreatCircleRoutes`**
- 几何体增加 `aLatitude`/`aLongitude` 属性（`latLons` 已有数据）。
- `PointsMaterial` → `ShaderMaterial`（glow.vert/glow.frag + uniforms；`uPointSize=0.06`、`uBaseOpacity=0.7`、`uColor=GC_COLOR` 对齐原值）。
- **移除 `updateLabels` 中发光粒子的逐帧 JS 位置更新**（`computeLabelPosition` 循环）——改由 GPU 投影。这同时消除漂移并简化热路径（每帧省约 600 点三角运算，性能小赚）。
- `createGreatCircleRoutes` 返回值新增 `onResize(viewportHeight)` 方法，内部遍历所有 glow 材质更新 `uViewportHeight`（glow 材质在该函数作用域内可达）。

**`src/main.js`**
- `createGreatCircleRoutes(sharedUniforms)` 返回值解构出 `onResize`；在现有 `resize` 监听里调用 `greatCircleRoutes.onResize(window.innerHeight)`（初始化时也调用一次设定初值）。

## 6. 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/shaders/common/projections.glsl` | 立体分支半径钳制 `stereoMaxR=2.3` |
| `src/shaders/globe.vert` | 新增 `vFarMask` varying + 计算 |
| `src/shaders/globe.frag` | 新增 `vFarMask`；alpha 输出 |
| `src/shaders/indicator.vert` | 新增 `vFarMask` varying + 计算 |
| `src/shaders/tissot.frag` | 补 `vFarMask`；alpha 乘淡出因子 |
| `src/shaders/outline.frag` | 补 `vLocalProgress`+`vFarMask`；alpha 乘因子 |
| `src/shaders/route.frag` | 同 outline.frag |
| **新增** `src/shaders/glow.vert` | GPU 投影 + mask 淡出 + gl_PointSize |
| **新增** `src/shaders/glow.frag` | 纹理 * 逐点 alpha |
| `src/indicators/greatCircleRoutes.js` | `jsProjectAzimuthal` 镜像钳制；`jsAzimuthalFarMask`+`smoothstepJS`；精灵 opacity 淡出；发光粒子改 ShaderMaterial、加属性、移除 JS 位置更新 |
| `src/main.js` | globe 材质 `transparent:true`；glow 的 `uViewportHeight`/`uPointSize` 接入 + resize 更新 |
| `scripts/glsl-lint.mjs` | 新增 `stereoMaxR=2.3` 一致性护栏 |

## 7. 验证计划

**自动化**
- `pnpm lint:glsl` 通过（含新增 `stereoMaxR` 护栏、循环引用检测、preamble 注入）。

**手动（`pnpm dev`，逐项观察）**
1. **正射投影**：切到方位投影（默认正射），拖动进度条 0→1。预期：背面半球随剥开平滑淡出，progress=1 时只剩面向相机的单一圆盘，**无穿模/z-fighting/双重纹理**。
2. **立体投影**：`uAzimuthalType=1`（临时改 `azimuthal.js` 默认或控制台设 uniform），拖动进度条。预期：南半球不再爆炸飞出，钳制为窄环后淡出，progress=1 时只剩北极中心的北半球圆盘（半径≈2）。
3. **指标一致性**：开启朝索（默认开）+ 面积比较 + 航线，方位投影下拖动进度条。预期：远端半球的朝索椭圆、国家轮廓、航线、城市精灵、发光粒子**同步淡出**，无悬空残留；发光粒子与航线**对齐**（漂移修复）。
4. **回归（关键）**：切到墨卡托/等距柱状/圆锥，全程拖动进度条。预期：**完全无淡出**（vFarMask=0），行为与改动前一致，全球完整展开。
5. **球面态**：progress=0（含自转）时，两个半球均可见（无提前淡出），完整地球。
6. **resize**：缩放窗口，发光粒子点大小随高度正确衰减。

## 8. 风险与边界

- **地球材质透明化排序**：开 `transparent:true` 后，远端半透层可能与星空背景/指标产生排序伪影。缓解：保留 `depthWrite=true`（有效半球写深度），指标已 `depthWrite=false`。验证步骤 1/3 确认；若有伪影，可调远端半球 `depthWrite` 或提高 `polygonOffset`。
- **立体南半球钳制成环**：过渡中可能观感略怪（南半球塌缩到半径 2.3 环再淡出）。`stereoMaxR` 可调（越小越聚拢）。
- **gl_PointSize 衰减**：自定义公式与 Three.js 内建 `sizeAttenuation` 近似，需肉眼校准点大小；`uPointSize` 可调。
- **smoothstep 过渡带**：0.2 是经验值，地平圈/赤道处抗锯齿不足时可调大。
- **半单源同步**：改 `projections.glsl` 立体分支后，必须同步 `jsProjectAzimuthal`（精灵仍用 JS 投影）；lint 护栏兜底 `stereoMaxR`，但 `jsAzimuthalFarMask` 的 smoothstep 带（0.2）无 lint 覆盖，需人工保持一致（可后续加护栏）。

## 9. 实现顺序建议

1. 5.1 + 5.2（地球核心 + 立体钳制）→ 验证步骤 1/2，解决用户报告的核心问题。
2. 5.3（indicator.vert + 3 frag）→ 验证步骤 3 的朝索/面积/航线。
3. 5.4（城市精灵）→ 验证步骤 3 的精灵。
4. 5.5（发光粒子改造）→ 验证步骤 3 的发光粒子 + 漂移修复。
5. lint 护栏 + 全量回归（步骤 4/5/6）。

每步独立可验证、可回退。

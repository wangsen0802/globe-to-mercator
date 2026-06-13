# 方位投影远端半球淡出 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让方位投影（正射/立体）展平后只保留有效半球作为干净的单一圆盘，远端半球随剥开进度 alpha 淡出，地球与全部指标系统（朝索/面积/航线/城市精灵/发光粒子）一致淡出，顺带修复发光粒子 CPU↔GPU 投影漂移。

**Architecture:** 引入统一远端标记 `vFarMask ∈ [0,1]`，驱动 `alpha = 1 - vFarMask · localProgress`。标记在 `globe.vert`/`indicator.vert`/新 `glow.vert` 各算一次（同公式），片元着色器乘 alpha；城市精灵在 JS 端镜像同一公式控制 `material.opacity`；立体投影先做半径钳制（防南半球发散）再淡出；发光粒子从 `PointsMaterial` 改为自定义 `ShaderMaterial` 以支持逐点淡出并统一到 GPU 投影。

**Tech Stack:** Three.js `^0.170.0`、自定义 GLSL（`?raw` 导入 + `#include`）、Vite、pnpm。

**对应 spec：** `docs/superpowers/specs/2026-06-13-azimuthal-hemisphere-fade-design.md`

---

## ⚠️ 验证方式说明（本项目无 JS 测试框架）

CLAUDE.md 已记录：本项目仅有 GLSL lint，**未配置 JS 的 eslint/prettier/typecheck/单元测试**。因此本计划的"验证"采用：

- **自动化**：`pnpm lint:glsl`（GLSL 语法 + Three.js preamble 注入 + 投影 clamp 一致性护栏）。改着色器后必跑。
- **行为**：`pnpm dev` 启动后手动可视化检查（按各 Task 的预期观察项）。

不为单个视觉特性引入 JS 测试框架（YAGNI）。每个 Task 末尾先跑 lint，再跑 dev 做视觉确认。

---

## Task 1: 立体投影半径钳制 + lint 护栏

**Goal:** 先把立体投影南半球的几何爆炸钳制到有界外环（独立可验证：南半球不再飞出屏幕），并加上 GLSL↔JS 一致性护栏。此 Task 不依赖淡出逻辑。

**Files:**
- Modify: `src/shaders/common/projections.glsl`（`projectAzimuthal` 立体分支）
- Modify: `src/indicators/greatCircleRoutes.js`（`jsProjectAzimuthal` 立体分支，镜像钳制）
- Modify: `scripts/glsl-lint.mjs`（新增 `stereoMaxR` 护栏）

- [ ] **Step 1: 修改 `projections.glsl` 立体分支**

把 `projectAzimuthal` 的 `else`（立体）分支（当前第 65–74 行）：

```glsl
  } else {
    // 立体投影 (Stereographic) — 保角，极地地图常用
    float clampedLat = clamp(lat, -1.4, 1.4);
    float k = 2.0 / max(1.0 + sin(clampedLat), 0.01);
    return vec3(
      k * cos(clampedLat) * sin(lon),
      k * cos(clampedLat) * cos(lon),
      0.0
    );
  }
```

替换为：

```glsl
  } else {
    // 立体投影 (Stereographic) — 保角，极地地图常用
    float clampedLat = clamp(lat, -1.4, 1.4);
    float k = 2.0 / max(1.0 + sin(clampedLat), 0.01);
    vec2 p = vec2(
      k * cos(clampedLat) * sin(lon),
      k * cos(clampedLat) * cos(lon)
    );
    // 半径钳制：南半球 k 发散，钳到北半球圆盘（半径≈2）外缘窄环，配合远端淡出（见 Task 2+）
    float stereoMaxR = 2.3;
    float r = length(p);
    if (r > stereoMaxR) p *= stereoMaxR / r;
    return vec3(p.x, p.y, 0.0);
  }
```

- [ ] **Step 2: 镜像钳制到 `jsProjectAzimuthal`**

把 `greatCircleRoutes.js` 的 `jsProjectAzimuthal` 立体分支（当前第 217–219 行）：

```js
  const clampedLat = Math.max(-1.4, Math.min(1.4, lat));
  const k = 2 / Math.max(0.01, 1 + Math.sin(clampedLat));
  return [k * Math.cos(clampedLat) * Math.sin(lon), k * Math.cos(clampedLat) * Math.cos(lon), 0];
```

替换为：

```js
  const clampedLat = Math.max(-1.4, Math.min(1.4, lat));
  const k = 2 / Math.max(0.01, 1 + Math.sin(clampedLat));
  const px = k * Math.cos(clampedLat) * Math.sin(lon);
  const py = k * Math.cos(clampedLat) * Math.cos(lon);
  // 半径钳制：与 projections.glsl 的 stereoMaxR 对齐（glsl-lint.mjs 护栏校验）
  const stereoMaxR = 2.3;
  const r = Math.hypot(px, py);
  const s = r > stereoMaxR ? stereoMaxR / r : 1;
  return [px * s, py * s, 0];
```

- [ ] **Step 3: 新增 `stereoMaxR` lint 护栏**

在 `glsl-lint.mjs` 的圆锥护栏块之后（当前第 131 行 `}` 之后、第 133 行 `process.exit(...)` 之前）插入：

```js

// 立体投影半径钳制：GLSL `stereoMaxR = X` ↔ JS `stereoMaxR = X`（同一标识符，一个正则覆盖两端）
const glslStereoMaxR = extractNum(/stereoMaxR\s*=\s*([\d.]+)/, glslProjSrc);
const jsStereoMaxR = extractNum(/stereoMaxR\s*=\s*([\d.]+)/, jsRoutesSrc);
if (glslStereoMaxR && jsStereoMaxR && glslStereoMaxR !== jsStereoMaxR) {
  console.log(`\x1b[31m✗ 投影漂移\x1b[0m: 立体投影半径上限 GLSL=${glslStereoMaxR} ≠ JS=${jsStereoMaxR}`);
  console.log(`  请对齐 src/shaders/common/projections.glsl 与 src/indicators/greatCircleRoutes.js`);
  errorCount++;
}
```

- [ ] **Step 4: 跑 lint 验证**

Run: `pnpm lint:glsl`
Expected: 所有着色器 `✓`，0 错误（新护栏两端都读到 `2.3`，不触发漂移）。

- [ ] **Step 5: 视觉验证立体投影不再爆炸**

Run: `pnpm dev`，在浏览器控制台执行 `__uniforms` 不可用，改为临时把 `src/projections/azimuthal.js` 的 `uAzimuthalType: 0.0` 改为 `1.0`，刷新，切到「方位投影」，拖动进度条到 100%。
Expected: 南半球不再飞出屏幕，塌缩到北极圆盘（半径≈2）外缘的窄环（半径≈2.3）。**注意此时仍有重叠（南环叠在区域上）——重叠由 Task 2 的淡出消除，本步只验证"不爆炸"。**
验证后把 `uAzimuthalType` 改回 `0.0`（保持默认正射；UI 无切换控件，避免遗留改动）。

- [ ] **Step 6: 提交**

```bash
git add src/shaders/common/projections.glsl src/indicators/greatCircleRoutes.js scripts/glsl-lint.mjs
git commit -m "fix(azimuthal): 立体投影南半球半径钳制(stereoMaxR=2.3) + lint 护栏，防几何爆炸"
```

---

## Task 2: 地球着色器远端半球淡出（核心）

**Goal:** 在 `globe.vert` 算 `vFarMask`，`globe.frag` 输出 alpha，材质开 transparent。正射/立体的远端半球随剥开淡出，展平后只剩单一圆盘。

**Files:**
- Modify: `src/shaders/globe.vert`
- Modify: `src/shaders/globe.frag`
- Modify: `src/main.js`（`createGlobe` 材质）

- [ ] **Step 1: `globe.vert` 新增 `vFarMask` varying 声明**

在现有 varyings 末尾（当前第 17 行 `varying vec3 vBitangent;` 之后）追加：

```glsl
varying float vFarMask;  // 方位投影远端半球淡出标记（0=保留，1=淡出）
```

- [ ] **Step 2: `globe.vert` 计算 `vFarMask`**

在 `main()` 中 `flatPos` 的 if/else 块之后（当前第 49 行 `}` 之后、第 51 行 `// ===== "剥橘子"...` 注释之前）插入：

```glsl

  // 方位投影远端半球淡出标记：非方位投影恒 0
  // 正射用 cosC=cos(lat)cos(lon)（<0 为背面），立体用 -sin(lat)（南半球）
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

- [ ] **Step 3: `globe.frag` 新增 `vFarMask` varying 声明**

在现有 varyings 末尾（当前第 18 行 `varying vec3 vBitangent;` 之后）追加：

```glsl
varying float vFarMask;
```

- [ ] **Step 4: `globe.frag` 输出 alpha**

把末尾（当前第 124 行）：

```glsl
  gl_FragColor = vec4(color, 1.0);
```

替换为：

```glsl
  // 方位投影远端半球随剥开进度淡出（非方位投影 vFarMask=0 → alpha 恒 1）
  float alpha = 1.0 - vFarMask * vLocalProgress;
  gl_FragColor = vec4(color, alpha);
```

- [ ] **Step 5: `main.js` 材质开 transparent**

`createGlobe` 中（当前第 105–110 行）：

```js
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide
  });
```

改为：

```js
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true
  });
```

- [ ] **Step 6: 跑 lint 验证**

Run: `pnpm lint:glsl`
Expected: 所有着色器 `✓`，0 错误（`globe.vert`/`globe.frag` 新增的 varying 两端声明匹配）。

- [ ] **Step 7: 视觉验证（正射单一圆盘）**

Run: `pnpm dev`，切到「方位投影」（默认正射），拖动进度条 0→100%。
Expected:
- progress=0：完整地球（两半球都可见，背半被深度遮挡，无提前淡出）。
- progress 渐增：背面半球随各纬度剥开节奏平滑淡出。
- progress=100%：只剩面向相机的**单一圆盘**，**无 z-fighting / 双重纹理穿透**。

- [ ] **Step 8: 视觉验证（立体）**

临时把 `azimuthal.js` 的 `uAzimuthalType` 改 `1.0`，刷新，方位投影，拖动进度条。
Expected: 南半球（Task 1 钳制后的窄环）随进度淡出，progress=100% 只剩北极中心的北半球圆盘。验证后改回 `0.0`。

- [ ] **Step 9: 回归验证（其他三投影无淡出）**

依次切到墨卡托/等距柱状/圆锥，全程拖动进度条。
Expected: **完全无淡出**（vFarMask=0），行为与改动前一致，全球完整展开。

- [ ] **Step 10: 提交**

```bash
git add src/shaders/globe.vert src/shaders/globe.frag src/main.js
git commit -m "feat(azimuthal): 地球远端半球随剥开进度 alpha 淡出 → 单一圆盘（vFarMask + transparent）"
```

---

## Task 3: 指标共用着色器 mask 淡出

**Goal:** `indicator.vert` 加 `vFarMask`（一处覆盖朝索填充/边线、面积比较、航线），三个 frag 的 alpha 各乘淡出因子。远端半球的指标随地球同步淡出。

**Files:**
- Modify: `src/shaders/indicator.vert`
- Modify: `src/shaders/tissot.frag`
- Modify: `src/shaders/outline.frag`
- Modify: `src/shaders/route.frag`

- [ ] **Step 1: `indicator.vert` 新增 `vFarMask` varying 声明**

在现有 varyings 末尾（当前第 16 行 `varying vec3 vSurfaceNormal;` 之后）追加：

```glsl
varying float vFarMask;  // 方位投影远端半球淡出标记（与 globe.vert 同公式）
```

- [ ] **Step 2: `indicator.vert` 计算 `vFarMask`**

在 `main()` 中 `vLocalProgress = localProgress;`（当前第 61 行）之后插入：

```glsl

  // 方位投影远端半球淡出标记（与 globe.vert 同公式）
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

- [ ] **Step 3: `tissot.frag` 加 varying + alpha 淡出**

在现有 varyings（当前第 4–7 行 `varying float vDistortion;` … `varying vec3 vSurfaceNormal;`）中追加：

```glsl
varying float vFarMask;
```

把（当前第 27–29 行）：

```glsl
  // 半透明填充，展开时稍微增强不透明度
  float alpha = 0.55 + vLocalProgress * 0.15;
  gl_FragColor = vec4(color, alpha);
```

替换为：

```glsl
  // 半透明填充，展开时稍微增强不透明度；方位投影远端半球随进度淡出
  float alpha = (0.55 + vLocalProgress * 0.15) * (1.0 - vFarMask * vLocalProgress);
  gl_FragColor = vec4(color, alpha);
```

- [ ] **Step 4: `outline.frag` 加两个 varying + alpha 淡出**

在现有 varyings（当前第 7–8 行 `varying vec3 vWorldPos;` / `varying vec3 vSurfaceNormal;`）中追加：

```glsl
varying float vLocalProgress;
varying float vFarMask;
```

把（当前第 15 行）：

```glsl
  gl_FragColor = vec4(uColor, uOpacity);
```

替换为：

```glsl
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - vFarMask * vLocalProgress));
```

- [ ] **Step 5: `route.frag` 加两个 varying + alpha 淡出**

与 `outline.frag` 完全相同的改动：在 varyings（当前第 5–6 行）追加 `varying float vLocalProgress;` 和 `varying float vFarMask;`；把（当前第 13 行）`gl_FragColor = vec4(uColor, uOpacity);` 替换为：

```glsl
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - vFarMask * vLocalProgress));
```

- [ ] **Step 6: 跑 lint 验证**

Run: `pnpm lint:glsl`
Expected: 所有着色器 `✓`，0 错误（`indicator.vert` 新增的 `vFarMask` 在三个 frag 中都已声明接收；`outline.frag`/`route.frag` 补的 `vLocalProgress` 与 vert 已有的输出匹配）。

- [ ] **Step 7: 视觉验证（指标同步淡出）**

Run: `pnpm dev`，开启朝索（默认开）+ 面积比较 + 航线（左侧面板），切到方位投影，拖动进度条。
Expected: 远端半球的朝索椭圆、国家轮廓、航线随地球同步淡出，progress=100% 时远端无悬空指标残留。

- [ ] **Step 8: 提交**

```bash
git add src/shaders/indicator.vert src/shaders/tissot.frag src/shaders/outline.frag src/shaders/route.frag
git commit -m "feat(azimuthal): 指标(indicator.vert + tissot/outline/route.frag)远端半球同步淡出"
```

---

## Task 4: 城市精灵 JS 淡出

**Goal:** 精灵走 JS 投影，用 `material.opacity` 控制淡出。镜像 GLSL 的 mask 公式到 JS，抽取 `computeLocalProgress` 复用。

**Files:**
- Modify: `src/indicators/greatCircleRoutes.js`

- [ ] **Step 1: 新增 `smoothstepJS` 工具函数**

在 `easeInOutCubic`（当前第 186–188 行）之后追加：

```js
// GLSL smoothstep 的 JS 等价（边界平滑过渡），供 jsAzimuthalFarMask 用
function smoothstepJS(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
```

- [ ] **Step 2: 新增 `jsAzimuthalFarMask`**

在 `jsApplyProjection`（当前第 222–228 行）之后追加：

```js
// 方位投影远端半球标记（镜像 indicator.vert/globe.vert 的 vFarMask 公式）
// 非方位投影返回 0；正射用 cosC（背面），立体用 -sin(lat)（南半球）
function jsAzimuthalFarMask(lat, lon, uniforms) {
  if (uniforms.uProjectionID.value <= 2.5) return 0;
  if (uniforms.uAzimuthalType.value < 0.5) {
    const cosC = Math.cos(lat) * Math.cos(lon);
    return smoothstepJS(0.0, 0.2, -cosC);
  }
  return smoothstepJS(0.0, 0.2, -Math.sin(lat));
}
```

- [ ] **Step 3: 抽取 `computeLocalProgress`**

把 `computeLabelPosition`（当前第 230–245 行）：

```js
function computeLabelPosition(lat, lon, progress, uniforms) {
  const sphere = latLonToXYZ(lat, lon);
  // 地球 phiStart=-π/2 背面切口：球面位置同步旋转 -π/2（绕 Y 轴，(x,y,z)→(-z,y,x)），平面投影不动
  const rsphere = [-sphere[2], sphere[1], sphere[0]];
  const flat = jsApplyProjection(lon, lat, uniforms);
  const spreadDelay = uniforms.uSpreadDelay.value;
  const normalizedLat = Math.abs(lat) / (PI / 2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = Math.max(0, Math.min(1, (progress - localDelay) / (1 - spreadDelay + 0.001)));
  const eased = easeInOutCubic(localProgress);
  return [
    rsphere[0] + (flat[0] - rsphere[0]) * eased,
    rsphere[1] + (flat[1] - rsphere[1]) * eased,
    rsphere[2] + (flat[2] - rsphere[2]) * eased,
  ];
}
```

替换为（抽出 `computeLocalProgress`，`computeLabelPosition` 改调它）：

```js
// 局部剥开进度（含纬度延迟 + easeInOutCubic），computeLabelPosition 与精灵淡出共用，避免公式漂移
function computeLocalProgress(lat, progress, uniforms) {
  const spreadDelay = uniforms.uSpreadDelay.value;
  const normalizedLat = Math.abs(lat) / (PI / 2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = Math.max(0, Math.min(1, (progress - localDelay) / (1 - spreadDelay + 0.001)));
  return easeInOutCubic(localProgress);
}

function computeLabelPosition(lat, lon, progress, uniforms) {
  const sphere = latLonToXYZ(lat, lon);
  // 地球 phiStart=-π/2 背面切口：球面位置同步旋转 -π/2（绕 Y 轴，(x,y,z)→(-z,y,x)），平面投影不动
  const rsphere = [-sphere[2], sphere[1], sphere[0]];
  const flat = jsApplyProjection(lon, lat, uniforms);
  const eased = computeLocalProgress(lat, progress, uniforms);
  return [
    rsphere[0] + (flat[0] - rsphere[0]) * eased,
    rsphere[1] + (flat[1] - rsphere[1]) * eased,
    rsphere[2] + (flat[2] - rsphere[2]) * eased,
  ];
}
```

- [ ] **Step 4: `updateLabels` 精灵循环加淡出**

把 `updateLabels` 中精灵循环（当前第 385–395 行）：

```js
    for (const { sprite, lat, lon } of sprites) {
      const p = computeLabelPosition(lat, lon, progress, uniforms);
      sprite.position.set(p[0], p[1], p[2]);

      // 球面状态下隐藏背面标签，展开过程中逐渐恢复可见
      if (camPos) {
        const backFacing = !isFrontFacing(sprite, camPos);
        // progress > 0.3 时完全展开，不再隐藏
        sprite.visible = !(backFacing && progress < 0.3);
      }
    }
```

替换为：

```js
    for (const { sprite, lat, lon } of sprites) {
      const p = computeLabelPosition(lat, lon, progress, uniforms);
      sprite.position.set(p[0], p[1], p[2]);

      // 方位投影远端半球随进度淡出（其他投影 farMask=0 → opacity=1，无影响）
      const eased = computeLocalProgress(lat, progress, uniforms);
      const fade = 1 - jsAzimuthalFarMask(lat, lon, uniforms) * eased;
      sprite.material.opacity = fade;

      // 球面状态下隐藏背面标签，展开过程中逐渐恢复可见
      if (camPos) {
        const backFacing = !isFrontFacing(sprite, camPos);
        // progress > 0.3 时完全展开，不再隐藏
        sprite.visible = !(backFacing && progress < 0.3);
      }
    }
```

- [ ] **Step 5: 视觉验证（精灵淡出）**

Run: `pnpm dev`，开启航线（左侧面板），切到方位投影，拖动进度条。
Expected: 远端半球的城市精灵（如东京、悉尼侧）随进度淡出，近端精灵保持可见；切回其他投影精灵 opacity 恢复正常。

- [ ] **Step 6: 提交**

```bash
git add src/indicators/greatCircleRoutes.js
git commit -m "feat(azimuthal): 城市精灵远端半球淡出(jsAzimuthalFarMask + opacity) + 抽取 computeLocalProgress"
```

---

## Task 5: 发光粒子改造为 ShaderMaterial（GPU 投影 + 淡出 + 修漂移）

**Goal:** `PointsMaterial` 无法逐点淡出 → 改自定义 `glow.vert`/`glow.frag`，复用 `projections.glsl` 走 GPU 投影（消除与航线的 CPU↔GPU 漂移）+ 同款 mask 淡出 + `gl_PointSize` 衰减。

**Files:**
- Create: `src/shaders/glow.vert`
- Create: `src/shaders/glow.frag`
- Modify: `src/indicators/greatCircleRoutes.js`（import、`createGlowPoints`、`createGreatCircleRoutes` 的 glow 循环与返回值、`updateLabels` 移除 JS 位置更新）
- Modify: `src/main.js`（resize 调 `onResize`）

- [ ] **Step 1: 创建 `src/shaders/glow.vert`**

```glsl
// 发光粒子顶点着色器：GPU 投影（复用 projections.glsl，与航线 indicator.vert 同源）
// + 方位投影远端淡出 + gl_PointSize 距离衰减

uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionID;
uniform float uConicStdLat;
uniform float uAzimuthalType;

uniform float uPointSize;        // 基础点大小（对应原 PointsMaterial.size）
uniform float uViewportHeight;   // 视口高度（用于 sizeAttenuation 近似）
uniform float uBaseOpacity;      // 基础不透明度（对应原 PointsMaterial.opacity）

attribute float aLatitude;
attribute float aLongitude;

varying float vGlowAlpha;

#include common/projections.glsl

void main() {
  // position 已在球面上（JS 端 latLonToXYZ 计算）
  vec3 spherePos = position;
  // 与 indicator.vert 一致：球面位置绕 Y 旋转 -π/2，对齐地球 phiStart 背面切口
  spherePos = vec3(-spherePos.z, spherePos.y, spherePos.x);

  float latitude = aLatitude;
  float longitude = aLongitude;

  vec3 flatPos = applyProjection(longitude, latitude);

  // 剥橘子纬度延迟展开（与 globe.vert / indicator.vert 一致）
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (1.0 - uSpreadDelay + 0.001), 0.0, 1.0);
  localProgress = easeInOutCubic(localProgress);

  vec3 finalPos = mix(spherePos, flatPos, localProgress);

  // 方位投影远端半球淡出（与 globe.vert 同公式）
  float farMask = 0.0;
  if (uProjectionID > 2.5) {
    if (uAzimuthalType < 0.5) {
      float cosC = cos(latitude) * cos(longitude);
      farMask = smoothstep(0.0, 0.2, -cosC);
    } else {
      farMask = smoothstep(0.0, 0.2, -sin(latitude));
    }
  }
  vGlowAlpha = (1.0 - farMask * localProgress) * uBaseOpacity;

  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  // sizeAttenuation 近似：scale = viewportHeight * 0.5（匹配 Three.js PointsMaterial 内部）
  gl_PointSize = uPointSize * uViewportHeight * 0.5 / max(-mvPosition.z, 0.001);
  gl_Position = projectionMatrix * mvPosition;
}
```

- [ ] **Step 2: 创建 `src/shaders/glow.frag`**

```glsl
// 发光粒子片元着色器：径向渐变纹理 * 颜色 * 逐点 alpha

uniform sampler2D uGlowTexture;
uniform vec3 uColor;

varying float vGlowAlpha;

void main() {
  vec4 tex = texture2D(uGlowTexture, gl_PointCoord);
  gl_FragColor = vec4(tex.rgb * uColor, tex.a * vGlowAlpha);
}
```

- [ ] **Step 3: `greatCircleRoutes.js` 导入 glow 着色器**

在 import 区（当前第 1–4 行）：

```js
import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import routeFrag from '../shaders/route.frag?raw';
import { PI, DEG2RAD } from '../utils/math.js';
```

之后追加：

```js
import glowVert from '../shaders/glow.vert?raw';
import glowFrag from '../shaders/glow.frag?raw';
```

- [ ] **Step 4: 重写 `createGlowPoints` 为 ShaderMaterial**

把 `createGlowPoints`（当前第 307–331 行）整体替换为（签名加 `uniforms`，新增 `aLatitude`/`aLongitude` 属性）：

```js
// 沿大圆航线创建发光粒子（GPU 投影 + 方位投影远端淡出，uViewportHeight 由外部 onResize 更新）
function createGlowPoints(points, uniforms) {
  const count = points.length;
  const positions = new Float32Array(count * 3);
  const lats = new Float32Array(count);
  const lons = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = latLonToXYZ(points[i].lat, points[i].lon);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    lats[i] = points[i].lat;
    lons[i] = points[i].lon;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aLatitude', new THREE.BufferAttribute(lats, 1));
  geometry.setAttribute('aLongitude', new THREE.BufferAttribute(lons, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    uniforms: {
      ...uniforms,
      uGlowTexture: { value: glowTexture },
      uColor: { value: new THREE.Color(GC_COLOR) },
      uPointSize: { value: 0.06 },
      uViewportHeight: { value: window.innerHeight },
      uBaseOpacity: { value: 0.7 }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geometry, material);
}
```

- [ ] **Step 5: `createGreatCircleRoutes` 追踪 glow 材质 + 改调用 + 返回 onResize**

在 `createGreatCircleRoutes` 内（当前第 336–338 行）：

```js
  const group = new THREE.Group();
  const sprites = [];
  const glowData = []; // { points, latLons }
```

把 `const glowData = [];` 这行替换为：

```js
  const glowMaterials = []; // 记录所有 glow 材质，供 onResize 更新 uViewportHeight
```

把 glow 创建循环（当前第 354–361 行）：

```js
    // 大圆航线发光粒子（仅大圆航线，恒向线不加）
    const gcPoints = generateGreatCirclePoints(route.from, route.to);
    for (const seg of splitAtDateLine(gcPoints)) {
      if (seg.length < 2) continue;
      const glow = createGlowPoints(seg);
      group.add(glow);
      glowData.push({ points: glow, latLons: seg });
    }
```

替换为（传入 `uniforms`、记录材质、不再记 glowData）：

```js
    // 大圆航线发光粒子（仅大圆航线，恒向线不加）；GPU 投影，无需逐帧 JS 更新位置
    const gcPoints = generateGreatCirclePoints(route.from, route.to);
    for (const seg of splitAtDateLine(gcPoints)) {
      if (seg.length < 2) continue;
      const glow = createGlowPoints(seg, uniforms);
      group.add(glow);
      glowMaterials.push(glow.material);
    }
```

- [ ] **Step 6: `updateLabels` 移除发光粒子的 JS 位置更新**

把 `updateLabels` 末尾（当前第 397–405 行）整段删除：

```js
    // 更新发光粒子位置（跟随投影变换）
    for (const { points, latLons } of glowData) {
      const posAttr = points.geometry.getAttribute('position');
      for (let i = 0; i < latLons.length; i++) {
        const p = computeLabelPosition(latLons[i].lat, latLons[i].lon, progress, uniforms);
        posAttr.setXYZ(i, p[0], p[1], p[2]);
      }
      posAttr.needsUpdate = true;
    }
```

（发光粒子现由 `glow.vert` GPU 投影，无需 CPU 更新；`glowData` 已在 Step 5 移除，此处删除后 `updateLabels` 只剩精灵循环。）

- [ ] **Step 7: 返回值新增 `onResize`**

把 `createGreatCircleRoutes` 末尾返回（当前第 408 行）：

```js
  return { group, updateLabels };
```

替换为：

```js
  // 窗口尺寸变化时更新 glow 的 uViewportHeight（gl_PointSize 衰减用）
  function onResize(viewportHeight) {
    for (const mat of glowMaterials) {
      mat.uniforms.uViewportHeight.value = viewportHeight;
    }
  }

  return { group, updateLabels, onResize };
```

- [ ] **Step 8: `main.js` resize 调 `onResize`**

把 resize 监听（当前第 416–420 行）：

```js
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

替换为：

```js
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  greatCircleRoutes.onResize(window.innerHeight);
});
```

- [ ] **Step 9: 跑 lint 验证**

Run: `pnpm lint:glsl`
Expected: 所有着色器 `✓`，0 错误（新 `glow.vert`/`glow.frag` 通过：preamble 提供 position/modelViewMatrix/projectionMatrix；`aLatitude`/`aLongitude`/`u*` 在 glow.vert 自行声明；`projections.glsl` 经 `#include` 注入）。

- [ ] **Step 10: 视觉验证（glow 对齐 + 淡出 + resize 衰减）**

Run: `pnpm dev`，开启航线，切到方位投影，拖动进度条。
Expected:
- 发光粒子**紧贴航线**（CPU↔GPU 漂移修复）。
- 远端半球的发光粒子随进度淡出。
- 缩放/调整窗口大小：发光粒子点大小随视口高度正确变化（不变形/不消失）。
- 切到其他投影：发光粒子正常显示（无淡出），仍贴合航线。

- [ ] **Step 11: 提交**

```bash
git add src/shaders/glow.vert src/shaders/glow.frag src/indicators/greatCircleRoutes.js src/main.js
git commit -m "refactor(glow): 发光粒子改 ShaderMaterial(GPU 投影+远端淡出)，修复与航线 CPU/GPU 漂移"
```

---

## Task 6: 全量回归验证

**Goal:** 端到端确认所有投影、所有指标、边界状态都正确，无回归。

- [ ] **Step 1: 全量 lint**

Run: `pnpm lint:glsl`
Expected: 所有着色器 `✓`，0 错误；新 `stereoMaxR` 护栏就位（可临时把 JS 端改 `2.4` 验证护栏会报漂移、再改回 `2.3`）。

- [ ] **Step 2: 正射投影端到端**

Run: `pnpm dev`，方位投影（正射），开启全部指标，拖动进度条 0↔100% 反复。
Expected: 远端半球（地球+所有指标+精灵+发光粒子）一致淡出，progress=100% 单一干净圆盘，无穿模/悬空/漂移。

- [ ] **Step 3: 立体投影端到端**

临时 `azimuthal.js` `uAzimuthalType=1.0`，同样操作。
Expected: 南半球窄环 + 所有指标一致淡出，progress=100% 北极中心北半球圆盘。验证后改回 `0.0`。

- [ ] **Step 4: 其他三投影回归**

墨卡托/等距柱状/圆锥，开启全部指标，全程拖动。
Expected: **完全无淡出**，全球完整展开，指标行为与改动前一致。

- [ ] **Step 5: 球面态 + 自转**

progress=0，确认自转开启时两半球都可见（无提前淡出）；拖动到中途再拖回 0，远端应恢复可见（无残留透明）。

- [ ] **Step 6: resize**

反复缩放窗口，确认发光粒子点大小正确衰减、布局不错位。

- [ ] **Step 7: 收尾提交（如有）**

若 Step 1–6 中改动了 `azimuthal.js` 之外的文件（理论上不应有），提交；否则此 Task 无新增提交，整个特性已完成。

---

## Self-Review 记录

- **Spec 覆盖**：spec 5.1（地球）→ Task 2；5.2（立体钳制 + JS 镜像 + lint）→ Task 1；5.3（indicator + 3 frag）→ Task 3；5.4（精灵）→ Task 4；5.5（glow）→ Task 5；spec §7 验证 → Task 6。全部覆盖。
- **占位符**：无 TBD/TODO，所有代码块完整。
- **一致性**：`vFarMask` 公式在 Task 2/3/5（GLSL）与 Task 4（JS `jsAzimuthalFarMask`）完全一致；`stereoMaxR=2.3` 在 Task 1 的 GLSL/JS/lint 三处一致；`computeLocalProgress` 在 Task 4 抽取后被 `computeLabelPosition` 与精灵淡出共用；`createGlowPoints(points, uniforms)` 新签名在 Task 5 Step 4 定义、Step 5 调用一致；`onResize` 在 Task 5 Step 7 返回、Step 8 调用一致。
- **顺序**：Task 1（钳制）独立可验证（不依赖淡出）；Task 2（地球淡出）依赖 Task 1（否则立体爆炸）；Task 3/4/5 依次；Task 6 全量回归。每 Task 末尾独立提交、可回退。

# 动态剥橘子中心经线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 剥橘子展开动画的中心经线从固定的 0° 改为按下进度条时捕获的可见半球中心经线。

**Architecture:** 新增共享 uniform `uCenterLon`，着色器端统一偏移经度实现投影中心平移。朝索椭圆的 180° 日期线分割从 JS 端硬编码改为着色器端动态 discard。

**Tech Stack:** Three.js + GLSL + Vite，无测试框架，通过 `pnpm dev` 目视验证。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/shaders/common/projections.glsl` | Modify | 新增 `wrapLon()` 工具函数 |
| `src/shaders/globe.vert` | Modify | 新增 `uCenterLon` uniform + 经度偏移 |
| `src/shaders/indicator.vert` | Modify | 新增 `uCenterLon` uniform + 偏移 + 日期线检测 varying |
| `src/shaders/tissot.frag` | Modify | 接收 varying，日期线附近 discard |
| `src/shaders/outline.frag` | Modify | 接收 varying，日期线附近 discard |
| `src/shaders/route.frag` | Modify | 接收 varying，日期线附近 discard |
| `src/main.js` | Modify | 新增 uniform、进度条事件、自转停止逻辑 |
| `src/indicators/tissot.js` | Modify | 删除 180° 硬编码分割，简化为统一圆几何体 |
| `src/indicators/greatCircleRoutes.js` | Modify | JS 投影函数加 uCenterLon 偏移 |

---

### Task 1: 共享 GLSL 工具函数

**Files:**
- Modify: `src/shaders/common/projections.glsl`

- [ ] **Step 1: 在 projections.glsl 末尾添加 wrapLon 函数**

在 `projections.glsl` 的 `easeInOutCubic` 函数之后、投影函数之前，添加：

```glsl
// 将经度包裹到 [-PI, PI]
float wrapLon(float lon) {
  return mod(lon + PI, 2.0 * PI) - PI;
}
```

完整文件内容确认：`wrapLon` 应该出现在 `easeInOutCubic` 之后、`projectMercator` 之前。

- [ ] **Step 2: 运行 pnpm dev 确认无编译错误**

Run: `pnpm dev`
Expected: Vite 正常启动，浏览器打开无 shader 编译错误

- [ ] **Step 3: Commit**

```bash
git add src/shaders/common/projections.glsl
git commit -m "feat: 添加 wrapLon 经度包裹工具函数"
```

---

### Task 2: 地球着色器加入 uCenterLon 偏移

**Files:**
- Modify: `src/shaders/globe.vert`

- [ ] **Step 1: 在 globe.vert 添加 uCenterLon uniform**

在文件顶部 uniform 声明区域（`uAzimuthalType` 之后）添加：

```glsl
uniform float uCenterLon;  // 投影中心经线（弧度），按下进度条时捕获
```

- [ ] **Step 2: 在 main() 中偏移经度**

在 `float longitude = atan(-cos(phi), sin(phi));` 之后、`vLongitude = longitude;` 之前，添加经度偏移：

将现有的投影调用代码：

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
  // 偏移经度，使投影中心对齐 uCenterLon
  float adjustedLon = wrapLon(longitude - uCenterLon);

  // 根据投影类型选择目标平面坐标
  vec3 flatPos;
  if (uProjectionID < 0.5) {
    flatPos = projectMercator(adjustedLon, latitude);
  } else if (uProjectionID < 1.5) {
    flatPos = projectPlateCarree(adjustedLon, latitude);
  } else if (uProjectionID < 2.5) {
    flatPos = projectConic(adjustedLon, latitude, uConicStdLat);
  } else {
    flatPos = projectAzimuthal(adjustedLon, latitude, uAzimuthalType);
  }
```

注意：`vLongitude = longitude;` 保持不变，传递原始经度供纹理采样用。

- [ ] **Step 3: 运行 pnpm dev 验证**

此时 `uCenterLon` 还没有 JS 端传入，默认值为 0，行为与之前完全一致。确认：
- 地球正常显示
- 拖动进度条展开正常

Run: `pnpm dev`

- [ ] **Step 4: Commit**

```bash
git add src/shaders/globe.vert
git commit -m "feat: 地球着色器加入 uCenterLon 经度偏移"
```

---

### Task 3: 指标着色器加入 uCenterLon 偏移 + 日期线检测

**Files:**
- Modify: `src/shaders/indicator.vert`

- [ ] **Step 1: 在 indicator.vert 添加 uCenterLon uniform 和 vNearDateline varying**

在 uniform 声明区域末尾（`uAzimuthalType` 之后）添加：

```glsl
uniform float uCenterLon;  // 投影中心经线（弧度）
```

在 varying 声明区域（`vLocalProgress` 之后）添加：

```glsl
varying float vNearDateline; // 日期线附近标记（用于片元 discard）
```

- [ ] **Step 2: 在 main() 中偏移经度并检测日期线**

将现有的 `applyProjection` 调用部分：

```glsl
  // 投影变换
  vec3 flatPos = applyProjection(longitude, latitude);
```

替换为：

```glsl
  // 偏移经度，使投影中心对齐 uCenterLon
  float adjustedLon = wrapLon(longitude - uCenterLon);

  // 投影变换（使用偏移后的经度）
  vec3 flatPos = applyProjection(adjustedLon, latitude);
```

在 `vLocalProgress = localProgress;` 之后添加日期线检测：

```glsl
  // 检测是否在日期线附近（偏移后经度接近 ±PI）
  // 用于片元着色器中 discard 跨日期线的三角形
  vNearDateline = 1.0 - smoothstep(0.0, 0.06, PI - abs(adjustedLon));
```

- [ ] **Step 3: 运行 pnpm dev 验证**

确认朝索椭圆和面积轮廓仍正常显示。`vNearDateline` 暂时未被片元着色器使用，不影响渲染。

Run: `pnpm dev`

- [ ] **Step 4: Commit**

```bash
git add src/shaders/indicator.vert
git commit -m "feat: 指标着色器加入 uCenterLon 偏移和日期线检测"
```

---

### Task 4: 片元着色器加入日期线 discard

**Files:**
- Modify: `src/shaders/tissot.frag`
- Modify: `src/shaders/outline.frag`
- Modify: `src/shaders/route.frag`

- [ ] **Step 1: tissot.frag 添加 discard 逻辑**

在 `varying float vDistortion;` 和 `varying float vLocalProgress;` 之后添加：

```glsl
varying float vNearDateline; // 日期线附近标记
```

在 `void main()` 的开头（第一行）添加：

```glsl
  if (vNearDateline > 0.5) discard;
```

- [ ] **Step 2: outline.frag 添加 discard 逻辑**

在 `uniform float uOpacity;` 之后添加：

```glsl
varying float vNearDateline;
```

在 `void main()` 的开头添加：

```glsl
  if (vNearDateline > 0.5) discard;
```

- [ ] **Step 3: route.frag 添加 discard 逻辑**

在 `uniform float uOpacity;` 之后添加：

```glsl
varying float vNearDateline;
```

在 `void main()` 的开头添加：

```glsl
  if (vNearDateline > 0.5) discard;
```

- [ ] **Step 4: 运行 pnpm dev 验证**

此时 `uCenterLon` 仍为 0，日期线就是 180° 经线。检查：
- 180° 经线上的朝索椭圆应该出现一个细缝（discard 效果）
- 其他位置的椭圆正常
- 大圆航线和轮廓线正常

Run: `pnpm dev`

- [ ] **Step 5: Commit**

```bash
git add src/shaders/tissot.frag src/shaders/outline.frag src/shaders/route.frag
git commit -m "feat: 片元着色器加入日期线 discard 处理"
```

---

### Task 5: JS 端 — main.js 加入 uCenterLon uniform 和事件

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 在 sharedUniforms 中添加 uCenterLon**

在 `sharedUniforms` 对象中，`uAzimuthalType` 之后添加：

```js
  uCenterLon: { value: 0.0 }
```

- [ ] **Step 2: 在 createGlobe 的 uniforms 中添加 uCenterLon**

在 `createGlobe()` 函数的 uniforms 对象中，`uAzimuthalType` 之后添加：

```js
    uCenterLon: sharedUniforms.uCenterLon,
```

- [ ] **Step 3: 添加进度条事件监听**

在现有 `slider.addEventListener('input', ...)` 之后添加：

```js
// 按下进度条时捕获可见半球中心经线
let peelingLocked = false;

slider.addEventListener('mousedown', () => {
  if (progress < 0.01) {
    // 从相机位置计算朝向的经线
    sharedUniforms.uCenterLon.value = Math.atan2(-camera.position.x, camera.position.z);
    peelingLocked = true;
  }
});
slider.addEventListener('touchstart', () => {
  if (progress < 0.01) {
    sharedUniforms.uCenterLon.value = Math.atan2(-camera.position.x, camera.position.z);
    peelingLocked = true;
  }
});
```

- [ ] **Step 4: 修改 input 事件，progress 归零时释放 centerLon**

将现有的 `input` 事件处理器：

```js
slider.addEventListener('input', (e) => {
  progress = parseInt(e.target.value) / 100;
  progressLabel.textContent = e.target.value + '%';
});
```

替换为：

```js
slider.addEventListener('input', (e) => {
  progress = parseInt(e.target.value) / 100;
  progressLabel.textContent = e.target.value + '%';
  // progress 归零时释放中心经线
  if (progress < 0.01) {
    sharedUniforms.uCenterLon.value = 0.0;
    peelingLocked = false;
  }
});
```

- [ ] **Step 5: 修改自转逻辑，按下进度条时停止**

将 animate() 中的自转条件：

```js
  if (progress < 0.05 && globe) {
    globe.mesh.rotation.y += 0.002;
```

替换为：

```js
  if (progress < 0.05 && !peelingLocked && globe) {
    globe.mesh.rotation.y += 0.002;
```

- [ ] **Step 6: 运行 pnpm dev 验证完整交互**

验证流程：
1. 地球自转中
2. 旋转地球到某个角度（如看到亚洲）
3. 按下进度条拖动到 50%
4. 展开动画应该从相机朝向的经线开始
5. 拖回 0%，地球恢复自转
6. 再次拖动，从新的视角重新捕获中心

Run: `pnpm dev`

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat: 进度条按下时捕获可见半球中心经线作为剥橘子起点"
```

---

### Task 6: 简化 tissot.js — 删除硬编码 180° 分割

**Files:**
- Modify: `src/indicators/tissot.js`

- [ ] **Step 1: 删除 createSplitCircleGeometries 函数**

删除 `tissot.js` 中的 `createSplitCircleGeometries` 函数整体（约第 130-180 行）。

- [ ] **Step 2: 删除 createSplitOutlineGeometries 函数**

删除 `tissot.js` 中的 `createSplitOutlineGeometries` 函数整体（约第 187-216 行）。

- [ ] **Step 3: 删除 180° 经线分割的调用代码**

删除 `createTissotIndicators` 函数末尾的 180° 分割循环（约第 287-302 行）：

```js
  // 180° 经线上的圆：拆分为两个半圆，避免跨日期变更线拉伸
  const splitLats = [];
  for (let lat = -60; lat <= 60; lat += LAT_STEP) splitLats.push(lat);
  splitLats.push(-75, 75);

  for (const lat of splitLats) {
    ...
  }
```

- [ ] **Step 4: 修改主循环，让 180° 经线也用完整圆**

将主循环中经度范围 `-150` 到 `180`（不含 180）：

```js
    for (let lon = -150; lon < 180; lon += LON_STEP) {
```

改为包含 180°（使用 `<=`）：

```js
    for (let lon = -150; lon <= 180; lon += LON_STEP) {
```

同样修改高纬度循环：

```js
    for (let lon = -120; lon < 180; lon += 60) {
```

改为：

```js
    for (let lon = -120; lon <= 180; lon += 60) {
```

- [ ] **Step 5: 运行 pnpm dev 验证**

验证：
- 180° 经线上的朝索椭圆正常显示为完整圆形
- 展开时 180° 处的椭圆在日期线位置有 discard 效果
- 其他位置无变化

Run: `pnpm dev`

- [ ] **Step 6: Commit**

```bash
git add src/indicators/tissot.js
git commit -m "refactor: 朝索椭圆删除硬编码 180° 分割，改由着色器动态处理"
```

---

### Task 7: greatCircleRoutes.js JS 投影函数加偏移

**Files:**
- Modify: `src/indicators/greatCircleRoutes.js`

- [ ] **Step 1: 添加 wrapLon 工具函数**

在文件顶部常量区域之后添加：

```js
function wrapLon(lon) {
  return ((lon % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
}
```

- [ ] **Step 2: 修改 jsApplyProjection 加入偏移**

将现有的 `jsApplyProjection` 函数：

```js
function jsApplyProjection(lon, lat, uniforms) {
  const id = uniforms.uProjectionID.value;
  if (id < 0.5) return jsProjectMercator(lon, lat);
  if (id < 1.5) return jsProjectPlateCarree(lon, lat);
  if (id < 2.5) return jsProjectConic(lon, lat, uniforms.uConicStdLat.value);
  return jsProjectAzimuthal(lon, lat, uniforms.uAzimuthalType.value);
}
```

替换为：

```js
function jsApplyProjection(lon, lat, uniforms) {
  const adjustedLon = wrapLon(lon - uniforms.uCenterLon.value);
  const id = uniforms.uProjectionID.value;
  if (id < 0.5) return jsProjectMercator(adjustedLon, lat);
  if (id < 1.5) return jsProjectPlateCarree(adjustedLon, lat);
  if (id < 2.5) return jsProjectConic(adjustedLon, lat, uniforms.uConicStdLat.value);
  return jsProjectAzimuthal(adjustedLon, lat, uniforms.uAzimuthalType.value);
}
```

- [ ] **Step 3: 运行 pnpm dev 验证**

验证：
- 大圆航线标签和发光粒子在展开时跟随投影中心偏移
- 城市 label 位置正确
- 拖回 0% 后一切恢复

Run: `pnpm dev`

- [ ] **Step 4: Commit**

```bash
git add src/indicators/greatCircleRoutes.js
git commit -m "feat: 大圆航线 JS 投影函数加入 uCenterLon 偏移"
```

---

### Task 8: 最终验证

- [ ] **Step 1: 完整交互测试**

测试以下场景：
1. 默认状态（0%），地球自转 → 正常
2. 旋转到非洲朝前，按下进度条 → 展开从非洲中心开始
3. 拖到 100% → 完整展开，投影中心正确
4. 拖回 0% → 恢复球体，地球恢复自转
5. 切换不同投影（墨卡托/等距柱状/圆锥/方位）→ 偏移都正确
6. 朝索椭圆开启 → 日期线处有 discard 缝隙，其他位置正常
7. 大圆航线 → 标签和粒子位置跟随偏移

- [ ] **Step 2: 边界情况测试**

- 相机在 0° 经线正前方按下 → 行为与旧版一致
- 相机在 180° 经线附近按下 → 日期线偏移到 0° 附近
- 快速拖动进度条来回 → 无闪烁或跳变

- [ ] **Step 3: Final commit（如有修复）**

```bash
git add -A
git commit -m "fix: 修复动态中心经线边界情况"
```

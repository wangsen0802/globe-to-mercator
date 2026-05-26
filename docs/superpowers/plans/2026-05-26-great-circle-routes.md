# 大圆航线 + 特征点标注 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在地球上绘制 3 条经典大圆航线与恒向线对比，辅以城市标注，展示投影变形对距离和方向的影响。

**Architecture:** 单模块 `greatCircleRoutes.js` 包含航线（THREE.Line + indicator.vert/route.frag）和城市标注（THREE.Sprite）。航线顶点经 indicator.vert 自动跟随投影变换和剥橘子动画；城市 Sprite 需在 JS 端同步投影位置（每帧 updateLabels 调用）。日期变更线交叉通过分割线段处理。

**Tech Stack:** Three.js, GLSL (indicator.vert + route.frag), Canvas 纹理 (Sprite)

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/shaders/route.frag` | 航线片段着色器（uniform 颜色 + 透明度） |
| 新建 | `src/indicators/greatCircleRoutes.js` | 航线几何体 + 城市标注 + JS 投影同步 |
| 修改 | `src/main.js` | 导入注册、animate 同步、toggle 回调 |
| 修改 | `src/ui/indicatorPanel.js` | 新增 toggle + 图例 |

---

### Task 1: 创建 route.frag 着色器

**Files:**
- Create: `src/shaders/route.frag`

- [ ] **Step 1: 创建片段着色器文件**

```glsl
// 航线片段着色器 — uniform 颜色 + 透明度
uniform vec3 uColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
```

- [ ] **Step 2: 提交**

```bash
git add src/shaders/route.frag
git commit -m "feat: 添加航线片段着色器 route.frag"
```

---

### Task 2: 创建 greatCircleRoutes.js — 航线数据与数学函数

**Files:**
- Create: `src/indicators/greatCircleRoutes.js`

- [ ] **Step 1: 编写文件头部 — 导入、常量、航线数据**

文件前 30 行：

```javascript
import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import routeFrag from '../shaders/route.frag?raw';

const PI = Math.PI;
const DEG2RAD = PI / 180;

// 航线数据：每条航线包含起点和终点的城市名与经纬度（度数）
const ROUTES = [
  { from: { name: '伦敦', lat: 51.5, lon: 0 }, to: { name: '纽约', lat: 40.7, lon: -74 } },
  { from: { name: '东京', lat: 35.7, lon: 139.7 }, to: { name: '洛杉矶', lat: 34.0, lon: -118.2 } },
  { from: { name: '悉尼', lat: -33.9, lon: 151.2 }, to: { name: '圣地亚哥', lat: -33.4, lon: -70.7 } },
];

const GC_SEGMENTS = 100;      // 大圆/恒向线插值段数
const GC_COLOR = 0x4fc3f7;    // 大圆线颜色（青色）
const RL_COLOR = 0xff9800;    // 恒向线颜色（橙色）
```

- [ ] **Step 2: 编写坐标转换与大圆插值函数**

在常量定义之后添加：

```javascript
// 经纬度（弧度）→ 球面笛卡尔坐标
function latLonToXYZ(lat, lon) {
  return [
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  ];
}

// 球面笛卡尔坐标 → 经纬度（弧度）
function xyzToLatLon(x, y, z) {
  return [
    Math.asin(Math.max(-1, Math.min(1, y))),
    Math.atan2(x, z),
  ];
}

// 球面线性插值（Slerp）— 生成大圆弧上的中间点
function slerp(p1, p2, t) {
  const dot = Math.max(-1, Math.min(1, p1[0]*p2[0] + p1[1]*p2[1] + p1[2]*p2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [...p1];
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  return [a*p1[0]+b*p2[0], a*p1[1]+b*p2[1], a*p1[2]+b*p2[2]];
}

// 生成大圆航线上的经纬度点序列
function generateGreatCirclePoints(from, to) {
  const lat1 = from.lat * DEG2RAD, lon1 = from.lon * DEG2RAD;
  const lat2 = to.lat * DEG2RAD, lon2 = to.lon * DEG2RAD;
  const p1 = latLonToXYZ(lat1, lon1);
  const p2 = latLonToXYZ(lat2, lon2);
  const points = [];
  for (let i = 0; i <= GC_SEGMENTS; i++) {
    const t = i / GC_SEGMENTS;
    const p = slerp(p1, p2, t);
    const [lat, lon] = xyzToLatLon(p[0], p[1], p[2]);
    points.push({ lat, lon });
  }
  return points;
}
```

- [ ] **Step 3: 编写恒向线插值函数**

在大圆函数之后添加：

```javascript
// 生成恒向线（等角航线）上的经纬度点序列
// 恒向线在墨卡托投影中是直线：Mercator 参数 ψ = ln(tan(π/4 + φ/2)) 线性变化
function generateRhumbLinePoints(from, to) {
  const lat1 = from.lat * DEG2RAD, lon1 = from.lon * DEG2RAD;
  const lat2 = to.lat * DEG2RAD, lon2 = to.lon * DEG2RAD;

  const psi1 = Math.log(Math.tan(PI / 4 + lat1 / 2));
  const psi2 = Math.log(Math.tan(PI / 4 + lat2 / 2));
  const dPsi = psi2 - psi1;

  // 取最短经度差（处理日期变更线）
  let dLon = lon2 - lon1;
  if (dLon > PI) dLon -= 2 * PI;
  if (dLon < -PI) dLon += 2 * PI;

  const points = [];
  for (let i = 0; i <= GC_SEGMENTS; i++) {
    const t = i / GC_SEGMENTS;
    const psi = psi1 + t * dPsi;
    const lat = 2 * Math.atan(Math.exp(psi)) - PI / 2;
    const lon = Math.abs(dPsi) < 1e-6
      ? lon1 + t * dLon                    // 近乎平行时线性插值
      : lon1 + dLon * (psi - psi1) / dPsi; // 标准恒向线公式
    points.push({ lat, lon });
  }
  return points;
}
```

- [ ] **Step 4: 编写日期变更线分割函数**

```javascript
// 在日期变更线处将连续点序列分割为多段（避免跨 ±180° 拉伸）
function splitAtDateLine(points) {
  if (points.length < 2) return [points];
  const segments = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].lon - points[i - 1].lon) > PI) {
      if (current.length > 1) segments.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments.length > 0 ? segments : [points];
}
```

- [ ] **Step 5: 提交**

```bash
git add src/indicators/greatCircleRoutes.js
git commit -m "feat: 添加大圆航线数学工具（slerp、恒向线、日期变更线分割）"
```

---

### Task 3: 创建 greatCircleRoutes.js — 几何体与材质

**Files:**
- Modify: `src/indicators/greatCircleRoutes.js` (追加在 Task 2 代码之后)

- [ ] **Step 1: 编写 Line 几何体创建函数**

在 `splitAtDateLine` 之后添加：

```javascript
// 从经纬度点序列创建 THREE.Line 的 BufferGeometry
// 每个顶点设置 position（球面坐标）、aLatitude、aLongitude
function createLineGeometry(points) {
  const positions = [];
  const latitudes = [];
  const longitudes = [];
  for (const p of points) {
    positions.push(
      Math.cos(p.lat) * Math.sin(p.lon),
      Math.sin(p.lat),
      Math.cos(p.lat) * Math.cos(p.lon),
    );
    latitudes.push(p.lat);
    longitudes.push(p.lon);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  geo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));
  return geo;
}

// 为单条航线创建所有 Line mesh（大圆 + 恒向线，各自可能因日期变更线分割为多段）
function createRouteLines(route, uniforms) {
  const meshes = [];

  // 大圆线（青色）
  const gcPoints = generateGreatCirclePoints(route.from, route.to);
  for (const seg of splitAtDateLine(gcPoints)) {
    const geo = createLineGeometry(seg);
    const mat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: routeFrag,
      uniforms: { ...uniforms, uColor: { value: new THREE.Color(GC_COLOR) }, uOpacity: { value: 0.8 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    meshes.push(new THREE.Line(geo, mat));
  }

  // 恒向线（橙色）
  const rlPoints = generateRhumbLinePoints(route.from, route.to);
  for (const seg of splitAtDateLine(rlPoints)) {
    const geo = createLineGeometry(seg);
    const mat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: routeFrag,
      uniforms: { ...uniforms, uColor: { value: new THREE.Color(RL_COLOR) }, uOpacity: { value: 0.8 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    meshes.push(new THREE.Line(geo, mat));
  }

  return meshes;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/indicators/greatCircleRoutes.js
git commit -m "feat: 添加航线几何体创建（大圆 + 恒向线 Line mesh）"
```

---

### Task 4: 创建 greatCircleRoutes.js — 城市标注与 JS 投影同步

**Files:**
- Modify: `src/indicators/greatCircleRoutes.js` (追加在 Task 3 代码之后)

- [ ] **Step 1: 编写 JS 端投影函数（与 indicator.vert 一致）**

在 `createRouteLines` 之后添加：

```javascript
// ===== JS 端投影函数（与 indicator.vert 保持一致，用于 Sprite 位置同步） =====

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function jsProjectMercator(lon, lat) {
  return [lon, Math.max(-2.5, Math.min(2.5, Math.log(Math.tan(PI / 4 + lat / 2)))), 0];
}

function jsProjectPlateCarree(lon, lat) {
  return [lon, lat, 0];
}

function jsProjectConic(lon, lat, stdLat) {
  const n = Math.sin(Math.max(0.1, Math.min(1.4, stdLat)));
  const tanStd = Math.max(0.001, Math.tan(PI / 4 + stdLat / 2));
  const F = Math.cos(stdLat) * Math.pow(tanStd, n) / Math.max(0.01, n);
  const clampedLat = Math.max(-1.3, Math.min(1.3, lat));
  const tanLat = Math.max(0.001, Math.tan(PI / 4 + clampedLat / 2));
  const rho = F / Math.pow(tanLat, n);
  const tanEq = Math.max(0.001, Math.tan(PI / 4));
  const rhoEq = F / Math.pow(tanEq, n);
  const theta = n * lon;
  return [rho * Math.sin(theta), rhoEq - rho * Math.cos(theta), 0];
}

function jsProjectAzimuthal(lon, lat, type) {
  if (type < 0.5) {
    const z = Math.min(Math.cos(lat) * Math.cos(lon), 0) * 0.08;
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), z];
  }
  const clampedLat = Math.max(-1.4, Math.min(1.4, lat));
  const k = 2 / Math.max(0.01, 1 + Math.sin(clampedLat));
  return [k * Math.cos(clampedLat) * Math.sin(lon), k * Math.cos(clampedLat) * Math.cos(lon), 0];
}

function jsApplyProjection(lon, lat, uniforms) {
  const id = uniforms.uProjectionID.value;
  if (id < 0.5) return jsProjectMercator(lon, lat);
  if (id < 1.5) return jsProjectPlateCarree(lon, lat);
  if (id < 2.5) return jsProjectConic(lon, lat, uniforms.uConicStdLat.value);
  return jsProjectAzimuthal(lon, lat, uniforms.uAzimuthalType.value);
}

// 计算城市标注的插值位置（球面 ↔ 投影平面）
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

- [ ] **Step 2: 编写城市 Sprite 创建函数**

在 JS 投影函数之后添加：

```javascript
// 创建城市标注 Sprite（Canvas 纹理：发光圆点 + 城市名）
function createCitySprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // 发光圆点
  const g = ctx.createRadialGradient(28, 32, 0, 28, 32, 10);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(28, 32, 10, 0, 2 * PI);
  ctx.fill();

  // 城市名
  ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 46, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  }));
  sprite.scale.set(0.4, 0.1, 1);
  return sprite;
}
```

- [ ] **Step 3: 编写工厂函数 createGreatCircleRoutes 与 updateLabels**

在 Sprite 函数之后添加（文件末尾）：

```javascript
/**
 * 创建大圆航线 + 城市标注指标
 * @param {Object} uniforms - 共享 uniform 对象
 * @returns {{ group: THREE.Group, updateLabels: Function }}
 */
export function createGreatCircleRoutes(uniforms) {
  const group = new THREE.Group();
  const sprites = []; // { sprite, lat, lon }

  for (const route of ROUTES) {
    // 航线 Line mesh
    for (const mesh of createRouteLines(route, uniforms)) {
      group.add(mesh);
    }

    // 起终点城市标注
    for (const city of [route.from, route.to]) {
      const sprite = createCitySprite(city.name);
      const lat = city.lat * DEG2RAD;
      const lon = city.lon * DEG2RAD;
      const pos = latLonToXYZ(lat, lon);
      sprite.position.set(pos[0], pos[1], pos[2]);
      group.add(sprite);
      sprites.push({ sprite, lat, lon });
    }
  }

  // 每帧调用：同步城市标注到当前投影位置
  function updateLabels(progress) {
    for (const { sprite, lat, lon } of sprites) {
      const p = computeLabelPosition(lat, lon, progress, uniforms);
      sprite.position.set(p[0], p[1], p[2]);
    }
  }

  return { group, updateLabels };
}
```

- [ ] **Step 4: 提交**

```bash
git add src/indicators/greatCircleRoutes.js
git commit -m "feat: 完成大圆航线指标（城市标注 + JS 投影同步）"
```

---

### Task 5: 集成到 main.js

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 添加导入语句**

在第 9 行 `import { createAreaComparison }` 之后添加：

```javascript
import { createGreatCircleRoutes } from './indicators/greatCircleRoutes.js';
```

- [ ] **Step 2: 创建并注册航线指标**

在第 125 行 `areaComparison.group.visible = false;` 之后添加：

```javascript
const greatCircleRoutes = createGreatCircleRoutes(sharedUniforms);
scene.add(greatCircleRoutes.group);
greatCircleRoutes.group.visible = false;
```

- [ ] **Step 3: 添加 indicatorPanel 回调**

将第 206-209 行的 `initIndicatorPanel` 调用修改为：

```javascript
initIndicatorPanel({
  onTissotToggle: (visible) => { tissotIndicators.group.visible = visible; },
  onAreaToggle: (visible) => { areaComparison.group.visible = visible; },
  onRouteToggle: (visible) => { greatCircleRoutes.group.visible = visible; }
});
```

- [ ] **Step 4: 在 animate 循环中同步标注位置和自转**

在第 218 行 `sharedUniforms.uProgress.value = progress;` 之后添加：

```javascript
greatCircleRoutes.updateLabels(progress);
```

在第 223-224 行（tissotIndicators 和 areaComparison 的 rotation.y 同步之后）添加：

```javascript
greatCircleRoutes.group.rotation.y = globe.mesh.rotation.y;
```

- [ ] **Step 5: 提交**

```bash
git add src/main.js
git commit -m "feat: main.js 集成大圆航线指标"
```

---

### Task 6: 添加 UI 开关到 indicatorPanel.js

**Files:**
- Modify: `src/ui/indicatorPanel.js`

- [ ] **Step 1: 修改 initIndicatorPanel 函数签名注释**

将第 22 行的 `opts.onAreaToggle` 注释之后添加：

```javascript
 * @param {Function} opts.onRouteToggle - 大圆航线开关回调
```

- [ ] **Step 2: 在面积比较 toggle 之后（第 43 行后）添加大圆航线 toggle + 图例**

在 `section.appendChild(areaRow);` 之后、`// 面积信息区域` 注释之前添加：

```javascript
  // 大圆航线开关
  const routeRow = createToggleRow('toggle-route', '大圆航线', false, (checked) => {
    opts.onRouteToggle(checked);
  });
  section.appendChild(routeRow);

  // 航线图例
  const routeLegend = el('div', 'area-info');
  routeLegend.id = 'route-legend';
  routeLegend.style.display = 'none';

  const legendTitle = el('div', '');
  legendTitle.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-top:8px;margin-bottom:4px;';
  legendTitle.textContent = '航线类型';
  routeLegend.appendChild(legendTitle);

  routeLegend.appendChild(createLegendRow('#4fc3f7', '——', '大圆（最短路径）'));
  routeLegend.appendChild(createLegendRow('#ff9800', '---', '恒向线（等角航线）'));

  section.appendChild(routeLegend);
```

- [ ] **Step 3: 在 checkbox change 事件中添加图例联动**

在 `createToggleRow` 函数中的 checkbox event listener（第 93-100 行），在现有 `if (id === 'toggle-area')` 块之后添加：

```javascript
    if (id === 'toggle-route') {
      const routeLegend = document.getElementById('route-legend');
      if (routeLegend) routeLegend.style.display = checkbox.checked ? 'block' : 'none';
    }
```

- [ ] **Step 4: 添加 createLegendRow 辅助函数**

在 `createAreaRow` 函数之后添加：

```javascript
function createLegendRow(color, symbol, label) {
  const row = el('div', 'area-row');
  const line = el('span', 'area-dot');
  line.style.background = color;
  line.style.width = '20px';
  line.style.height = '3px';
  line.style.borderRadius = '1px';
  row.appendChild(line);
  row.appendChild(el('span', '', ' ' + label));
  return row;
}
```

- [ ] **Step 5: 提交**

```bash
git add src/ui/indicatorPanel.js
git commit -m "feat: 添加大圆航线 toggle 开关 + 图例面板"
```

---

### Task 7: 可视化验证

- [ ] **Step 1: 启动开发服务器**

```bash
pnpm dev
```

- [ ] **Step 2: 逐项验证**

检查清单：
1. 默认状态：航线不可见（toggle 默认关闭）
2. 打开 "大圆航线" toggle → 3 条航线可见（青色大圆 + 橙色恒向线）
3. 6 个城市标注可见（伦敦、纽约、东京、洛杉矶、悉尼、圣地亚哥）
4. 拖动滑块 0→100% → 航线跟随剥橘子动画展开到平面
5. 切换 4 种投影 → 航线和标注跟随投影变形
6. 图例面板随 toggle 开关显隐

- [ ] **Step 3: 修复发现的问题（如有）并提交**

---

## 自检清单

- [x] 设计规范所有需求都有对应任务覆盖
- [x] 无 TBD / TODO / placeholder
- [x] 函数名、变量名在 Task 间一致（latLonToXYZ, createLineGeometry, updateLabels, uniforms）
- [x] 日期变更线处理已包含（splitAtDateLine）
- [x] JS 投影函数与 indicator.vert 一致
- [x] Sprite 位置同步逻辑完整（球面↔平面插值）

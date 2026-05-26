# Phase 1: 投影框架重构 + 圆锥投影 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构现有 shader 为可插拔投影架构，新增圆锥和方位投影，添加教育信息面板，实现 4 种投影可切换。

**Architecture:** Vertex shader 通过 `uProjectionID` uniform 分支选择投影函数；JS 端投影模块统一导出 `{ id, name, epsg, uniforms, info }` 结构；教育面板为 HTML overlay，数据驱动渲染。

**Tech Stack:** Three.js 0.170, Vite 6, GLSL, 原生 HTML/CSS（无额外依赖）

**Spec:** `docs/superpowers/specs/2026-05-26-map-projection-visualization-design.md`

---

## 文件变更清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `src/utils/math.js` | 共用数学常量 |
| 创建 | `src/projections/mercator.js` | 墨卡托投影模块 |
| 创建 | `src/projections/plateCarree.js` | 等距柱状投影模块 |
| 创建 | `src/projections/conic.js` | 圆锥投影模块（Lambert） |
| 创建 | `src/projections/azimuthal.js` | 方位投影模块（正射/立体） |
| 创建 | `src/projections/index.js` | 投影注册表 |
| 创建 | `src/ui/projectionPanel.js` | 教育面板 JS |
| 修改 | `src/shaders/globe.vert` | 重构为投影函数分支 |
| 修改 | `src/main.js` | 使用投影注册表，动态生成按钮，驱动面板 |
| 修改 | `index.html` | 添加教育面板 HTML + 新 CSS |

---

### Task 1: 创建目录结构和共用数学工具

**Files:**
- Create: `src/utils/math.js`

- [ ] **Step 1: 创建目录结构**

```bash
cd /Users/wangsen/person_project/globe-to-mercator
mkdir -p src/projections src/ui src/utils
```

- [ ] **Step 2: 创建 `src/utils/math.js`**

```js
// 共用数学常量
export const PI = Math.PI;
export const DEG2RAD = PI / 180;
export const RAD2DEG = 180 / PI;
```

- [ ] **Step 3: 验证目录结构**

```bash
ls -R src/projections src/ui src/utils
```

Expected: 三个空目录存在

- [ ] **Step 4: 提交**

```bash
git add src/utils/math.js
git commit -m "chore: 创建目录结构和共用数学常量"
```

---

### Task 2: 创建 4 个投影模块

**Files:**
- Create: `src/projections/mercator.js`
- Create: `src/projections/plateCarree.js`
- Create: `src/projections/conic.js`
- Create: `src/projections/azimuthal.js`

- [ ] **Step 1: 创建 `src/projections/mercator.js`**

```js
/**
 * 墨卡托投影 (Mercator Projection)
 * EPSG:3857 — Web 地图标准投影
 *
 * 公式：x = λ,  y = ln(tan(π/4 + φ/2))
 * 特点：保角投影，角度无变形，高纬度面积严重放大
 */
export const mercator = {
  id: 0,
  name: '墨卡托投影',
  epsg: 'EPSG:3857',
  uniforms: {},
  info: {
    forwardFormula: 'x = λ\ny = ln(tan(π/4 + φ/2))',
    inverseFormula: 'λ = x\nφ = 2·arctan(eʸ) - π/2',
    properties: [
      { name: '保角（角度不变）', valid: true },
      { name: '等面积', valid: false },
      { name: '等距', valid: false },
      { name: '恒向线为直线', valid: true },
    ],
    useCases: '航海导航、Web 地图（Google Maps / 高德地图）',
    distortion: '高纬度面积严重放大，格陵兰显得和非洲一样大'
  }
};
```

- [ ] **Step 2: 创建 `src/projections/plateCarree.js`**

```js
/**
 * 等距柱状投影 (Plate Carrée / Equirectangular)
 * EPSG:4326 / EPSG:4490 — 最简单的地图投影
 *
 * 公式：x = λ,  y = φ
 * 特点：经纬度直接映射为 XY，无任何数学变换
 */
export const plateCarree = {
  id: 1,
  name: '等距柱状投影',
  epsg: 'EPSG:4326',
  uniforms: {},
  info: {
    forwardFormula: 'x = λ\ny = φ',
    inverseFormula: 'λ = x\nφ = y',
    properties: [
      { name: '保角（角度不变）', valid: false },
      { name: '等面积', valid: false },
      { name: '沿经线等距', valid: true },
      { name: '恒向线为直线', valid: true },
    ],
    useCases: '简单数据存储、GIS 基础底图、卫星影像默认投影',
    distortion: '高纬度水平拉伸，形状压扁；面积在高纬度放大'
  }
};
```

- [ ] **Step 3: 创建 `src/projections/conic.js`**

```js
/**
 * 圆锥投影 — Lambert 正形圆锥投影 (Lambert Conformal Conic)
 *
 * 公式：
 *   n = sin(φ₁)
 *   F = cos(φ₁) · tan^n(π/4 + φ₁/2) / n
 *   ρ = F / tan^n(π/4 + φ/2)
 *   θ = n · λ
 *   x = ρ · sin(θ)
 *   y = ρ₀ - ρ · cos(θ)
 *
 * 特点：保角投影，中纬度区域变形小，航空图常用
 */
export const conic = {
  id: 2,
  name: '圆锥投影（Lambert）',
  epsg: 'Lambert Conformal Conic',
  // shader 中需要额外 uniform：uConicStdLat（标准纬线，弧度）
  uniforms: {
    uConicStdLat: 0.5236  // 30°N，适合展示中国/中纬度区域
  },
  info: {
    forwardFormula: 'n = sin(φ₁)\nρ = F / tan^n(π/4 + φ/2)\nθ = n · λ\nx = ρ · sin(θ)\ny = ρ₀ - ρ · cos(θ)',
    inverseFormula: 'θ = atan2(x, ρ₀ - y)\nλ = θ / n + λ₀\nφ = 2·arctan((F/ρ)^(1/n)) - π/2',
    properties: [
      { name: '保角（角度不变）', valid: true },
      { name: '等面积', valid: false },
      { name: '等距', valid: false },
      { name: '大圆近似直线', valid: true },
    ],
    useCases: '航空图、中纬度国家地图（中国、美国、欧洲）',
    distortion: '标准纬线处无变形，远离标准纬线面积变形增大；极点附近收敛为一点'
  }
};
```

- [ ] **Step 4: 创建 `src/projections/azimuthal.js`**

```js
/**
 * 方位投影 (Azimuthal Projection)
 * 包含：正射投影 (Orthographic) 和 立体投影 (Stereographic)
 *
 * 正射公式：x = cos(φ)·sin(λ),  y = sin(φ)
 * 立体公式：k = 2/(1+sin(φ)),  x = k·cos(φ)·sin(λ),  y = k·cos(φ)·cos(λ)
 *
 * 特点：从特定点（通常为极点或球心）投影到切平面
 */
export const azimuthal = {
  id: 3,
  name: '方位投影',
  epsg: 'Azimuthal',
  // shader 中需要额外 uniform：uAzimuthalType（0=正射, 1=立体）
  uniforms: {
    uAzimuthalType: 0.0
  },
  info: {
    forwardFormula: '正射: x = cos(φ)·sin(λ)\n     y = sin(φ)\n\n立体: k = 2/(1+sin(φ))\n     x = k·cos(φ)·sin(λ)\n     y = k·cos(φ)·cos(λ)',
    inverseFormula: '正射: λ = atan2(x, cos(φ\'))\n     φ = asin(y)\n\n立体: ρ = √(x²+y²)\n     c = 2·atan(ρ/2)\n     φ = asin(cos(c)·sin(φ₁) + y·sin(c)·cos(φ₁)/ρ)',
    properties: [
      { name: '保角（角度不变）', valid: false },
      { name: '等面积', valid: false },
      { name: '从中心点方向正确', valid: true },
      { name: '大圆为直线（立体投影）', valid: true },
    ],
    useCases: '正射：从太空看地球的视角；立体：极地地图、航空导航',
    distortion: '正射只能看到半球，边缘压缩严重；立体面积变形随离中心距离增大而增大'
  }
};
```

- [ ] **Step 5: 提交**

```bash
git add src/projections/
git commit -m "feat: 创建 4 个投影模块（墨卡托、等距柱状、圆锥、方位）"
```

---

### Task 3: 创建投影注册表

**Files:**
- Create: `src/projections/index.js`

- [ ] **Step 1: 创建 `src/projections/index.js`**

```js
import { mercator } from './mercator.js';
import { plateCarree } from './plateCarree.js';
import { conic } from './conic.js';
import { azimuthal } from './azimuthal.js';

const projections = [mercator, plateCarree, conic, azimuthal];

/**
 * 通过 id 获取投影配置
 * @param {number} id 投影 ID (0-3)
 * @returns {object} 投影配置对象
 */
export function getProjection(id) {
  return projections.find(p => p.id === id) || mercator;
}

/**
 * 获取所有投影列表
 * @returns {object[]}
 */
export function getAllProjections() {
  return projections;
}
```

- [ ] **Step 2: 验证模块可导入**

```bash
cd /Users/wangsen/person_project/globe-to-mercator
node --input-type=module -e "
import { getAllProjections, getProjection } from './src/projections/index.js';
const all = getAllProjections();
console.log('投影数量:', all.length);
console.log('名称:', all.map(p => p.name).join(', '));
const m = getProjection(0);
console.log('ID=0:', m.name, m.epsg);
"
```

Expected: 输出 4 个投影名称，ID=0 为墨卡托投影。

- [ ] **Step 3: 提交**

```bash
git add src/projections/index.js
git commit -m "feat: 创建投影注册表，统一 getProjection/getAllProjections 接口"
```

---

### Task 4: 重构顶点着色器

**Files:**
- Modify: `src/shaders/globe.vert`

这是最关键的任务。将现有的双投影 shader 重构为支持 4 种投影的可插拔架构。

- [ ] **Step 1: 重写 `src/shaders/globe.vert`**

完整替换为：

```glsl
uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionID;   // 0=mercator, 1=plateCarree, 2=conic, 3=azimuthal

// 圆锥投影参数
uniform float uConicStdLat;    // Lambert 标准纬线（弧度）

// 方位投影参数
uniform float uAzimuthalType;  // 0=正射, 1=立体

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalProgress;
varying float vLatitude;
varying float vLongitude;

#define PI 3.14159265359

// 缓动函数：平滑的三次方 ease-in-out
float easeInOutCubic(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

// ===== 投影函数 =====

// 墨卡托投影 (EPSG:3857)
vec3 projectMercator(float lon, float lat) {
  float mercX = lon;
  float mercY = log(tan(PI / 4.0 + lat / 2.0));
  mercY = clamp(mercY, -2.5, 2.5);
  return vec3(mercX, mercY, 0.0);
}

// 等距柱状投影 (EPSG:4326)
vec3 projectPlateCarree(float lon, float lat) {
  return vec3(lon, lat, 0.0);
}

// 圆锥投影 — Lambert 正形圆锥投影
vec3 projectConic(float lon, float lat, float stdLat) {
  float n = sin(clamp(stdLat, 0.1, 1.4));

  // 标准纬线处的参考值
  float tanStd = max(tan(PI / 4.0 + stdLat / 2.0), 0.001);
  float F = cos(stdLat) * pow(tanStd, n) / max(n, 0.01);

  // 限制纬度避免极点处无穷大
  float clampedLat = clamp(lat, -1.3, 1.3);
  float tanLat = max(tan(PI / 4.0 + clampedLat / 2.0), 0.001);
  float rho = F / pow(tanLat, n);

  // 赤道处 rho 作为 y 基准
  float tanEq = max(tan(PI / 4.0), 0.001);
  float rhoEq = F / pow(tanEq, n);

  float theta = n * lon;

  return vec3(rho * sin(theta), rhoEq - rho * cos(theta), 0.0);
}

// 方位投影
vec3 projectAzimuthal(float lon, float lat, float type) {
  if (type < 0.5) {
    // 正射投影 (Orthographic) — 从无穷远处看地球
    return vec3(cos(lat) * sin(lon), sin(lat), 0.0);
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
}

void main() {
  // 原始球面位置和法线
  vec3 spherePos = position;
  vec3 sphereNormal = normal;

  // 从球面坐标计算经纬度
  float latitude = asin(clamp(normalize(position).y, -1.0, 1.0));
  float longitude = atan(position.x, position.z);

  // 传递经纬度给片元着色器
  vLatitude = latitude;
  vLongitude = longitude;

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

  // ===== "剥橘子" 逐层展开 =====
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (1.0 - uSpreadDelay + 0.001), 0.0, 1.0);

  localProgress = easeInOutCubic(localProgress);
  vLocalProgress = localProgress;

  // 在球面和平面之间插值位置
  vec3 finalPos = mix(spherePos, flatPos, localProgress);

  // 法线插值
  vec3 flatNormal = vec3(0.0, 0.0, 1.0);
  vec3 finalNormal = normalize(mix(sphereNormal, flatNormal, localProgress));

  vNormal = normalize(normalMatrix * finalNormal);
  vWorldPos = (modelMatrix * vec4(finalPos, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}
```

关键变更：
- `uProjectionType` → `uProjectionID`，支持 0/1/2/3 四种投影
- 新增 `uConicStdLat`、`uAzimuthalType` uniform
- 4 个独立投影函数，用 `float` 比较分支（WebGL 兼容性优于 `int`）
- 圆锥投影用 `clamp` 处理极点无穷大
- 方位投影用 `clamp` 处理立体投影分母为零
- "剥橘子"逻辑完全保持不变

- [ ] **Step 2: 提交**

```bash
git add src/shaders/globe.vert
git commit -m "refactor: 重构顶点着色器为可插拔投影架构，支持 4 种投影"
```

---

### Task 5: 重构 main.js

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 重写 `src/main.js`**

完整替换为：

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import vertexShader from './shaders/globe.vert?raw';
import fragmentShader from './shaders/globe.frag?raw';
import { getAllProjections, getProjection } from './projections/index.js';
import { initPanel, updatePanel } from './ui/projectionPanel.js';

// ===== 全局状态 =====
let progress = 0;
let currentProjection = getProjection(0);
const LON_SEGMENTS = 360;
const LAT_SEGMENTS = 180;
const SPREAD_DELAY = 0.35;

// ===== 场景初始化 =====
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.insertBefore(renderer.domElement, container.firstChild);

// ===== 控制器 =====
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 8;

// ===== 加载纹理 =====
const textureLoader = new THREE.TextureLoader();
const EARTH_TEXTURE_URL = './assets/earth-blue-marble.jpg';

function buildUniforms() {
  return {
    uProgress: { value: 0.0 },
    uSpreadDelay: { value: SPREAD_DELAY },
    uTexture: { value: null },
    uLightDir: { value: new THREE.Vector3(1, 0.5, 1).normalize() },
    uProjectionID: { value: 0.0 },
    uConicStdLat: { value: 0.5236 },
    uAzimuthalType: { value: 0.0 }
  };
}

function createGlobe(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.SphereGeometry(1, LON_SEGMENTS, LAT_SEGMENTS);
  const uniforms = buildUniforms();
  uniforms.uTexture.value = texture;

  // 用当前投影的额外 uniform 覆盖默认值
  Object.entries(currentProjection.uniforms).forEach(([key, val]) => {
    if (uniforms[key]) {
      uniforms[key].value = val;
    }
  });

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  return { mesh, material };
}

// ===== 星空背景 =====
function createStars() {
  const starsGeo = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 50;
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starsMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    sizeAttenuation: true
  });
  const stars = new THREE.Points(starsGeo, starsMat);
  scene.add(stars);
  return stars;
}

// ===== 初始化场景 =====
const stars = createStars();
let globe = null;

textureLoader.load(EARTH_TEXTURE_URL, (texture) => {
  globe = createGlobe(texture);
  console.log('地球纹理加载完成');
}, undefined, (err) => {
  console.warn('纹理加载失败，使用备用纹理', err);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#1a3a5c');
  gradient.addColorStop(0.2, '#2d6a4f');
  gradient.addColorStop(0.5, '#40916c');
  gradient.addColorStop(0.8, '#2d6a4f');
  gradient.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  ctx.fillStyle = '#52796f';
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 1024;
    const y = 100 + Math.random() * 312;
    const w = 30 + Math.random() * 100;
    const h = 20 + Math.random() * 60;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const fallbackTexture = new THREE.CanvasTexture(canvas);
  globe = createGlobe(fallbackTexture);
});

// ===== 投影切换按钮（动态生成） =====
const btnGroup = document.querySelector('.proj-btn-group');

getAllProjections().forEach(proj => {
  const btn = document.createElement('button');
  btn.className = 'proj-btn' + (proj.id === currentProjection.id ? ' active' : '');
  btn.dataset.projId = proj.id;
  btn.textContent = proj.epsg.length < 14 ? proj.epsg : proj.name;
  btn.addEventListener('click', () => switchProjection(proj.id));
  btnGroup.appendChild(btn);
});

function switchProjection(id) {
  currentProjection = getProjection(id);

  // 更新按钮状态
  btnGroup.querySelectorAll('.proj-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.projId) === id);
  });

  // 更新 shader uniforms
  if (globe) {
    globe.material.uniforms.uProjectionID.value = id;
    Object.entries(currentProjection.uniforms).forEach(([key, val]) => {
      if (globe.material.uniforms[key]) {
        globe.material.uniforms[key].value = val;
      }
    });
  }

  // 更新教育面板
  updatePanel(currentProjection);
}

// ===== 滑块交互 =====
const slider = document.getElementById('progress-slider');
const progressLabel = document.getElementById('progress-value');

slider.addEventListener('input', (e) => {
  progress = parseInt(e.target.value) / 100;
  progressLabel.textContent = e.target.value + '%';
});

// ===== 教育面板初始化 =====
initPanel(currentProjection);

// ===== 动画循环 =====
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  if (globe) {
    globe.material.uniforms.uProgress.value = progress;
  }

  if (progress < 0.05 && globe) {
    globe.mesh.rotation.y += 0.002;
  }

  stars.rotation.y += 0.0001;

  renderer.render(scene, camera);
}

animate();

// ===== 窗口自适应 =====
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

关键变更：
- 导入投影注册表和面板模块
- `projectionType` 变量 → `currentProjection` 对象
- `uProjectionType` → `uProjectionID`
- 新增 `uConicStdLat`、`uAzimuthalType` uniform（含默认值）
- 投影按钮由 JS 动态生成
- `switchProjection()` 统一处理按钮 + uniform + 面板

- [ ] **Step 2: 提交**

```bash
git add src/main.js
git commit -m "refactor: main.js 使用投影注册表，动态生成按钮，驱动面板"
```

---

### Task 6: 更新 index.html（面板 + CSS）

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 重写 `index.html`**

完整替换为：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>地球投影可视化</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; font-family: system-ui, -apple-system, sans-serif; }

    #canvas-container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    canvas { display: block; }

    /* 顶部投影切换按钮组 — 由 JS 动态填充 */
    .proj-btn-group {
      position: absolute;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(12px);
      padding: 5px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 10;
    }

    .proj-btn {
      background: transparent;
      color: rgba(255, 255, 255, 0.5);
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.25s ease;
      white-space: nowrap;
    }

    .proj-btn:hover { color: rgba(255, 255, 255, 0.8); }

    .proj-btn.active {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }

    /* 底部滑块 */
    #controls {
      position: absolute;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 16px;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(12px);
      padding: 14px 28px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 10;
    }

    #controls label {
      color: #fff;
      font-size: 13px;
      white-space: nowrap;
      opacity: 0.6;
    }

    #progress-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 360px;
      height: 5px;
      border-radius: 3px;
      background: linear-gradient(to right, #4a9eff, #ff6b6b);
      outline: none;
      cursor: pointer;
    }

    #progress-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
      cursor: grab;
    }

    #progress-slider::-webkit-slider-thumb:active {
      cursor: grabbing;
      transform: scale(1.2);
    }

    #progress-value {
      color: #fff;
      font-family: 'SF Mono', monospace;
      font-size: 13px;
      min-width: 36px;
      text-align: right;
    }

    /* ===== 右侧教育面板 ===== */
    #info-panel {
      position: absolute;
      top: 72px;
      right: 20px;
      width: 300px;
      max-height: calc(100vh - 160px);
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(12px);
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 20px;
      color: #fff;
      z-index: 10;
    }

    #info-panel::-webkit-scrollbar { width: 4px; }
    #info-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }

    .panel-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 2px;
    }

    .panel-epsg {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
      font-family: 'SF Mono', monospace;
      margin-bottom: 16px;
    }

    .panel-section {
      margin-bottom: 16px;
    }

    .panel-section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 8px;
    }

    .panel-formula {
      font-family: 'SF Mono', 'Menlo', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #7ec8e3;
      background: rgba(255, 255, 255, 0.05);
      padding: 10px 12px;
      border-radius: 8px;
      white-space: pre-wrap;
    }

    .panel-property {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      margin-bottom: 4px;
    }

    .panel-property .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .panel-property .dot.valid { background: #4ade80; }
    .panel-property .dot.invalid { background: #f87171; }

    .panel-text {
      font-size: 13px;
      line-height: 1.5;
      color: rgba(255, 255, 255, 0.7);
    }

    .panel-label {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div id="canvas-container">
    <!-- 投影按钮由 JS 动态生成 -->
    <div class="proj-btn-group"></div>

    <!-- 教育面板 -->
    <div id="info-panel"></div>

    <!-- 底部滑块 -->
    <div id="controls">
      <label>球体</label>
      <input type="range" id="progress-slider" min="0" max="100" value="0" />
      <label>平面</label>
      <span id="progress-value">0%</span>
    </div>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

变更说明：
- 删除硬编码的两个投影按钮（改为 JS 动态生成）
- 添加 `#info-panel` 教育面板容器
- 新增面板 CSS（玻璃态风格，与现有控件一致）
- 标题改为"地球投影可视化"

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: 更新 HTML 布局，添加教育面板容器和样式"
```

---

### Task 7: 创建教育面板 JS 模块

**Files:**
- Create: `src/ui/projectionPanel.js`

- [ ] **Step 1: 创建 `src/ui/projectionPanel.js`**

使用 DOM API（createElement + textContent）而非 innerHTML，确保安全。

```js
/**
 * 教育信息面板 — 显示当前投影的公式、特性和说明
 */

const panelEl = document.getElementById('info-panel');

/**
 * 创建一个带 class 的 div 元素
 */
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * 渲染面板内容
 * @param {object} proj 投影配置对象
 */
function renderPanel(proj) {
  const { info } = proj;

  // 清空面板
  panelEl.textContent = '';

  // 标题
  panelEl.appendChild(el('div', 'panel-title', proj.name));
  panelEl.appendChild(el('div', 'panel-epsg', proj.epsg));

  // 正算公式
  const fwdSection = el('div', 'panel-section');
  fwdSection.appendChild(el('div', 'panel-section-title', '正算公式'));
  fwdSection.appendChild(el('div', 'panel-formula', info.forwardFormula));
  panelEl.appendChild(fwdSection);

  // 反算公式
  const invSection = el('div', 'panel-section');
  invSection.appendChild(el('div', 'panel-section-title', '反算公式'));
  invSection.appendChild(el('div', 'panel-formula', info.inverseFormula));
  panelEl.appendChild(invSection);

  // 投影特性
  const propSection = el('div', 'panel-section');
  propSection.appendChild(el('div', 'panel-section-title', '投影特性'));
  info.properties.forEach(p => {
    const row = el('div', 'panel-property');
    const dot = el('span', 'dot ' + (p.valid ? 'valid' : 'invalid'));
    row.appendChild(dot);
    row.appendChild(el('span', '', p.name));
    propSection.appendChild(row);
  });
  panelEl.appendChild(propSection);

  // 适用场景
  const useSection = el('div', 'panel-section');
  useSection.appendChild(el('div', 'panel-section-title', '适用场景'));
  useSection.appendChild(el('div', 'panel-text', info.useCases));
  panelEl.appendChild(useSection);

  // 变形特征
  const distSection = el('div', 'panel-section');
  distSection.appendChild(el('div', 'panel-section-title', '变形特征'));
  distSection.appendChild(el('div', 'panel-text', info.distortion));
  panelEl.appendChild(distSection);
}

/**
 * 初始化面板
 * @param {object} proj 初始投影
 */
export function initPanel(proj) {
  renderPanel(proj);
}

/**
 * 切换投影时更新面板
 * @param {object} proj 新投影
 */
export function updatePanel(proj) {
  renderPanel(proj);
}
```

- [ ] **Step 2: 提交**

```bash
git add src/ui/projectionPanel.js
git commit -m "feat: 创建教育信息面板 JS 模块（DOM API 安全渲染）"
```

---

### Task 8: 集成验证

- [ ] **Step 1: 启动开发服务器**

```bash
cd /Users/wangsen/person_project/globe-to-mercator
pnpm dev
```

- [ ] **Step 2: 逐项验证**

在浏览器中确认以下功能：

1. **墨卡托投影 (EPSG:3857)**：拖动滑块，球体平滑变形为墨卡托平面，纹理对齐正确
2. **等距柱状投影 (EPSG:4326)**：切换按钮，变形结果为矩形，比例均匀
3. **圆锥投影 (Lambert)**：变形结果为扇形，扇形顶点在上方
4. **方位投影 (Azimuthal)**：变形结果为圆形/椭圆形，类似从太空看地球
5. **教育面板**：切换投影时，右侧面板内容（名称、公式、特性）同步更新
6. **滑块**：拖动流畅，百分比显示正确
7. **OrbitControls**：可旋转、缩放，交互正常
8. **控制台无错误**

- [ ] **Step 3: 如有问题，修复后重新验证**

常见问题排查：
- Shader 编译错误 → 检查 `globe.vert` 中的 `if-else` 语法和函数定义
- 纹理错位 → 确认 `vLatitude` / `vLongitude` varying 传递正确
- 面板空白 → 检查 `#info-panel` 元素是否存在，浏览器控制台是否有 JS 错误
- 按钮不显示 → 检查 `.proj-btn-group` 选择器是否匹配

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: Phase 1 完成 — 4 种投影切换 + 教育信息面板"
```

---

## 自审清单

| 检查项 | 状态 |
|--------|------|
| 设计文档 Phase 1 需求全覆盖 | 投影框架 ✅ 圆锥投影 ✅ 方位投影 ✅ 教育面板 ✅ |
| 无 TBD / TODO / placeholder | ✅ |
| JS 导出接口与 import 匹配 | `getProjection` / `getAllProjections` / `initPanel` / `updatePanel` ✅ |
| Shader uniform 名称一致 | `uProjectionID` / `uConicStdLat` / `uAzimuthalType` ✅ |
| HTML DOM ID 与 JS 查询一致 | `#info-panel` / `.proj-btn-group` / `#progress-slider` ✅ |

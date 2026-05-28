# main.js 深度解析

> 从 Three.js 基础概念到项目核心实现，逐模块剖析 `main.js` 的设计思路和底层原理。

---

## 目录

1. [全局状态与共享 Uniform](#1-全局状态与共享-uniform)
2. [场景 (Scene)](#2-场景-scene)
3. [透视相机 (PerspectiveCamera)](#3-透视相机-perspectivecamera)
4. [WebGL 渲染器 (WebGLRenderer)](#4-webgl-渲染器-webglrenderer)
5. [轨道控制器 (OrbitControls)](#5-轨道控制器-orbitcontrols)
6. [地球创建 (createGlobe)](#6-地球创建-createglobe)
7. [球体几何体与细分度](#7-球体几何体与细分度)
8. [着色器管线：从球面到平面](#8-着色器管线从球面到平面)
9. [DoubleSide 与接缝问题](#9-doubleside-与接缝问题)
10. [动画循环与渲染流水线](#10-动画循环与渲染流水线)
11. [窗口自适应](#11-窗口自适应)

---

## 1. 全局状态与共享 Uniform

```js
// main.js:14-27
let progress = 0;
let currentProjection = getProjection(0);
const LON_SEGMENTS = 360;
const LAT_SEGMENTS = 180;
const SPREAD_DELAY = 0.35;

const sharedUniforms = {
  uProgress: { value: 0.0 },
  uSpreadDelay: { value: SPREAD_DELAY },
  uProjectionID: { value: currentProjection.id },
  uConicStdLat: { value: 0.5236 },
  uAzimuthalType: { value: 0.0 }
};
```

### 设计要点

- **共享引用机制**：`sharedUniforms` 对象被地球材质和所有指标系统（朝索、面积比较、大圆航线）共用。滑块修改 `sharedUniforms.uProgress.value = 0.5` 时，所有引用该对象的着色器自动读到新值，无需逐一通知。

```
滑块拖动 → sharedUniforms.uProgress.value = 0.5
                    ↓
        ┌───────────┼───────────┐
        ↓           ↓           ↓
    地球着色器   朝索着色器   航线着色器
    (引用同一个 {value: 0.5} 对象)
```

- **360×180 分段**：经度 360 段 + 纬度 180 段 = 每 1° 一个顶点，和纹理的经纬度分辨率 1:1 对齐。
- **SPREAD_DELAY = 0.35**：剥橘子效果中，高纬度区域最大延迟系数。纬度越高展开越晚。

---

## 2. 场景 (Scene)

```js
// main.js:35-37
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);
```

`Scene` 是 Three.js 的**根容器**，所有 3D 对象（地球、指标、星空）都通过 `scene.add()` 挂载到场景树上。渲染器调用 `renderer.render(scene, camera)` 时，会遍历场景树中所有可见对象并提交给 GPU。

背景色 `0x0a0a1a` 是深蓝黑色，模拟太空感。

---

## 3. 透视相机 (PerspectiveCamera)

```js
// main.js:39-45
const camera = new THREE.PerspectiveCamera(
  45,                                    // FOV（视场角）
  window.innerWidth / window.innerHeight, // 宽高比
  0.1,                                   // 近裁剪面
  100                                    // 远裁剪面
);
camera.position.set(0, 0, 4);
```

### 透视相机的本质

`PerspectiveCamera` 模拟人眼的**近大远小**效果，是 Three.js 中最常用的相机类型。

### 四个核心参数

| 参数 | 含义 | 项目值 | 说明 |
|------|------|--------|------|
| `fov` | 垂直视场角（度） | `45` | 类似 50mm 标准镜头，变形最小 |
| `aspect` | 宽高比 | `innerWidth / innerHeight` | 动态跟随窗口 |
| `near` | 近裁剪面距离 | `0.1` | 比这更近的物体不可见 |
| `far` | 远裁剪面距离 | `100` | 比这更远的物体不可见 |

四个参数定义了一个**视锥体（Frustum）**——一个金字塔被 near 和 far 截断后的体积，只有视锥体内部的物体才会被渲染：

```
        far plane (远裁剪面)
       /                \
      /                  \
     /      可见区域       \
    /                      \
   /________________________\
       near plane (近裁剪面)
              |
              | camera z=4
              ●
```

### FOV 的视觉影响

| FOV 范围 | 类比 | 典型用途 |
|----------|------|---------|
| 1° - 15° | 超长焦 | 望远效果 |
| 15° - 35° | 长焦 | 人像、产品展示 |
| **40° - 60°** | **标准镜头** | **通用 3D 场景、本项目** |
| 60° - 90° | 广角 | 室内漫游、游戏 |
| 90° - 120° | 超广角 | 第一人称射击 |
| 120° - 170° | 鱼眼 | 特殊艺术效果 |

FOV 的理论有效范围是 `(0°, 180°)`，超出或触碰边界会导致投影矩阵退化。

### near/far 与精度

near 和 far 的**比值**决定深度缓冲（z-buffer）的精度。`0.1 / 100 = 1000` 是健康的范围。比值过大（如 `0.001 / 10000`）会导致远处物体出现 z-fighting（闪烁）。

### 为什么用 FOV=45°

- 人眼自然聚焦区域约 40°-50°，45° 是最舒适的视角
- 窄视角让物体看起来更自然、透视变形小
- 配合相机 z=4（距球心 4 个单位），地球完整可见且不产生明显畸变

---

## 4. WebGL 渲染器 (WebGLRenderer)

```js
// main.js:47-53
const renderer = new THREE.WebGLRenderer({
  antialias: true,   // MSAA 抗锯齿
  alpha: false        // 不需要透明背景
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.insertBefore(renderer.domElement, container.firstChild);
```

### 渲染器的角色

渲染器是 Three.js 的"画师"——拿着相机（视角）和场景（内容），把 3D 世界画到屏幕的 2D 像素里。

每次调用 `renderer.render(scene, camera)` 时的流水线：

```
3D 数据                GPU 处理                   屏幕
┌──────────┐   ┌───────────┐   ┌─────────────┐   ┌──────────┐
│  Scene    │   │  Camera   │   │ WebGLRenderer│   │ <canvas> │
│ ┌──────┐ │   │           │   │              │   │          │
│ │ 地球 │ │ ─▶│ 视锥体裁剪 │ ─▶│ 顶点着色器   │ ─▶│ 像素输出 │
│ │ 指标 │ │   │ 投影变换   │   │ 片段着色器   │   │          │
│ │ 星空 │ │   │           │   │ 光栅化       │   │          │
│ └──────┘ │   └───────────┘   └─────────────┘   └──────────┘
└──────────┘
```

### 关键配置

| 配置 | 作用 | 为什么这样设置 |
|------|------|---------------|
| `antialias: true` | 多重采样抗锯齿 (MSAA) | 地球边缘和经纬线更平滑 |
| `alpha: false` | canvas 背景不透明 | 场景自设 `0x0a0a1a` 背景色 |
| `setPixelRatio(min(dpr, 2))` | 限制最大 DPR=2 | 防止 Retina 屏 GPU 过载 |
| `renderer.domElement` | 就是一个 `<canvas>` 元素 | 插入 DOM 作为渲染目标 |

### DPR 限制为 2 的原因

iPhone 的 DPR=3，像素量是 CSS 尺寸的 9 倍（3×3）。本项目球体有 64,800 个顶点加抗锯齿，高 DPR 下 GPU 负担很重。`min(dpr, 2)` 是清晰度和性能的最佳平衡。

### 与自定义着色器的关系

使用 `ShaderMaterial` 时，Three.js 不用内置着色器，而是把你的 `globe.vert`/`globe.frag` 直接编译成 WebGL 程序交给 GPU。Renderer 负责管理编译过程、绑定 attribute、传入 uniform、调用 `gl.drawArrays`——它是你和 GPU 之间的"翻译官"。

---

## 5. 轨道控制器 (OrbitControls)

```js
// main.js:56-61
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 8;
```

### 核心概念

OrbitControls 让相机围绕一个**目标点**旋转，就像拿着相机绕着地球转。相机始终朝向 target（默认原点 `(0,0,0)`），只能在以 target 为中心的球面上运动。

```
                    maxDistance (8)
                         ↓
    ┌─────────────────────────────────┐
    │         · · · · · · ·          │  ← 相机运动轨迹（球面）
    │       ·       target       ·   │  ← 目标点：(0,0,0)
    │     ·       ● 地球          ·  │
    │       ·                   ·    │
    │         · · · · · · ·          │
    └─────────────────────────────────┘
         ↑
    minDistance (2)
```

### 配置解析

| 属性 | 项目值 | 说明 |
|------|--------|------|
| `enableDamping` | `true` | 启用惯性滑动 |
| `dampingFactor` | `0.05` | 每帧衰减 5%，"丝滑"手感 |
| `enablePan` | `false` | 禁止右键拖拽平移（防止地球跑出视野） |
| `minDistance` | `2` | 最近距离（球半径=1，2≈贴着球面） |
| `maxDistance` | `8` | 最远距离 |

### 操作映射

| 操作 | 桌面端 | 移动端 |
|------|--------|--------|
| 旋转 | 左键拖拽 | 单指拖拽 |
| 缩放 | 滚轮 | 双指捏合 |
| 平移 | 右键拖拽（已禁用） | 双指拖拽（已禁用） |

### 为什么需要 controls.update()

```js
// main.js:227
controls.update();  // 每帧必须调用
```

启用阻尼后，松开鼠标后相机继续滑动（速度每帧衰减 `dampingFactor`），这个衰减过程由 `update()` 驱动。不调用则松手瞬间卡住，没有惯性效果。

### OrbitControls 改的是相机，不是物体

它移动 `camera.position` 并用 `camera.lookAt(target)` 更新朝向。场景中的物体完全不动——这就是为什么着色器里的 `projectionMatrix` 和 `viewMatrix` 随操作变化，而 `modelMatrix` 不变。

---

## 6. 地球创建 (createGlobe)

```js
// main.js:67-98
function createGlobe(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.SphereGeometry(1, LON_SEGMENTS, LAT_SEGMENTS);
  const uniforms = { /* 共享 + 独有 */ };
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
```

### 整体结构

```
createGlobe(texture)
  │
  ├── SphereGeometry(1, 360, 180)   ← 几何体：球形骨架
  │
  ├── ShaderMaterial({...})          ← 材质：自定义着色器 + uniforms
  │     ├── globe.vert               ← 顶点着色器：球面→平面变形
  │     └── globe.frag               ← 片段着色器：纹理+光照+经纬线
  │
  └── Mesh(geometry, material)       ← 网格体：几何体+材质
      └── scene.add(mesh)
```

### 纹理色彩空间

```js
texture.colorSpace = THREE.SRGBColorSpace;
```

告诉 GPU 纹理是 sRGB 色彩空间。不设置则颜色偏暗（GPU 按线性空间处理导致 gamma 校正错误）。

### Uniforms 分层设计

```js
const uniforms = {
  // 共享投影参数（引用 sharedUniforms 中的同一个对象）
  uProgress: sharedUniforms.uProgress,
  uSpreadDelay: sharedUniforms.uSpreadDelay,
  uProjectionID: sharedUniforms.uProjectionID,
  uConicStdLat: sharedUniforms.uConicStdLat,
  uAzimuthalType: sharedUniforms.uAzimuthalType,
  // 地球独有
  uTexture: { value: texture },
  uShowGrid: { value: showGrid ? 1.0 : 0.0 },
  uLightDir / uLightDir2 / uLightDir3 / uLightDir4: ...
};
```

关键在于共享 uniform 是**对象引用**而非值拷贝。修改 `sharedUniforms.uProgress.value` 时，地球和所有指标着色器自动读到新值。

### ShaderMaterial vs 内置材质

| 材质类型 | 着色器 | 适用场景 |
|---------|--------|---------|
| MeshStandardMaterial | Three.js 内置 PBR | 普通物体 |
| **ShaderMaterial** | **自定义 GLSL** | **自定义变形、特效** |

`side: THREE.DoubleSide` 表示正反面都渲染（详见[第 9 节](#9-doubleside-与接缝问题)）。

### 纹理加载与降级

```js
// main.js:138-170
textureLoader.load(EARTH_TEXTURE_URL, (texture) => {
  globe = createGlobe(texture);
}, undefined, (err) => {
  // 降级：用 Canvas 绘制渐变+随机椭圆模拟陆地
  const fallbackTexture = new THREE.CanvasTexture(canvas);
  globe = createGlobe(fallbackTexture);
});
```

异步加载纹理，失败时用 Canvas 2D 绘制备用纹理（蓝绿渐变 + 随机椭圆模拟大陆）。

---

## 7. 球体几何体与细分度

```js
const geometry = new THREE.SphereGeometry(1, 360, 180);
```

### 数据量

| 指标 | 数量 |
|------|------|
| 顶点 | (360+1) × (180+1) = **65,341** |
| 三角形 | 360 × 180 × 2 = **129,600** |
| 显存（约） | 顶点+法线+UV ≈ **3 MB** |

### 为什么是 360×180？

```
360 段经度 = 每 1° 经度一个顶点
180 段纬度 = 每 1° 纬度一个顶点
```

地球纹理是等距柱状投影，像素和经纬度一一对应。360×180 保证每个经纬度都有对应顶点，纹理映射最精确。

### 对比不同细分度

| 细分度 | 三角形数 | 变形效果 |
|--------|---------|---------|
| 32×16 | 1,024 | 明显棱角 |
| 128×64 | 16,384 | 极点有锯齿 |
| **360×180** | **129,600** | **平滑，和纹理对齐** |
| 720×360 | 518,400 | 极微小改善，显存翻倍 |

超过 360×180 后改善肉眼几乎不可见，但 GPU 每帧处理 129,600 个顶点的复杂着色器计算（`asin`、`atan`、`mix`、`easeInOutCubic`）已有一定开销。

### Three.js SphereGeometry 的索引绕序

源码中的索引生成：

```js
// Three.js 源码 SphereGeometry.js
const a = grid[iy][ix + 1];   // 右上
const b = grid[iy][ix];       // 左上
const c = grid[iy + 1][ix];   // 左下
const d = grid[iy + 1][ix + 1]; // 右下

indices.push(a, b, d);  // 三角形1
indices.push(b, c, d);  // 三角形2
```

所有三角形在球体外侧呈现 **CCW（逆时针）** 绕序——这是 WebGL 的正面朝向约定。

---

## 8. 着色器管线：从球面到平面

### 顶点着色器 (globe.vert)

核心流程：

```glsl
void main() {
  // 1. 从球面坐标算经纬度
  float latitude = asin(clamp(normalize(position).y, -1.0, 1.0));
  float phi = uv.x * 2.0 * PI;
  float longitude = atan(-cos(phi), sin(phi));

  // 2. 根据投影类型算平面目标坐标
  vec3 flatPos = projectMercator(longitude, latitude); // 或其他投影

  // 3. "剥橘子"：赤道先展开，极地延迟
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (...), 0.0, 1.0);
  localProgress = easeInOutCubic(localProgress);

  // 4. 在球面和平面之间插值 ← 动画核心
  vec3 finalPos = mix(spherePos, flatPos, localProgress);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}
```

#### 经度计算的特殊处理

```glsl
float phi = uv.x * 2.0 * PI;
float longitude = atan(-cos(phi), sin(phi));
```

使用 UV 参数化角度而非 `atan(position.x, position.z)`，原因是：
- **极点处** position.x 和 position.z 都趋近 0，`atan(0,0)` 退化
- UV 参数化让极点的每个重复顶点有各自的 `uv.x`，给出正确经度

#### 剥橘子延迟的数学

```
localDelay = normalizedLat² × 0.35
```

用纬度的**平方**：赤道附近延迟极小（立刻展开），极地延迟急剧增大。平方函数创造"从赤道向两极波纹式扩散"的视觉效果。

#### progress=1 时所有顶点完全展开

```
lat=0°   → localProgress = 1.000000
lat=80°  → localProgress = 1.000000
lat=89°  → localProgress = 1.000000
```

由于 `clamp` 的上限是 1.0，progress=1 时所有纬度的 localProgress 都被 clamp 到 1.0，几何体是精确的平面。

### 片段着色器 (globe.frag)

核心流程：

```glsl
void main() {
  // 1. 从经纬度反算纹理坐标（不依赖插值 UV）
  float u = (vLongitude + PI) / (2.0 * PI);
  float v = (vLatitude + PI / 2.0) / PI;
  vec4 texColor = texture2D(uTexture, vec2(u, v));

  // 2. 4 光源漫反射叠加
  vec3 ambient = texColor.rgb * 0.45;
  vec3 diffuse = texColor.rgb * (diff1*0.45 + diff2*0.30 + diff3*0.20 + diff4*0.15);
  vec3 color = ambient + diffuse;

  // 3. 经纬线网格
  // 4. 过渡发光效果
  gl_FragColor = vec4(color, 1.0);
}
```

#### 为什么用经纬度算纹理坐标

球体自带的 `uv` 在变形后不再正确（顶点已移到平面位置）。用 `vLongitude` 和 `vLatitude` 从 varying 传递的经纬度反算 UV，确保变形过程中纹理始终正确映射——无论顶点移动到哪里，每个像素都能找到正确的纹素。

#### 4 光源布光逻辑

| 光源 | 强度 | 作用 |
|------|------|------|
| 主光 | 45% | 右上方，定义明暗关系 |
| 补光 2 | 30% | 左下方，填充暗部 |
| 补光 3 | 20% | 正前方，整体提亮 |
| 补光 4 | 15% | 右下方，增加立体感 |

总漫反射 110% + 环境光 45% = 155%。这种"多灯布光"来自摄影的三点照明法，目的是让球体在任何角度旋转都不会出现全黑的暗面。

---

## 9. DoubleSide 与接缝问题

### 问题的发现

将 `side` 从 `DoubleSide` 改为 `FrontSide` 后，展开的平面从背面仍然能看到镜像的地球纹理。

### 根因分析

经度计算 `atan(-cos(phi), sin(phi))` 在 `phi=3π/2`（即球体正后方）处发生不连续跳变（从 +π 跳到 -π）。

SphereGeometry 在 `ix=270`（对应 `phi=270°`）列的 180 个三角形恰好横跨这个跳变点，它们的两个顶点分别位于地图的 `mercX=+π` 和 `mercX=-π`，形成横跨**整个地图宽度**的超长三角形。

```
经度映射：

u=0       u=0.25    u=0.5     u=0.75      u=1.0
phi=0°    phi=90°   phi=180°  phi=270°    phi=360°
  ↓         ↓         ↓      ↕ 跳变!       ↓
  ┌─────────────────────────────────────────────┐
  │         ←  CCW (99.7%)  →                  │
  │                                   ┌──────┐  │
  │  ←───── 横跨地图的 CW 三角形 ──────→    │  │ ← 180个 (0.3%)
  │                                   └──────┘  │
  │         ←  CCW (99.7%)  →                  │
  └─────────────────────────────────────────────┘
```

### 绕序统计

| 类型 | 数量 | 占比 | 从正面看 | 从背面看 |
|------|------|------|---------|---------|
| CCW（正面） | 64,620 | 99.7% | 可见 | 被剔除 |
| CW（背面） | 180 | 0.3% | 被剔除 | **可见** |

这 180 个 CW 三角形从正面被剔除，但从背面看变成了 CCW → 可见。因为它们每个横跨整个地图宽度，视觉上覆盖了完整的背面。

### 为什么修改 phiStart 无效

尝试将 `SphereGeometry` 的 `phiStart` 参数改为 `3π/2`，让 UV 接缝对齐 atan 跳变点。但 SphereGeometry 的**索引绕序是固定的拓扑结构**，和 UV 起点无关。结果仍然是 180 个 CW 三角形。

### 结论：球面不可展定理

高斯的绝妙定理（Theorema Egregium）证明了球面不可能无畸变地展成平面。`atan()` 的不连续性是这一数学事实在代码层面的体现。无论经度公式怎么写，接缝必然存在于某处。

### 解决方案

**使用 `DoubleSide`** 是最干净的解法：

```js
side: THREE.DoubleSide
```

DoubleSide 的性能开销极小——WebGL 实现方式是禁用背面剔除（`gl.disable(gl.CULL_FACE)`），而不是把三角形画两遍。

---

## 10. 动画循环与渲染流水线

```js
// main.js:224-246
function animate() {
  requestAnimationFrame(animate);

  controls.update();                              // 1. 更新控制器阻尼
  sharedUniforms.uProgress.value = progress;      // 2. 同步进度到着色器
  greatCircleRoutes.updateLabels(progress);        // 3. 更新航线标签

  if (progress < 0.05 && globe) {                  // 4. 球体状态下缓慢自转
    globe.mesh.rotation.y += 0.002;
    tissotIndicators.group.rotation.y = globe.mesh.rotation.y;
    areaComparison.group.rotation.y = globe.mesh.rotation.y;
    greatCircleRoutes.group.rotation.y = globe.mesh.rotation.y;
  }

  stars.rotation.y += 0.0001;                      // 5. 星空微动

  renderer.render(scene, camera);                  // 6. 渲染一帧
}
```

### 每帧的数据流

```
requestAnimationFrame 回调
  │
  ├─ controls.update() → 更新 camera.position（阻尼衰减）
  │
  ├─ sharedUniforms.uProgress.value = progress → 所有着色器自动同步
  │
  ├─ renderer.render(scene, camera)
  │    │
  │    ├─ 遍历 scene 中所有 Mesh/Line/Points
  │    ├─ 视锥体裁剪
  │    ├─ 提交顶点数据 + uniform 到 GPU
  │    ├─ 执行 globe.vert（每个顶点）：
  │    │    position → 经纬度 → 投影坐标 → mix(球面, 平面, progress)
  │    ├─ 执行 globe.frag（每个像素）：
  │    │    经纬度 → 纹理采样 → 光照 → 经纬线 → 发光 → gl_FragColor
  │    └─ 光栅化输出到 <canvas>
  │
  └─ 下一帧（浏览器 VSync 信号触发）
```

### renderer.render() 是同步的

调用后 GPU 立即开始工作，但 GPU 执行是异步的。浏览器会在合适时机把帧缓冲区像素刷到屏幕。下一帧 `requestAnimationFrame` 时 GPU 一定画完了。

### 球体自转条件

```js
if (progress < 0.05 && globe) { ... }
```

只在球体状态（展开度 < 5%）下自转，展开后停止。指标组通过 `group.rotation.y` 跟随地球同步旋转。

---

## 11. 窗口自适应

```js
// main.js:249-253
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

窗口大小改变时需要同步更新三件事：

1. **camera.aspect**：宽高比变了，不更新则画面拉伸/压扁
2. **camera.updateProjectionMatrix()**：重新计算投影矩阵缓存（修改 aspect/fov/near/far 后必须调用）
3. **renderer.setSize()**：更新 canvas 的分辨率和 CSS 尺寸

---

## 附：备用纹理降级

```js
// main.js:142-170
const canvas = document.createElement('canvas');
// ... Canvas 2D 绘制渐变+随机椭圆模拟陆地
const fallbackTexture = new THREE.CanvasTexture(canvas);
globe = createGlobe(fallbackTexture);
```

当本地纹理文件加载失败时，用 Canvas 2D API 绘制一个简化的地球纹理（蓝绿渐变 + 随机椭圆模拟大陆），确保即使没有纹理文件也能正常展示。

---

## 附：投影切换

```js
// main.js:184-198
function switchProjection(id) {
  currentProjection = getProjection(id);
  // 更新按钮高亮
  // 更新共享 uniform（地球和指标自动同步）
  sharedUniforms.uProjectionID.value = id;
  Object.entries(currentProjection.uniforms).forEach(([key, val]) => {
    if (sharedUniforms[key]) sharedUniforms[key].value = val;
  });
  updatePanel(currentProjection);
}
```

切换投影时只修改 `sharedUniforms` 的值，不需要重新创建几何体或材质。着色器中的 `if (uProjectionID < 0.5)` 分支自动选择对应的投影函数。

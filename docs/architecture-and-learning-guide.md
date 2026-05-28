# Globe-to-Mercator 项目架构与学习指南

> 通过 Three.js + GLSL 着色器将 3D 地球实时变形为各种地图投影平面，直观理解投影变形特征。

---

## 一、项目架构总览

### 1.1 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                        index.html                            │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ 投影按钮  │  │ 底部滑块     │  │ UI 面板（左侧指标/右侧教育）│  │
│  └────┬─────┘  └──────┬───────┘  └────────────┬───────────┘  │
└───────┼───────────────┼───────────────────────┼──────────────┘
        │               │                       │
        v               v                       v
┌──────────────────────────────────────────────────────────────┐
│                      main.js (核心控制器)                      │
│                                                               │
│  ┌─────────────────┐    ┌───────────────────┐                │
│  │  sharedUniforms  │◄───│ 投影注册表 (4种投影) │                │
│  │  { uProgress,   │    └───────────────────┘                │
│  │    uProjectionID,│                                         │
│  │    uSpreadDelay }│                                         │
│  └────────┬────────┘                                         │
│           │ 引用共享（一处修改，全局同步）                         │
│      ┌────┴────────────────────┐                             │
│      v                         v                             │
│    地球材质                 指标材质                             │
│    (globe.vert)          (indicator.vert)                     │
└──────┬──────────────────────┬────────────────────────────────┘
       │                      │
       v                      v
┌─────────────────────────────────────────────────────────────┐
│                    GLSL 着色器管线                             │
│                                                              │
│  projections.glsl (共享投影函数库)                              │
│    ├─ projectMercator()    墨卡托                              │
│    ├─ projectPlateCarree() 等距柱状                            │
│    ├─ projectConic()       Lambert 圆锥                       │
│    └─ projectAzimuthal()   正射/立体                           │
│                                                              │
│  globe.vert ──► globe.frag        地球渲染                    │
│  indicator.vert ──► tissot.frag   朝索椭圆（变形着色）           │
│  indicator.vert ──► outline.frag  轮廓线                       │
│  indicator.vert ──► route.frag    航线                         │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 文件清单与职责

| 文件 | 职责 | 行数 |
|------|------|-----|
| `index.html` | HTML 入口 + 全部 CSS 样式（深色空间主题、毛玻璃 UI） | ~382 |
| `src/main.js` | **核心入口**：场景、相机、渲染器、控件、动画循环、交互绑定 | ~254 |
| `src/shaders/common/projections.glsl` | **共享投影函数库**（单源维护，`#include` 引入） | ~74 |
| `src/shaders/globe.vert` | 地球顶点着色器：球面→投影变形 + 剥橘子缓动 | ~67 |
| `src/shaders/globe.frag` | 地球片段着色器：纹理采样、4 光源光照、经纬线网格 | ~70 |
| `src/shaders/indicator.vert` | 指标系统共享顶点着色器（朝索 + 面积轮廓共用） | ~74 |
| `src/shaders/tissot.frag` | 朝索椭圆变形着色：绿→黄→红梯度 | ~25 |
| `src/shaders/route.frag` | 航线片段着色：uniform 颜色 + 透明度 | ~7 |
| `src/shaders/outline.frag` | 轮廓/填充着色（面积比较和朝索边线共用） | ~9 |
| `src/projections/index.js` | 投影注册表：`getProjection()` / `getAllProjections()` | ~15 |
| `src/projections/mercator.js` | 墨卡托投影配置 (ID=0) | ~60 |
| `src/projections/plateCarree.js` | 等距柱状投影配置 (ID=1) | ~50 |
| `src/projections/conic.js` | 圆锥投影配置 (ID=2) | ~60 |
| `src/projections/azimuthal.js` | 方位投影配置 (ID=3) | ~70 |
| `src/indicators/tissot.js` | 朝索变形椭圆指标（测地线圆生成） | ~305 |
| `src/indicators/areaComparison.js` | 面积比较指标（格陵兰/非洲/南美洲轮廓） | ~229 |
| `src/indicators/greatCircleRoutes.js` | 大圆航线指标（大圆弧 + 恒向线 + 标签 + 发光粒子） | ~361 |
| `src/ui/projectionPanel.js` | 右侧投影教育信息面板 | ~60 |
| `src/ui/indicatorPanel.js` | 左侧指标开关面板（自定义 toggle） | ~121 |
| `src/utils/math.js` | 共享数学常量（PI, DEG2RAD, RAD2DEG） | ~5 |
| `vite-plugin-glsl-include.js` | 自定义 Vite 插件：展开 GLSL `#include` 指令 | ~42 |
| `scripts/glsl-lint.mjs` | GLSL 着色器 lint 脚本 | ~126 |

### 1.3 核心设计模式

| 模式 | 实现方式 | 为什么这样设计 |
|------|----------|---------------|
| **Uniform 引用共享** | 地球和指标材质引用同一组 JS 对象 | 修改 `sharedUniforms.uProgress.value` 时所有着色器自动同步，无需遍历 |
| **投影函数单源维护** | GLSL 函数只在 `projections.glsl` 定义，通过 `#include` 注入 | 避免投影逻辑在多处重复，修改一处全局生效 |
| **CPU/GPU 投影双轨** | JS 端在 `greatCircleRoutes.js` 复刻了投影函数 | Sprite 标签需要在 CPU 端计算位置，无法走 GPU 着色器 |
| **剥橘子动画** | `lat² × uSpreadDelay` 延迟 + easeInOutCubic 缓动 | 赤道先展开、两极后展开，视觉效果自然 |
| **自定义 Vite 插件** | `load` hook 拦截 `.vert/.frag`，展开 `#include` | 让 GLSL 支持模块化，同时兼容 `?raw` 导入 |

### 1.4 数据流（每帧循环）

```
animate() 每帧执行:

  1. controls.update()              ← OrbitControls 阻尼更新
  2. sharedUniforms.uProgress = slider.value
         ↓ 一处赋值，所有材质同步
      ┌──────────────┐    ┌──────────────────┐
      │  globe.vert   │    │  indicator.vert   │
      │  球面→经纬度    │    │  aLat/aLon 属性   │
      │  →投影变换     │    │  →投影变换         │
      │  →mix 插值    │    │  →mix 插值         │
      └──────┬───────┘    └────────┬──────────┘
             v                      v
      globe.frag          tissot/outline/route.frag
      (纹理+光照+经纬线)    (各自的颜色/透明度逻辑)

  3. greatCircleRoutes.updateLabels()   ← CPU 端投影计算（标签位置）
  4. 低进度自转（progress < 0.05）
  5. renderer.render(scene, camera)
```

---

## 二、核心模块详解

### 2.1 main.js — 场景初始化

**全局状态：**

```javascript
let progress = 0;                       // 滑块控制的变形进度 [0, 1]
let currentProjection = getProjection(0); // 当前投影（默认墨卡托）
const LON_SEGMENTS = 360;               // 球体经度细分
const LAT_SEGMENTS = 180;               // 球体纬度细分
const SPREAD_DELAY = 0.35;              // 剥橘子展开延迟系数
```

**共享 Uniform 机制（系统核心纽带）：**

```javascript
const sharedUniforms = {
  uProgress:      { value: 0.0 },      // 变形进度
  uSpreadDelay:   { value: 0.35 },     // 展开延迟
  uProjectionID:  { value: 0 },        // 投影类型 ID
  uConicStdLat:   { value: 0.5236 },   // 圆锥投影标准纬线 (30°)
  uAzimuthalType: { value: 0.0 }       // 方位投影子类型
};
```

地球材质和所有指标材质都引用这同一组 uniform 对象。修改值时所有着色器自动同步——无需遍历材质逐一更新。

**场景构建：**
- **相机**: `PerspectiveCamera` (45 FOV, z=4)
- **渲染器**: `WebGLRenderer` (抗锯齿, 最大 DPR=2)
- **控制器**: `OrbitControls` (阻尼 0.05, 禁止平移, 缩放范围 2~8)
- **背景**: 深蓝黑色 `0x0a0a1a`
- **星空**: 2000 个随机分布的白色粒子

**地球创建 (createGlobe)：**
1. `SphereGeometry(1, 360, 180)` — 极高细分保证变形光滑（约 64800 个顶点）
2. `ShaderMaterial` uniforms 包含：5 个共享投影 uniform + 纹理 + 经纬线开关 + 4 个光照方向
3. 双面渲染 (`DoubleSide`)，确保平面化后背面也可见
4. 纹理加载失败时用 Canvas 绘制渐变备用纹理

### 2.2 投影系统

**注册表** (`projections/index.js`)：4 个投影按固定顺序 `[mercator, plateCarree, conic, azimuthal]`，通过 ID (0~3) 查找。

**每个投影配置的结构：**

```javascript
{
  id: number,           // 投影 ID，对应 GLSL 中的 uProjectionID
  name: string,         // 中文名称
  epsg: string,         // EPSG 代码或英文标识
  uniforms: {},         // 投影特有 uniform
  info: {               // 教育面板数据
    forwardFormula,     // 正算公式
    inverseFormula,     // 反算公式
    properties: [],     // 投影特性 [{name, valid}]
    useCases,           // 适用场景
    distortion          // 变形特征描述
  }
}
```

| 投影 | ID | 特点 | 额外 Uniform |
|------|----|------|-------------|
| 墨卡托 | 0 | 保角，航海/Web 地图标准 | 无 |
| 等距柱状 | 1 | 最简单：x=lon, y=lat | 无 |
| Lambert 圆锥 | 2 | 保角，中纬度适用 | `uConicStdLat = 0.5236` (30°) |
| 方位 | 3 | 正射(0) / 立体(1) 切换 | `uAzimuthalType` |

### 2.3 GLSL 着色器管线

#### 共享投影库 (`projections.glsl`)

单源维护点，修改投影参数只需改这一个文件：

| 函数 | 算法核心 |
|------|---------|
| `projectMercator(lon, lat)` | `y = ln(tan(PI/4 + lat/2))`，裁剪到 ~85.05° |
| `projectPlateCarree(lon, lat)` | 直接返回 `(lon, lat, 0)` |
| `projectConic(lon, lat, stdLat)` | Lambert 正形圆锥：`rho = F / tan(lat/2+PI/4)^n` |
| `projectAzimuthal(lon, lat, type)` | type<0.5 正射（背面 z 微移 0.08）；否则立体 `k=2/(1+sin(lat))` |
| `easeInOutCubic(t)` | 缓入缓出：`4t³` (t<0.5) / `1-(-2t+2)³/2` (t≥0.5) |

#### 地球顶点着色器 (`globe.vert`)

```
position (球面坐标)
    ↓ asin(normalize(position).y) → latitude
    ↓ uv.x 参数化角度 → longitude（避免极点 atan(0,0) 奇异）
    ↓ 根据 uProjectionID 选择投影函数 → flatPos
    ↓ normalizedLat² × uSpreadDelay → localDelay（赤道延迟 0，极区延迟大）
    ↓ easeInOutCubic(clamp(progress - delay, 0, 1)) → localProgress
    ↓ mix(spherePos, flatPos, localProgress) → 最终位置
    ↓ gl_Position = projectionMatrix × modelViewMatrix × pos
```

#### 地球片段着色器 (`globe.frag`)

1. **纹理采样**：从 `vLatitude/vLongitude` 计算 UV（不依赖插值 UV）
2. **4 光源光照**：主光(0.45) + 补光(0.30) + 正面弱光(0.20) + 侧光(0.15)，环境光基底 0.45
3. **经纬线网格**：`sin(u × PI × 12)` / `sin(v × PI × 6)` 检测经纬线位置
4. **过渡能量线条**：高斯脉冲 `exp(-((progress-0.5)×4)²)` 蓝色辉光

#### 指标顶点着色器 (`indicator.vert`)

与 `globe.vert` 结构平行但有两个关键差异：
- **经纬度来自属性**：`attribute float aLatitude / aLongitude`（由 JS 端精确注入）
- **面积变形因子**：`computeAreaDistortion()` 通过数值微分计算雅可比行列式

### 2.4 指标系统

#### 朝索变形椭圆 (`tissot.js`)

在球面每隔 30° 放置等大测地线正圆（角半径 ~4.3°），投影后直观展示变形。

**测地线圆生成算法：**
```
P = cos(r)·C + sin(r)·D
C = 圆心球面坐标
D = 切平面内的方向向量（北向 + 东向分量组合）
```

**覆盖范围：**
- 中低纬度：-60°~60°，每 30°×30°
- 高纬度：±75°，每 60° 经度
- 180° 经线上的圆拆分为两个半圆避免跨日期变更线拉伸

#### 面积比较 (`areaComparison.js`)

用简化轮廓展示格陵兰(53点)、非洲(72点)、南美洲(76点)在不同投影下的面积差异。

**几何体创建流程：**
1. `THREE.Shape` + `ShapeGeometry` 耳切三角化
2. 2D (lon, lat) → 3D 球面坐标
3. 同时创建填充 Mesh（半透明 0.35）和轮廓 LineLoop（0.85）

#### 大圆航线 (`greatCircleRoutes.js`)

3 条航线（伦敦→纽约、东京→洛杉矶、悉尼→圣地亚哥），同时绘制大圆弧和恒向线。

**核心算法：**
- **大圆弧**: `slerp(p1, p2, t)` 球面线性插值
- **恒向线**: Mercator 等角公式 `ψ = ln(tan(π/4+lat/2))`，线性插值等角纬度
- **日期变更线处理**: 相邻点经度跳变 > PI 时拆分段
- **JS 端投影复刻**: 完整复制 4 个 GLSL 投影函数到 JS，用于 CPU 端标签位置计算

### 2.5 UI 系统

**投影教育面板** (`projectionPanel.js`)：右侧面板，根据投影配置动态渲染公式、特性、适用场景。

**指标开关面板** (`indicatorPanel.js`)：左侧面板，自定义 CSS toggle 联动 Three.js Group 的 `visible` 属性。

### 2.6 Vite GLSL Include 插件

```javascript
// 工作原理：
1. load hook（enforce: 'pre'）拦截 .vert/.frag/.glsl 文件
2. 正则匹配 #include 指令
3. 递归展开（支持嵌套，Set 去重防循环）
4. 返回 export default "..." 字符串模块
```

---

## 三、基础知识学习路线

### Level 1: WebGL / GPU 渲染基础

> 理解着色器的前提

| 知识点 | 为什么需要 | 推荐资源 |
|--------|-----------|---------|
| 顶点着色器 (Vertex Shader) | 球体变形在顶点着色器中完成 | [WebGL2 Fundamentals 中文](https://webgl2fundamentals.org/webgl/lessons/zh_cn/) |
| 片段着色器 (Fragment Shader) | 纹理采样、光照、经纬线都在这里 | 同上 |
| Uniform / Attribute / Varying | uniform 全局参数、attribute 逐顶点、varying 顶点到片段 | 同上 |
| 渲染管线流程 | 理解 CPU → GPU → 屏幕 | [The Book of Shaders 中文](https://thebookofshaders.com/) |

**关键概念：**
- `attribute float aLatitude/aLongitude` — JS 注入的逐顶点经纬度数据
- `uniform uProgress` — 全局共享的进度值，每帧更新一次
- `varying vNormal` — 顶点着色器赋值后，GPU 在光栅化阶段对每个像素自动插值

### Level 2: GLSL 着色器语言

| 知识点 | 对应项目代码 | 优先级 |
|--------|-------------|-------|
| 数据类型: `vec2/vec3/vec4`, `float`, `mat4` | 所有着色器 | 必学 |
| 内置函数: `sin/cos/asin/atan/normalize/dot/mix/clamp/pow` | 投影函数核心 | 必学 |
| 空间变换: 模型→世界→视图→裁剪空间 | `gl_Position = projectionMatrix × modelViewMatrix × vec4(pos, 1.0)` | 必学 |
| 纹理采样: `texture2D()` | `globe.frag` 地球纹理 | 必学 |
| 光照模型: Lambert 漫反射 | `globe.frag` 4 光源累加 | 重要 |
| 数值微分 / 雅可比行列式 | `indicator.vert` 的 `computeAreaDistortion()` | 进阶 |
| 条件分支: `if/else` vs `step/mix` | 投影选择逻辑 | 了解 |

**关键概念：**
- `mix(spherePos, flatPos, localProgress)` — GPU 对 64800 个顶点并行插值，CPU 无法实时完成
- `asin()` 返回 `[-PI/2, PI/2]`，刚好对应纬度范围 `[-90°, 90°]`

### Level 3: Three.js 核心概念

| 知识点 | 对应项目代码 | 优先级 |
|--------|-------------|-------|
| Scene / Camera / Renderer | `main.js` 入口 3 件套 | 必学 |
| Geometry: `SphereGeometry`, `BufferGeometry` | 地球球体、指标几何体 | 必学 |
| Material: `ShaderMaterial` | 所有自定义着色器材质 | 必学 |
| Texture: `TextureLoader`, Canvas 备用纹理 | 地球纹理加载 | 必学 |
| OrbitControls | 鼠标拖拽旋转/缩放 | 必学 |
| Group / Object3D 层级 | 指标系统用 Group 管理 | 重要 |
| Line / LineLoop / Points / Sprite | 轮廓线、粒子、标签 | 重要 |
| Attribute 系统: `setAttribute()` | 朝索圆和航线注入经纬度 | 重要 |
| Blending / Side / PolygonOffset | 半透明混合、z-fighting 处理 | 进阶 |
| BufferGeometry 属性: `position`, `normal`, `uv` | 球体内置属性 | 必学 |

**推荐资源：**
- [Three.js 官方文档](https://threejs.org/docs/)
- [Three.js Journey](https://threejs-journey.com/) — 最系统的付费课程

**关键概念：**
- `ShaderMaterial` 意味着 Three.js 只提供内置 attribute/uniform，投影逻辑完全自定义
- `SphereGeometry(1, 360, 180)` 约 13 万顶点，是变形动画光滑的前提

### Level 4: 地图投影数学

| 知识点 | 对应投影 | 公式核心 |
|--------|---------|---------|
| 墨卡托投影 | ID=0 | `y = ln(tan(π/4 + φ/2))`，保角 |
| 等距柱状投影 | ID=1 | `x = λ, y = φ`，最简单 |
| Lambert 圆锥投影 | ID=2 | 保角圆锥，标准纬线参数化 |
| 正射投影 | ID=3 type=0 | 无穷远处看地球（卫星视角） |
| 立体投影 | ID=3 type=1 | `k = 2/(1 + sin(φ₀))`，保形 |
| 球面↔笛卡尔坐标 | 所有着色器 | `(x,y,z) ↔ (lon, lat, r)` |
| 测地线圆 | 朝索椭圆 | 指数映射公式 |
| 球面线性插值 (Slerp) | 大圆航线 | `P(t) = sin((1-t)θ)/sin(θ)·P₁ + sin(tθ)/sin(θ)·P₂` |
| 雅可比行列式 | 面积变形因子 | 数值微分近似 |

**推荐资源：**
- [Map Projections - Wikipedia](https://en.wikipedia.org/wiki/Map_projection)

**关键概念：**
- 墨卡托裁剪到 `2·atan(exp(π)) - π/2 ≈ 85.05°` 对应 `y = π`，宽高比 1:1（Web 瓦片标准）
- 朝索椭圆用"测地线圆"而非"纬度偏移"生成，避免高纬度失真

### Level 5: 构建工具 & 工程化

| 知识点 | 对应项目代码 | 优先级 |
|--------|-------------|-------|
| Vite 基础配置 | `vite.config.js` | 了解 |
| 自定义 Vite 插件 | `vite-plugin-glsl-include.js` | 进阶 |
| `?raw` 导入 | 着色器字符串加载方式 | 了解 |
| ES Module | 整个项目使用 ESM | 了解 |

---

## 四、推荐学习顺序

```
1️⃣  Three.js 基础（Scene/Camera/Renderer/Geometry/Material）
    → 能理解 main.js 的大部分代码

2️⃣  GLSL 着色器基础（数据类型、内置函数、渲染管线）
    → 能读懂 globe.vert 和 globe.frag

3️⃣  地图投影数学
    → 能理解 projections.glsl 中的投影函数

4️⃣  Three.js 进阶（ShaderMaterial、自定义 Attribute、Blending）
    → 能理解指标系统和着色器管线

5️⃣  工程化（Vite 插件、构建流程）
    → 理解项目骨架
```

---

## 五、项目灵魂

> **GPU 并行变形** — 通过在顶点着色器中对 64800 个顶点并行执行 `mix(球面坐标, 投影坐标, 进度)`，实现了实时、流畅的球体→平面变形动画。理解了这一点，就理解了整个项目的设计动机。

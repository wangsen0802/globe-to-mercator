# Globe to Mercator

Three.js + GLSL shader 项目：将 3D 地球（球体）通过顶点着色器变形为墨卡托投影平面，带有"剥橘子"逐层展开动画。

## 技术栈

- **Runtime**: Three.js `^0.170.0`（ES Module）
- **构建工具**: Vite `^6.0.0`
- **包管理**: pnpm
- **着色器**: 自定义 GLSL vert/frag，通过 `?raw` 导入，`#include` 引入共享代码

## 项目结构

```
src/
├── main.js              # 入口：场景、相机、控制器、纹理加载、滑块交互
├── projections/         # 投影注册表，驱动按钮和面板
│   ├── index.js         # 投影注册表：getProjection / getAllProjections
│   ├── mercator.js      # 墨卡托投影配置
│   ├── plateCarree.js   # 等距柱状投影配置
│   ├── conic.js         # 圆锥投影配置
│   └── azimuthal.js     # 方位投影配置
├── indicators/
│   ├── tissot.js        # 朝索变形椭圆（测地线圆公式 + 180°经线拆分）
│   ├── areaComparison.js # 面积比较（格陵兰/非洲/南美洲 ShapeGeometry 三角化）
│   └── greatCircleRoutes.js # 大圆航线 + 恒向线 + 城市标注精灵 + 发光粒子
├── ui/
│   ├── projectionPanel.js  # 投影教育信息面板
│   └── indicatorPanel.js   # 指标开关面板（玻璃拟态风格）
├── utils/
│   └── math.js          # 共享数学常量（PI、DEG2RAD、RAD2DEG）
└── shaders/
    ├── common/
    │   └── projections.glsl  # 共享投影函数（PI、缓动、4种投影），#include 引入
    ├── globe.vert       # 地球顶点着色器：线性经度参数化 + 球面→投影变形 + 剥橘子缓动
    ├── globe.frag       # 地球片段着色器：4光源 + 经纬线 + 过渡发光 + vRawUv 纹理采样
    ├── indicator.vert   # 指标顶点着色器（朝索+面积轮廓共用，含数值雅可比变形因子）
    ├── tissot.frag      # 朝索变形着色（绿→黄→红梯度）
    ├── route.frag       # 航线片段着色器：uniform 颜色 + 透明度
    └── outline.frag     # 轮廓线/填充着色
vite-plugin-glsl-include.js  # Vite 插件：处理 GLSL #include 指令
scripts/
  glsl-lint.mjs          # GLSL lint 脚本
docs/
  architecture-and-learning-guide.md   # 架构与学习指南
  main-module-deep-dive.md             # main.js 深入解析
  longitude-parameterization-change.md # 经度参数化变更说明
```

## 关键实现

- **变形原理（线性经度参数化）**: 顶点着色器中经度计算从 uv 直接线性映射：`phi = uv.x * 2PI; longitude = phi - PI`，不再通过 `atan` 从 position 反推。片元着色器用 `vRawUv = uv.x` 直接采样纹理，消除纹理接缝跳变
- **剥橘子效果**: 赤道区域先展开，两极延迟（`localDelay = normalizedLat² * uSpreadDelay`），用 easeInOutCubic 缓动
- **纹理来源**: 本地 `assets/earth-blue-marble.jpg`，失败时用 Canvas 绘制备用纹理（复制最左列到最右列消除边缘接缝）
- **球体细分**: 360x180 段，保证变形时足够的顶点密度
- **多投影支持**: 墨卡托(3857)、等距柱状(4326)、圆锥、方位（正射/立体），通过 uProjectionID 切换
- **共享 uniform**: `sharedUniforms` 对象被地球和指标系统共用，切换投影时自动同步
- **4 光源系统**: `uLightDir` ~ `uLightDir4`，从不同角度照亮球体，增强立体感
- **经纬线开关**: 通过 `uShowGrid` uniform 控制经纬线显示/隐藏

### 城市标注精灵系统（greatCircleRoutes.js）

- **Canvas 精灵**: `createCitySprite(name)` 用 Canvas 绘制圆点标记+城市名称纹理，渲染为 `THREE.Sprite`
- **JS 端投影**: `computeLabelPosition(lat, lon, progress, uniforms)` 在 JS 端模拟顶点着色器的球面→投影插值（含剥橘子缓动），计算城市标签实时位置
- **背面隐藏**: `isFrontFacing(sprite, cameraPos)` 通过法线-视线点积判断精灵是否在球体背面，球面状态下自动隐藏
- **发光粒子**: `createGlowPoints(points)` 沿大圆航线创建径向渐变发光粒子
- **JS 投影函数**: `jsProjectMercator` / `jsProjectPlateCarree` / `jsProjectConic` / `jsProjectAzimuthal` — JS 端复刻 GLSL 投影逻辑，供精灵位置计算使用

### 指标球面坐标约定

所有指标模块统一使用以下球面坐标约定（匹配线性经度参数化，lon 0° → +x 方向）：

```javascript
// 球面坐标 → 笛卡尔坐标
x = cos(lat) * cos(lon)
y = sin(lat)
z = -cos(lat) * sin(lon)

// 笛卡尔坐标 → 球面坐标
lon = atan2(-z, x)
lat = asin(y)
```

此约定在 `tissot.js`、`areaComparison.js`、`greatCircleRoutes.js` 中保持一致。

### 日期变更线处理

跨 180° 经线的几何体（朝索椭圆、大圆航线等）需要 `splitAtDateLine()` 函数处理：在 180° 经线处插值出精确边界点，将线段拆分为两段分别渲染，避免经度回绕导致的拉伸和空隙。

### 朝索变形椭圆

- 使用测地线圆公式（`geodesicCirclePoint`）生成圆上的点，而非简单的纬度/经度偏移，修复高纬度变形问题
- 180° 经线附近的朝索椭圆自动拆分为两段渲染
- 面积变形因子通过 `indicator.vert` 中的 `computeAreaDistortion()` 函数计算（有限差分数值雅可比）

## ⚠️ 重要：投影函数单源维护

共享投影函数提取在 `src/shaders/common/projections.glsl`，通过 Vite 插件 `vite-plugin-glsl-include.js` 处理 `#include` 指令注入到各着色器。

**修改投影参数只需改 `projections.glsl` 一个文件**，所有引用它的着色器自动同步。着色器中用 `#include common/projections.glsl` 引入。

## 开发命令

```bash
pnpm dev        # 启动开发服务器（监听 0.0.0.0:3000，支持内网访问）
pnpm build      # 生产构建
pnpm lint:glsl  # GLSL 着色器语法检查（展开 include + 注入 Three.js 声明 + glslangValidator）
```

## GLSL Lint

脚本 `scripts/glsl-lint.mjs` 处理流程：
1. 递归扫描 `src/shaders/` 下的 `.vert` / `.frag` 文件（跳过 `.glsl` 共享库）
2. 展开 `#include` 指令（复用 `vite-plugin-glsl-include.js` 逻辑）
3. 注入 Three.js 内置声明 preamble（`position`, `projectionMatrix`, `normalMatrix` 等）
4. 用 `glslangValidator` 验证语法

前置依赖：`brew install glslang`

## 编码规范

- 注释使用中文
- HTML lang 设为 `zh-CN`
- 着色器中 `#define PI` 在 `projections.glsl` 中统一定义，各着色器通过 `#include` 引入
- uniform 命名：`u` 前缀（uProgress, uSpreadDelay, uTexture, uLightDir ~ uLightDir4, uShowGrid, uProjectionID）
- varying 命名：`v` 前缀（vUv, vNormal, vWorldPos, vLocalProgress, vRawUv, vLatitude）
- GLSL 共享代码放 `src/shaders/common/`，用 `#include common/文件名.glsl` 引入

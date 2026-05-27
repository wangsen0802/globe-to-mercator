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
│   ├── tissot.js        # 朝索变形椭圆指示器
│   ├── areaComparison.js # 面积比较指示器（格陵兰/非洲/南美洲轮廓）
│   └── greatCircleRoutes.js # 大圆航线指示器（航线+发光效果）
├── ui/
│   ├── projectionPanel.js  # 投影教育信息面板
│   └── indicatorPanel.js   # 指标开关面板
├── utils/
│   └── math.js          # 共享数学常量（PI、DEG2RAD、RAD2DEG）
└── shaders/
    ├── common/
    │   └── projections.glsl  # 共享投影函数（PI、缓动、4种投影），#include 引入
    ├── globe.vert       # 地球顶点着色器：球面→投影变形 + 剥橘子缓动
    ├── globe.frag       # 地球片段着色器：纹理采样、光照、经纬线
    ├── indicator.vert   # 指标顶点着色器（朝索+面积轮廓共用）
    ├── tissot.frag      # 朝索圆变形着色
    ├── route.frag       # 航线片段着色器：uniform 颜色 + 透明度
    └── outline.frag     # 轮廓线/填充着色
vite-plugin-glsl-include.js  # Vite 插件：处理 GLSL #include 指令
```

## 关键实现

- **变形原理**: 顶点着色器中将每个顶点的球面坐标 `(x,y,z)` 转换为经纬度，再映射到墨卡托坐标 `(lon, mercY, 0)`，通过 `mix()` 插值实现平滑过渡
- **剥橘子效果**: 赤道区域先展开，两极延迟（`localDelay = normalizedLat² * uSpreadDelay`），用 easeInOutCubic 缓动
- **纹理来源**: 本地 `assets/earth-blue-marble.jpg`，失败时用 Canvas 绘制备用纹理
- **球体细分**: 360x180 段，保证变形时足够的顶点密度
- **多投影支持**: 墨卡托(3857)、等距柱状(4326)、圆锥、方位（正射/立体），通过 uProjectionID 切换
- **共享 uniform**: `sharedUniforms` 对象被地球和指标系统共用，切换投影时自动同步
- **大圆航线**: 预定义多条航线（伦敦→纽约等），在顶点着色器中沿大圆弧插值，变形后展示投影对距离的扭曲

## ⚠️ 重要：投影函数单源维护

共享投影函数提取在 `src/shaders/common/projections.glsl`，通过 Vite 插件 `vite-plugin-glsl-include.js` 处理 `#include` 指令注入到各着色器。

**修改投影参数只需改 `projections.glsl` 一个文件**，所有引用它的着色器自动同步。着色器中用 `#include common/projections.glsl` 引入。

## 开发命令

```bash
pnpm dev        # 启动开发服务器 (端口 3000)
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
- uniform 命名：`u` 前缀（uProgress, uSpreadDelay, uTexture, uLightDir）
- varying 命名：`v` 前缀（vUv, vNormal, vWorldPos, vLocalProgress）
- GLSL 共享代码放 `src/shaders/common/`，用 `#include common/文件名.glsl` 引入

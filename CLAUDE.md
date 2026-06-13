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
├── main.js              # 入口：场景、相机、控制器、纹理加载/切换、法线贴图、滑块交互
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
│   └── indicatorPanel.js   # 指标开关面板（玻璃拟态风格，含地形光影开关）
├── textures/
│   └── index.js         # 纹理注册表：getAllTextures / getDefaultTextureId
├── utils/
│   └── math.js          # 共享数学常量（PI、DEG2RAD、RAD2DEG、CONIC_STD_LAT_DEFAULT）
└── shaders/
    ├── common/
    │   └── projections.glsl  # 共享投影函数（PI、缓动、4种投影），#include 引入
    ├── globe.vert       # 地球顶点着色器：线性经度参数化 + 球面→投影变形 + 剥橘子缓动 + 切线空间基向量
    ├── globe.frag       # 地球片段着色器：4光源 + 法线贴图TBN + 经纬线/特殊纬度线 + Gamma校正 + 过渡发光
    ├── indicator.vert   # 指标顶点着色器（朝索+面积轮廓共用，含数值雅可比变形因子）
    ├── glow.vert        # 发光粒子顶点着色器：GPU 投影（复用 projections.glsl）+ 方位远端淡出 + gl_PointSize 衰减
    ├── tissot.frag      # 朝索变形着色（绿→黄→红梯度）
    ├── route.frag       # 航线片段着色器：uniform 颜色 + 透明度
    ├── outline.frag     # 轮廓线/填充着色
    └── glow.frag        # 发光粒子片元：径向渐变纹理 × 颜色 × 逐点 alpha
public/assets/            # 静态资源：地球纹理、法线贴图、favicon（Vite 映射到根路径，代码以 ./assets/ 引用）
vite.config.js            # Vite 配置：dev server（0.0.0.0:3000）+ glslInclude 插件
vite-plugin-glsl-include.js  # Vite 插件：处理 GLSL #include 指令（导出 expandIncludes 供 lint 复用）
scripts/
  glsl-lint.mjs          # GLSL lint 脚本
docs/                     # 学习文档：架构指南、main.js 深入解析、经度参数化变更说明
```

## 关键实现

- **变形原理（线性经度参数化）**: 顶点着色器中经度计算从 uv 直接线性映射：`phi = uv.x * 2PI; longitude = phi - PI`，不再通过 `atan` 从 position 反推。片元着色器用 `vRawUv = uv.x` 直接采样纹理，消除纹理接缝跳变
- **剥橘子效果**: 赤道区域先展开，两极延迟（`localDelay = normalizedLat² * uSpreadDelay`），用 easeInOutCubic 缓动
- **背面切口（消除剥开穿模，antimeridian crossing 解法）**: `SphereGeometry(1, 360, 180, -Math.PI/2)` 的 `phiStart=-π/2` 把网格接缝（重复顶点）从默认 -x（侧面）转到 -z（背面）。线性经度下 180° 经线落在接缝上 → **在背面干净分割**（接缝两侧顶点分离为平面左右边缘），被前半球遮挡，正面剥开**不再穿模**。本初子午线相应转到 +z 正对相机（更标准的地球仪视角）。这是经典 antimeridian crossing 问题的解法（与 `greatCircleRoutes.js` 的 `splitAtDateLine` 同理）：必须在 180° 经线处有可分割的顶点，且让该分割发生在背面。曾尝试的 `atan` 经度（切口在背面但接缝不分割→平面图拉伸错乱）和贝塞尔外鼓（切口在侧面、外鼓撑开→观感怪异）均已废弃。
- **指标 -π/2 旋转对齐**: 因 `phiStart` 把地球转了 90°，指标球面位置须同步旋转 -π/2（绕 Y，`(x,y,z)→(-z,y,x)`）以贴合地球——在 `indicator.vert`（`spherePos = vec3(-spherePos.z, spherePos.y, spherePos.x)`）和 `greatCircleRoutes.js` 的 `computeLabelPosition`（`rsphere`）各加一处。**平面投影不动**（地理经度，两端一致）。指标的 `latLonToXYZ` 仍用 lon 0°→+x 约定（见下），旋转在着色器/JS 出口处统一施加
- **纹理来源**: 本地 `public/assets/` 目录（代码以 `./assets/` 引用，Vite 把 `public/` 映射到根路径），来源 Solar System Scope (CC BY 4.0)
- **多纹理切换**: 4 种地球纹理（蓝色弹珠、日间、夜间、云层）实时切换，底部纹理切换栏 UI
- **法线贴图光照**: `uNormalMap` 全局常驻，通过 TBN 矩阵将法线从切线空间变换到世界空间，增强地形凹凸光影细节。`uNormalStrength` 控制强度（0~1），左侧面板"地形光影"开关
- **球体细分**: 360x180 段，保证变形时足够的顶点密度
- **多投影支持**: 墨卡托(3857)、等距柱状(4326)、圆锥、方位（正射/立体），通过 uProjectionID 切换。⚠️ 方位投影子类型（正射 `uAzimuthalType=0` / 立体 `=1`）和圆锥标准纬度 `uConicStdLat`（固定 30°N）**代码支持但当前无 UI 切换控件**
- **共享 uniform**: `sharedUniforms` 对象被地球和指标系统共用，切换投影时自动同步
- **4 光源系统**: `uLightDir` ~ `uLightDir4`，从不同角度照亮球体，增强立体感
- **经纬线开关**: 通过 `uShowGrid` uniform 控制经纬线显示/隐藏
- **特殊纬度线**: `globe.frag` 在普通经纬线（每 30°）之外，按纬度 v 坐标额外绘制——赤道 0°(亮白)、南北回归线 ±23.44°(暖黄**虚线**，`step(0.4, fract(u*36))` 生成)、南北极圈 ±66.56°(冷蓝紫)。回归线为虚线、其余实线，受 `uShowGrid` 统一开关控制
- **方位投影远端半球淡出**: 方位投影（正射/立体）是"穿透投影"，只能覆盖一个半球，压扁全球会重叠/爆炸。引入 `vFarMask ∈ [0,1]` 远端标记，驱动 `alpha = 1 - vFarMask · localProgress`：随剥开进度把远端半球淡出，展平后只剩单一有效半球圆盘。标记公式在 `globe.vert`/`indicator.vert`/`glow.vert` 三处 GLSL + `greatCircleRoutes.js`(`jsAzimuthalFarMask`) JS 共 4 份，正射用 `smoothstep(0,0.2,-cos(lat)cos(lon))`（背面）、立体用 `smoothstep(0,0.2,-sin(lat))`（南半球），非方位投影恒 0（其他三种投影完全不淡出）。立体投影额外做半径钳制（`stereoMaxR=2.3`）防南半球 `k` 发散爆炸。地球材质**仅方位投影**下开 `transparent`（`createGlobe` 初值 + `switchProjection` 按 `id===3` 同步）——非方位投影 alpha 恒 1、无需进透明队列。⚠️ **透明地球与共面指标的渲染顺序**：地球 `depthWrite` 默认开 + 最后加入场景 → 透明队列里后于 `depthWrite:false` 的指标渲染 → alpha=1 近端覆盖指标（斜视角下靠近相机一侧可见、远侧被覆盖，呈视角相关"半边显示"）。**已用 `renderAboveEarth()` 给所有指标 group `traverse` 设 `renderOrder=1`（地球默认 0）根治**——`renderOrder` 优先于距离排序，指标恒定后于地球渲染，`depthTest` 因顶点着色器 z 偏移更近而通过、叠在地球之上，地球仍正常淡出（正对+斜视角双验证）；修 5df69c4 遗留（门控只让非方位投影地球不透明，方位投影仍透明、覆盖回归未解）。所有指标（朝索/面积/航线/精灵/发光粒子）同步淡出

### 地球纹理系统（textures/index.js + main.js）

- **纹理注册表**: `src/textures/index.js` 导出 `getAllTextures()` 和 `getDefaultTextureId()`，与投影注册表模式一致
- **4 种可切换纹理**: 蓝色弹珠（默认，earth-blue-marble.jpg）、日间（2k_earth_daymap.jpg）、夜间（2k_earth_nightmap.jpg）、云层（2k_earth_clouds.jpg）
- **异步加载 + 缓存**: `textureCache` 对象缓存已加载的 `THREE.Texture`。默认纹理在初始化阶段即写入 `textureCache`（非"首次切换时"），其余纹理首次切换时通过 `TextureLoader` 加载并缓存，后续命中直接替换
- **实时切换**: `switchTexture(id)` → `applyTexture(id, texture)`，直接替换 `uTexture` uniform 的 value，无需重建材质
- **fallback 链**: 默认纹理失败 → daymap 备用 → Canvas 渐变兜底；法线贴图失败 → 1×1 平坦法线 (128,128,255)。⚠️ 三级 fallback **仅初始加载**；运行时 `switchTexture` 失败只 `console.warn` 并保持当前纹理

### 法线贴图光照（globe.vert + globe.frag）

- **纹理**: `2k_earth_normal_map.jpg`（全局常驻，不随颜色纹理切换），来源 Solar System Scope
- **切线空间基向量**: 顶点着色器中基于球面坐标偏导数计算：
  - 球面切线 `sphereTangent = normalize(∂Pos/∂lon)` = `(-sinLon·cosLat, 0, -cosLon·cosLat)`
  - 球面副切线 `sphereBitangent = normalize(∂Pos/∂lat)` = `(-cosLon·sinLat, cosLat, sinLon·sinLat)`
  - 跟法线一样在球面和平面之间 `mix` 插值，保证变形过程中 TBN 连续过渡
- **TBN 矩阵**: 片段着色器中构建，对 `vTangent` 做 Gram-Schmidt 正交化（`T = normalize(T - dot(T,N)·N)`），副切线由 `B = cross(N,T) * sign(dot(cross(N,T), vBitangent))` 重算——以 `vBitangent` 校正手性，防止球面↔平面过渡中切线空间翻转导致法线贴图凹凸反向
- **扰动放大**: `tangentNormal.xy *= 10.0` 增强凹凸效果，`uNormalStrength` uniform 控制混合比例（0=纯顶点法线，1=完全法线贴图）
- **Varying**: `vTangent`（切线）、`vBitangent`（副切线），通过 `normalMatrix` 变换到世界空间

### 城市标注精灵系统（greatCircleRoutes.js）

- **Canvas 精灵**: `createCitySprite(name)` 用 Canvas 绘制圆点标记+城市名称纹理，渲染为 `THREE.Sprite`
- **JS 端投影**: `computeLabelPosition(lat, lon, progress, uniforms)` 在 JS 端模拟顶点着色器的球面→投影插值（含剥橘子缓动），计算城市标签实时位置
- **背面隐藏**: `isFrontFacing(sprite, cameraPos)` 通过法线-视线点积判断精灵是否在球体背面，球面状态下自动隐藏
- **发光粒子**: `createGlowPoints(points, uniforms)` 沿大圆航线创建径向渐变发光粒子，**GPU 投影**（`glow.vert`，复用 `projections.glsl` 与 `indicator.vert` 同源），含方位远端淡出 + `gl_PointSize` 距离衰减；`uViewportHeight` 由 `createGreatCircleRoutes` 返回的 `onResize` 在窗口缩放时更新
- **JS 投影函数**: `jsProjectMercator` / `jsProjectPlateCarree` / `jsProjectConic` / `jsProjectAzimuthal` + `jsAzimuthalFarMask`（方位远端淡出标记）— JS 端复刻 GLSL 投影/mask 逻辑，**仅供城市精灵用**（`SpriteMaterial` 不能 `#include` GLSL）。发光粒子已改走 GPU 投影、与航线同源不再漂移；现仅精灵这一处依赖 JS 副本

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

## ⚠️ 重要：投影函数的"半单源"维护

- **GLSL 层真单源**：投影函数集中在 `src/shaders/common/projections.glsl`，经 `vite-plugin-glsl-include.js` 的 `#include` 注入。改投影函数只需动 `projections.glsl` 一处，`globe.vert`/`indicator.vert` 自动同步。
- **JS 层有手写副本须手动同步**：`greatCircleRoutes.js` 的 `jsProject*` + `jsApplyProjection` + `jsAzimuthalFarMask` + `easeInOutCubic`/`smoothstepJS` 是 shader 的纯 JS 复刻（**仅城市精灵**用，发光粒子已改 GPU 投影，JS 不能 `#include` GLSL）。改 `projections.glsl` 的 clamp 边界或 mask 公式后**必须同步该文件**。
- **构建期护栏**：`glsl-lint.mjs` 末尾断言 GLSL↔JS 数值一致，漂移即 `pnpm lint:glsl` 失败：① 圆锥纬度上限 `1.56`；② 立体投影半径钳制 `stereoMaxR=2.3`；③ 方位远端淡出 mask 的 `smoothstep(0.0, 0.2, …)` 过渡带宽度（跨 `globe.vert`/`indicator.vert`/`glow.vert`/`greatCircleRoutes.js` 四副本）。墨卡托两端数学等价无需对齐。`expandIncludes`（插件导出、lint 复用）基于绝对路径 `seen` 集合检测 `#include` 跨文件循环引用。

## 开发命令

```bash
pnpm dev        # 启动开发服务器（监听 0.0.0.0:3000，支持内网访问）
pnpm build      # 生产构建
pnpm lint:glsl  # GLSL 着色器语法检查（展开 include + 注入 Three.js 声明 + glslangValidator）
```

> **质量工具缺口**：本项目仅有 GLSL lint（`pnpm lint:glsl`），**未配置 JS 的 eslint / prettier / typecheck**。编码规范（中文注释、`u`/`v` 前缀命名）依赖人工遵守，建议中长期补充。

## GLSL Lint

脚本 `scripts/glsl-lint.mjs` 处理流程：
1. 递归扫描 `src/shaders/` 下的 `.vert` / `.frag` 文件（跳过 `.glsl` 共享库）
2. 展开 `#include` 指令（复用 `vite-plugin-glsl-include.js` 的 `expandIncludes`，含循环引用检测）
3. 注入 Three.js 内置声明 preamble（`position`, `projectionMatrix`, `normalMatrix` 等）
4. 用 `glslangValidator` 验证语法
5. 投影 clamp 边界一致性护栏：正则比对 `projections.glsl` 与 `greatCircleRoutes.js` 的圆锥纬度上限等数值，漂移即 fail

前置依赖：`brew install glslang`

## 编码规范

- 注释使用中文
- HTML lang 设为 `zh-CN`
- 着色器中 `#define PI`：`projections.glsl` 定义一次，`#include` 它的 vert 着色器复用；但 `globe.frag` 等 frag 着色器**不 include 共享库**，各自独立 `#define PI`（修改 PI 精度需同步多处）
- uniform 命名：`u` 前缀（uProgress, uSpreadDelay, uTexture, uNormalMap, uNormalStrength, uNormalBumpScale, uLightDir ~ uLightDir4, uShowGrid, uProjectionID, uConicStdLat, uAzimuthalType）
- varying 命名：`v` 前缀（vUv, vNormal, vWorldPos, vLocalProgress, vRawUv, vLatitude, vTangent, vBitangent）
- GLSL 共享代码放 `src/shaders/common/`，用 `#include common/文件名.glsl` 引入

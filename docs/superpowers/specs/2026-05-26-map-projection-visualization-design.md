# 地球投影可视化项目设计文档

> 在现有 globe-to-mercator 项目基础上扩展，构建交互式地图投影学习与科普平台。

## 项目目标

1. **可视化理解**：通过 3D 球体→2D 平面的变形动画，直观展示不同投影的变形过程
2. **学习投影计算**：每种投影展示数学公式和参数含义，理解投影变换本质
3. **科普教育**：通过变形指标和交互面板，帮助他人理解投影变形的原理和影响

## 整体架构

```
src/
├── main.js                    # 入口：场景、相机、控制器（现有，重构）
├── projections/
│   ├── index.js               # 投影注册表，统一接口
│   ├── mercator.js            # 导出：{ id, name, formula, description, uniforms, info }
│   ├── plateCarree.js
│   ├── conic.js               # Albers / Lambert
│   └── azimuthal.js           # Orthographic / Stereographic
├── indicators/
│   ├── tissot.js              # 朝索变形椭圆
│   ├── areaComparison.js      # 面积比较可视化
│   ├── greatCircle.js         # 大圆航线变形
│   └── featurePoints.js       # 特征点标注
├── ui/
│   ├── projectionPanel.js     # 投影选择 + 教育信息面板
│   └── indicatorPanel.js      # 变形指标开关
├── shaders/
│   ├── globe.vert             # 统一顶点着色器，通过 uniform 选投影
│   ├── globe.frag             # 统一片元着色器
│   ├── tissot.vert            # 变形椭圆专用 shader
│   └── tissot.frag
└── utils/
    └── math.js                # 共用数学常量和函数
```

### 核心原则

- 投影公式统一抽象为 `project(lon, lat, params) → [x, y, z]`
- JS 端维护投影参数，传给 shader 的 uniform
- Vertex shader 内用 `if-else` 分支选投影（GPU 对 uniform 分支效率可接受）
- 变形指标作为独立的 Three.js 对象叠加在场景中

## Shader 投影架构

### 统一顶点着色器

```glsl
uniform int uProjectionID;   // 0=mercator, 1=plateCarree, 2=conic, 3=azimuthal
uniform float uProgress;
uniform float uSpreadDelay;

// 圆锥投影专属参数
uniform float uConicLat1;
uniform float uConicLat2;

// 方位投影专属参数
uniform int uAzimuthalType;  // 0=正射, 1=立体

void main() {
  float lat = asin(clamp(normalize(position).y, -1.0, 1.0));
  float lon = atan(position.x, position.z);

  vec3 flatPos;
  if (uProjectionID == 0) {
    flatPos = projectMercator(lon, lat);
  } else if (uProjectionID == 1) {
    flatPos = projectPlateCarree(lon, lat);
  } else if (uProjectionID == 2) {
    flatPos = projectConic(lon, lat, uConicLat1, uConicLat2);
  } else {
    flatPos = projectAzimuthal(lon, lat, uAzimuthalType);
  }

  // "剥橘子"插值逻辑不变
  vec3 finalPos = mix(spherePos, flatPos, localProgress);
}
```

### 各投影公式

**墨卡托（Mercator, EPSG:3857）**
```glsl
vec3 projectMercator(float lon, float lat) {
  float mercY = log(tan(PI / 4.0 + lat / 2.0));
  mercY = clamp(mercY, -2.5, 2.5);
  return vec3(lon, mercY, 0.0);
}
```

**等距柱状（Plate Carree, EPSG:4326）**
```glsl
vec3 projectPlateCarree(float lon, float lat) {
  return vec3(lon, lat, 0.0);
}
```

**圆锥投影（Conic, Albers/Lambert）**
```glsl
vec3 projectConic(float lon, float lat, float lat1, float lat2) {
  float n = sin(lat1);
  float rho = (1.0 / tan(lat1)) * pow(tan(PI/4.0 + lat/2.0), n) / cos(lat1);
  float theta = n * lon;
  return vec3(rho * sin(theta), rho * cos(theta), 0.0);
}
```

**方位投影（Azimuthal, Orthographic/Stereographic）**
```glsl
vec3 projectAzimuthal(float lon, float lat, int type) {
  if (type == 0) {
    // 正射投影（Orthographic）
    return vec3(cos(lat) * sin(lon), sin(lat), 0.0);
  } else {
    // 立体投影（Stereographic）
    float k = 2.0 / (1.0 + sin(lat));
    return vec3(k * cos(lat) * sin(lon), k * cos(lat) * cos(lon), 0.0);
  }
}
```

### JS 端投影模块接口

每个投影导出统一结构：

```js
export const mercator = {
  id: 0,
  name: '墨卡托投影',
  epsg: 'EPSG:3857',
  uniforms: {},              // 额外 shader 参数（无）
  info: {
    forwardFormula: 'x = λ,  y = ln(tan(π/4 + φ/2))',
    inverseFormula: 'λ = x,  φ = 2·arctan(eʸ) - π/2',
    properties: [
      { name: '保角（角度不变）', valid: true },
      { name: '等面积', valid: false },
      { name: '等距', valid: false },
      { name: '大圆为直线', valid: true },
    ],
    useCases: '航海导航、Web 地图（Google/高德）',
    distortion: '高纬度面积严重放大，格陵兰显得和非洲一样大'
  }
};
```

## 变形指标系统

### 朝索变形椭圆（Tissot's Indicatrix）

- 球面上均匀放置圆形标记点（每 30° 一个，共 6×12 = 72 个）
- 用独立 `CircleGeometry`（32 段），顶点 shader 施加与主地球相同的投影变换
- 半透明填充 + 边框线，颜色随变形程度变化（绿→黄→红）

### 面积比较

- 用 `ShapeGeometry` 勾勒格陵兰、非洲、俄罗斯、南美洲轮廓
- 简化到约 20-30 个控制点的 GeoJSON 坐标
- 投影变形后旁边显示真实面积数值和变形倍率

### 大圆航线变形

- 计算北京→纽约、伦敦→悉尼等 3-4 条经典航线的大圆弧线
- 球面上亮色曲线表示大圆航线，投影后自动变形
- 叠加投影空间直线（虚线）作为对比

### 特征点标注

- 标注北京、伦敦、纽约、悉尼、开罗等 8-10 个城市
- 用 `Sprite` 或 HTML CSS2DRenderer 标签
- 显示经纬度坐标、投影后坐标、与真实距离的偏差

## 教育信息面板

### 布局

```
┌─────────────────────────────────────────────────┐
│  [EPSG:3857] [EPSG:4326] [Conic] [Azimuthal]    │
├──────────────────────────┬──────────────────────┤
│                          │  ┌──────────────────┐ │
│                          │  │ 投影名称 + EPSG   │ │
│     3D 场景              │  │ 正反算公式        │ │
│                          │  │ 投影特性列表      │ │
│                          │  │ 使用场景          │ │
│                          │  │ 变形说明          │ │
│                          │  │ [变形指标开关]     │ │
│                          │  └──────────────────┘ │
├──────────────────────────┴──────────────────────┤
│  球体 ════════════════════════════ 平面  0%       │
└─────────────────────────────────────────────────┘
```

### 面板规则

- 公式用 CSS 渲染，不引入 MathJax（HTML 实体 `φ` `λ` `π` + 上标标签）
- 信息随投影切换即时更新
- 三个区块：公式区、特性区、指标控制区

## 迭代计划

### Phase 1：投影框架重构 + 圆锥投影

- 重构 shader 为可插拔投影架构（`uProjectionID` 分支）
- 抽取 JS 端投影模块（统一接口）
- 新增圆锥投影（Albers / Lambert）
- 教育面板基础骨架（公式 + 特性展示）
- **交付物**：可切换 4 种投影，右侧显示公式说明

### Phase 2：朝索变形椭圆 + 面积比较

- 实现朝索椭圆的独立 mesh + 变形 shader
- 面积轮廓（格陵兰 vs 非洲等）
- 面板中增加指标 toggle 开关
- **交付物**：投影变形可视化，可开关对比

### Phase 3：大圆航线 + 特征点标注

- 大圆弧线采样与渲染
- 投影空间直线对比（虚线）
- 城市 Sprite 标签 + 坐标偏差信息
- **交付物**：完整的 4 个变形指标系统

### Phase 4：打磨与优化

- 过渡动画优化（不同投影的"剥橘子"缓动差异化）
- 移动端适配
- 性能优化（LOD 等，按需）
- **交付物**：可分享的科普演示

## 技术约束

- 保持现有技术栈：Three.js + Vite + GLSL shader
- 包管理使用 pnpm
- 注释使用中文
- HTML lang 为 zh-CN
- shader uniform 命名 `u` 前缀，varying 命名 `v` 前缀

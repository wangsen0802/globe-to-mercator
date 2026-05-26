# Phase 3：大圆航线 + 特征点标注 — 设计规范

> 将球面最短路径（大圆航线）与等角航线（恒向线）在地球投影上对比展示，辅以城市标注，直观呈现投影变形对距离和方向的影响。

## 1. 需求摘要

- **大圆航线**：3 条经典航线对（大圆 vs 恒向线），发光线条风格
- **特征点标注**：航线端点城市的固定文字标签（Sprite）
- **交互**：独立的 toggle 开关，默认关闭
- **投影联动**：航线和标注跟随投影切换和剥橘子动画变形

## 2. 航线数据

| 航线 | 起点 | 终点 | 教育意义 |
|------|------|------|----------|
| 大西洋航线 | 伦敦 (51.5°N, 0°) | 纽约 (40.7°N, -74°) | 大圆向北弯曲，比恒向线短约 800km |
| 太平洋航线 | 东京 (35.7°N, 139.7°E) | 洛杉矶 (34°N, 118.2°W) | 大圆经阿拉斯加附近弯曲，效果最戏剧性 |
| 南半球航线 | 悉尼 (33.9°S, 151.2°E) | 圣地亚哥 (33.4°S, 70.7°W) | 大圆向南弯曲，与北半球方向相反 |

每条航线包含两条线：
- **大圆**：球面最短路径，用球面线性插值（slerp）生成 100 个插值点
- **恒向线**：等角航线，用恒向线方程计算各中间点经纬度

数据结构：
```javascript
const ROUTES = [
  { from: { name: '伦敦', lat: 51.5, lon: 0 }, to: { name: '纽约', lat: 40.7, lon: -74 } },
  { from: { name: '东京', lat: 35.7, lon: 139.7 }, to: { name: '洛杉矶', lat: 34.0, lon: -118.2 } },
  { from: { name: '悉尼', lat: -33.9, lon: 151.2 }, to: { name: '圣地亚哥', lat: -33.4, lon: -70.7 } }
];
```

## 3. 视觉风格

- **发光线条风格**：大圆用青色 `#4fc3f7`，恒向线用橙色 `#ff9800`
- 端点为白色发光圆点
- 半透明度 0.8，`transparent: true`
- 使用 `THREE.Line` + 自定义 `ShaderMaterial`

## 4. 渲染架构

### 4.1 航线几何体

- 使用 `indicator.vert` 共享顶点着色器（复用投影变换和剥橘子动画）
- 新建 `route.frag` 片段着色器：接收 `uColor` (vec3) + `uOpacity` (float) uniform，输出纯色发光
- 每个顶点设置 `position`（球面笛卡尔坐标）、`aLatitude`、`aLongitude` 属性
- 每条线一个 `THREE.Line` mesh，6 个城市端点共享同组 Sprite

### 4.2 城市标注

- 使用 `THREE.Sprite` 显示城市名（始终面向相机）
- Sprite 纹理通过 Canvas 绘制：发光圆点 + 城市名文字
- Sprite 位置需每帧同步：在 JS 端实现与着色器一致的投影函数 + 剥橘子插值

### 4.3 JS 端投影同步

标注 Sprite 不经过 `indicator.vert`，需在 JS 端手动计算投影位置：

```javascript
function projectPoint(lat, lon, progress, projectionID, spreadDelay) {
  // 球面坐标
  const spherePos = [cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon)];
  // 投影坐标（JS 版 4 种投影）
  const flatPos = applyProjection(lon, lat, projectionID);
  // 剥橘子缓动
  const normalizedLat = abs(lat) / (PI/2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = easeInOutCubic(clamp((progress - localDelay) / (1 - spreadDelay), 0, 1));
  // 插值
  return lerp(spherePos, flatPos, localProgress);
}
```

导出 `updateLabels(progress, projectionID)` 供 `animate()` 每帧调用。

## 5. 文件结构

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/indicators/greatCircleRoutes.js` | 航线几何体 + 城市标注，单模块 |
| `src/shaders/route.frag` | 航线片段着色器（发光色） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/main.js` | 导入并注册航线指标，animate 中同步标注位置 |
| `src/ui/indicatorPanel.js` | 新增 "大圆航线" toggle + 航线图例 |

## 6. main.js 集成

```javascript
// 新增导入
import { createGreatCircleRoutes } from './indicators/greatCircleRoutes.js';

// 创建并加入场景（默认隐藏）
const greatCircleRoutes = createGreatCircleRoutes(sharedUniforms);
scene.add(greatCircleRoutes.group);
greatCircleRoutes.group.visible = false;

// indicatorPanel 新增回调
initIndicatorPanel({
  onTissotToggle: ...,
  onAreaToggle: ...,
  onRouteToggle: (visible) => { greatCircleRoutes.group.visible = visible; }
});

// animate() 中
greatCircleRoutes.updateLabels(progress, currentProjection.id);
if (progress < 0.05 && globe) {
  greatCircleRoutes.group.rotation.y = globe.mesh.rotation.y;
}
```

## 7. UI 面板

`indicatorPanel.js` 新增：
- Toggle 开关：`大圆航线`（默认关闭）
- 展开时显示图例区域：
  - `—— 大圆（最短路径）` 青色
  - `--- 恒向线（等角航线）` 橙色

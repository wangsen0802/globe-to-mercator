# Globe to Mercator

Three.js + GLSL shader 项目：将 3D 地球（球体）通过顶点着色器变形为墨卡托投影平面，带有"剥橘子"逐层展开动画。

## 技术栈

- **Runtime**: Three.js `^0.170.0`（ES Module）
- **构建工具**: Vite `^6.0.0`
- **包管理**: pnpm
- **着色器**: 自定义 GLSL vert/frag，通过 `?raw` 导入

## 项目结构

```
src/
├── main.js              # 入口：场景、相机、控制器、纹理加载、滑块交互
└── shaders/
    ├── globe.vert       # 顶点着色器：球面→墨卡托变形 + 剥橘子缓动
    └── globe.frag       # 片段着色器：纹理采样、光照、经纬线、边缘高光
```

## 关键实现

- **变形原理**: 顶点着色器中将每个顶点的球面坐标 `(x,y,z)` 转换为经纬度，再映射到墨卡托坐标 `(lon, mercY, 0)`，通过 `mix()` 插值实现平滑过渡
- **剥橘子效果**: 赤道区域先展开，两极延迟（`localDelay = normalizedLat² * uSpreadDelay`），用 easeInOutCubic 缓动
- **纹理来源**: NASA Blue Marble，通过 unpkg CDN 从 `three-globe` 包加载，失败时用 Canvas 绘制备用纹理
- **球体细分**: 360x180 段，保证变形时足够的顶点密度

## 开发命令

```bash
pnpm dev      # 启动开发服务器 (端口 3000)
pnpm build    # 生产构建
```

## 编码规范

- 注释使用中文
- HTML lang 设为 `zh-CN`
- 着色器中定义 `#define PI 3.14159265359`
- uniform 命名：`u` 前缀（uProgress, uSpreadDelay, uTexture, uLightDir）
- varying 命名：`v` 前缀（vUv, vNormal, vWorldPos, vLocalProgress）

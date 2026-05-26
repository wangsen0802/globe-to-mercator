# 球体展开为墨卡托平面时的纹理对齐问题

## 问题描述

将 Three.js 球体通过顶点着色器变形为墨卡托平面时，存在一对矛盾：

- **使用几何体 UV**：展开后纹理整体错位 90°
- **使用经纬度计算 UV**：纹理正确，但 180° 经线处出现拼接缝隙

## 根因分析

### Three.js SphereGeometry 的参数方程

SphereGeometry 用参数 `phi`（水平角）和 `theta`（极角）生成顶点：

```
顶点位置:  x = -r × cos(phi) × sin(theta)
           z =  r × sin(phi) × sin(theta)

UV 坐标:   uv.x = phi / (2π)            ← 线性映射 phi 到 [0, 1]
```

### 墨卡托 X 坐标的计算方式

在顶点着色器中，墨卡托 X 坐标通过 `atan` 从顶点位置反算经度：

```glsl
float longitude = atan(position.x, position.z);  // [-π, +π]
float mercX = longitude;
```

### 关键矛盾：uv.x 和 mercX 之间恒差 90°

将 `atan(x, z)` 展开：

```
atan(-cos(phi), sin(phi)) = phi - π/2
```

因此：

```
uv.x = phi / (2π)
mercX = phi - π/2

纹理应采样 U = (mercX + π) / (2π) = phi/(2π) + 0.25 = uv.x + 0.25
```

**uv.x 和正确的纹理 U 之间恒差 0.25（即 90° 经度）。**

### 为什么球体状态下看不出来

球体是封闭曲面，纹理从哪个经度开始贴、旋转多少度，视觉上无法分辨。
球体上的一切看起来都是"正确的"，因为不存在绝对的"左边缘"和"右边缘"。

### 为什么展开成平面后纹理错乱

平面地图有明确的坐标轴：左边缘 = -180°，中心 = 0°，右边缘 = +180°。
90° 的偏移导致每个大陆都出现在错误的位置：

```
网格实际位置 (mercX):   -180°    -90°      0°     +90°    +180°
纹理采样位置 (uv.x):    -90°      0°     +90°    +180°    -90°(循环)
```

非洲（~20°E）出现在南美洲的位置，亚洲出现在大西洋的位置。
这不是模糊或拉伸，而是**整体平移 90°**，视觉上表现为"错乱"。

## 两种方案的对比

### 方案 A：使用几何体 UV

```glsl
// 顶点着色器
float mercX = atan(position.x, position.z);
vUv = uv;  // 直接用几何体 UV

// 片元着色器
vec4 tex = texture2D(uTexture, vUv);
```

| 优点 | 缺点 |
|------|------|
| 无缝隙（Three.js 在接缝处有重复顶点，UV 分别为 0 和 1，插值自然过渡） | 纹理偏移 90°，平面状态下大陆位置错误 |

### 方案 B：使用经纬度计算 UV

```glsl
// 顶点着色器
float longitude = atan(position.x, position.z);
float latitude = asin(normalize(position).y);
vLongitude = longitude;
vLatitude = latitude;

// 片元着色器
float u = (vLongitude + PI) / (2.0 * PI);
float v = (vLatitude + PI / 2.0) / PI;
vec4 tex = texture2D(uTexture, vec2(u, v));
```

| 优点 | 缺点 |
|------|------|
| 纹理与 mercX 完美对齐，大陆位置正确 | 180° 经线处有缝隙 |

### 180° 缝隙的成因

`atan(x, z)` 返回值范围 [-π, +π]，在 180° 经线处从 `+π` 跳变到 `-π`：

```
顶点A (经度 ≈ +179°)  ───  顶点B (经度 ≈ -179°)
vLongitude = +0.997π        vLongitude = -0.997π
                    GPU 线性插值
                    ↓
              中点值 = 0  ← 错误！应该接近 ±π
              纹理采样到地图中间（非洲区域）
              → 出现一条高亮/错误的窄缝
```

GPU 不理解 `+π` 和 `-π` 是同一个角度，它只做线性插值，穿过了 0。

## 修复方案

### 方案 C：UV 偏移（推荐）

利用 uv.x 和经纬度之间的**恒定偏移量**，结合两者的优势：

```glsl
// 顶点着色器
float mercX = atan(position.x, position.z);  // 顶点不滑动
vTexU = uv.x + 0.25;  // 无缝插值 + 对齐 mercX

// 片元着色器
float u = fract(vTexU);  // 映射到 [0, 1]
float v = uv.y;
vec4 tex = texture2D(uTexture, vec2(u, v));
```

**原理**：偏移量 0.25 在所有顶点上都一样（由参数方程决定），所以 GPU 在三角形内插值时，
`vTexU` 的变化范围极小（相邻顶点差 ≈ 1/360 ≈ 0.003），`fract()` 不会跨过整数边界。

| 优点 | 缺点 |
|------|------|
| 无缝隙（基于 uv.x 插值） | 需要理解偏移常量的来源 |
| 纹理正确（0.25 偏移对齐 mercX） | |
| 顶点过渡不滑动（mercX 仍用 atan） | |

## 数学证明：偏移量恒为 0.25

Three.js SphereGeometry 中，顶点的 phi 与 uv.x 的关系：

```
phi = uv.x × 2π
```

顶点位置：

```
x = -r × cos(phi) × sin(theta)
z =  r × sin(phi) × sin(theta)
```

经度：

```
longitude = atan(x, z) = atan(-cos(phi), sin(phi)) = phi - π/2
```

正确的纹理 U：

```
texU = (longitude + π) / (2π)
     = (phi - π/2 + π) / (2π)
     = (phi + π/2) / (2π)
     = phi/(2π) + 1/4
     = uv.x + 0.25
```

偏移量 = 0.25，对所有顶点、所有纬度恒成立。

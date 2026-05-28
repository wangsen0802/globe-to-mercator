# 球面经度参数化：从 atan 到线性映射

> 提交 `ef35fc2` 将经度计算从 `atan(-cos(phi), sin(phi))` 改为 `phi - PI`。
> 本文档解释这一变更的原因、对坐标系的影响，以及指示器为什么需要同步修改。

## 背景：Three.js SphereGeometry 的坐标约定

Three.js 的 `SphereGeometry` 用两个角度参数化球面顶点：

```
x = -r · cos(φ) · sin(θ)
y =  r · cos(θ)
z =  r · sin(φ) · sin(θ)
```

其中 φ ∈ [0, 2π]（水平角），θ ∈ [0, π]（从北极到南极），UV 坐标 uv.x = φ / 2π。

关键对应关系：

| φ       | uv.x | 3D 方向 | 顶点位置 (赤道) |
|---------|------|---------|-----------------|
| 0       | 0    | -x      | (-r, 0, 0)      |
| π/2     | 0.25 | +z      | (0, 0, +r)      |
| π       | 0.5  | +x      | (+r, 0, 0)      |
| 3π/2    | 0.75 | -z      | (0, 0, -r)      |
| 2π      | 1.0  | -x      | (-r, 0, 0)      |

球面接缝（seam）在 φ=0/2π 处，即 **-x 方向**。

## 旧公式：atan 参数化

```glsl
float phi = uv.x * 2.0 * PI;
float longitude = atan(-cos(phi), sin(phi));
```

### 数学本质

这个公式等价于 `atan2(position.x, position.z)`：

```
position.x = -r · cos(φ)
position.z =  r · sin(φ)

atan2(-cos(φ), sin(φ))
```

展开验证：

| φ    | cos(φ) | sin(φ) | atan2(-cos, sin) | 3D 方向 |
|------|--------|--------|-------------------|---------|
| 0    |  1     |  0     | -π/2              | -x      |
| π/2  |  0     |  1     | **0**             | **+z**  |
| π    | -1     |  0     | π/2               | +x      |
| 3π/2 |  0     | -1     | π                 | -z      |

**经度 0°（本初子午线）对应 +z 方向**，即面向默认相机位置。

### 问题：接缝处截断回绕

`atan2` 的返回值范围是 [-π, π]，在 φ=2π（uv.x=1）处会发生跳变：

```
φ = 2π - ε:  longitude ≈ -π/2 - (small)    ← 接近 -π
φ = 2π:      longitude = -π/2               ← 跳回 -π/2
```

接缝两侧的顶点经度值不连续，导致：
1. **纹理采样跳变** — 展开动画中接缝处的 UV 坐标发生突变，出现可见的接缝线
2. **投影坐标跳变** — 从球面变形到平面时，接缝处顶点的 flatPos 不连续

## 新公式：线性参数化

```glsl
float phi = uv.x * 2.0 * PI;
float longitude = phi - PI;
```

### 数学本质

直接用 φ 的线性偏移计算经度，整个 uv.x ∈ [0, 1] 区间连续无跳变。

| φ    | uv.x | phi - PI | 3D 方向 |
|------|------|----------|---------|
| 0    | 0    | -π       | -x      |
| π/2  | 0.25 | -π/2     | +z      |
| π    | 0.5  | **0**    | **+x**  |
| 3π/2 | 0.75 | π/2      | -z      |
| 2π   | 1.0  | π        | -x      |

**经度 0° 现在对应 +x 方向**，接缝在 lon=±π（对跖经线 / 日期变更线），位于球体背面，视觉上不可见。

### 优势

1. **消除接缝跳变** — `phi - PI` 是严格线性函数，uv.x 从 0 到 1 单调递增，无 atan 的截断回绕
2. **纹理对齐正确** — uv.x=0.5（纹理中心）= lon=0（本初子午线），uv.x=0/1（纹理边缘）= lon=±π（对跖经线）
3. **片元着色器简化** — 可以直接用 `vRawUv = uv.x` 采样纹理，无需从经度反算 UV

### 副作用：坐标约定变更

线性参数化决定了 φ=π（+x 方向）= lon=0°，这是数学上的必然结果，无法在保持线性无跳变的同时让 lon=0° 落在 +z 方向。

可能的替代方案及其问题：

| 方案 | 做法 | 问题 |
|------|------|------|
| 旋转 mesh | `mesh.rotation.y = -PI/2` | 平面投影也会被旋转，展开的地图是歪的 |
| 偏移公式 | `longitude = phi - PI/2` | 接缝落在 lon=-π/2（90°W），球体侧面可见 |
| 保留 atan | 不改 | 接缝跳变 bug 依然存在 |

**结论：线性参数化 + 调整指示器坐标约定是唯一不引入新问题的方案。**

## 指示器坐标修正

指示器（朝索椭圆、面积比较、大圆航线）在 JS 端计算球面顶点位置，需要与地球的 SphereGeometry 坐标一致。

### 旧约定（匹配 atan 公式，lon 0° → +z）

```javascript
x = Math.cos(lat) * Math.sin(lon)
y = Math.sin(lat)
z = Math.cos(lat) * Math.cos(lon)

// 逆运算
lon = Math.atan2(x, z)
```

### 新约定（匹配线性公式，lon 0° → +x）

```javascript
x = Math.cos(lat) * Math.cos(lon)
y = Math.sin(lat)
z = -Math.cos(lat) * Math.sin(lon)

// 逆运算
lon = Math.atan2(-z, x)
```

### 修改范围

三个指示器文件中所有从经纬度计算 3D 位置的代码：

| 文件 | 涉及函数/位置 |
|------|---------------|
| `indicators/greatCircleRoutes.js` | `latLonToXYZ`、`xyzToLatLon`、`createLineGeometry` |
| `indicators/areaComparison.js` | `createPolygonGeometries` 中填充和轮廓线的位置计算 |
| `indicators/tissot.js` | `geodesicCirclePoint`（中心点、切向量、球面位置公式）、`createCircleGeometry`、`createSplitCircleGeometries` |

注意：`aLatitude`/`aLongitude` 属性值不变（仍是地理经纬度），只有 3D 球面位置需要改。着色器中的投影函数依据 `aLongitude`/`aLatitude` 计算，不受坐标约定变更影响。

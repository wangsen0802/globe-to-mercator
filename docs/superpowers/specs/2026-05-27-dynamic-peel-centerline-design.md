# 动态剥橘子的中心经线设计

> 剥橘子展开动画的中心经线由固定的 0° 改为按下进度条时捕获的可见半球中心经线。

## 背景

当前实现中，投影中心始终为 0° 经线（本初子午线），剥橘子动画从赤道向两极展开，但水平方向对称于 0°。用户旋转地球到任意角度后拖进度条，展开的视觉起点可能和用户看到的视角不匹配。

本设计让展开动画的起点跟随用户视角：按下进度条时捕获相机朝向的经线作为投影中心。

## 核心机制

新增共享 uniform `uCenterLon`（弧度），在按下进度条时从相机位置计算并冻结，progress 回到 0 时归零。

所有着色器（地球 + 指标）在投影计算前统一偏移经度：`adjustedLon = wrapLon(longitude - uCenterLon)`。

## 详细设计

### 1. 着色器变更

#### projections.glsl — 新增工具函数

```glsl
float wrapLon(float lon) {
  return mod(lon + PI, 2.0 * PI) - PI;
}
```

#### globe.vert — 偏移经度

- 新增 `uniform float uCenterLon;`
- 投影前：`float adjustedLon = wrapLon(longitude - uCenterLon);`
- 所有投影函数调用使用 `adjustedLon` 而非 `longitude`
- `vLongitude` 仍传递原始经度（供纹理采样用）

#### indicator.vert — 偏移经度 + 分割线标记

- 新增 `uniform float uCenterLon;`
- 投影前偏移经度，与 globe.vert 一致
- 新增 varying `vSplitMask`：检测 adjustedLon 是否接近 ±PI（日期线），传递给片元着色器

#### tissot.frag — 分割线 discard

- 根据 `vSplitMask` 在接近日期线的区域 discard 片元
- 替代原来 JS 端硬编码的 180° 拆分逻辑

#### indicator 相关片元着色器

- `outline.frag`、`route.frag` 中同样检测 `vSplitMask`，必要时 discard

### 2. JS 端变更

#### main.js

- `sharedUniforms` 新增 `uCenterLon: { value: 0.0 }`
- 进度条 `mousedown` / `touchstart` 事件：
  ```js
  const centerLon = Math.atan2(-camera.position.x, camera.position.z);
  sharedUniforms.uCenterLon.value = centerLon;
  ```
- progress 回到 0 时：`sharedUniforms.uCenterLon.value = 0;`
- 自转停止逻辑扩展：按下进度条时停止自转（当前仅在 progress < 0.05 时自转）

#### tissot.js — 简化

- 删除 `createSplitCircleGeometries()` 和 `createSplitOutlineGeometries()` 函数
- 删除 180° 经线上的特殊处理循环
- 所有经度位置统一使用 `createCircleGeometry()` 和 `createOutlineGeometry()`
- 分割逻辑完全交由着色器处理

#### greatCircleRoutes.js

- `splitAtDateLine()` 保留（处理球面几何拓扑，与投影中心无关）
- `jsApplyProjection()` 中加入 `uCenterLon` 偏移：
  ```js
  const adjustedLon = wrapLon(lon - uniforms.uCenterLon.value);
  ```
- `computeLabelPosition()` 同步使用偏移后的经度

#### areaComparison.js

- 无需改动（轮廓不跨越日期变更线）

### 3. 纹理采样

`globe.frag` 中的纹理坐标基于 `vLongitude`（原始经度），不受 `uCenterLon` 影响。

## 交互流程

```
1. 地球自转 → 用户旋转到任意角度
2. 按下进度条 → 冻结 centerLon = atan2(-camX, camZ)
3. 停止自转
4. 拖动进度 → 着色器用 uCenterLon 偏移投影中心
5. 回到 0% → uCenterLon = 0，恢复自转
```

## 影响范围

| 文件 | 改动类型 |
|------|----------|
| `shaders/common/projections.glsl` | 新增 `wrapLon()` |
| `shaders/globe.vert` | 新增 uniform + 经度偏移 |
| `shaders/indicator.vert` | 新增 uniform + 偏移 + 分割线检测 |
| `shaders/tissot.frag` | 分割线 discard |
| `shaders/outline.frag` | 分割线 discard |
| `shaders/route.frag` | 分割线 discard |
| `main.js` | 新增 uniform + 进度条事件 |
| `indicators/tissot.js` | 删除硬编码分割，简化 |
| `indicators/greatCircleRoutes.js` | JS 投影函数加偏移 |

## 不变的部分

- 纹理采样逻辑
- 面积比较指示器
- 投影函数本身（只改输入经度）
- 剥橘子的纬度延迟逻辑（`normalizedLat² * uSpreadDelay`）

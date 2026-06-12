// 共享投影函数 — 被 globe.vert 和 indicator.vert 通过 #include 引入
// 修改此文件即可同步更新所有着色器

#define PI 3.14159265359

// 缓动函数：平滑的三次方 ease-in-out
float easeInOutCubic(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

// ===== 投影函数 =====

// 墨卡托投影 (EPSG:3857)
vec3 projectMercator(float lon, float lat) {
  // 裁剪纬度到 ±85.05°（Web Mercator 标准：mercY = ±π 处）
  // 先裁剪再计算，避免极点附近三角形 Y 反转
  float maxLat = 2.0 * atan(exp(PI)) - PI * 0.5;
  float clampedLat = clamp(lat, -maxLat, maxLat);
  float mercX = lon;
  float mercY = log(tan(PI / 4.0 + clampedLat / 2.0));
  return vec3(mercX, mercY, 0.0);
}

// 等距柱状投影 (EPSG:4326)
vec3 projectPlateCarree(float lon, float lat) {
  return vec3(lon, lat, 0.0);
}

// 圆锥投影 — Lambert 正形圆锥投影
vec3 projectConic(float lon, float lat, float stdLat) {
  float n = sin(clamp(stdLat, 0.1, 1.4));

  // 标准纬线处的参考值
  float tanStd = max(tan(PI / 4.0 + stdLat / 2.0), 0.001);
  float F = cos(stdLat) * pow(tanStd, n) / max(n, 0.01);

  // 纬度裁剪：控制扇形展开范围
  //   下限 -1.3（74.5°S）→ 扇尾（南极方向），ρ 发散故需裁剪
  //   上限 1.56（89.4°N）→ 扇心（北极方向），ρ→0 收敛到锥顶
  float clampedLat = clamp(lat, -1.3, 1.56);
  float tanLat = max(tan(PI / 4.0 + clampedLat / 2.0), 0.001);
  float rho = F / pow(tanLat, n);

  // 赤道处 rho 作为 y 基准
  float tanEq = max(tan(PI / 4.0), 0.001);
  float rhoEq = F / pow(tanEq, n);

  float theta = n * lon;

  return vec3(rho * sin(theta), rhoEq - rho * cos(theta), 0.0);
}

// 方位投影
vec3 projectAzimuthal(float lon, float lat, float type) {
  if (type < 0.5) {
    // 正射投影 (Orthographic) — 从无穷远处看地球
    float x = cos(lat) * sin(lon);
    float y = sin(lat);
    // 背面半球略微后移，旋转时正面/背面各自可见
    float cosC = cos(lat) * cos(lon);
    float z = min(cosC, 0.0) * 0.08;
    return vec3(x, y, z);
  } else {
    // 立体投影 (Stereographic) — 保角，极地地图常用
    float clampedLat = clamp(lat, -1.4, 1.4);
    float k = 2.0 / max(1.0 + sin(clampedLat), 0.01);
    return vec3(
      k * cos(clampedLat) * sin(lon),
      k * cos(clampedLat) * cos(lon),
      0.0
    );
  }
}

// ===== 投影分派（globe.vert / indicator.vert 共用）=====
vec3 applyProjection(float lon, float lat) {
  if (uProjectionID < 0.5) return projectMercator(lon, lat);
  else if (uProjectionID < 1.5) return projectPlateCarree(lon, lat);
  else if (uProjectionID < 2.5) return projectConic(lon, lat, uConicStdLat);
  else return projectAzimuthal(lon, lat, uAzimuthalType);
}

// 球面位置（lon 0° → +x，与 SphereGeometry 约定一致）
vec3 sphereFromLatLon(float lat, float lon) {
  return vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
}

// ===== 剥橘子路径（穿透度加权外鼓二次贝塞尔）=====
// 与 src/utils/peel.js 的 peelPath() 逐项一致，由 scripts/glsl-lint.mjs 护栏守护。
const float PEEL_DGATE_MAX = 0.05;
const float PEEL_LONW_A = 0.3;
const float PEEL_LONW_B = 1.0;
const float PEEL_LATBAND = 0.0349;   // 2°
const float PEEL_LONBAND = 2.967;    // 170°

vec3 peelPath(vec3 p0, vec3 p2, float lat, float lon, float t, float strength) {
  vec3 r = normalize(p0);
  vec3 d = p2 - p0;
  float dLen = length(d);
  float dGate = smoothstep(0.0, PEEL_DGATE_MAX, dLen);

  float dr = dot(d, r);
  vec3 dPerp = d - dr * r;
  float pen = max(0.0, -dr);

  vec3 poleY = vec3(0.0, lat >= 0.0 ? 1.0 : -1.0, 0.0);
  vec3 liftDir0 = length(dPerp) > 1e-3 ? normalize(dPerp) : poleY;

  float latGate = 1.0 - smoothstep(0.0, PEEL_LATBAND, abs(lat));
  float lonGate = smoothstep(PEEL_LONBAND, PI, abs(lon));
  float yBlend = latGate * lonGate;
  vec3 liftDir = normalize(mix(liftDir0, poleY, yBlend));

  float lonWeight = smoothstep(PEEL_LONW_A, PEEL_LONW_B, abs(lon) / PI);
  float L = strength * (0.6 + 0.4 * pen) * lonWeight * dGate;
  vec3 C = p0 + L * liftDir;

  float u = 1.0 - t;
  return u * u * p0 + 2.0 * u * t * C + t * t * p2;
}

// 给定 lat/lon/t 求 peeled 位置（数值法线用：对 lat/lon 求邻域）
vec3 peeledAt(float lat, float lon, float t, float strength) {
  vec3 sp = sphereFromLatLon(lat, lon);
  vec3 fp = applyProjection(lon, lat);
  return peelPath(sp, fp, lat, lon, t, strength);
}

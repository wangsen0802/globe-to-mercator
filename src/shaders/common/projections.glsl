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
  float mercX = lon;
  float mercY = log(tan(PI / 4.0 + lat / 2.0));
  mercY = clamp(mercY, -PI, PI);
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

  // 限制纬度避免极点处无穷大
  float clampedLat = clamp(lat, -1.3, 1.3);
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

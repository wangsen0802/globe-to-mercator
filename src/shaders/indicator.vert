// 指标系统共享顶点着色器 — 朝索椭圆和面积轮廓共用
// 与 globe.vert 使用相同的投影函数，但通过属性接收经纬度

uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionID;
uniform float uConicStdLat;
uniform float uAzimuthalType;

// 自定义属性：每个顶点的经纬度（弧度）
attribute float aLatitude;
attribute float aLongitude;

varying float vDistortion;    // 面积变形因子（1.0=无变形）
varying float vLocalProgress; // 局部展开进度

#define PI 3.14159265359

// 缓动函数
float easeInOutCubic(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

// ===== 投影函数（与 globe.vert 一致） =====

vec3 projectMercator(float lon, float lat) {
  float mercX = lon;
  float mercY = log(tan(PI / 4.0 + lat / 2.0));
  mercY = clamp(mercY, -2.5, 2.5);
  return vec3(mercX, mercY, 0.0);
}

vec3 projectPlateCarree(float lon, float lat) {
  return vec3(lon, lat, 0.0);
}

vec3 projectConic(float lon, float lat, float stdLat) {
  float n = sin(clamp(stdLat, 0.1, 1.4));
  float tanStd = max(tan(PI / 4.0 + stdLat / 2.0), 0.001);
  float F = cos(stdLat) * pow(tanStd, n) / max(n, 0.01);
  float clampedLat = clamp(lat, -1.3, 1.3);
  float tanLat = max(tan(PI / 4.0 + clampedLat / 2.0), 0.001);
  float rho = F / pow(tanLat, n);
  float tanEq = max(tan(PI / 4.0), 0.001);
  float rhoEq = F / pow(tanEq, n);
  float theta = n * lon;
  return vec3(rho * sin(theta), rhoEq - rho * cos(theta), 0.0);
}

vec3 projectAzimuthal(float lon, float lat, float type) {
  if (type < 0.5) {
    float x = cos(lat) * sin(lon);
    float y = sin(lat);
    float cosC = cos(lat) * cos(lon);
    float z = min(cosC, 0.0) * 0.08;
    return vec3(x, y, z);
  } else {
    float clampedLat = clamp(lat, -1.4, 1.4);
    float k = 2.0 / max(1.0 + sin(clampedLat), 0.01);
    return vec3(
      k * cos(clampedLat) * sin(lon),
      k * cos(clampedLat) * cos(lon),
      0.0
    );
  }
}

// 根据当前投影 ID 选择投影函数
vec3 applyProjection(float lon, float lat) {
  if (uProjectionID < 0.5) return projectMercator(lon, lat);
  else if (uProjectionID < 1.5) return projectPlateCarree(lon, lat);
  else if (uProjectionID < 2.5) return projectConic(lon, lat, uConicStdLat);
  else return projectAzimuthal(lon, lat, uAzimuthalType);
}

// 数值计算面积变形因子（雅可比行列式 / cos(lat)）
float computeAreaDistortion(float lat, float lon) {
  float eps = 0.001;

  vec3 p0 = applyProjection(lon, lat);
  vec3 pLat = applyProjection(lon, lat + eps);
  vec3 pLon = applyProjection(lon + eps, lat);

  vec2 dLat = (pLat.xy - p0.xy) / eps;
  vec2 dLon = (pLon.xy - p0.xy) / eps;

  // 2D 雅可比行列式 = |∂x/∂φ · ∂y/∂λ - ∂x/∂λ · ∂y/∂φ|
  float jacobian = abs(dLat.x * dLon.y - dLat.y * dLon.x);

  // 球面上的面积元素 = cos(φ)·dφ·dλ，归一化后得到变形因子
  float cosLat = max(abs(cos(lat)), 0.01);

  return jacobian / cosLat;
}

void main() {
  // position 已在球面上（由 JS 端计算）
  vec3 spherePos = position;

  // 使用属性中的经纬度（而非从 position 反推，更精确）
  float latitude = aLatitude;
  float longitude = aLongitude;

  // 投影变换
  vec3 flatPos = applyProjection(longitude, latitude);

  // 剥橘子动画（与 globe.vert 逻辑一致）
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (1.0 - uSpreadDelay + 0.001), 0.0, 1.0);
  localProgress = easeInOutCubic(localProgress);
  vLocalProgress = localProgress;

  // 球面 ↔ 平面插值
  vec3 finalPos = mix(spherePos, flatPos, localProgress);

  // 计算面积变形因子
  vDistortion = computeAreaDistortion(latitude, longitude);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);

  // 微小 z 偏移，确保指标始终在地球表面之上（避免 z-fighting）
  gl_Position.z -= 0.002;
}

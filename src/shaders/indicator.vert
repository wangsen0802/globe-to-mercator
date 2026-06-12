// 指标系统共享顶点着色器 — 朝索椭圆和面积轮廓共用

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
varying vec3 vWorldPos;       // 世界坐标（用于背面判断）
varying vec3 vSurfaceNormal;  // 球面法线（用于背面判断）

#include common/projections.glsl

// applyProjection 由 common/projections.glsl 提供（globe.vert / indicator.vert 共用）

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

  // 剥橘子动画（注：globe.vert 已改贝塞尔路径，本文件位置仍用线性 mix，Task 4 同步）
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
  gl_Position.z -= 0.02;

  // 传递世界坐标和插值法线，供片段着色器做背面剔除
  vWorldPos = (modelMatrix * vec4(finalPos, 1.0)).xyz;
  // 法线从球面到平面插值，变换到世界空间（w=0 只取旋转部分）
  vec3 sphereNormal = normalize(spherePos);
  vec3 flatNormal = vec3(0.0, 0.0, 1.0);
  vec3 interpNormal = normalize(mix(sphereNormal, flatNormal, localProgress));
  vSurfaceNormal = normalize((modelMatrix * vec4(interpNormal, 0.0)).xyz);
}

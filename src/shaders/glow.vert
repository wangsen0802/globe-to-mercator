// 发光粒子顶点着色器：GPU 投影（复用 projections.glsl，与航线 indicator.vert 同源）
// + 方位投影远端淡出 + gl_PointSize 距离衰减

uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionID;
uniform float uConicStdLat;
uniform float uAzimuthalType;

uniform float uPointSize;        // 基础点大小（对应原 PointsMaterial.size）
uniform float uViewportHeight;   // 视口高度（用于 sizeAttenuation 近似）
uniform float uBaseOpacity;      // 基础不透明度（对应原 PointsMaterial.opacity）

attribute float aLatitude;
attribute float aLongitude;

varying float vGlowAlpha;

#include common/projections.glsl

void main() {
  // position 已在球面上（JS 端 latLonToXYZ 计算）
  vec3 spherePos = position;
  // 与 indicator.vert 一致：球面位置绕 Y 旋转 -π/2，对齐地球 phiStart 背面切口
  spherePos = vec3(-spherePos.z, spherePos.y, spherePos.x);

  float latitude = aLatitude;
  float longitude = aLongitude;

  vec3 flatPos = applyProjection(longitude, latitude);

  // 剥橘子纬度延迟展开（与 globe.vert / indicator.vert 一致）
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (1.0 - uSpreadDelay + 0.001), 0.0, 1.0);
  localProgress = easeInOutCubic(localProgress);

  vec3 finalPos = mix(spherePos, flatPos, localProgress);

  // 方位投影远端半球淡出（与 globe.vert 同公式）
  float farMask = 0.0;
  if (uProjectionID > 2.5) {
    if (uAzimuthalType < 0.5) {
      float cosC = cos(latitude) * cos(longitude);
      farMask = smoothstep(0.0, 0.2, -cosC);
    } else {
      farMask = smoothstep(0.0, 0.2, -sin(latitude));
    }
  }
  vGlowAlpha = (1.0 - farMask * localProgress) * uBaseOpacity;

  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  // sizeAttenuation 近似：scale = viewportHeight * 0.5（匹配 Three.js PointsMaterial 内部）
  gl_PointSize = uPointSize * uViewportHeight * 0.5 / max(-mvPosition.z, 0.001);
  gl_Position = projectionMatrix * mvPosition;
}

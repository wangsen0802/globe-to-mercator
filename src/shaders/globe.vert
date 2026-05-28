uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionID;   // 0=mercator, 1=plateCarree, 2=conic, 3=azimuthal

// 圆锥投影参数
uniform float uConicStdLat;    // Lambert 标准纬线（弧度）

// 方位投影参数
uniform float uAzimuthalType;  // 0=正射, 1=立体

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalProgress;
varying float vLatitude;
varying float vRawUv;  // 原始 uv.x，线性经度参数化下直接作为纹理 u 坐标

#include common/projections.glsl

void main() {
  // 原始球面位置和法线
  vec3 spherePos = position;
  vec3 sphereNormal = normal;

  // 从球面坐标计算经纬度
  float latitude = asin(clamp(normalize(position).y, -1.0, 1.0));
  // 线性经度参数化：phi ∈ [0, 2π] → longitude ∈ [-π, π]
  // 比 atan(-cos, sin) 更优：无截断回绕，整个 [0,1] 区间连续无跳变
  // 球面 seam 处 column 0 (lon=-π) 和 column 360 (lon=π) 位置重合但经度不同，
  // 展开时自然分离为平面左右边缘
  float phi = uv.x * 2.0 * PI;
  float longitude = phi - PI;

  // 传递给片元着色器
  vLatitude = latitude;
  vRawUv = uv.x;

  // 根据投影类型选择目标平面坐标
  vec3 flatPos;
  if (uProjectionID < 0.5) {
    flatPos = projectMercator(longitude, latitude);
  } else if (uProjectionID < 1.5) {
    flatPos = projectPlateCarree(longitude, latitude);
  } else if (uProjectionID < 2.5) {
    flatPos = projectConic(longitude, latitude, uConicStdLat);
  } else {
    flatPos = projectAzimuthal(longitude, latitude, uAzimuthalType);
  }

  // ===== "剥橘子" 逐层展开 =====
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (1.0 - uSpreadDelay + 0.001), 0.0, 1.0);

  localProgress = easeInOutCubic(localProgress);
  vLocalProgress = localProgress;

  // 在球面和平面之间插值位置
  vec3 finalPos = mix(spherePos, flatPos, localProgress);

  // 法线插值
  vec3 flatNormal = vec3(0.0, 0.0, 1.0);
  vec3 finalNormal = normalize(mix(sphereNormal, flatNormal, localProgress));

  vNormal = normalize(normalMatrix * finalNormal);
  vWorldPos = (modelMatrix * vec4(finalPos, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}

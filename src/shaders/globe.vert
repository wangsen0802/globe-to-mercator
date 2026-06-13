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
varying vec3 vTangent;   // 切线（用于法线贴图 TBN 变换）
varying vec3 vBitangent; // 副切线
varying float vFarMask;  // 方位投影远端半球淡出标记（0=保留，1=淡出）

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

  // 方位投影远端半球淡出标记：非方位投影恒 0
  // 正射用 cosC=cos(lat)cos(lon)（<0 为背面），立体用 -sin(lat)（南半球）
  float farMask = 0.0;
  if (uProjectionID > 2.5) {
    if (uAzimuthalType < 0.5) {
      float cosC = cos(latitude) * cos(longitude);
      farMask = smoothstep(0.0, 0.2, -cosC);
    } else {
      farMask = smoothstep(0.0, 0.2, -sin(latitude));
    }
  }
  vFarMask = farMask;

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

  // ===== 切线空间基向量（法线贴图用） =====
  // 球面切线：沿经度方向（dPos/dLon），副切线沿纬度方向（dPos/dLat）
  float cosLat = cos(latitude);
  float sinLat = sin(latitude);
  float cosLon = cos(longitude);
  float sinLon = sin(longitude);

  // 球面切线：经度方向偏导 ∂Pos/∂lon = (-sinLon * cosLat, 0, -cosLon * cosLat)
  vec3 sphereTangent = normalize(vec3(-sinLon * cosLat, 0.0, -cosLon * cosLat));
  // 球面副切线：纬度方向偏导 ∂Pos/∂lat = (-cosLon * sinLat, cosLat, sinLon * sinLat)
  vec3 sphereBitangent = normalize(vec3(-cosLon * sinLat, cosLat, sinLon * sinLat));

  // 平面切线/副切线
  vec3 flatTangent = vec3(1.0, 0.0, 0.0);
  vec3 flatBitangent = vec3(0.0, 1.0, 0.0);

  // 跟法线一样在球面和平面之间插值
  vec3 finalTangent = normalize(mix(sphereTangent, flatTangent, localProgress));
  vec3 finalBitangent = normalize(mix(sphereBitangent, flatBitangent, localProgress));

  vTangent = normalize(normalMatrix * finalTangent);
  vBitangent = normalize(normalMatrix * finalBitangent);

  vWorldPos = (modelMatrix * vec4(finalPos, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}

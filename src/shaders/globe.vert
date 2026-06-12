uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionID;   // 0=mercator, 1=plateCarree, 2=conic, 3=azimuthal

// 圆锥投影参数
uniform float uConicStdLat;    // Lambert 标准纬线（弧度）

// 方位投影参数
uniform float uAzimuthalType;  // 0=正射, 1=立体

uniform float uPeelStrength;  // 剥橘子外鼓强度（默认 1.5，范围 1.5~2.5）

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalProgress;
varying float vLatitude;
varying float vRawUv;  // 原始 uv.x，线性经度参数化下直接作为纹理 u 坐标
varying vec3 vTangent;   // 切线（用于法线贴图 TBN 变换）
varying vec3 vBitangent; // 副切线

#include common/projections.glsl

void main() {
  // 原始球面位置（法线改为从贝塞尔曲面数值重算，不再用 attribute normal）
  vec3 spherePos = position;

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

  // 根据投影类型选择目标平面坐标（共享分派）
  vec3 flatPos = applyProjection(longitude, latitude);

  // ===== "剥橘子" 逐层展开 =====
  float normalizedLat = abs(latitude) / (PI / 2.0);
  float localDelay = normalizedLat * normalizedLat * uSpreadDelay;
  float localProgress = clamp((uProgress - localDelay) / (1.0 - uSpreadDelay + 0.001), 0.0, 1.0);

  localProgress = easeInOutCubic(localProgress);
  vLocalProgress = localProgress;

  // 在球面和平面之间用"穿透度加权外鼓贝塞尔"变形（消除接缝穿模）
  vec3 finalPos = peelPath(spherePos, flatPos, latitude, longitude, localProgress, uPeelStrength);

  // ===== 法线/切线/副切线：从贝塞尔曲面数值偏导重算 =====
  // 端点天然匹配（t=0→球面外法线 cross(∂lon,∂lat)，t=1→+Z）；mercator/方位等投影对 lat 有钳位，
  // 钳位极区里 lat+eps 不再变化 → T_lat≈0 → cross 退化，故加长度护栏：退化时回退到解析球面切线基 + 线性法线。
  float nEps = 0.001;
  vec3 pLat = peeledAt(latitude + nEps, longitude, localProgress, uPeelStrength);
  vec3 pLon = peeledAt(latitude, longitude + nEps, localProgress, uPeelStrength);
  vec3 T_lon = pLon - finalPos;
  vec3 T_lat = pLat - finalPos;
  vec3 numNormal = cross(T_lon, T_lat);

  vec3 finalNormal, finalTangent, finalBitangent;
  if (length(numNormal) > 1e-6) {
    finalNormal   = normalize(numNormal);
    finalTangent   = normalize(T_lon);
    finalBitangent = normalize(T_lat);
  } else {
    // 退化（极点 / 钳位极区）：解析球面切线基 + 球面→平面线性混合（等价 T3 前的稳定行为）
    float cl = cos(latitude), sl = sin(latitude), clo = cos(longitude), slo = sin(longitude);
    vec3 sTangent   = normalize(vec3(-slo * cl, 0.0, -clo * cl));       // ∂Pos/∂lon
    vec3 sBitangent = normalize(vec3(-clo * sl, cl, slo * sl));         // ∂Pos/∂lat
    finalNormal   = normalize(mix(normalize(spherePos), vec3(0.0, 0.0, 1.0), localProgress));
    finalTangent   = normalize(mix(sTangent, vec3(1.0, 0.0, 0.0), localProgress));
    finalBitangent = normalize(mix(sBitangent, vec3(0.0, 1.0, 0.0), localProgress));
  }

  vNormal = normalize(normalMatrix * finalNormal);
  vTangent = normalize(normalMatrix * finalTangent);
  vBitangent = normalize(normalMatrix * finalBitangent);

  vWorldPos = (modelMatrix * vec4(finalPos, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}

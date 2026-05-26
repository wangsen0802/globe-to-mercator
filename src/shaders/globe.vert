uniform float uProgress;
uniform float uSpreadDelay;
uniform float uProjectionType; // 0 = Mercator(3857), 1 = Plate Carree(4326/4490)

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalProgress;
varying float vLatitude;
varying float vLongitude;

#define PI 3.14159265359

// 缓动函数：平滑的三次方 ease-in-out
float easeInOutCubic(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
  // 原始球面位置和法线
  vec3 spherePos = position;
  vec3 sphereNormal = normal;

  // 从球面坐标计算经纬度
  float latitude = asin(clamp(normalize(position).y, -1.0, 1.0));
  float longitude = atan(position.x, position.z);

  // 传递经纬度给片元着色器（用于精确计算纹理坐标）
  vLatitude = latitude;
  vLongitude = longitude;

  // ===== 墨卡托平面坐标 (EPSG:3857) =====
  float mercX = longitude;
  float mercY = log(tan(PI / 4.0 + latitude / 2.0));
  mercY = clamp(mercY, -2.5, 2.5);
  vec3 mercatorPos = vec3(mercX, mercY, 0.0);

  // ===== 等距柱状投影平面坐标 (EPSG:4326/4490) =====
  vec3 plateCarreePos = vec3(longitude, latitude, 0.0);

  // 根据投影类型选择目标平面坐标
  vec3 flatPos = mix(mercatorPos, plateCarreePos, uProjectionType);

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

uniform sampler2D uTexture;
uniform sampler2D uNormalMap;
uniform float uProgress;
uniform float uShowGrid;
uniform float uNormalStrength;  // 法线贴图强度 0~1
uniform vec3 uLightDir;
uniform vec3 uLightDir2;
uniform vec3 uLightDir3;
uniform vec3 uLightDir4;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalProgress;
varying float vLatitude;
varying float vRawUv;  // 原始 uv.x，线性经度下直接用作纹理 u 坐标
varying vec3 vTangent;
varying vec3 vBitangent;

#define PI 3.14159265359

void main() {
  // 线性经度参数化：longitude = uv.x * 2π - π
  // 所以 u = (longitude + π) / (2π) = uv.x，直接用 vRawUv 即可
  float u = vRawUv;
  float v = (vLatitude + PI / 2.0) / PI;

  vec4 texColor = texture2D(uTexture, vec2(u, v));

  // ===== 法线贴图：地形凹凸细节 =====
  // 从法线贴图采样，解码为切线空间法线 [-1, 1]
  vec3 normalMapValue = texture2D(uNormalMap, vec2(u, v)).xyz;
  vec3 tangentNormal = normalMapValue * 2.0 - 1.0;
  // 放大法线扰动，增强凹凸效果
  tangentNormal.xy *= 10.0;
  tangentNormal = normalize(tangentNormal);

  // 构建 TBN 矩阵，将切线空间法线变换到世界空间
  vec3 T = normalize(vTangent);
  vec3 B = normalize(vBitangent);
  vec3 N = normalize(vNormal);
  // 正交化：确保 TBN 互相垂直
  T = normalize(T - dot(T, N) * N);
  B = cross(N, T);

  vec3 perturbedNormal = normalize(T * tangentNormal.x + B * tangentNormal.y + N * tangentNormal.z);

  // 用强度参数混合：0 = 纯顶点法线，1 = 完全法线贴图
  vec3 surfNormal = normalize(mix(N, perturbedNormal, uNormalStrength));

  // ===== 多光源光照 =====
  // 主光源：右上方（最强）
  vec3 lightDir1 = normalize(uLightDir);
  float diff1 = max(dot(surfNormal, lightDir1), 0.0);
  // 补光2：左下方（中等强度，填充暗部）
  vec3 lightDir2 = normalize(uLightDir2);
  float diff2 = max(dot(surfNormal, lightDir2), 0.0);
  // 补光3：正前方（弱，整体提亮）
  vec3 lightDir3 = normalize(uLightDir3);
  float diff3 = max(dot(surfNormal, lightDir3), 0.0);
  // 补光4：右下方（微弱，增加立体感）
  vec3 lightDir4 = normalize(uLightDir4);
  float diff4 = max(dot(surfNormal, lightDir4), 0.0);

  // 提高环境光基底 + 多光源漫反射叠加
  vec3 ambient = texColor.rgb * 0.45;
  vec3 diffuse = texColor.rgb * (
    diff1 * 0.45 +   // 主光源
    diff2 * 0.30 +   // 补光2
    diff3 * 0.20 +   // 补光3
    diff4 * 0.15     // 补光4
  );
  vec3 color = ambient + diffuse;

  // ===== 网格线（经纬线） =====
  if (uShowGrid > 0.5) {
    float lonLines = abs(sin(u * PI * 12.0));
    float latLines = abs(sin(v * PI * 6.0));

    float gridLine = 1.0;
    float lineWidth = 0.01;
    if (lonLines < lineWidth) gridLine = 0.0;
    if (latLines < lineWidth) gridLine = 0.0;

    // 球形时也显示经纬线（基础值 0.15），过渡时额外增强
    float gridAlpha = 0.5 + sin(uProgress * PI) * 0.3;
    color = mix(color, vec3(0.3, 0.7, 1.0), (1.0 - gridLine) * gridAlpha);
  }

  // ===== 过渡中的能量线条 =====
  float edgeGlow = exp(-pow((vLocalProgress - 0.5) * 4.0, 2.0));
  float transitionGlow = edgeGlow * sin(uProgress * PI) * 0.2;
  color += vec3(0.5, 0.8, 1.0) * transitionGlow;

  gl_FragColor = vec4(color, 1.0);
}

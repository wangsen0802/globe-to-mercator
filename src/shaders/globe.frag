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
  vec3 ambient = texColor.rgb * 0.55;
  vec3 diffuse = texColor.rgb * (
    diff1 * 0.55 +   // 主光源
    diff2 * 0.35 +   // 补光2
    diff3 * 0.25 +   // 补光3
    diff4 * 0.20     // 补光4
  );
  vec3 color = ambient + diffuse;

  // ===== 网格线（经纬线） =====
  if (uShowGrid > 0.5) {
    // 球形时基础可见，过渡中增强
    float gridAlpha = 0.5 + sin(uProgress * PI) * 0.3;

    // --- 常规经线（每 30°，12 条主线） ---
    float lonLine = 1.0 - smoothstep(0.005, 0.012, abs(sin(u * PI * 12.0)));
    color = mix(color, vec3(0.3, 0.7, 1.0), lonLine * gridAlpha * 0.5);

    // --- 常规纬线（每 30°，作为参考网格） ---
    float latLine = 1.0 - smoothstep(0.005, 0.012, abs(sin(v * PI * 6.0)));
    color = mix(color, vec3(0.3, 0.7, 1.0), latLine * gridAlpha * 0.35);

    // --- 特殊纬度线（统一宽度，彩色区分） ---
    // v 坐标与纬度映射：v = lat_deg / 180 + 0.5
    float hw = 0.001;  // 统一半宽

    // 赤道 0°：亮白色
    float eqLine = 1.0 - smoothstep(hw * 0.4, hw, abs(v - 0.5));
    color = mix(color, vec3(1.0, 1.0, 0.9), eqLine * gridAlpha);

    // 北回归线 23.44°N & 南回归线 23.44°S：暖黄橙色，虚线
    float vTN = 0.5 + 23.4367 / 180.0;
    float vTS = 0.5 - 23.4367 / 180.0;
    float tropicLine = max(
      1.0 - smoothstep(hw * 0.4, hw, abs(v - vTN)),
      1.0 - smoothstep(hw * 0.4, hw, abs(v - vTS))
    );
    float dash = step(0.4, fract(u * 36.0));  // 虚线：36 段，60% 实线
    color = mix(color, vec3(1.0, 0.78, 0.15), tropicLine * dash * gridAlpha);

    // 北极圈 66.56°N & 南极圈 66.56°S：冷蓝紫色
    float vAN = 0.5 + 66.5633 / 180.0;
    float vAS = 0.5 - 66.5633 / 180.0;
    float arcticLine = max(
      1.0 - smoothstep(hw * 0.4, hw, abs(v - vAN)),
      1.0 - smoothstep(hw * 0.4, hw, abs(v - vAS))
    );
    color = mix(color, vec3(0.5, 0.65, 1.0), arcticLine * gridAlpha);
  }

  // ===== 过渡中的能量线条 =====
  float edgeGlow = exp(-pow((vLocalProgress - 0.5) * 4.0, 2.0));
  float transitionGlow = edgeGlow * sin(uProgress * PI) * 0.2;
  color += vec3(0.5, 0.8, 1.0) * transitionGlow;

  // Gamma 校正：线性空间 → sRGB 输出（匹配显示器响应曲线）
  color = pow(color, vec3(1.0 / 2.2));

  gl_FragColor = vec4(color, 1.0);
}

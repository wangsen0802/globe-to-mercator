uniform sampler2D uTexture;
uniform float uProgress;
uniform float uShowGrid;
uniform vec3 uLightDir;
uniform vec3 uLightDir2;
uniform vec3 uLightDir3;
uniform vec3 uLightDir4;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLocalProgress;
varying float vLatitude;
varying float vLongitude;

#define PI 3.14159265359

void main() {
  // 从经纬度计算精确的纹理坐标（而非依赖插值的 UV）
  // 纹理是等距柱状投影，所以直接用经纬度映射即可
  float u = (vLongitude + PI) / (2.0 * PI);
  float v = (vLatitude + PI / 2.0) / PI;

  vec4 texColor = texture2D(uTexture, vec2(u, v));

  // ===== 多光源光照 =====
  // 主光源：右上方（最强）
  vec3 lightDir1 = normalize(uLightDir);
  float diff1 = max(dot(vNormal, lightDir1), 0.0);
  // 补光2：左下方（中等强度，填充暗部）
  vec3 lightDir2 = normalize(uLightDir2);
  float diff2 = max(dot(vNormal, lightDir2), 0.0);
  // 补光3：正前方（弱，整体提亮）
  vec3 lightDir3 = normalize(uLightDir3);
  float diff3 = max(dot(vNormal, lightDir3), 0.0);
  // 补光4：右下方（微弱，增加立体感）
  vec3 lightDir4 = normalize(uLightDir4);
  float diff4 = max(dot(vNormal, lightDir4), 0.0);

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

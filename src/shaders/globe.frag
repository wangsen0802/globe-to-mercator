uniform sampler2D uTexture;
uniform float uProgress;
uniform vec3 uLightDir;

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

  // ===== 光照 =====
  vec3 lightDir = normalize(uLightDir);
  float diff = max(dot(vNormal, lightDir), 0.0);
  vec3 ambient = texColor.rgb * 0.35;
  vec3 diffuse = texColor.rgb * diff * 0.65;
  vec3 color = ambient + diffuse;

  // ===== 网格线（经纬线） =====
  float lonLines = abs(sin(u * PI * 12.0));
  float latLines = abs(sin(v * PI * 6.0));

  float gridLine = 1.0;
  float lineWidth = 0.03;
  if (lonLines < lineWidth) gridLine = 0.0;
  if (latLines < lineWidth) gridLine = 0.0;

  float gridAlpha = sin(uProgress * PI) * 0.3;
  color = mix(color, vec3(0.3, 0.7, 1.0), (1.0 - gridLine) * gridAlpha);

  // ===== 过渡中的能量线条 =====
  float edgeGlow = exp(-pow((vLocalProgress - 0.5) * 4.0, 2.0));
  float transitionGlow = edgeGlow * sin(uProgress * PI) * 0.2;
  color += vec3(0.5, 0.8, 1.0) * transitionGlow;

  gl_FragColor = vec4(color, 1.0);
}

// 航线片段着色器 — uniform 颜色 + 透明度
uniform vec3 uColor;
uniform float uOpacity;

varying vec3 vWorldPos;
varying vec3 vSurfaceNormal;

void main() {
  // 背面剔除：法线背向相机时丢弃
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  if (dot(vSurfaceNormal, viewDir) < 0.0) discard;

  gl_FragColor = vec4(uColor, uOpacity);
}

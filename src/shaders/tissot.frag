// 朝索变形椭圆片元着色器
// 根据 vDistortion 着色：绿(1.0) → 黄(2.0) → 红(4.0+)

varying float vDistortion;
varying float vLocalProgress;
varying vec3 vWorldPos;
varying vec3 vSurfaceNormal;

void main() {
  // 背面剔除：法线背向相机时丢弃（球面状态下隐藏背面指标）
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  if (dot(vSurfaceNormal, viewDir) < 0.0) discard;
  // 变形程度梯度着色
  vec3 green  = vec3(0.30, 0.92, 0.40);
  vec3 yellow = vec3(1.00, 0.90, 0.20);
  vec3 red    = vec3(1.00, 0.30, 0.20);

  vec3 color;
  if (vDistortion < 2.0) {
    float t = clamp((vDistortion - 1.0), 0.0, 1.0);
    color = mix(green, yellow, t);
  } else {
    float t = clamp((vDistortion - 2.0) / 2.0, 0.0, 1.0);
    color = mix(yellow, red, t);
  }

  // 半透明填充，展开时稍微增强不透明度
  float alpha = 0.55 + vLocalProgress * 0.15;
  gl_FragColor = vec4(color, alpha);
}

// 航线片段着色器 — uniform 颜色 + 透明度
uniform vec3 uColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}

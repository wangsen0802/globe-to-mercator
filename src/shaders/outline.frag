// 面积比较轮廓片元着色器
// 使用 uniform 颜色 + 透明度，用于国家/地区轮廓渲染

uniform vec3 uColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}

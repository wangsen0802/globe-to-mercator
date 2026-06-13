// 发光粒子片元着色器：径向渐变纹理 * 颜色 * 逐点 alpha

uniform sampler2D uGlowTexture;
uniform vec3 uColor;

varying float vGlowAlpha;

void main() {
  vec4 tex = texture2D(uGlowTexture, gl_PointCoord);
  gl_FragColor = vec4(tex.rgb * uColor, tex.a * vGlowAlpha);
}

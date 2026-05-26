/**
 * 方位投影 (Azimuthal Projection)
 * 包含：正射投影 (Orthographic) 和 立体投影 (Stereographic)
 */
export const azimuthal = {
  id: 3,
  name: '方位投影',
  epsg: 'Azimuthal',
  uniforms: {
    uAzimuthalType: 0.0
  },
  info: {
    forwardFormula: '正射: x = cos(φ)·sin(λ)\n     y = sin(φ)\n\n立体: k = 2/(1+sin(φ))\n     x = k·cos(φ)·sin(λ)\n     y = k·cos(φ)·cos(λ)',
    inverseFormula: '正射: λ = atan2(x, cos(φ\'))\n     φ = asin(y)\n\n立体: ρ = √(x²+y²)\n     c = 2·atan(ρ/2)\n     φ = asin(cos(c)·sin(φ₁) + y·sin(c)·cos(φ₁)/ρ)',
    properties: [
      { name: '保角（角度不变）', valid: false },
      { name: '等面积', valid: false },
      { name: '从中心点方向正确', valid: true },
      { name: '大圆为直线（立体投影）', valid: true },
    ],
    useCases: '正射：从太空看地球的视角；立体：极地地图、航空导航',
    distortion: '正射只能看到半球，边缘压缩严重；立体面积变形随离中心距离增大而增大'
  }
};

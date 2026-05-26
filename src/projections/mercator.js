/**
 * 墨卡托投影 (Mercator Projection)
 * EPSG:3857 — Web 地图标准投影
 */
export const mercator = {
  id: 0,
  name: '墨卡托投影',
  epsg: 'EPSG:3857',
  uniforms: {},
  info: {
    forwardFormula: 'x = λ\ny = ln(tan(π/4 + φ/2))',
    inverseFormula: 'λ = x\nφ = 2·arctan(eʸ) - π/2',
    properties: [
      { name: '保角（角度不变）', valid: true },
      { name: '等面积', valid: false },
      { name: '等距', valid: false },
      { name: '恒向线为直线', valid: true },
    ],
    useCases: '航海导航、Web 地图（Google Maps / 高德地图）',
    distortion: '高纬度面积严重放大，格陵兰显得和非洲一样大'
  }
};

/**
 * 等距柱状投影 (Plate Carrée / Equirectangular)
 * EPSG:4326 / EPSG:4490 — 最简单的地图投影
 */
export const plateCarree = {
  id: 1,
  name: '等距柱状投影',
  epsg: 'EPSG:4326',
  uniforms: {},
  info: {
    forwardFormula: 'x = λ\ny = φ',
    inverseFormula: 'λ = x\nφ = y',
    properties: [
      { name: '保角（角度不变）', valid: false },
      { name: '等面积', valid: false },
      { name: '沿经线等距', valid: true },
      { name: '恒向线为直线', valid: true },
    ],
    useCases: '简单数据存储、GIS 基础底图、卫星影像默认投影',
    distortion: '高纬度水平拉伸，形状压扁；面积在高纬度放大'
  }
};

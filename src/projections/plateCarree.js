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
    note: '严格来说，EPSG:4326 是 WGS84 地理坐标系（GCS），而非真正的地图投影。它定义的是经纬度坐标本身，将经度直接作为 x、纬度作为 y 展示的"等距柱状"形式，只是一种最简单的线性映射。在实际应用中，人们常把这种经纬度直接铺平的方式也视为一种投影，但它的本质是"未投影"的坐标参照系。',
    useCases: '简单数据存储、GIS 基础底图、卫星影像默认投影',
    distortion: '高纬度水平拉伸，形状压扁；面积在高纬度放大'
  }
};

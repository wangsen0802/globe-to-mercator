/**
 * 正射投影 (Orthographic Projection)
 * 从无穷远处透视地球，可见半球呈单位圆盘
 */
export const orthographic = {
  id: 3,
  name: '正射投影',
  epsg: 'Orthographic',
  uniforms: {
    uProjectionID: 3,
    uAzimuthalType: 0.0
  },
  info: {
    forwardFormula: 'x = cos(φ)·sin(λ)\ny = sin(φ)',
    inverseFormula: 'λ = atan2(x, cos(φ\'))\nφ = asin(y)',
    properties: [
      { name: '保角（角度不变）', valid: false },
      { name: '等面积', valid: false },
      { name: '从中心点方向正确', valid: true },
      { name: '大圆为直线', valid: false },
    ],
    useCases: '从太空看地球的视角，航天、天文可视化',
    distortion: '只能看到半球，边缘压缩严重',
    note: '从无穷远处透视，可见半球投影为单位圆盘；远端半球随剥开进度淡出'
  }
};

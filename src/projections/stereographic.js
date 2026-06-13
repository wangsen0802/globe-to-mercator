/**
 * 立体投影 (Stereographic Projection)
 * 保角投影，北极为中心；极地地图、航空导航常用
 *
 * 注：复用方位 shader（uProjectionID=3 的 projectAzimuthal + 远端 mask），
 * 用 uAzimuthalType=1 切到立体分支。id=4 是 UI/注册表层独立，uProjectionID 仍=3。
 */
export const stereographic = {
  id: 4,
  name: '立体投影',
  epsg: 'Stereographic',
  uniforms: {
    uProjectionID: 3,      // 复用方位 shader（projectAzimuthal + 远端 mask）
    uAzimuthalType: 1.0
  },
  info: {
    forwardFormula: 'k = 2/(1+sin(φ))\nx = k·cos(φ)·sin(λ)\ny = k·cos(φ)·cos(λ)',
    inverseFormula: 'ρ = √(x²+y²)\nc = 2·atan(ρ/2)\nφ = asin(cos(c)·sin(φ₁) + y·sin(c)·cos(φ₁)/ρ)',
    properties: [
      { name: '保角（角度不变）', valid: true },
      { name: '等面积', valid: false },
      { name: '从中心点方向正确', valid: true },
      { name: '大圆为直线', valid: true },
    ],
    useCases: '极地地图、航空导航',
    distortion: '面积变形随离中心距离增大而增大',
    note: '保角，北极为中心；南半球 k 发散被钳制（stereoMaxR=2.3）并随剥开进度淡出'
  }
};

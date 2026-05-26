/**
 * 圆锥投影 — Lambert 正形圆锥投影 (Lambert Conformal Conic)
 */
export const conic = {
  id: 2,
  name: '圆锥投影（Lambert）',
  epsg: 'Lambert Conformal Conic',
  uniforms: {
    uConicStdLat: 0.5236  // 30°N，适合展示中国/中纬度区域
  },
  info: {
    forwardFormula: 'n = sin(φ₁)\nρ = F / tan^n(π/4 + φ/2)\nθ = n · λ\nx = ρ · sin(θ)\ny = ρ₀ - ρ · cos(θ)',
    inverseFormula: 'θ = atan2(x, ρ₀ - y)\nλ = θ / n + λ₀\nφ = 2·arctan((F/ρ)^(1/n)) - π/2',
    properties: [
      { name: '保角（角度不变）', valid: true },
      { name: '等面积', valid: false },
      { name: '等距', valid: false },
      { name: '大圆近似直线', valid: true },
    ],
    useCases: '航空图、中纬度国家地图（中国、美国、欧洲）',
    distortion: '标准纬线处无变形，远离标准纬线面积变形增大；极点附近收敛为一点'
  }
};

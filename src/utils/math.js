// 共用数学常量
export const PI = Math.PI;
export const DEG2RAD = PI / 180; // 角度转弧度系数
export const RAD2DEG = 180 / PI; // 弧度转角度系数

// 圆锥投影标准纬线默认值（30°N = π/6）
// conic.js 配置与 main.js sharedUniforms 初始值共用此常量，避免双源漂移
export const CONIC_STD_LAT_DEFAULT = PI / 6;

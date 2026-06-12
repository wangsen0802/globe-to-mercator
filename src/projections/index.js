import { mercator } from './mercator.js';
import { plateCarree } from './plateCarree.js';
import { conic } from './conic.js';
import { azimuthal } from './azimuthal.js';

const projections = [mercator, plateCarree, conic, azimuthal];

// 断言：id 必须从 0 连续递增且唯一
// globe.vert / indicator.vert / greatCircleRoutes.js 用 `if (id < 0.5)...` 数值区间分发，
// id 不连续或重复会导致投影分发错乱，模块加载时立即暴露
projections.forEach((p, i) => {
  if (p.id !== i) {
    throw new Error(`投影 id 必须从 0 连续递增：期望 index ${i} 处 id=${i}，但 ${p.name} 是 id=${p.id}`);
  }
});

/**
 * 通过 id 获取投影配置
 * @param {number} id 投影 ID (0-3)
 * @returns {object} 投影配置对象
 */
export function getProjection(id) {
  return projections.find(p => p.id === id) || mercator;
}

/**
 * 获取所有投影列表
 * @returns {object[]}
 */
export function getAllProjections() {
  return projections;
}

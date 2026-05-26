import { mercator } from './mercator.js';
import { plateCarree } from './plateCarree.js';
import { conic } from './conic.js';
import { azimuthal } from './azimuthal.js';

const projections = [mercator, plateCarree, conic, azimuthal];

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

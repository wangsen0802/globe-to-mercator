/**
 * 指标开关面板 — 左侧独立面板，始终可见
 */
import { getCountryData } from '../indicators/areaComparison.js';

const panelEl = document.getElementById('indicator-panel');

// 指标开关回调
let callbacks = {}; // eslint-disable-line no-unused-vars

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * 初始化指标开关面板
 * @param {Object} opts - 回调函数
 * @param {Function} opts.onTissotToggle - 朝索椭圆开关回调
 * @param {Function} opts.onAreaToggle - 面积比较开关回调
 * @param {Function} opts.onRouteToggle - 大圆航线开关回调
 * @param {Function} opts.onGridToggle - 经纬线开关回调
 * @param {Function} opts.onNormalToggle - 地形光影开关回调
 * @param {Function} opts.onWireframeToggle - 球面线框开关回调
 * @param {Function} opts.onAutoRotateToggle - 球体自转开关回调
 */
export function initIndicatorPanel(opts) {
  callbacks = opts;

  // 面板标题
  const header = el('div', 'ind-header');
  header.appendChild(el('div', 'ind-header-title', '指标'));
  panelEl.appendChild(header);

  // ===== 变形指标 =====
  const distSection = el('div', 'ind-section');
  distSection.appendChild(el('div', 'ind-section-label', '变形指标'));

  distSection.appendChild(createToggle('toggle-grid', '经纬线', true, (v) => opts.onGridToggle(v)));
  distSection.appendChild(createToggle('toggle-tissot', '朝索变形椭圆', true, (v) => opts.onTissotToggle(v)));
  distSection.appendChild(createToggle('toggle-area', '面积比较', false, (v) => opts.onAreaToggle(v)));

  // 面积详情（展开/折叠）— 数据取自 areaComparison 的 COUNTRY_DATA，避免与 3D 双源
  const areaDetail = createExpandable('area-detail');
  const areaInner = el('div', 'ind-detail-inner');
  areaInner.appendChild(el('div', 'ind-detail-title', '真实面积对比'));
  for (const c of getCountryData()) {
    // color 为归一化 [r,g,b] 0-1，与 3D 区域填充色 THREE.Color(...color) 同源
    const [r, g, b] = c.color;
    const cssColor = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    areaInner.appendChild(createDotRow(cssColor, c.name, `${c.realArea.toLocaleString()} 万km²`));
  }
  const note = el('div', 'ind-note', '非洲 ≈ 14× 格陵兰，但墨卡托投影中看起来差不多大');
  areaInner.appendChild(note);
  areaDetail.appendChild(areaInner);
  distSection.appendChild(areaDetail);

  // 大圆航线
  distSection.appendChild(createToggle('toggle-route', '大圆航线', false, (v) => opts.onRouteToggle(v)));

  // 航线图例（展开/折叠）
  const routeDetail = createExpandable('route-detail');
  const routeInner = el('div', 'ind-detail-inner');
  routeInner.appendChild(el('div', 'ind-detail-title', '航线类型'));
  routeInner.appendChild(createLineRow('#4fc3f7', '大圆（最短路径）'));
  routeInner.appendChild(createLineRow('#ff9800', '恒向线（等角航线）'));
  routeDetail.appendChild(routeInner);
  distSection.appendChild(routeDetail);

  panelEl.appendChild(distSection);

  // ===== 显示增强 =====
  const enhanceSection = el('div', 'ind-section');
  enhanceSection.appendChild(el('div', 'ind-section-label', '显示增强'));

  enhanceSection.appendChild(createToggle('toggle-normal', '地形光影', true, (v) => opts.onNormalToggle(v)));
  // 球面线框：material.wireframe，在顶点着色器变形后光栅化，故能跟随剥橘子/投影动画
  enhanceSection.appendChild(createToggle('toggle-wireframe', '球面线框', false, (v) => opts.onWireframeToggle(v)));

  panelEl.appendChild(enhanceSection);

  // ===== 场景控制 =====
  const sceneSection = el('div', 'ind-section');
  sceneSection.appendChild(el('div', 'ind-section-label', '场景控制'));

  // 球面态自转：仅 progress < 0.05（未开始剥橘子）时生效，指标组自动跟随
  sceneSection.appendChild(createToggle('toggle-rotate', '球体自转', true, (v) => opts.onAutoRotateToggle(v)));

  panelEl.appendChild(sceneSection);
}

// 创建 toggle 开关行
function createToggle(id, label, checked, onChange) {
  const row = el('label', 'ind-toggle');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.id = id;
  cb.checked = checked;

  row.appendChild(cb);
  row.appendChild(el('span', 'ind-switch'));
  row.appendChild(el('span', 'ind-toggle-label', label));

  cb.addEventListener('change', () => {
    onChange(cb.checked);
    // 联动展开详情区域
    if (id === 'toggle-area') toggleDetail('area-detail', cb.checked);
    if (id === 'toggle-route') toggleDetail('route-detail', cb.checked);
  });

  return row;
}

// 创建可展开区域
function createExpandable(id) {
  const wrap = el('div', 'ind-detail');
  wrap.id = id;
  return wrap;
}

// 切换展开状态
function toggleDetail(id, open) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open', open);
}

// 圆点 + 名称 + 数值行
function createDotRow(color, name, value) {
  const row = el('div', 'ind-row');
  const dot = el('span', 'ind-dot');
  dot.style.background = color;
  row.appendChild(dot);
  row.appendChild(el('span', '', name));
  row.appendChild(el('span', 'ind-value', value));
  return row;
}

// 线段 + 名称行（用于航线图例）
function createLineRow(color, label) {
  const row = el('div', 'ind-row');
  const line = el('span', 'ind-line');
  line.style.background = color;
  row.appendChild(line);
  row.appendChild(el('span', '', label));
  return row;
}

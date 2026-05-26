/**
 * 指标开关面板 — 在教育面板底部添加变形指标的 toggle 开关
 */

const panelEl = document.getElementById('info-panel');

// 指标开关回调（保留供外部扩展）
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
 */
export function initIndicatorPanel(opts) {
  callbacks = opts;

  const section = el('div', 'panel-section');
  section.style.marginTop = '8px';
  section.style.paddingTop = '12px';
  section.style.borderTop = '1px solid rgba(255,255,255,0.1)';

  section.appendChild(el('div', 'panel-section-title', '变形指标'));

  // 朝索椭圆开关
  const tissotRow = createToggleRow('toggle-tissot', '朝索变形椭圆', true, (checked) => {
    opts.onTissotToggle(checked);
  });
  section.appendChild(tissotRow);

  // 面积比较开关
  const areaRow = createToggleRow('toggle-area', '面积比较', false, (checked) => {
    opts.onAreaToggle(checked);
  });
  section.appendChild(areaRow);

  // 大圆航线开关
  const routeRow = createToggleRow('toggle-route', '大圆航线', false, (checked) => {
    opts.onRouteToggle(checked);
  });
  section.appendChild(routeRow);

  // 航线图例
  const routeLegend = el('div', 'area-info');
  routeLegend.id = 'route-legend';
  routeLegend.style.display = 'none';

  const legendTitle = el('div', '');
  legendTitle.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-top:8px;margin-bottom:4px;';
  legendTitle.textContent = '航线类型';
  routeLegend.appendChild(legendTitle);

  routeLegend.appendChild(createLegendRow('#4fc3f7', '大圆（最短路径）'));
  routeLegend.appendChild(createLegendRow('#ff9800', '恒向线（等角航线）'));

  section.appendChild(routeLegend);

  // 面积信息区域（初始隐藏）
  const areaInfo = el('div', 'area-info');
  areaInfo.id = 'area-info';
  areaInfo.style.display = 'none';

  const infoTitle = el('div', '');
  infoTitle.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-top:8px;margin-bottom:4px;';
  infoTitle.textContent = '真实面积对比';
  areaInfo.appendChild(infoTitle);

  areaInfo.appendChild(createAreaRow('#4fc3f7', '格陵兰', '216 万km²'));
  areaInfo.appendChild(createAreaRow('#81c784', '非洲', '3,037 万km²'));
  areaInfo.appendChild(createAreaRow('#ffb74d', '南美洲', '1,784 万km²'));

  const note = el('div', 'area-note');
  note.textContent = '非洲 ≈ 14× 格陵兰，但在墨卡托投影中看起来差不多大';
  areaInfo.appendChild(note);

  section.appendChild(areaInfo);
  panelEl.appendChild(section);
}

function createAreaRow(color, name, area) {
  const row = el('div', 'area-row');
  const dot = el('span', 'area-dot');
  dot.style.background = color;
  row.appendChild(dot);
  row.appendChild(el('span', '', name + ' '));
  const val = el('span', 'area-value', area);
  row.appendChild(val);
  return row;
}

function createLegendRow(color, label) {
  const row = el('div', 'area-row');
  const line = el('span', 'area-dot');
  line.style.background = color;
  line.style.width = '20px';
  line.style.height = '3px';
  line.style.borderRadius = '1px';
  row.appendChild(line);
  row.appendChild(el('span', '', ' ' + label));
  return row;
}

function createToggleRow(id, label, defaultChecked, onChange) {
  const row = el('label', 'indicator-toggle');

  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.id = id;
  checkbox.checked = defaultChecked;

  const slider = el('span', 'toggle-slider');
  const labelSpan = el('span', 'toggle-label', label);

  row.appendChild(checkbox);
  row.appendChild(slider);
  row.appendChild(labelSpan);

  checkbox.addEventListener('change', () => {
    onChange(checkbox.checked);
    // 显示/隐藏面积信息
    if (id === 'toggle-area') {
      const areaInfo = document.getElementById('area-info');
      if (areaInfo) areaInfo.style.display = checkbox.checked ? 'block' : 'none';
    }
    if (id === 'toggle-route') {
      const routeLegend = document.getElementById('route-legend');
      if (routeLegend) routeLegend.style.display = checkbox.checked ? 'block' : 'none';
    }
  });

  return row;
}

/**
 * 教育信息面板 — 显示当前投影的公式、特性和说明
 */

const panelEl = document.getElementById('info-panel');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderPanel(proj) {
  const { info } = proj;

  panelEl.textContent = '';

  panelEl.appendChild(el('div', 'panel-title', proj.name));
  panelEl.appendChild(el('div', 'panel-epsg', proj.epsg));

  const fwdSection = el('div', 'panel-section');
  fwdSection.appendChild(el('div', 'panel-section-title', '正算公式'));
  fwdSection.appendChild(el('div', 'panel-formula', info.forwardFormula));
  panelEl.appendChild(fwdSection);

  const invSection = el('div', 'panel-section');
  invSection.appendChild(el('div', 'panel-section-title', '反算公式'));
  invSection.appendChild(el('div', 'panel-formula', info.inverseFormula));
  panelEl.appendChild(invSection);

  const propSection = el('div', 'panel-section');
  propSection.appendChild(el('div', 'panel-section-title', '投影特性'));
  info.properties.forEach(p => {
    const row = el('div', 'panel-property');
    const dot = el('span', 'dot ' + (p.valid ? 'valid' : 'invalid'));
    row.appendChild(dot);
    row.appendChild(el('span', '', p.name));
    propSection.appendChild(row);
  });
  panelEl.appendChild(propSection);

  const useSection = el('div', 'panel-section');
  useSection.appendChild(el('div', 'panel-section-title', '适用场景'));
  useSection.appendChild(el('div', 'panel-text', info.useCases));
  panelEl.appendChild(useSection);

  const distSection = el('div', 'panel-section');
  distSection.appendChild(el('div', 'panel-section-title', '变形特征'));
  distSection.appendChild(el('div', 'panel-text', info.distortion));
  panelEl.appendChild(distSection);
}

export function initPanel(proj) {
  renderPanel(proj);
}

export function updatePanel(proj) {
  renderPanel(proj);
}

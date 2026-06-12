import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import vertexShader from './shaders/globe.vert?raw';
import fragmentShader from './shaders/globe.frag?raw';
import { getAllProjections, getProjection } from './projections/index.js';
import { initPanel, updatePanel } from './ui/projectionPanel.js';
import { createTissotIndicators } from './indicators/tissot.js';
import { createAreaComparison } from './indicators/areaComparison.js';
import { createGreatCircleRoutes } from './indicators/greatCircleRoutes.js';
import { initIndicatorPanel } from './ui/indicatorPanel.js';
import { getAllTextures, getDefaultTextureId } from './textures/index.js';
import { CONIC_STD_LAT_DEFAULT } from './utils/math.js';

// ===== 全局状态 =====
let progress = 0;
let currentProjection = getProjection(0);
const LON_SEGMENTS = 360;
const LAT_SEGMENTS = 180;
const SPREAD_DELAY = 0.35;

// ===== 共享 uniform（地球和指标系统共用投影参数） =====
const sharedUniforms = {
  uProgress: { value: 0.0 },
  uSpreadDelay: { value: SPREAD_DELAY },
  uProjectionID: { value: currentProjection.id },
  uConicStdLat: { value: CONIC_STD_LAT_DEFAULT },
  uAzimuthalType: { value: 0.0 }
};

// 同步初始投影参数
Object.entries(currentProjection.uniforms).forEach(([key, val]) => {
  if (sharedUniforms[key]) sharedUniforms[key].value = val;
});

// ===== 场景初始化 =====
const container = document.getElementById('canvas-container');
// 创建场景
const scene = new THREE.Scene();
// 指定场景背景色
scene.background = new THREE.Color(0x0a0a1a);

// 创建透视相机（近大远小）
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({
  antialias: true, // 控制抗锯齿，启用 MSAA 多重采样，略有性能消耗
  alpha: false     // 控制背景透明度，true 为透明，false 为不透明
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 设置像素比例，限制上限保证性能
container.insertBefore(renderer.domElement, container.firstChild);

// ===== 控制器 =====
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // 启用缓冲
controls.dampingFactor = 0.05; // 阻尼系数
controls.enablePan = false; // 不允许平移
controls.minDistance = 2;
controls.maxDistance = 8;

// ===== 加载纹理 =====
const textureLoader = new THREE.TextureLoader();

// 纹理注册表
const allTextures = getAllTextures();
const defaultTexId = getDefaultTextureId();

// 纹理缓存：{ id: THREE.Texture }
const textureCache = {};
let currentTextureId = defaultTexId;

function createGlobe(texture, normalMap) {
  texture.colorSpace = THREE.SRGBColorSpace;

  // phiStart=-π/2：把 SphereGeometry 的网格接缝（重复顶点）从默认 -x 转到 -z（背面）。
  // 线性经度下 180° 经线落在接缝上 → 在背面干净分割（消除穿模：分割被前半球遮挡），
  // 本初子午线相应转到 +z 正对相机。指示器坐标约定须为 lon 0°→+z（见各 indicator 文件）。
  const geometry = new THREE.SphereGeometry(1, LON_SEGMENTS, LAT_SEGMENTS, -Math.PI / 2);

  // 地球 uniforms：共享投影参数 + 独有的纹理和光照
  const uniforms = {
    uProgress: sharedUniforms.uProgress,
    uSpreadDelay: sharedUniforms.uSpreadDelay,
    uProjectionID: sharedUniforms.uProjectionID,
    uConicStdLat: sharedUniforms.uConicStdLat,
    uAzimuthalType: sharedUniforms.uAzimuthalType,
    uTexture: { value: texture },
    uNormalMap: { value: normalMap },
    uShowGrid: { value: showGrid ? 1.0 : 0.0 },
    uNormalStrength: { value: 1.0 },
    uNormalBumpScale: { value: 10.0 },
    uLightDir: { value: new THREE.Vector3(1, 0.5, 1).normalize() },
    uLightDir2: { value: new THREE.Vector3(-0.8, -0.3, 0.6).normalize() },
    uLightDir3: { value: new THREE.Vector3(0, 0, 1).normalize() },
    uLightDir4: { value: new THREE.Vector3(0.7, -0.5, 0.5).normalize() }
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  return { mesh, material };
}

// 切换地球纹理（异步加载 + 实时替换 uTexture uniform）
// loadSeq：防止快速连点时旧请求回调覆盖新选择（竞态）——过期请求只缓存不应用
let loadSeq = 0;
function switchTexture(id) {
  if (id === currentTextureId) return;

  // 缓存命中则直接切换
  const cached = textureCache[id];
  if (cached) {
    applyTexture(id, cached);
    return;
  }

  // 查找纹理 URL
  const texEntry = allTextures.find(t => t.id === id);
  if (!texEntry) return;

  // 显示加载状态
  const btn = document.querySelector(`.tex-btn[data-tex-id="${id}"]`);
  if (btn) btn.classList.add('loading');

  const reqId = ++loadSeq;
  textureLoader.load(texEntry.url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache[id] = texture;
    if (btn) btn.classList.remove('loading');
    // 过期请求（用户已连点切到别的纹理）只缓存不应用，避免覆盖最新选择
    if (reqId !== loadSeq) return;
    applyTexture(id, texture);
  }, undefined, (err) => {
    console.warn(`纹理 ${id} 加载失败，保持当前纹理`, err);
    if (btn) {
      btn.classList.remove('loading');
      btn.classList.add('load-failed'); // 失败状态钩子（可配 CSS 提示用户）
    }
    // 运行时切换失败不中断体验，保持当前纹理（与初始加载三级 fallback 不同，见 CLAUDE.md）
  });
}

// 应用纹理到地球
function applyTexture(id, texture) {
  if (globe) {
    // 直接替换 uniform value 即可：TextureLoader 加载完成的纹理首次使用时
    // 由 Three.js 自动上传 GPU，无需手动 needsUpdate（设 true 反而触发多余重传）
    globe.material.uniforms.uTexture.value = texture;
  }
  currentTextureId = id;
  document.querySelectorAll('.tex-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.texId === id);
  });
}

// ===== 星空背景 =====
function createStars() {
  const starsGeometry = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 50;
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    sizeAttenuation: true
  });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(stars);
  return stars;
}

// ===== 指标系统 =====
const tissotIndicators = createTissotIndicators(sharedUniforms);
scene.add(tissotIndicators.group);

const areaComparison = createAreaComparison(sharedUniforms);
scene.add(areaComparison.group);
areaComparison.group.visible = false; // 默认关闭面积比较

const greatCircleRoutes = createGreatCircleRoutes(sharedUniforms);
scene.add(greatCircleRoutes.group);
greatCircleRoutes.group.visible = false;

// ===== 初始化场景 =====
const stars = createStars();
let globe = null;
let showGrid = true;  // 缓存经纬线开关状态，globe 异步加载后读取
let autoRotate = true;  // 球面态自转开关（仅 progress < 0.05 时生效）

// 创建 1×1 平坦法线 fallback（RGB = [0.5, 0.5, 1.0] = 指向上方的法线）
// 防止 uNormalMap 为 null 时 GLSL texture2D() 行为未定义
const flatNormalCanvas = document.createElement('canvas');
flatNormalCanvas.width = 1;
flatNormalCanvas.height = 1;
flatNormalCanvas.getContext('2d').fillStyle = 'rgb(128,128,255)';
flatNormalCanvas.getContext('2d').fillRect(0, 0, 1, 1);
const flatNormalTexture = new THREE.CanvasTexture(flatNormalCanvas);

// ===== 并行加载法线贴图 + 默认颜色纹理，两者完成后创建地球 =====
const NORMAL_MAP_URL = './assets/2k_earth_normal_map.jpg';
const defaultTex = allTextures.find(t => t.id === defaultTexId);

// 把 TextureLoader.load 包成 Promise
function loadTexture(url) {
  return new Promise((resolve, reject) => {
    textureLoader.load(url, resolve, undefined, reject);
  });
}

// 法线贴图：失败则回退平坦法线（全局常驻，不随颜色纹理切换）
async function loadNormalMap() {
  try {
    return await loadTexture(NORMAL_MAP_URL);
  } catch (err) {
    console.warn('法线贴图加载失败，将使用平坦法线 fallback', err);
    return flatNormalTexture;
  }
}

// 默认颜色纹理：三级 fallback 链（默认 → daymap → Canvas 渐变）
async function loadDefaultTexture() {
  try {
    const tex = await loadTexture(defaultTex.url);
    textureCache[defaultTexId] = tex;
    return tex;
  } catch (err) {
    console.warn('默认纹理加载失败，尝试备用纹理', err);
    const fallback = allTextures.find(t => t.id === 'daymap');
    if (fallback) {
      try {
        const fbTex = await loadTexture(fallback.url);
        textureCache['daymap'] = fbTex;
        currentTextureId = 'daymap';
        return fbTex;
      } catch {
        console.error('备用纹理也加载失败，使用 Canvas fallback');
      }
    }
    createCanvasFallback();
    return textureCache[currentTextureId];
  }
}

// 并行加载两个资源，都完成后创建地球（新增资源只需往数组加一项）
Promise.all([loadNormalMap(), loadDefaultTexture()]).then(([normalMap, colorTexture]) => {
  globe = createGlobe(colorTexture, normalMap);
  console.log('地球纹理 + 法线贴图加载完成');
  initTextureSwitcher();
});

// Canvas 渐变纹理作为最终 fallback
function createCanvasFallback() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#1a3a5c');
  gradient.addColorStop(0.3, '#2d6a4f');
  gradient.addColorStop(0.5, '#40916c');
  gradient.addColorStop(0.7, '#2d6a4f');
  gradient.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);
  const fallbackTexture = new THREE.CanvasTexture(canvas);
  fallbackTexture.colorSpace = THREE.SRGBColorSpace;
  textureCache['canvas-fallback'] = fallbackTexture;
  currentTextureId = 'canvas-fallback';
}

// ===== 纹理切换 UI =====
function initTextureSwitcher() {
  const texContainer = document.getElementById('texture-switcher');
  if (!texContainer) return;

  allTextures.forEach(tex => {
    const btn = document.createElement('button');
    btn.className = 'tex-btn' + (tex.id === currentTextureId ? ' active' : '');
    btn.dataset.texId = tex.id;
    btn.title = tex.name;

    // 缩略图
    const img = document.createElement('img');
    img.src = tex.thumbUrl;
    img.alt = tex.name;
    img.className = 'tex-thumb';
    img.loading = 'lazy';

    // 名称
    const label = document.createElement('span');
    label.className = 'tex-label';
    label.textContent = tex.name;

    btn.appendChild(img);
    btn.appendChild(label);
    btn.addEventListener('click', () => switchTexture(tex.id));
    texContainer.appendChild(btn);
  });
}

// ===== 投影切换按钮（动态生成） =====
const btnGroup = document.querySelector('.proj-btn-group');

getAllProjections().forEach(proj => {
  const btn = document.createElement('button');
  btn.className = 'proj-btn' + (proj.id === currentProjection.id ? ' active' : '');
  btn.dataset.projId = proj.id;
  // 上行中文名，下行英文/EPSG 编号
  const cn = document.createElement('span');
  cn.className = 'proj-btn-cn';
  cn.textContent = proj.name;
  const en = document.createElement('span');
  en.className = 'proj-btn-en';
  en.textContent = proj.epsg;
  btn.appendChild(cn);
  btn.appendChild(en);
  btn.addEventListener('click', () => switchProjection(proj.id));
  btnGroup.appendChild(btn);
});

function switchProjection(id) {
  currentProjection = getProjection(id);

  btnGroup.querySelectorAll('.proj-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.projId) === id);
  });

  // 更新共享 uniform（地球和指标自动同步）
  sharedUniforms.uProjectionID.value = id;
  Object.entries(currentProjection.uniforms).forEach(([key, val]) => {
    if (sharedUniforms[key]) sharedUniforms[key].value = val;
  });

  updatePanel(currentProjection);
}

// ===== 滑块交互 =====
const slider = document.getElementById('progress-slider');
const progressLabel = document.getElementById('progress-value');

slider.addEventListener('input', (e) => {
  progress = parseInt(e.target.value) / 100;
  progressLabel.textContent = e.target.value + '%';
});

// ===== 教育面板初始化 =====
initPanel(currentProjection);

// ===== 指标开关面板初始化 =====
initIndicatorPanel({
  onTissotToggle: (visible) => { tissotIndicators.group.visible = visible; },
  onAreaToggle: (visible) => { areaComparison.group.visible = visible; },
  onRouteToggle: (visible) => { greatCircleRoutes.group.visible = visible; },
  onGridToggle: (visible) => {
    showGrid = visible;
    if (globe) globe.material.uniforms.uShowGrid.value = visible ? 1.0 : 0.0;
  },
  onNormalToggle: (visible) => {
    if (globe) globe.material.uniforms.uNormalStrength.value = visible ? 1.0 : 0.0;
  },
  onWireframeToggle: (visible) => {
    // wireframe 在顶点着色器输出后光栅化，能正确跟随变形动画
    if (globe) globe.material.wireframe = visible;
  },
  onAutoRotateToggle: (visible) => {
    autoRotate = visible;
  }
});

// ===== 动画循环 =====
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  // 更新共享进度 uniform（地球和指标同步）
  sharedUniforms.uProgress.value = progress;
  // 仅在航线可见时更新标签/发光粒子位置（内部约 600 点/帧三角运算），关闭时跳过省 CPU
  if (greatCircleRoutes.group.visible) greatCircleRoutes.updateLabels(progress, camera);

  if (autoRotate && progress < 0.05 && globe) {
    globe.mesh.rotation.y += 0.002;
    // 指标组跟随地球自转
    tissotIndicators.group.rotation.y = globe.mesh.rotation.y;
    areaComparison.group.rotation.y = globe.mesh.rotation.y;
    greatCircleRoutes.group.rotation.y = globe.mesh.rotation.y;
  }

  stars.rotation.y += 0.0001;

  renderer.render(scene, camera);
}

animate();

// ===== 窗口自适应 =====
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

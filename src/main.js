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
  uConicStdLat: { value: 0.5236 },
  uAzimuthalType: { value: 0.0 }
};

// 同步初始投影参数
Object.entries(currentProjection.uniforms).forEach(([key, val]) => {
  if (sharedUniforms[key]) sharedUniforms[key].value = val;
});

// ===== 场景初始化 =====
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.insertBefore(renderer.domElement, container.firstChild);

// ===== 控制器 =====
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 8;

// ===== 加载纹理 =====
const textureLoader = new THREE.TextureLoader();
const EARTH_TEXTURE_URL = './assets/earth-blue-marble.jpg';

function createGlobe(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.SphereGeometry(1, LON_SEGMENTS, LAT_SEGMENTS);

  // 地球 uniforms：共享投影参数 + 独有的纹理和光照
  const uniforms = {
    uProgress: sharedUniforms.uProgress,
    uSpreadDelay: sharedUniforms.uSpreadDelay,
    uProjectionID: sharedUniforms.uProjectionID,
    uConicStdLat: sharedUniforms.uConicStdLat,
    uAzimuthalType: sharedUniforms.uAzimuthalType,
    uTexture: { value: texture },
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

// ===== 星空背景 =====
function createStars() {
  const starsGeo = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 50;
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starsMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    sizeAttenuation: true
  });
  const stars = new THREE.Points(starsGeo, starsMat);
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

textureLoader.load(EARTH_TEXTURE_URL, (texture) => {
  globe = createGlobe(texture);
  console.log('地球纹理加载完成');
}, undefined, (err) => {
  console.warn('纹理加载失败，使用备用纹理', err);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#1a3a5c');
  gradient.addColorStop(0.2, '#2d6a4f');
  gradient.addColorStop(0.5, '#40916c');
  gradient.addColorStop(0.8, '#2d6a4f');
  gradient.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  ctx.fillStyle = '#52796f';
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 1024;
    const y = 100 + Math.random() * 312;
    const w = 30 + Math.random() * 100;
    const h = 20 + Math.random() * 60;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const fallbackTexture = new THREE.CanvasTexture(canvas);
  globe = createGlobe(fallbackTexture);
});

// ===== 投影切换按钮（动态生成） =====
const btnGroup = document.querySelector('.proj-btn-group');

getAllProjections().forEach(proj => {
  const btn = document.createElement('button');
  btn.className = 'proj-btn' + (proj.id === currentProjection.id ? ' active' : '');
  btn.dataset.projId = proj.id;
  btn.textContent = proj.epsg.length < 14 ? proj.epsg : proj.name;
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
  onRouteToggle: (visible) => { greatCircleRoutes.group.visible = visible; }
});

// ===== 动画循环 =====
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  // 更新共享进度 uniform（地球和指标同步）
  sharedUniforms.uProgress.value = progress;
  greatCircleRoutes.updateLabels(progress);

  if (progress < 0.05 && globe) {
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

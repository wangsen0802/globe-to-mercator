import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import vertexShader from './shaders/globe.vert?raw';
import fragmentShader from './shaders/globe.frag?raw';

// ===== 全局状态 =====
let progress = 0;
let projectionType = 0; // 0 = Mercator(3857), 1 = Plate Carree(4326/4490)
const LON_SEGMENTS = 360;
const LAT_SEGMENTS = 180;
const SPREAD_DELAY = 0.35; // 剥橘子展开延迟系数

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

// 使用免费的地球纹理
// const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const EARTH_TEXTURE_URL = './assets/earth-blue-marble.jpg';

function createGlobe(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;

  // 创建高细分球体
  const geometry = new THREE.SphereGeometry(1, LON_SEGMENTS, LAT_SEGMENTS);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uProgress: { value: 0.0 },
      uSpreadDelay: { value: SPREAD_DELAY },
      uTexture: { value: texture },
      uLightDir: { value: new THREE.Vector3(1, 0.5, 1).normalize() },
      uProjectionType: { value: 0.0 }
    },
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

// ===== 初始化场景 =====
const stars = createStars();

let globe = null;

textureLoader.load(EARTH_TEXTURE_URL, (texture) => {
  globe = createGlobe(texture);
  console.log('地球纹理加载完成');
}, undefined, (err) => {
  console.warn('纹理加载失败，使用备用纹理', err);
  // 备用：生成一个简单的渐变纹理
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 简单的蓝绿色地球
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#1a3a5c');
  gradient.addColorStop(0.2, '#2d6a4f');
  gradient.addColorStop(0.5, '#40916c');
  gradient.addColorStop(0.8, '#2d6a4f');
  gradient.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  // 添加一些随机的"大陆"块
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

// ===== 滑块交互 =====
const slider = document.getElementById('progress-slider');
const progressLabel = document.getElementById('progress-value');

slider.addEventListener('input', (e) => {
  progress = parseInt(e.target.value) / 100;
  progressLabel.textContent = e.target.value + '%';
});

// ===== 投影切换 =====
const projButtons = document.querySelectorAll('.proj-btn');
projButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    projectionType = parseInt(btn.dataset.type);
    projButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ===== 动画循环 =====
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  // 更新 shader uniforms
  if (globe) {
    globe.material.uniforms.uProgress.value = progress;
    globe.material.uniforms.uProjectionType.value = projectionType;
  }

  // 球体阶段自动慢旋转
  if (progress < 0.05 && globe) {
    globe.mesh.rotation.y += 0.002;
  }

  // 星空微旋转
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

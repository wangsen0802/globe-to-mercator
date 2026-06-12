import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import routeFrag from '../shaders/route.frag?raw';
import { PI, DEG2RAD } from '../utils/math.js';

const ROUTES = [
  { from: { name: '伦敦', lat: 51.5, lon: 0 }, to: { name: '纽约', lat: 40.7, lon: -74 } },
  { from: { name: '东京', lat: 35.7, lon: 139.7 }, to: { name: '洛杉矶', lat: 34.0, lon: -118.2 } },
  { from: { name: '悉尼', lat: -33.9, lon: 151.2 }, to: { name: '圣地亚哥', lat: -33.4, lon: -70.7 } },
];

const GC_SEGMENTS = 100;
const GC_COLOR = 0x4fc3f7;
const RL_COLOR = 0xff9800;

// --- 坐标转换 + 大圆弧 (slerp) ---

// 球面坐标转换：匹配 Three.js SphereGeometry 的坐标约定
// 经度 0° → +x 方向，经度 π/2 → -z 方向
function latLonToXYZ(lat, lon) {
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  ];
}

function xyzToLatLon(x, y, z) {
  return [
    Math.asin(Math.max(-1, Math.min(1, y))),
    Math.atan2(-z, x),
  ];
}

function slerp(p1, p2, t) {
  const dot = Math.max(-1, Math.min(1, p1[0]*p2[0] + p1[1]*p2[1] + p1[2]*p2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [...p1];
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  return [a*p1[0]+b*p2[0], a*p1[1]+b*p2[1], a*p1[2]+b*p2[2]];
}

function generateGreatCirclePoints(from, to) {
  const lat1 = from.lat * DEG2RAD, lon1 = from.lon * DEG2RAD;
  const lat2 = to.lat * DEG2RAD, lon2 = to.lon * DEG2RAD;
  const p1 = latLonToXYZ(lat1, lon1);
  const p2 = latLonToXYZ(lat2, lon2);
  const points = [];
  for (let i = 0; i <= GC_SEGMENTS; i++) {
    const t = i / GC_SEGMENTS;
    const p = slerp(p1, p2, t);
    const [lat, lon] = xyzToLatLon(p[0], p[1], p[2]);
    points.push({ lat, lon });
  }
  return points;
}

// --- 恒向线 + 日期变更线分割 ---

function generateRhumbLinePoints(from, to) {
  const lat1 = from.lat * DEG2RAD, lon1 = from.lon * DEG2RAD;
  const lat2 = to.lat * DEG2RAD, lon2 = to.lon * DEG2RAD;

  const psi1 = Math.log(Math.tan(PI / 4 + lat1 / 2));
  const psi2 = Math.log(Math.tan(PI / 4 + lat2 / 2));
  const dPsi = psi2 - psi1;

  let dLon = lon2 - lon1;
  if (dLon > PI) dLon -= 2 * PI;
  if (dLon < -PI) dLon += 2 * PI;

  // 将经度归一化到 [-π, π]，确保 splitAtDateLine 能检测到跳变
  function normalizeLon(lon) {
    return ((lon % (2 * PI)) + 3 * PI) % (2 * PI) - PI;
  }

  const points = [];
  for (let i = 0; i <= GC_SEGMENTS; i++) {
    const t = i / GC_SEGMENTS;
    const psi = psi1 + t * dPsi;
    const lat = 2 * Math.atan(Math.exp(psi)) - PI / 2;
    const lon = normalizeLon(
      Math.abs(dPsi) < 1e-6
        ? lon1 + t * dLon
        : lon1 + dLon * (psi - psi1) / dPsi
    );
    points.push({ lat, lon });
  }
  return points;
}

function splitAtDateLine(points) {
  if (points.length < 2) return [points];
  const segments = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const dLon = points[i].lon - points[i - 1].lon;
    if (Math.abs(dLon) > PI) {
      // 在 180° 经线处插值出精确边界点，闭合两段线之间的空隙
      const lon1 = points[i - 1].lon, lon2 = points[i].lon;
      const lat1 = points[i - 1].lat, lat2 = points[i].lat;
      let t;
      if (dLon < -PI) {
        // 正经度 → 负经度（跨越 +π → -π），展开 lon2 计算
        t = (PI - lon1) / (lon2 + 2 * PI - lon1);
      } else {
        // 负经度 → 正经度（跨越 -π → +π），展开 lon2 计算
        t = (-PI - lon1) / (lon2 - 2 * PI - lon1);
      }
      t = Math.max(0, Math.min(1, t));
      const crossLat = lat1 + t * (lat2 - lat1);

      // 当前段以 +π 边界点结尾
      current.push({ lat: crossLat, lon: PI });
      if (current.length > 1) segments.push(current);
      // 新段以 -π 边界点起始（与 +π 在球面上是同一点）
      current = [{ lat: crossLat, lon: -PI }, points[i]];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments.length > 0 ? segments : [points];
}

// --- 线段几何体创建 ---

function createLineGeometry(points) {
  const positions = [];
  const latitudes = [];
  const longitudes = [];
  for (const p of points) {
    positions.push(
      Math.cos(p.lat) * Math.cos(p.lon),
      Math.sin(p.lat),
      -Math.cos(p.lat) * Math.sin(p.lon),
    );
    latitudes.push(p.lat);
    longitudes.push(p.lon);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  geo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));
  return geo;
}

function createRouteLines(route, uniforms) {
  const meshes = [];

  const gcPoints = generateGreatCirclePoints(route.from, route.to);
  for (const seg of splitAtDateLine(gcPoints)) {
    const geo = createLineGeometry(seg);
    const mat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: routeFrag,
      uniforms: { ...uniforms, uColor: { value: new THREE.Color(GC_COLOR) }, uOpacity: { value: 0.8 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    meshes.push(new THREE.Line(geo, mat));
  }

  const rlPoints = generateRhumbLinePoints(route.from, route.to);
  for (const seg of splitAtDateLine(rlPoints)) {
    const geo = createLineGeometry(seg);
    const mat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: routeFrag,
      uniforms: { ...uniforms, uColor: { value: new THREE.Color(RL_COLOR) }, uOpacity: { value: 0.8 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    meshes.push(new THREE.Line(geo, mat));
  }

  return meshes;
}

// --- JS 投影函数（与 indicator.vert 匹配）---

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function jsProjectMercator(lon, lat) {
  return [lon, Math.max(-PI, Math.min(PI, Math.log(Math.tan(PI / 4 + lat / 2)))), 0];
}

function jsProjectPlateCarree(lon, lat) {
  return [lon, lat, 0];
}

function jsProjectConic(lon, lat, stdLat) {
  const n = Math.sin(Math.max(0.1, Math.min(1.4, stdLat)));
  const tanStd = Math.max(0.001, Math.tan(PI / 4 + stdLat / 2));
  const F = Math.cos(stdLat) * Math.pow(tanStd, n) / Math.max(0.01, n);
  // 圆锥纬度上限对齐 projections.glsl:42 的 clamp(lat, -1.3, 1.56)，避免 JS/GPU 投影漂移
  const clampedLat = Math.max(-1.3, Math.min(1.56, lat));
  const tanLat = Math.max(0.001, Math.tan(PI / 4 + clampedLat / 2));
  const rho = F / Math.pow(tanLat, n);
  const tanEq = Math.max(0.001, Math.tan(PI / 4));
  const rhoEq = F / Math.pow(tanEq, n);
  const theta = n * lon;
  return [rho * Math.sin(theta), rhoEq - rho * Math.cos(theta), 0];
}

function jsProjectAzimuthal(lon, lat, type) {
  if (type < 0.5) {
    const z = Math.min(Math.cos(lat) * Math.cos(lon), 0) * 0.08;
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), z];
  }
  const clampedLat = Math.max(-1.4, Math.min(1.4, lat));
  const k = 2 / Math.max(0.01, 1 + Math.sin(clampedLat));
  return [k * Math.cos(clampedLat) * Math.sin(lon), k * Math.cos(clampedLat) * Math.cos(lon), 0];
}

function jsApplyProjection(lon, lat, uniforms) {
  const id = uniforms.uProjectionID.value;
  if (id < 0.5) return jsProjectMercator(lon, lat);
  if (id < 1.5) return jsProjectPlateCarree(lon, lat);
  if (id < 2.5) return jsProjectConic(lon, lat, uniforms.uConicStdLat.value);
  return jsProjectAzimuthal(lon, lat, uniforms.uAzimuthalType.value);
}

function computeLabelPosition(lat, lon, progress, uniforms) {
  const sphere = latLonToXYZ(lat, lon);
  // 地球 phiStart=-π/2 背面切口：球面位置同步旋转 -π/2（绕 Y 轴，(x,y,z)→(-z,y,x)），平面投影不动
  const rsphere = [-sphere[2], sphere[1], sphere[0]];
  const flat = jsApplyProjection(lon, lat, uniforms);
  const spreadDelay = uniforms.uSpreadDelay.value;
  const normalizedLat = Math.abs(lat) / (PI / 2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = Math.max(0, Math.min(1, (progress - localDelay) / (1 - spreadDelay + 0.001)));
  const eased = easeInOutCubic(localProgress);
  return [
    rsphere[0] + (flat[0] - rsphere[0]) * eased,
    rsphere[1] + (flat[1] - rsphere[1]) * eased,
    rsphere[2] + (flat[2] - rsphere[2]) * eased,
  ];
}

// --- 城市标签精灵 ---

function createCitySprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const g = ctx.createRadialGradient(28, 32, 0, 28, 32, 10);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(28, 32, 10, 0, 2 * PI);
  ctx.fill();

  ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 46, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  }));
  sprite.scale.set(0.4, 0.1, 1);
  // 锚点对齐到圆点标记位置（canvas 中圆点在 x=28/256），使标记点精确指向城市坐标
  sprite.center.set(28 / 256, 0.5);
  return sprite;
}

// --- 大圆航线发光效果 ---

// 创建发光径向渐变纹理
function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  gradient.addColorStop(0.3, 'rgba(79, 195, 247, 0.25)');
  gradient.addColorStop(1, 'rgba(79, 195, 247, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

const glowTexture = createGlowTexture();

// 沿大圆航线创建发光粒子
function createGlowPoints(points) {
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = latLonToXYZ(points[i].lat, points[i].lon);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    map: glowTexture,
    size: 0.06,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    color: GC_COLOR,
    sizeAttenuation: true,
  });

  return new THREE.Points(geometry, material);
}

// --- 工厂函数（导出）---

export function createGreatCircleRoutes(uniforms) {
  const group = new THREE.Group();
  const sprites = [];
  const glowData = []; // { points, latLons }

  for (const route of ROUTES) {
    for (const mesh of createRouteLines(route, uniforms)) {
      group.add(mesh);
    }
    for (const city of [route.from, route.to]) {
      const sprite = createCitySprite(city.name);
      const lat = city.lat * DEG2RAD;
      const lon = city.lon * DEG2RAD;
      const pos = latLonToXYZ(lat, lon);
      sprite.position.set(pos[0], pos[1], pos[2]);
      group.add(sprite);
      sprites.push({ sprite, lat, lon });
    }

    // 大圆航线发光粒子（仅大圆航线，恒向线不加）
    const gcPoints = generateGreatCirclePoints(route.from, route.to);
    for (const seg of splitAtDateLine(gcPoints)) {
      if (seg.length < 2) continue;
      const glow = createGlowPoints(seg);
      group.add(glow);
      glowData.push({ points: glow, latLons: seg });
    }
  }

  const _worldPos = new THREE.Vector3();

  // 判断精灵在世界坐标中是否朝向相机（正面可见）
  // 法线方向 = normalize(worldPosition)，视线 = normalize(worldPosition - cameraPosition)
  // dot > 0 表示法线背向相机，即点在背面
  function isFrontFacing(sprite, cameraPos) {
    sprite.getWorldPosition(_worldPos);
    const nx = _worldPos.x, ny = _worldPos.y, nz = _worldPos.z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 0.001) return true;
    const vx = nx - cameraPos.x;
    const vy = ny - cameraPos.y;
    const vz = nz - cameraPos.z;
    // 法线（归一化的世界位置）与视线方向的点积
    return (nx / len * vx + ny / len * vy + nz / len * vz) <= 0;
  }

  function updateLabels(progress, camera) {
    const camPos = camera ? camera.position : null;

    // 更新城市标签位置
    for (const { sprite, lat, lon } of sprites) {
      const p = computeLabelPosition(lat, lon, progress, uniforms);
      sprite.position.set(p[0], p[1], p[2]);

      // 球面状态下隐藏背面标签，展开过程中逐渐恢复可见
      if (camPos) {
        const backFacing = !isFrontFacing(sprite, camPos);
        // progress > 0.3 时完全展开，不再隐藏
        sprite.visible = !(backFacing && progress < 0.3);
      }
    }

    // 更新发光粒子位置（跟随投影变换）
    for (const { points, latLons } of glowData) {
      const posAttr = points.geometry.getAttribute('position');
      for (let i = 0; i < latLons.length; i++) {
        const p = computeLabelPosition(latLons[i].lat, latLons[i].lon, progress, uniforms);
        posAttr.setXYZ(i, p[0], p[1], p[2]);
      }
      posAttr.needsUpdate = true;
    }
  }

  return { group, updateLabels };
}

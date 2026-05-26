import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import routeFrag from '../shaders/route.frag?raw';

const PI = Math.PI;
const DEG2RAD = PI / 180;

const ROUTES = [
  { from: { name: '伦敦', lat: 51.5, lon: 0 }, to: { name: '纽约', lat: 40.7, lon: -74 } },
  { from: { name: '东京', lat: 35.7, lon: 139.7 }, to: { name: '洛杉矶', lat: 34.0, lon: -118.2 } },
  { from: { name: '悉尼', lat: -33.9, lon: 151.2 }, to: { name: '圣地亚哥', lat: -33.4, lon: -70.7 } },
];

const GC_SEGMENTS = 100;
const GC_COLOR = 0x4fc3f7;
const RL_COLOR = 0xff9800;

// --- 坐标转换 + 大圆弧 (slerp) ---

function latLonToXYZ(lat, lon) {
  return [
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  ];
}

function xyzToLatLon(x, y, z) {
  return [
    Math.asin(Math.max(-1, Math.min(1, y))),
    Math.atan2(x, z),
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

  const points = [];
  for (let i = 0; i <= GC_SEGMENTS; i++) {
    const t = i / GC_SEGMENTS;
    const psi = psi1 + t * dPsi;
    const lat = 2 * Math.atan(Math.exp(psi)) - PI / 2;
    const lon = Math.abs(dPsi) < 1e-6
      ? lon1 + t * dLon
      : lon1 + dLon * (psi - psi1) / dPsi;
    points.push({ lat, lon });
  }
  return points;
}

function splitAtDateLine(points) {
  if (points.length < 2) return [points];
  const segments = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].lon - points[i - 1].lon) > PI) {
      if (current.length > 1) segments.push(current);
      current = [points[i]];
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
      Math.cos(p.lat) * Math.sin(p.lon),
      Math.sin(p.lat),
      Math.cos(p.lat) * Math.cos(p.lon),
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
  const clampedLat = Math.max(-1.3, Math.min(1.3, lat));
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
  const flat = jsApplyProjection(lon, lat, uniforms);
  const spreadDelay = uniforms.uSpreadDelay.value;
  const normalizedLat = Math.abs(lat) / (PI / 2);
  const localDelay = normalizedLat * normalizedLat * spreadDelay;
  const localProgress = Math.max(0, Math.min(1, (progress - localDelay) / (1 - spreadDelay + 0.001)));
  const eased = easeInOutCubic(localProgress);
  return [
    sphere[0] + (flat[0] - sphere[0]) * eased,
    sphere[1] + (flat[1] - sphere[1]) * eased,
    sphere[2] + (flat[2] - sphere[2]) * eased,
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
  return sprite;
}

// --- 工厂函数（导出）---

export function createGreatCircleRoutes(uniforms) {
  const group = new THREE.Group();
  const sprites = [];

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
  }

  function updateLabels(progress) {
    for (const { sprite, lat, lon } of sprites) {
      const p = computeLabelPosition(lat, lon, progress, uniforms);
      sprite.position.set(p[0], p[1], p[2]);
    }
  }

  return { group, updateLabels };
}

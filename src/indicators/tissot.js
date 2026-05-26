// 朝索变形椭圆（Tissot's Indicatrix）指示器
// 在球面上每隔 30° 放置等大小圆，投影后变形程度不同
// 顶点位置在球面上，经纬度通过 aLatitude/aLongitude 属性传入

import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import tissotFrag from '../shaders/tissot.frag?raw';
import outlineFrag from '../shaders/outline.frag?raw';

const CIRCLE_RADIUS = 0.075;  // 角半径（弧度，约 4.3°）
const CIRCLE_SEGMENTS = 32;   // 每个圆的细分段数
const LAT_STEP = 30;          // 纬度间隔（度）
const LON_STEP = 30;          // 经度间隔（度）

const DEG2RAD = Math.PI / 180;

/**
 * 在球面上创建一个小圆的几何体
 * @param {number} latCenter - 圆心纬度（弧度）
 * @param {number} lonCenter - 圆心经度（弧度）
 * @returns {THREE.BufferGeometry}
 */
function createCircleGeometry(latCenter, lonCenter) {
  const positions = [];
  const latitudes = [];
  const longitudes = [];
  const indices = [];

  // 中心点（索引 0）
  positions.push(
    Math.cos(latCenter) * Math.sin(lonCenter),
    Math.sin(latCenter),
    Math.cos(latCenter) * Math.cos(lonCenter)
  );
  latitudes.push(latCenter);
  longitudes.push(lonCenter);

  // 圆周顶点（索引 1 ~ segments+1）
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const theta = (i / CIRCLE_SEGMENTS) * Math.PI * 2;

    // 球面上小圆的纬度偏移
    const lat = latCenter + CIRCLE_RADIUS * Math.cos(theta);
    // 经度偏移需要除以 cos(lat) 来保持地理坐标中的圆形
    const lon = lonCenter + CIRCLE_RADIUS * Math.sin(theta) / Math.max(Math.cos(latCenter), 0.01);

    // 限制纬度不超出极点
    const clampedLat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, lat));
    // 将经度归一化到 [-π, π]
    let clampedLon = lon;
    while (clampedLon > Math.PI) clampedLon -= Math.PI * 2;
    while (clampedLon < -Math.PI) clampedLon += Math.PI * 2;

    // 球面笛卡尔坐标
    positions.push(
      Math.cos(clampedLat) * Math.sin(clampedLon),
      Math.sin(clampedLat),
      Math.cos(clampedLat) * Math.cos(clampedLon)
    );
    latitudes.push(clampedLat);
    longitudes.push(clampedLon);
  }

  // 三角形扇形索引（中心 → 相邻两个圆周顶点）
  for (let i = 1; i <= CIRCLE_SEGMENTS; i++) {
    indices.push(0, i, i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  geometry.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));
  geometry.setIndex(indices);

  return geometry;
}

/**
 * 创建仅圆周边线的几何体（不含中心点）
 */
function createOutlineGeometry(latCenter, lonCenter) {
  const positions = [];
  const latitudes = [];
  const longitudes = [];

  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const theta = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const lat = latCenter + CIRCLE_RADIUS * Math.cos(theta);
    const lon = lonCenter + CIRCLE_RADIUS * Math.sin(theta) / Math.max(Math.cos(latCenter), 0.01);
    const clampedLat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, lat));
    let clampedLon = lon;
    while (clampedLon > Math.PI) clampedLon -= Math.PI * 2;
    while (clampedLon < -Math.PI) clampedLon += Math.PI * 2;

    positions.push(
      Math.cos(clampedLat) * Math.sin(clampedLon),
      Math.sin(clampedLat),
      Math.cos(clampedLat) * Math.cos(clampedLon)
    );
    latitudes.push(clampedLat);
    longitudes.push(clampedLon);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  geometry.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));

  return geometry;
}

/**
 * 创建朝索变形椭圆指示器组
 * @param {Object} uniforms - 与主地球共享的 uniform 对象
 * @returns {{ group: THREE.Group, fillMaterial: THREE.ShaderMaterial, outlineMaterial: THREE.ShaderMaterial }}
 */
export function createTissotIndicators(uniforms) {
  const group = new THREE.Group();

  // 填充材质（变形着色）
  const fillMaterial = new THREE.ShaderMaterial({
    vertexShader: indicatorVert,
    fragmentShader: tissotFrag,
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });

  // 边线材质（白色半透明）
  const outlineMaterial = new THREE.ShaderMaterial({
    vertexShader: indicatorVert,
    fragmentShader: outlineFrag,
    uniforms: {
      ...uniforms,
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.7 }
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  // 在 -60°~60° 纬度范围内，每隔 30° 放置圆
  for (let lat = -60; lat <= 60; lat += LAT_STEP) {
    for (let lon = -180; lon < 180; lon += LON_STEP) {
      const latRad = lat * DEG2RAD;
      const lonRad = lon * DEG2RAD;

      // 填充圆
      const fillGeo = createCircleGeometry(latRad, lonRad);
      const fillMesh = new THREE.Mesh(fillGeo, fillMaterial);
      group.add(fillMesh);

      // 边线
      const outlineGeo = createOutlineGeometry(latRad, lonRad);
      const outlineLine = new THREE.Line(outlineGeo, outlineMaterial);
      group.add(outlineLine);
    }
  }

  // 高纬度区域（±75°），每隔 60° 经度放一个
  for (const lat of [-75, 75]) {
    for (let lon = -180; lon < 180; lon += 60) {
      const latRad = lat * DEG2RAD;
      const lonRad = lon * DEG2RAD;

      const fillGeo = createCircleGeometry(latRad, lonRad);
      const fillMesh = new THREE.Mesh(fillGeo, fillMaterial);
      group.add(fillMesh);

      const outlineGeo = createOutlineGeometry(latRad, lonRad);
      const outlineLine = new THREE.Line(outlineGeo, outlineMaterial);
      group.add(outlineLine);
    }
  }

  return { group, fillMaterial, outlineMaterial };
}

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
 * 测地线圆：在球面上计算精确正圆的点
 * 使用指数映射公式 P = cos(r)·C + sin(r)·D
 * 其中 C 是圆心，D 是切平面内的方向向量
 * @param {number} latCenter - 圆心纬度（弧度）
 * @param {number} lonCenter - 圆心经度（弧度）
 * @param {number} theta - 圆上角度（0=北，π/2=东）
 * @param {number} radius - 角半径（弧度）
 * @returns {{ x: number, y: number, z: number, lat: number, lon: number }}
 */
function geodesicCirclePoint(latCenter, lonCenter, theta, radius) {
  const clat = Math.cos(latCenter), slat = Math.sin(latCenter);
  const clon = Math.cos(lonCenter), slon = Math.sin(lonCenter);

  // 北向单位切线（纬度增大方向）
  const nx = -slat * slon;
  const ny = clat;
  const nz = -slat * clon;

  // 东向单位切线（经度增大方向）
  const ex = clon;
  const ez = -slon;

  // 切平面内的方向向量
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const dx = cosT * nx + sinT * ex;
  const dy = cosT * ny;
  const dz = cosT * nz + sinT * ez;

  // P = cos(r)·C + sin(r)·D，结果自动在单位球面上
  const cosR = Math.cos(radius), sinR = Math.sin(radius);
  const x = cosR * clat * slon + sinR * dx;
  const y = cosR * slat + sinR * dy;
  const z = cosR * clat * clon + sinR * dz;

  return {
    x, y, z,
    lat: Math.asin(Math.max(-1, Math.min(1, y))),
    lon: Math.atan2(x, z)
  };
}

/**
 * 在球面上创建一个测地线正圆的几何体
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
    const pt = geodesicCirclePoint(latCenter, lonCenter, theta, CIRCLE_RADIUS);
    positions.push(pt.x, pt.y, pt.z);
    latitudes.push(pt.lat);
    longitudes.push(pt.lon);
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
    const pt = geodesicCirclePoint(latCenter, lonCenter, theta, CIRCLE_RADIUS);
    positions.push(pt.x, pt.y, pt.z);
    latitudes.push(pt.lat);
    longitudes.push(pt.lon);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  geometry.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));

  return geometry;
}

/**
 * 在 180° 经线上创建拆分的两个半圆几何体（填充用）
 * 测地线圆在 180° 处跨越日期变更线，按 θ 范围拆为左右两半
 * @param {number} latCenter - 圆心纬度（弧度）
 * @returns {THREE.BufferGeometry[]} [左半圆, 右半圆]
 */
function createSplitCircleGeometries(latCenter) {
  const halfSeg = Math.ceil(CIRCLE_SEGMENTS / 2);
  const results = [];

  for (const side of [-1, 1]) {
    const positions = [];
    const lats = [];
    const lons = [];
    const indices = [];

    // θ ∈ [0, π] → 东向分量正 → lon 落在 -π 侧
    // θ ∈ [π, 2π] → 东向分量负 → lon 落在 +π 侧
    const tStart = side === -1 ? 0 : Math.PI;
    const tEnd = side === -1 ? Math.PI : Math.PI * 2;
    const centerLon = side * Math.PI;

    // 中心点
    positions.push(
      Math.cos(latCenter) * Math.sin(centerLon),
      Math.sin(latCenter),
      Math.cos(latCenter) * Math.cos(centerLon)
    );
    lats.push(latCenter);
    lons.push(centerLon);

    // 半圆弧顶点
    for (let i = 0; i <= halfSeg; i++) {
      const theta = tStart + (i / halfSeg) * (tEnd - tStart);
      const pt = geodesicCirclePoint(latCenter, Math.PI, theta, CIRCLE_RADIUS);
      positions.push(pt.x, pt.y, pt.z);
      lats.push(pt.lat);
      // 北/南端点（θ=0,π）的 lon 恰好为 π，需强制到对应侧
      lons.push(side === -1 ? (pt.lon > 0 ? -Math.PI : pt.lon) : (pt.lon < 0 ? Math.PI : pt.lon));
    }

    // 扇形三角形索引
    for (let i = 1; i <= halfSeg; i++) {
      indices.push(0, i, i + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(lats, 1));
    geo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(lons, 1));
    geo.setIndex(indices);

    results.push(geo);
  }

  return results;
}

/**
 * 在 180° 经线上创建拆分的两个半圆边线几何体
 * @param {number} latCenter - 圆心纬度（弧度）
 * @returns {THREE.BufferGeometry[]} [左半圆边线, 右半圆边线]
 */
function createSplitOutlineGeometries(latCenter) {
  const halfSeg = Math.ceil(CIRCLE_SEGMENTS / 2);
  const results = [];

  for (const side of [-1, 1]) {
    const positions = [];
    const lats = [];
    const lons = [];

    const tStart = side === -1 ? 0 : Math.PI;
    const tEnd = side === -1 ? Math.PI : Math.PI * 2;

    for (let i = 0; i <= halfSeg; i++) {
      const theta = tStart + (i / halfSeg) * (tEnd - tStart);
      const pt = geodesicCirclePoint(latCenter, Math.PI, theta, CIRCLE_RADIUS);
      positions.push(pt.x, pt.y, pt.z);
      lats.push(pt.lat);
      lons.push(side === -1 ? (pt.lon > 0 ? -Math.PI : pt.lon) : (pt.lon < 0 ? Math.PI : pt.lon));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(lats, 1));
    geo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(lons, 1));

    results.push(geo);
  }

  return results;
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
    for (let lon = -150; lon < 180; lon += LON_STEP) {
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
    for (let lon = -120; lon < 180; lon += 60) {
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

  // 180° 经线上的圆：拆分为两个半圆，避免跨日期变更线拉伸
  const splitLats = [];
  for (let lat = -60; lat <= 60; lat += LAT_STEP) splitLats.push(lat);
  splitLats.push(-75, 75);

  for (const lat of splitLats) {
    const latRad = lat * DEG2RAD;

    const [leftFill, rightFill] = createSplitCircleGeometries(latRad);
    group.add(new THREE.Mesh(leftFill, fillMaterial));
    group.add(new THREE.Mesh(rightFill, fillMaterial));

    const [leftOutline, rightOutline] = createSplitOutlineGeometries(latRad);
    group.add(new THREE.Line(leftOutline, outlineMaterial));
    group.add(new THREE.Line(rightOutline, outlineMaterial));
  }

  return { group, fillMaterial, outlineMaterial };
}

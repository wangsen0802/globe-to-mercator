// 面积比较指示器
// 用简化轮廓展示格陵兰、非洲、南美洲在不同投影下的面积变形
// 经纬度坐标存为属性，由 indicator.vert 施加投影变换

import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import outlineFrag from '../shaders/outline.frag?raw';

const DEG2RAD = Math.PI / 180;

// ===== 简化国家轮廓坐标 [经度, 纬度]（度） =====

const COUNTRY_DATA = [
  {
    name: '格陵兰',
    color: [0.31, 0.76, 0.97],  // #4fc3f7
    realArea: 216,  // 万平方公里
    coords: [
      [-44, 60], [-40, 62], [-34, 65], [-26, 68], [-22, 70],
      [-18, 74], [-18, 78], [-22, 80], [-30, 82], [-40, 83],
      [-50, 82], [-56, 80], [-60, 78], [-64, 76], [-68, 74],
      [-72, 72], [-70, 68], [-64, 66], [-56, 64], [-50, 62],
      [-44, 60]
    ]
  },
  {
    name: '非洲',
    color: [0.51, 0.78, 0.52],  // #81c784
    realArea: 3037,  // 万平方公里
    coords: [
      [-5, 36], [10, 37], [12, 33], [25, 32], [32, 31],
      [36, 28], [40, 20], [43, 12], [50, 12], [50, 8],
      [42, 0], [40, -4], [36, -12], [34, -22], [30, -30],
      [26, -34], [20, -35], [18, -28], [14, -20], [12, -10],
      [10, -2], [8, 4], [2, 6], [-4, 6], [-8, 8],
      [-12, 12], [-16, 16], [-17, 20], [-14, 24], [-8, 28],
      [-4, 32], [-5, 36]
    ]
  },
  {
    name: '南美洲',
    color: [1.0, 0.72, 0.30],   // #ffb74d
    realArea: 1784,  // 万平方公里
    coords: [
      [-34, -6], [-35, -12], [-38, -18], [-42, -22], [-48, -28],
      [-52, -34], [-58, -40], [-66, -54], [-70, -52], [-72, -46],
      [-74, -40], [-76, -20], [-78, -6], [-80, 2], [-76, 6],
      [-78, 8], [-72, 12], [-64, 11], [-58, 6], [-52, 4],
      [-50, 0], [-44, -2], [-38, -4], [-34, -6]
    ]
  }
];

/**
 * 将 [lon, lat] 坐标数组转换为球面 BufferGeometry
 * @param {number[][]} coords - [[lon, lat], ...] 度数
 * @param {boolean} close - 是否闭合多边形（添加首尾连线）
 * @returns {{ fillGeo: THREE.BufferGeometry, lineGeo: THREE.BufferGeometry }}
 */
function createPolygonGeometries(coords) {
  const positions = [];
  const latitudes = [];
  const longitudes = [];

  // 计算质心用于扇形三角化
  let cx = 0, cy = 0;
  for (const [lon, lat] of coords) { cx += lon; cy += lat; }
  cx /= coords.length;
  cy /= coords.length;

  // 添加质心作为第一个顶点（索引 0）— 用于填充三角扇
  const cLatRad = cy * DEG2RAD;
  const cLonRad = cx * DEG2RAD;
  positions.push(
    Math.cos(cLatRad) * Math.sin(cLonRad),
    Math.sin(cLatRad),
    Math.cos(cLatRad) * Math.cos(cLonRad)
  );
  latitudes.push(cLatRad);
  longitudes.push(cLonRad);

  // 轮廓顶点（索引 1 起）
  for (const [lon, lat] of coords) {
    const latRad = lat * DEG2RAD;
    const lonRad = lon * DEG2RAD;
    positions.push(
      Math.cos(latRad) * Math.sin(lonRad),
      Math.sin(latRad),
      Math.cos(latRad) * Math.cos(lonRad)
    );
    latitudes.push(latRad);
    longitudes.push(lonRad);
  }

  // 填充几何体（三角扇）
  const fillIndices = [];
  for (let i = 1; i < coords.length; i++) {
    fillIndices.push(0, i, i + 1);
  }

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  fillGeo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  fillGeo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));
  fillGeo.setIndex(fillIndices);

  // 轮廓线几何体（仅轮廓顶点，不含质心）
  const linePositions = positions.slice(3);  // 跳过质心
  const lineLatitudes = latitudes.slice(1);
  const lineLongitudes = longitudes.slice(1);

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(lineLatitudes, 1));
  lineGeo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(lineLongitudes, 1));

  return { fillGeo, lineGeo };
}

/**
 * 创建面积比较指示器组
 * @param {Object} uniforms - 与主地球共享的 uniform 对象
 * @returns {{ group: THREE.Group, labels: Array }}
 */
export function createAreaComparison(uniforms) {
  const group = new THREE.Group();
  const labels = [];

  for (const country of COUNTRY_DATA) {
    const { fillGeo, lineGeo } = createPolygonGeometries(country.coords);

    // 填充材质（半透明）
    const fillMat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: outlineFrag,
      uniforms: {
        ...uniforms,
        uColor: { value: new THREE.Color(...country.color) },
        uOpacity: { value: 0.35 }
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    // 边线材质（较不透明）
    const lineMat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: outlineFrag,
      uniforms: {
        ...uniforms,
        uColor: { value: new THREE.Color(...country.color) },
        uOpacity: { value: 0.85 }
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    const lineLoop = new THREE.LineLoop(lineGeo, lineMat);

    group.add(fillMesh);
    group.add(lineLoop);

    // 存储标签信息供 UI 显示
    const centerLon = country.coords.reduce((s, c) => s + c[0], 0) / country.coords.length;
    const centerLat = country.coords.reduce((s, c) => s + c[1], 0) / country.coords.length;

    labels.push({
      name: country.name,
      realArea: country.realArea,
      color: country.color,
      centerLon: centerLon * DEG2RAD,
      centerLat: centerLat * DEG2RAD
    });
  }

  return { group, labels };
}

/**
 * 获取国家数据（供 UI 面板使用）
 */
export function getCountryData() {
  return COUNTRY_DATA;
}

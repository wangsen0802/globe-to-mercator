// 面积比较指示器
// 用简化轮廓展示格陵兰、非洲、南美洲在不同投影下的面积变形
// 经纬度坐标存为属性，由 indicator.vert 施加投影变换

import * as THREE from 'three';
import indicatorVert from '../shaders/indicator.vert?raw';
import outlineFrag from '../shaders/outline.frag?raw';

const DEG2RAD = Math.PI / 180;

// ===== 简化国家轮廓坐标 [经度, 纬度]（度）=====
// 数据来源：Natural Earth 110m land，Douglas-Peucker 简化

const COUNTRY_DATA = [
  {
    name: '格陵兰',
    color: [0.31, 0.76, 0.97],  // #4fc3f7
    realArea: 216,  // 万平方公里
    coords: [
      [-27.1,83.5],[-20.8,82.7],[-31.4,82],[-22.9,82.1],[-22.1,81.7],
      [-23.2,81.2],[-15.8,81.9],[-12.2,81.3],[-20,80.2],[-17.7,80.1],
      [-19.7,78.8],[-19.7,77.6],[-18.5,77],[-21.7,76.6],[-19.8,76.1],
      [-19.6,75.2],[-20.7,75.2],[-19.4,74.3],[-23.6,73.3],[-22.3,72.2],
      [-24.8,72.3],[-22.1,71.5],[-21.8,70.7],[-23.5,70.5],[-25.5,71.4],
      [-25.2,70.8],[-26.4,70.2],[-22.3,70.1],[-39.8,65.5],[-41.2,63.5],
      [-42.8,62.7],[-42.4,61.9],[-43.4,60.1],[-48.3,60.9],[-51.6,63.6],
      [-54,67.2],[-53,68.4],[-51.5,68.7],[-50.9,69.9],[-54.7,69.6],
      [-54.4,70.8],[-51.4,70.6],[-55.8,71.7],[-54.7,72.6],[-58.6,75.5],
      [-68.5,76.1],[-71.4,77],[-66.8,77.4],[-73.3,78],[-65.7,79.4],
      [-68,80.1],[-62.2,81.3],[-62.7,81.8],[-50.4,82.4],[-44.5,81.7],
      [-46.8,82.6],[-43.4,83.2],[-27.1,83.5]
    ]
  },
  {
    name: '非洲',
    color: [0.51, 0.78, 0.52],  // #81c784
    realArea: 3037,  // 万平方公里
    coords: [
      [32.3,29.8],[35.7,23.9],[35.5,23.1],[36.9,22],[37.5,18.6],
      [38.4,18],[39.3,15.9],[43.1,12.7],[43.3,12],[42.7,11.7],
      [44.6,10.4],[51.1,12],[51,10.6],[48.6,5.3],[40.3,-2.6],
      [39.2,-4.7],[38.7,-5.9],[39.5,-7.1],[39.2,-8.5],[40.5,-10.8],
      [40.8,-14.7],[39.5,-16.7],[37.4,-17.6],[34.8,-19.8],[35.6,-22.1],
      [35.5,-24.1],[32.6,-25.7],[32.2,-28.8],[28.2,-32.8],[25.8,-33.9],
      [22.6,-33.9],[19.6,-34.8],[18.2,-33.9],[18.2,-31.7],[15.2,-27.1],
      [14.3,-22.1],[11.8,-18.1],[11.8,-15.8],[13.7,-10.7],[11.9,-5],
      [8.8,-1.1],[9.8,3.1],[8.5,4.8],[5.9,4.3],[4.3,6.3],
      [1.1,5.9],[-2,4.7],[-4.6,5.2],[-7.5,4.3],[-9,4.8],
      [-12.4,7.3],[-14.8,10.9],[-16.7,12.4],[-16.7,13.6],[-17.6,14.7],
      [-16.7,15.6],[-16.1,18.1],[-17,21.9],[-14.4,26.3],[-9.6,29.9],
      [-9.3,32.6],[-6.9,34.1],[-5.9,35.8],[-2.2,35.2],[1.5,36.6],
      [9.5,37.4],[10.2,36.7],[11.1,36.9],[10.3,33.8],[15.2,32.3],
      [15.7,31.4],[19.1,30.3],[20.1,31],[20.1,32.2],[21.5,32.8],
      [28.9,30.9],[30.1,31.5],[32,30.9],[32.2,31.3],[32.3,29.8]
    ]
  },
  {
    name: '南美洲',
    color: [1.0, 0.72, 0.30],   // #ffb74d
    realArea: 1784,  // 万平方公里
    coords: [
      [-76.8,8.6],[-74.9,11.1],[-73.4,11.2],[-71.8,12.4],[-71.1,12.1],
      [-71.9,11.4],[-71.7,9.1],[-71,9.9],[-71.4,11],[-70.2,11.4],
      [-69.9,12.2],[-68.2,10.6],[-64.9,10.1],[-61.9,10.7],[-62.7,10.4],
      [-62.4,9.9],[-60.8,9.4],[-60.7,8.6],[-59.1,8],[-58.5,6.8],
      [-57.1,6],[-54,5.8],[-51.3,4.2],[-50,1.7],[-50.7,0.2],
      [-48.6,-0.2],[-48.6,-1.2],[-47.8,-0.6],[-46.6,-0.9],[-44.9,-1.6],
      [-44.6,-2.7],[-40,-2.9],[-37.2,-4.8],[-35.6,-5.1],[-34.7,-7.3],
      [-35.1,-9],[-38.7,-13.1],[-39.3,-17.9],[-40.9,-21.9],[-42,-23],
      [-44.6,-23.4],[-47.6,-24.9],[-48.5,-25.9],[-48.9,-28.7],[-53.8,-34.4],
      [-56.2,-34.9],[-58.4,-33.9],[-56.7,-36.4],[-57.7,-38.2],[-62.3,-38.8],
      [-62.1,-40.7],[-65.1,-41.1],[-65,-42.1],[-63.8,-42],[-63.5,-42.6],
      [-65.2,-43.5],[-65.6,-45],[-67.3,-45.6],[-67.6,-46.3],[-65.6,-47.2],
      [-69.1,-50.7],[-68.2,-52.3],[-70.8,-52.9],[-71,-53.8],[-72.6,-53.5],
      [-75.3,-51.6],[-75.6,-48.7],[-74.1,-46.9],[-75.6,-46.6],[-74.7,-45.8],
      [-74.4,-44.1],[-73.2,-44.5],[-72.7,-42.4],[-73.4,-42.1],[-73.7,-43.4],
      [-74.3,-43.2],[-73.2,-39.3],[-73.6,-37.2],[-71.4,-32.4],[-71.7,-30.9],
      [-70.2,-19.8],[-70.4,-18.3],[-76,-14.6],[-79,-8.4],[-81.3,-6.1],
      [-81.1,-4],[-79.8,-2.7],[-81,-2.2],[-80.1,0.8],[-78.9,1.4],
      [-77.1,3.8],[-77.5,6.7],[-76.8,8.6]
    ]
  }
];

/**
 * 细分多边形边：将超过 maxDeg 的边拆为多段，让三角化产生更小的三角形
 * @param {number[][]} openCoords - 未闭合的 [[lon, lat], ...] 度数
 * @param {number} maxDeg - 最大边长（度）
 * @returns {number[][]} 细分后的坐标数组（未闭合）
 */
function subdivideCoords(openCoords, maxDeg = 2) {
  const result = [];
  for (let i = 0; i < openCoords.length; i++) {
    const [lon1, lat1] = openCoords[i];
    const [lon2, lat2] = openCoords[(i + 1) % openCoords.length];

    const dist = Math.sqrt((lon2 - lon1) ** 2 + (lat2 - lat1) ** 2);
    const steps = Math.max(1, Math.ceil(dist / maxDeg));

    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      result.push([
        lon1 + (lon2 - lon1) * t,
        lat1 + (lat2 - lat1) * t
      ]);
    }
  }
  return result;
}

/**
 * 将 [lon, lat] 坐标数组转换为球面 BufferGeometry
 * @param {number[][]} coords - [[lon, lat], ...] 度数（首尾闭合）
 * @returns {{ fillGeo: THREE.BufferGeometry, lineGeo: THREE.BufferGeometry }}
 */
function createPolygonGeometries(coords) {
  // 去掉末尾闭合点（Shape 自动闭合），若未闭合则原样使用
  const isClosed = coords.length > 1 &&
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1];
  const open = isClosed ? coords.slice(0, -1) : coords;

  // 细分边：将长边拆为 ≤2° 的小段，让三角化产生更密的三角形
  const fine = subdivideCoords(open, 2);

  // 用 THREE.Shape + ShapeGeometry 实现耳切三角化
  const shape = new THREE.Shape();
  shape.moveTo(fine[0][0], fine[0][1]);
  for (let i = 1; i < fine.length; i++) {
    shape.lineTo(fine[i][0], fine[i][1]);
  }

  const tmpGeo = new THREE.ShapeGeometry(shape);

  // ===== 三角形中点细分 =====
  // 对每个三角形取三边中点，拆成 4 个小三角形，增加内部顶点密度
  // depth=2: 每个原始三角形 → 16 个小三角形
  // 注意：ShapeGeometry 的 position 是 3 分量 (x,y,z=0)，步长=3
  let posArr = Array.from(tmpGeo.getAttribute('position').array);
  let idxArr = Array.from(tmpGeo.getIndex().array);
  tmpGeo.dispose();

  for (let d = 0; d < 2; d++) {
    const newPos = [...posArr];
    const newIdx = [];
    const midCache = new Map();

    for (let i = 0; i < idxArr.length; i += 3) {
      const a = idxArr[i], b = idxArr[i + 1], c = idxArr[i + 2];

      // 取或创建边中点（共享边复用同一中点）
      function mid(p1, p2) {
        const key = p1 < p2 ? p1 * 100000 + p2 : p2 * 100000 + p1;
        if (midCache.has(key)) return midCache.get(key);
        const mx = (posArr[p1 * 3] + posArr[p2 * 3]) / 2;
        const my = (posArr[p1 * 3 + 1] + posArr[p2 * 3 + 1]) / 2;
        const idx = newPos.length / 3;
        newPos.push(mx, my, 0);
        midCache.set(key, idx);
        return idx;
      }

      const mab = mid(a, b);
      const mbc = mid(b, c);
      const mca = mid(c, a);

      // 一个三角形 → 四个
      newIdx.push(a, mab, mca,  mab, b, mbc,  mca, mbc, c,  mab, mbc, mca);
    }

    posArr = newPos;
    idxArr = newIdx;
  }

  // 将细分后的 2D (lon°, lat°) 顶点 → 3D 球面坐标 + lat/lon 属性
  const positions = [];
  const latitudes = [];
  const longitudes = [];

  for (let i = 0; i < posArr.length; i += 3) {
    const lonDeg = posArr[i];
    const latDeg = posArr[i + 1];
    const latRad = latDeg * DEG2RAD;
    const lonRad = lonDeg * DEG2RAD;
    positions.push(
      Math.cos(latRad) * Math.cos(lonRad),
      Math.sin(latRad),
      -Math.cos(latRad) * Math.sin(lonRad)
    );
    latitudes.push(latRad);
    longitudes.push(lonRad);
  }

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  fillGeo.setAttribute('aLatitude', new THREE.Float32BufferAttribute(latitudes, 1));
  fillGeo.setAttribute('aLongitude', new THREE.Float32BufferAttribute(longitudes, 1));
  fillGeo.setIndex(idxArr);

  // 轮廓线几何体（仅边界顶点，无质心）
  const linePositions = [];
  const lineLatitudes = [];
  const lineLongitudes = [];

  for (const [lon, lat] of fine) {
    const latRad = lat * DEG2RAD;
    const lonRad = lon * DEG2RAD;
    linePositions.push(
      Math.cos(latRad) * Math.cos(lonRad),
      Math.sin(latRad),
      -Math.cos(latRad) * Math.sin(lonRad)
    );
    lineLatitudes.push(latRad);
    lineLongitudes.push(lonRad);
  }

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

    // 填充材质（半透明，FrontSide 避免 DoubleSide alpha 双重混合导致三角边线可见）
    const fillMat = new THREE.ShaderMaterial({
      vertexShader: indicatorVert,
      fragmentShader: outlineFrag,
      uniforms: {
        ...uniforms,
        uColor: { value: new THREE.Color(...country.color) },
        uOpacity: { value: 0.35 }
      },
      transparent: true,
      side: THREE.FrontSide,
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

// 诊断：tissot 变形椭圆在方位投影（正射/立体）展平态（progress=1）的分布与远端淡出
// 纯数值复刻 tissot.js 采样网格 + projections.glsl 投影/mask，确定性输出每个椭圆归属
// 运行：node scripts/debug-tissot-azimuthal.mjs

const DEG2RAD = Math.PI / 180;
const CIRCLE_RADIUS = 0.075; // 角半径，约 4.3°
const SEG = 32;

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// 复刻 tissot.js geodesicCirclePoint（纯数学，去 THREE）
function geoCircle(latC, lonC, theta, radius) {
  const clat = Math.cos(latC), slat = Math.sin(latC);
  const clon = Math.cos(lonC), slon = Math.sin(lonC);
  const nx = -slat * clon, ny = clat, nz = slat * slon;
  const ex = -slon, ez = -clon;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const dx = cosT * nx + sinT * ex;
  const dy = cosT * ny;
  const dz = cosT * nz + sinT * ez;
  const cosR = Math.cos(radius), sinR = Math.sin(radius);
  const x = cosR * clat * clon + sinR * dx;
  const y = cosR * slat + sinR * dy;
  const z = -cosR * clat * slon + sinR * dz;
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const lon = Math.atan2(-z, x);
  return { x, y, z, lat, lon };
}

// 正射投影 + mask（复刻 projections.glsl projectAzimuthal type<0.5）
function ortho(lon, lat) {
  return { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat) };
}
function maskOrtho(lat, lon) {
  return smoothstep(0, 0.2, -Math.cos(lat) * Math.cos(lon));
}

// 立体投影 + mask（type>=0.5，含 stereoMaxR=2.3 钳制）
function stereo(lon, lat) {
  const cl = Math.max(-1.4, Math.min(1.4, lat));
  const k = 2 / Math.max(1 + Math.sin(cl), 0.01);
  let px = k * Math.cos(cl) * Math.sin(lon);
  let py = k * Math.cos(cl) * Math.cos(lon);
  const r = Math.hypot(px, py);
  const clamped = r > 2.3;
  if (clamped) { px *= 2.3 / r; py *= 2.3 / r; }
  return { x: px, y: py, clamped };
}
function maskStereo(lat) {
  return smoothstep(0, 0.2, -Math.sin(lat));
}

// 采样网格（复刻 tissot.js createTissotIndicators）
const samples = [];
for (let lat = -60; lat <= 60; lat += 30)
  for (let lon = -150; lon < 180; lon += 30)
    samples.push({ lat, lon });
for (const lat of [-75, 75])
  for (let lon = -120; lon < 180; lon += 60)
    samples.push({ lat, lon });
const splitLats = [];
for (let lat = -60; lat <= 60; lat += 30) splitLats.push(lat);
splitLats.push(-75, 75);
for (const lat of splitLats) {
  samples.push({ lat, lon: 180, split: 'L' });
  samples.push({ lat, lon: 180, split: 'R' });
}

function analyze(mode) {
  const proj = mode === 'ortho' ? ortho : stereo;
  const mask = mode === 'ortho'
    ? (lat, lon) => maskOrtho(lat, lon)
    : (lat) => maskStereo(lat);
  console.log(`\n===== ${mode.toUpperCase()} 展平态(progress=1) =====`);
  console.log('lon,lat | 圆心(x,y) | 圆心mask | 圆周mask[min,max] | 圆周x[min,max] | 圆周y[min,max] | 分类');

  let cntNear = 0, cntBnd = 0, cntFar = 0;
  let leftVisible = 0, rightVisible = 0, centerVisible = 0;
  const anomalies = [];

  for (const s of samples) {
    const latC = s.lat * DEG2RAD, lonC = s.lon * DEG2RAD;
    const center = proj(lonC, latC);
    const cmask = mask(latC, lonC);
    let mMin = 1, mMax = 0, xMin = 1e9, xMax = -1e9, yMin = 1e9, yMax = -1e9;
    for (let i = 0; i < SEG; i++) {
      const theta = (i / SEG) * Math.PI * 2;
      const pt = geoCircle(latC, lonC, theta, CIRCLE_RADIUS);
      const m = mask(pt.lat, pt.lon);
      const pp = proj(pt.lon, pt.lat);
      mMin = Math.min(mMin, m); mMax = Math.max(mMax, m);
      xMin = Math.min(xMin, pp.x); xMax = Math.max(xMax, pp.x);
      yMin = Math.min(yMin, pp.y); yMax = Math.max(yMax, pp.y);
    }
    let cls;
    if (mMax < 0.05) {
      cls = '近端✓';
      cntNear++;
      if (center.x < -0.01) leftVisible++;
      else if (center.x > 0.01) rightVisible++;
      else centerVisible++;
    } else if (mMin > 0.95) { cls = '远端✗'; cntFar++; }
    else { cls = '边界~'; cntBnd++; anomalies.push({ s, center, mMin, mMax, xMin, xMax }); }
    const tag = s.split ? `[拆${s.split}]` : '       ';
    console.log(
      `${String(s.lon).padStart(4)},${String(s.lat).padStart(4)} ${tag} | ` +
      `(${center.x.toFixed(2).padStart(5)},${center.y.toFixed(2).padStart(5)}) | ` +
      `${cmask.toFixed(2)} | [${mMin.toFixed(2)},${mMax.toFixed(2)}] | ` +
      `[${xMin.toFixed(2)},${xMax.toFixed(2)}] | [${yMin.toFixed(2)},${yMax.toFixed(2)}] | ${cls}`
    );
  }
  console.log(`\n汇总: 近端(可见)${cntNear}  边界(部分淡出)${cntBnd}  远端(全淡出)${cntFar}`);
  console.log(`可见椭圆屏幕分布: 左半(x<0)=${leftVisible}  右半(x>0)=${rightVisible}  中央(x≈0)=${centerVisible}`);
  console.log(`>>> 对称性: ${leftVisible === rightVisible ? '左右对称 ✓' : '⚠️ 不对称! 左=' + leftVisible + ' 右=' + rightVisible}`);
  if (anomalies.length) {
    console.log(`边界椭圆(被切半的可疑对象)共 ${anomalies.length} 个:`);
    for (const a of anomalies) {
      console.log(`   lon=${a.s.lon} lat=${a.s.lat} ${a.s.split ? '拆' + a.s.split : ''} 圆心(${a.center.x.toFixed(2)},${a.center.y.toFixed(2)}) mask[${a.mMin.toFixed(2)},${a.mMax.toFixed(2)}] x[${a.xMin.toFixed(2)},${a.xMax.toFixed(2)}]`);
    }
  }
}

analyze('ortho');
analyze('stereo');

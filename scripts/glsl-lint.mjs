/**
 * GLSL 着色器验证脚本
 *
 * 先展开 #include 指令，注入 Three.js 内置声明，再用 glslangValidator 验证。
 * 用法：pnpm lint:glsl
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, join, relative, basename } from 'path';
import { execFileSync } from 'child_process';
// 复用插件的 #include 展开逻辑（含循环引用检测），避免两份副本漂移
import { expandIncludes } from '../vite-plugin-glsl-include.js';

// Three.js 自动注入的内置声明 — 验证时需要提前声明
const THREEJS_VERT_PREAMBLE = `
// === Three.js 内置声明 (自动注入) ===
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
`;

const THREEJS_FRAG_PREAMBLE = `
// === Three.js 内置声明 (自动注入) ===
precision mediump float;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

// 递归查找着色器文件
function findShaders(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...findShaders(full));
    } else if (/\.(vert|frag)$/.test(full)) {
      files.push(full);
    }
  }
  return files;
}

// 根据 shader 阶段注入对应的 preamble
function addPreamble(source, ext) {
  if (ext === '.vert') return THREEJS_VERT_PREAMBLE + source;
  if (ext === '.frag') return THREEJS_FRAG_PREAMBLE + source;
  return source;
}

// ── 前置检查 ──

const rootDir = resolve(import.meta.dirname, '..');
const shadersDir = resolve(rootDir, 'src/shaders');
const tmpDir = resolve(rootDir, '.glsl-tmp');

try {
  execFileSync('which', ['glslangValidator'], { encoding: 'utf-8' });
} catch {
  console.error('\x1b[31m错误: 未找到 glslangValidator\x1b[0m');
  console.error('请先安装: brew install glslang');
  process.exit(1);
}

// ── 主流程 ──

mkdirSync(tmpDir, { recursive: true });

// 进程异常退出时清理临时目录
const cleanup = () => { rmSync(tmpDir, { recursive: true, force: true }); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const files = findShaders(shadersDir);
let errorCount = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf-8');
  const expanded = expandIncludes(source, dirname(file));
  const ext = file.slice(file.lastIndexOf('.'));
  const relPath = relative(rootDir, file);

  // 注入 Three.js preamble + 展开后的代码
  const fullSource = addPreamble(expanded, ext);
  const tmpFile = join(tmpDir, basename(file));
  writeFileSync(tmpFile, fullSource);

  try {
    const stdout = execFileSync('glslangValidator', [tmpFile], { encoding: 'utf-8' });
    if (stdout.includes('ERROR')) {
      console.log(`\x1b[31m✗ ${relPath}\x1b[0m`);
      console.log(stdout);
      errorCount++;
    } else {
      console.log(`\x1b[32m✓\x1b[0m ${relPath}`);
      if (stdout.trim() && !stdout.includes('No errors')) {
        console.log(`  ${stdout.trim()}`);
      }
    }
  } catch (e) {
    console.log(`\x1b[31m✗ ${relPath}\x1b[0m`);
    console.log(e.stdout || e.message);
    errorCount++;
  }
}

console.log(`\n${files.length} 个着色器文件，\x1b[31m${errorCount}\x1b[0m 个错误`);

// ── 投影 clamp 边界一致性护栏（JS 复刻副本 vs GLSL 真源）──
// CLAUDE.md 声明的"单源维护"仅对 GLSL 成立；greatCircleRoutes.js 有手写 JS 副本，
// 这里在构建期断言两端数值一致，漂移即 fail。新增/修改投影 clamp 边界后必跑 pnpm lint:glsl。
function extractNum(re, src) {
  const m = re.exec(src);
  return m ? m[1] : null;
}

const glslProjSrc = readFileSync(resolve(shadersDir, 'common/projections.glsl'), 'utf-8');
const jsRoutesSrc = readFileSync(resolve(rootDir, 'src/indicators/greatCircleRoutes.js'), 'utf-8');

// 圆锥纬度上限：GLSL clamp(lat, -1.3, X) ↔ JS Math.min(X, lat)
const glslConicMax = extractNum(/clamp\(\s*lat,\s*-1\.3,\s*([\d.]+)\s*\)/, glslProjSrc);
const jsConicMax = extractNum(/Math\.min\(\s*([\d.]+),\s*lat\s*\)/, jsRoutesSrc);
if (glslConicMax && jsConicMax && glslConicMax !== jsConicMax) {
  console.log(`\x1b[31m✗ 投影漂移\x1b[0m: 圆锥纬度上限 GLSL=${glslConicMax} ≠ JS=${jsConicMax}`);
  console.log(`  请对齐 src/shaders/common/projections.glsl 与 src/indicators/greatCircleRoutes.js`);
  errorCount++;
}

// 立体投影半径钳制：GLSL `stereoMaxR = X` ↔ JS `stereoMaxR = X`（同一标识符，一个正则覆盖两端）
const glslStereoMaxR = extractNum(/stereoMaxR\s*=\s*([\d.]+)/, glslProjSrc);
const jsStereoMaxR = extractNum(/stereoMaxR\s*=\s*([\d.]+)/, jsRoutesSrc);
if (glslStereoMaxR && jsStereoMaxR && glslStereoMaxR !== jsStereoMaxR) {
  console.log(`\x1b[31m✗ 投影漂移\x1b[0m: 立体投影半径上限 GLSL=${glslStereoMaxR} ≠ JS=${jsStereoMaxR}`);
  console.log(`  请对齐 src/shaders/common/projections.glsl 与 src/indicators/greatCircleRoutes.js`);
  errorCount++;
}

// 方位投影远端淡出 mask 的 smoothstep 过渡带宽度一致性护栏
// mask 公式散落在 globe.vert / indicator.vert / glow.vert / greatCircleRoutes.js(jsAzimuthalFarMask)
// 断言各处 smoothstep(0.0, X, ...) / smoothstepJS(0.0, X, ...) 的过渡带宽度 X 一致，漂移即 fail
const maskBandRe = /smoothstep(?:JS)?\(\s*0\.0\s*,\s*([\d.]+)\s*,/g;
function extractMaskBands(src) {
  const bands = new Set();
  let m;
  while ((m = maskBandRe.exec(src)) !== null) bands.add(m[1]);
  return bands;
}
const maskBandFiles = {
  'globe.vert': readFileSync(resolve(shadersDir, 'globe.vert'), 'utf-8'),
  'indicator.vert': readFileSync(resolve(shadersDir, 'indicator.vert'), 'utf-8'),
  'glow.vert': readFileSync(resolve(shadersDir, 'glow.vert'), 'utf-8'),
  'greatCircleRoutes.js': jsRoutesSrc,
};
const allMaskBands = new Set();
for (const src of Object.values(maskBandFiles)) {
  for (const b of extractMaskBands(src)) allMaskBands.add(b);
}
if (allMaskBands.size > 1) {
  console.log(`\x1b[31m✗ 投影漂移\x1b[0m: 远端淡出 mask 过渡带不一致 [${[...allMaskBands].join(', ')}]`);
  console.log(`  请对齐 globe.vert / indicator.vert / glow.vert / greatCircleRoutes.js 的 smoothstep(0.0, X, ...) 宽度`);
  errorCount++;
}

process.exit(errorCount > 0 ? 1 : 0);

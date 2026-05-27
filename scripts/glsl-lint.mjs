/**
 * GLSL 着色器验证脚本
 *
 * 先展开 #include 指令，注入 Three.js 内置声明，再用 glslangValidator 验证。
 * 用法：pnpm lint:glsl
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, join, relative, basename } from 'path';
import { execFileSync } from 'child_process';

const INCLUDE_RE = /^[ \t]*#include[ \t]+(.+?)[ \t]*$/gm;

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

// 展开递归 #include
function expandIncludes(source, baseDir) {
  const resolved = new Set();
  return source.replace(INCLUDE_RE, (_, incPath) => {
    const cleanPath = incPath.replace(/['"]/g, '');
    if (resolved.has(cleanPath)) return '';
    resolved.add(cleanPath);
    const absPath = resolve(baseDir, cleanPath);
    const content = readFileSync(absPath, 'utf-8');
    return expandIncludes(content, dirname(absPath));
  });
}

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
process.exit(errorCount > 0 ? 1 : 0);

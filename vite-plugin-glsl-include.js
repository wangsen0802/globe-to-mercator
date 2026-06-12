/**
 * Vite 插件：处理 GLSL 着色器中的 #include 指令
 *
 * 用法：在 .vert/.frag 文件中写  #include common/projections.glsl
 * 插件在 load 阶段将其替换为对应文件的内容，兼容 ?raw 导入。
 * 支持 HMR：修改 .glsl 共享文件时，自动刷新所有依赖它的着色器。
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const INCLUDE_RE = /^[ \t]*#include[ \t]+(.+?)[ \t]*$/gm;

// 依赖图：被 include 的文件绝对路径 → 依赖它的文件绝对路径集合
const includeDeps = new Map();

// 展开递归 #include（导出供 scripts/glsl-lint.mjs 复用，保证插件与 lint 单源）
// seen 沿调用链透传（每分支拷贝），基于绝对路径检测跨文件循环引用 A→B→A
export function expandIncludes(source, baseDir, importerPath, seen = new Set()) {
  return source.replace(INCLUDE_RE, (_, incPath) => {
    const cleanPath = incPath.replace(/['"]/g, '');
    const absPath = resolve(baseDir, cleanPath);

    // 循环引用检测：absPath 已在当前祖先路径中 → 跳过，避免无限 readFileSync/栈溢出
    if (seen.has(absPath)) {
      console.warn(`[glsl-include] 检测到循环引用，已跳过: ${absPath}`);
      return '';
    }
    const nextSeen = new Set(seen);
    nextSeen.add(absPath);

    // 记录 HMR 依赖：absPath 被 importerPath 引用（importerPath 为空时跳过，如 lint 场景）
    if (importerPath) {
      if (!includeDeps.has(absPath)) {
        includeDeps.set(absPath, new Set());
      }
      includeDeps.get(absPath).add(importerPath);
    }

    const content = readFileSync(absPath, 'utf-8');
    return expandIncludes(content, dirname(absPath), importerPath, nextSeen);
  });
}

export default function glslInclude() {
  return {
    name: 'glsl-include',
    enforce: 'pre',  // 必须在 Vite 内置 asset plugin 之前拦截

    // 用 load hook 拦截 ?raw 导入，在 Vite 包装为 JS 模块之前处理 #include
    load(id) {
      const cleanId = id.replace(/\?.*$/, '');
      if (!/\.(vert|frag|glsl)$/.test(cleanId)) return null;

      const source = readFileSync(cleanId, 'utf-8');
      const expanded = expandIncludes(source, dirname(cleanId), cleanId);

      // 模拟 Vite ?raw 行为：返回 JS 模块导出字符串
      return `export default ${JSON.stringify(expanded)}`;
    },

    // HMR：当 .glsl 共享文件变更时，失效所有依赖它的着色器模块
    handleHotUpdate({ file, server }) {
      if (!/\.(vert|frag|glsl)$/.test(file)) return;

      const dependents = includeDeps.get(file);
      if (!dependents || dependents.size === 0) return;

      const mods = [];
      for (const depPath of dependents) {
        const depMods = server.moduleGraph.getModulesByFile(depPath);
        if (depMods) {
          for (const mod of depMods) {
            server.moduleGraph.invalidateModule(mod);
            mods.push(mod);
          }
        }
      }
      return mods.length > 0 ? mods : undefined;
    }
  };
}

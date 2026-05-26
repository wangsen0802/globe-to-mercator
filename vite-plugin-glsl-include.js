/**
 * Vite 插件：处理 GLSL 着色器中的 #include 指令
 *
 * 用法：在 .vert/.frag 文件中写  #include common/projections.glsl
 * 插件在 load 阶段将其替换为对应文件的内容，兼容 ?raw 导入。
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const INCLUDE_RE = /^[ \t]*#include[ \t]+(.+?)[ \t]*$/gm;

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

export default function glslInclude() {
  return {
    name: 'glsl-include',
    enforce: 'pre',  // 必须在 Vite 内置 asset plugin 之前拦截

    // 用 load hook 拦截 ?raw 导入，在 Vite 包装为 JS 模块之前处理 #include
    load(id) {
      const cleanId = id.replace(/\?.*$/, '');
      if (!/\.(vert|frag|glsl)$/.test(cleanId)) return null;

      const source = readFileSync(cleanId, 'utf-8');
      const expanded = expandIncludes(source, dirname(cleanId));

      // 模拟 Vite ?raw 行为：返回 JS 模块导出字符串
      return `export default ${JSON.stringify(expanded)}`;
    }
  };
}

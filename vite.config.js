import { defineConfig } from 'vite';
import glslInclude from './vite-plugin-glsl-include.js';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    open: true
  },
  plugins: [glslInclude()],
  assetsInclude: ['**/*.glsl']
});

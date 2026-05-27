import { defineConfig } from 'vite';
import glslInclude from './vite-plugin-glsl-include.js';

export default defineConfig({
  root: '.',
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true
  },
  plugins: [glslInclude()],
  assetsInclude: ['**/*.glsl']
});

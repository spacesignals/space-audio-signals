import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/galaxy/',
  plugins: [preact()],
  build: {
    outDir: '../deploy',
    emptyOutDir: true,
  },
});

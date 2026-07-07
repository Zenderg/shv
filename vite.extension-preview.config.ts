import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/extension-preview',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/extension-preview',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5174
  }
});

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/extension/source-helper/contentScript.ts',
      formats: ['iife'],
      name: 'ShvSourceHelperContentScript'
    },
    outDir: 'extension/chrome-source-helper',
    rollupOptions: {
      output: {
        entryFileNames: 'content-script.js'
      }
    }
  }
});

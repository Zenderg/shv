import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/extension': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
      '/thumbnails': 'http://127.0.0.1:8080'
    }
  }
});

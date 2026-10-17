import { narrationPlugin } from './server/viteNarration';
import { ocrPlugin } from './server/viteOCR';
import { backendPlugin } from './server/viteBackend';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), backendPlugin(), narrationPlugin(), ocrPlugin()], base: './',
  server: { host: '0.0.0.0', port: 5186, strictPort: true },
  preview: { host: '0.0.0.0', port: 4186, strictPort: true },
  build: { target: 'es2022', sourcemap: true }
});

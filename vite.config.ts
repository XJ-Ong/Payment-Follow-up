import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: { jsx: 'automatic' },
  build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
});

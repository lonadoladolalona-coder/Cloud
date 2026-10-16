import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Static demo: the real UI with a simulated backend (src/web/demo). `npm run build:demo`, then `npm run pack:demo`. */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/demo',
    emptyOutDir: true,
    rollupOptions: { input: 'demo.html' },
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
  },
});

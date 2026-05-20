import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devPort = Number(process.env.VITE_DEV_PORT ?? 5173);
const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${process.env.API_PORT ?? 5174}`;

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mapbox-gl')) return 'mapbox';
          if (id.includes('node_modules/firebase')) return 'firebase';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/lucide-react')) return 'icons';
        }
      }
    }
  },
  server: {
    port: devPort,
    proxy: {
      '/api': apiTarget,
      '/events': apiTarget
    }
  }
});

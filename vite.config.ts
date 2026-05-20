import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devPort = Number(process.env.VITE_DEV_PORT ?? 5173);
const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${process.env.API_PORT ?? 5174}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: devPort,
    proxy: {
      '/api': apiTarget,
      '/events': apiTarget
    }
  }
});

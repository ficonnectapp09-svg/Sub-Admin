import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = (
    env.VITE_API_BASE_URL ||
    env.BACKEND_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.BACKEND_URL ||
    'http://127.0.0.1:8006'
  ).replace(/\/+$/, '');

  return {
    plugins: [react()],

    // Use '/' for web deployments so deep routes (/state-admin/dashboard, etc.) resolve assets correctly.
    // Use './' only when explicitly building for Electron via ELECTRON=true.
    base: process.env.ELECTRON === 'true' ? './' : '/',

    server: {
      host: true,
      port: 3000,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: proxyTarget.startsWith('https:'),
          timeout: 60000,
          proxyTimeout: 60000,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, res) => {
              if (res && !res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Backend server is temporarily restarting, please retry.' }));
              }
            });
          }
        },
        '/uploads': {
          target: proxyTarget,
          changeOrigin: true,
          secure: proxyTarget.startsWith('https:')
        }
      }
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('recharts') || id.includes('d3-')) {
                return 'vendor-charts';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
            }
          }
        }
      }
    }
  };
});


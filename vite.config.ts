import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3141',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks, loaded in parallel with the app by modulepreload:
        // they stay cached across app releases and keep every chunk under the 500 kB
        // warning. The desk is served on loopback, so the split is for caching, not for lazy
        // loading - a lazy floor measured slower (an extra request round before it paints).
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'uidl-runtime', test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?uidl-runtime[\\/]/, priority: 20 },
            {
              name: 'context-atlas',
              test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@context-atlas|@xyflow|@reactflow)[\\/]|node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:ajv|d3(?:-[^\\/]+)?|fast-deep-equal|fast-uri|json-schema-traverse|lucide-react|use-sync-external-store|zustand)[\\/]/,
              priority: 15,
            },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});

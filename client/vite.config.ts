import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Both ports can move, so a second checkout (a worktree, say) can run beside the first.
const apiPort = process.env.LOADBEARING_PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.LOADBEARING_CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});

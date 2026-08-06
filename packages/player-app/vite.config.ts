import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@jogo/shared': path.resolve(__dirname, '../shared/src/index.ts')
    }
  },
  server: {
    port: 5173,
    host: true
  }
});

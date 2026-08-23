import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Servido em produção sob /admin, no mesmo container Cloud Run da cloud-api, atrás do
// Identity-Aware Proxy (Tarefa C7 — ver README para o resto do raciocínio de auth).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5175,
    host: true
  }
});

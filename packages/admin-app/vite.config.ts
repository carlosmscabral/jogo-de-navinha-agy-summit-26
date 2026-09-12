import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Servido em produção sob /admin, no mesmo container Cloud Run da cloud-api, atrás da senha
// HTTP Basic da Tarefa C10 — não há IAP nesta topologia (ver packages/cloud-api/README.md,
// "Autenticação do painel de admin", e o comentário de `requireAdminAuth` em
// cloud-api/src/index.ts).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5175,
    host: true
  }
});

import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { casesApi } from './server/cases-api.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), casesApi({
    sample: fileURLToPath(new URL('../player/cases', import.meta.url)),
    // 元の台本から変換した公式の章（手元用・配布しない。tools/convert で作る）
    official: fileURLToPath(new URL('../../assets/extracted/converted', import.meta.url)),
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 13575 },
});

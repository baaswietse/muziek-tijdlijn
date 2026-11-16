import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

// De site staat op https://baaswietse.github.io/muziek-tijdlijn/, dus alle
// paden beginnen met /muziek-tijdlijn/ (ook lokaal, zodat alles gelijk loopt).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: process.env.VITE_BASE || '/muziek-tijdlijn/',
  plugins: [preact()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});

import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Version publiée : identifiant du commit sur GitHub Actions, sinon « dev ».
// version.json permet à l'appli de voir qu'une version plus récente est en ligne (voir services/appVersion.ts).
const APP_VERSION = (process.env.GITHUB_SHA ?? '').slice(0, 7) || process.env.APP_VERSION || 'dev';
const BUILT_AT = new Date().toISOString();

// V2 : plus aucune clé d'IA dans l'application — tout passe par la fonction serveur « ai ».
export default defineConfig({
  // Chemins relatifs : l'appli fonctionne aussi bien sur GitHub Pages (/inspecteur-batiment-ai/) que sur Firebase Hosting
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  plugins: [
    react(),
    {
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION, builtAt: BUILT_AT }) });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});

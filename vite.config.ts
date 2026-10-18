import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// V2 : plus aucune clé d'IA dans l'application — tout passe par la fonction serveur « ai ».
export default defineConfig({
  // Chemins relatifs : l'appli fonctionne aussi bien sur GitHub Pages (/inspecteur-batiment-ai/) que sur Firebase Hosting
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});

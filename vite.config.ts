/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const brand = loadEnv(mode, process.cwd(), 'VITE_').VITE_BRAND_NAME?.trim();
  return {
  // relative Pfade: App läuft auch in einem Unterordner / als gehostete Website
  base: './',
  build: mode === 'artifact' ? { outDir: process.env.OUT_DIR ?? 'dist-site', emptyOutDir: true } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Im Website-Build (mode=artifact) ohne Service Worker
      disable: mode === 'artifact',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: brand ? `Pausenplan ${brand}` : 'Pausenplaner Filiale',
        short_name: 'Pausenplan',
        description: 'Digitale Pausenplanung & PEPZeit-Abgleich für die Bäckerei-Filiale',
        lang: 'de',
        theme_color: '#6b4226',
        background_color: '#faf6f0',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Supabase-API wird nie gecacht – Offline-Daten liegen in IndexedDB.
        runtimeCaching: [],
      },
    }),
  ],
  test: { environment: 'node' },
  };
});

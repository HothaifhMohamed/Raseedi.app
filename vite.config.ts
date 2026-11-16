import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function conditionalAdsTxtPlugin(): Plugin {
  return {
    name: 'conditional-ads-txt',
    closeBundle() {
      const client = process.env.VITE_ADSENSE_CLIENT_ID?.trim() || 'ca-pub-7802456807447662';
      const outAdsPath = path.resolve(__dirname, 'dist', 'ads.txt');
      if (!fs.existsSync(path.dirname(outAdsPath))) return;
      const pubId = client.replace(/^ca-/, '');
      const content = `# Google AdSense Authorized Digital Sellers (ads.txt) for Raseedi\ngoogle.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`;
      fs.writeFileSync(outAdsPath, content, 'utf8');
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      conditionalAdsTxtPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        manifestFilename: 'manifest.json',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'app-icon.png',
          'icon-192.png',
          'icon-512.png',
        ],
        manifest: {
          id: '/',
          name: 'رَصِيدِي - Raseedi',
          short_name: 'Raseedi',
          description: 'تطبيق عربي شامل لإدارة وتتبع المصاريف، الميزانيات، المحافظ، والديون وحسابات المؤسسات.',
          lang: 'ar',
          dir: 'rtl',
          theme_color: '#F5EFE3',
          background_color: '#F5EFE3',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/app-icon.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/ads\.txt$/, /^\/api\//],
        },
        devOptions: {
          enabled: false
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

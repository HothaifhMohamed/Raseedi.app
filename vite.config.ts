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

function readAppVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version?.trim() || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function versionManifestPlugin(version: string, buildId: string): Plugin {
  const payload = JSON.stringify(
    {
      version,
      buildId,
      builtAt: new Date().toISOString(),
    },
    null,
    2
  );

  return {
    name: 'raseedi-version-manifest',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.end(payload);
      });
    },
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) return;
      fs.writeFileSync(path.join(distDir, 'version.json'), payload, 'utf8');
    },
  };
}

export default defineConfig(() => {
  const appVersion = readAppVersion();
  const buildId = `${appVersion}-${Date.now().toString(36)}`;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      react(),
      tailwindcss(),
      conditionalAdsTxtPlugin(),
      versionManifestPlugin(appVersion, buildId),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: null,
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
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/version.json'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/ads\.txt$/, /^\/api\//, /^\/version\.json$/],
          runtimeCaching: [
            {
              urlPattern: /\/version\.json(\?.*)?$/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/manifest\.json$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'raseedi-manifest',
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
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

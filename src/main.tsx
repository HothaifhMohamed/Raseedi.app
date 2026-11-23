import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { attemptChunkRecoveryReload, initAppAutoUpdate } from './services/appUpdate';
import { initPWAInstallCapture } from './services/pwaInstallStore';
import { isBenignAdSenseNoDivError } from './services/adsterra';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    attemptChunkRecoveryReload();
  });

  window.addEventListener(
    'error',
    (event) => {
      const errObj = event.error as { message?: unknown; stack?: unknown } | null | undefined;
      if (
        isBenignAdSenseNoDivError({
          message: event.message || errObj?.message,
          filename: event.filename,
          stack: errObj?.stack,
        })
      ) {
        event.preventDefault();
      }
    },
    true
  );
}

initAppAutoUpdate();
initPWAInstallCapture();

createRoot(document.getElementById('root')!).render(<App />);

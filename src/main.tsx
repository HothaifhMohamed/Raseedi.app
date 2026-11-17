import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { attemptChunkRecoveryReload, initAppAutoUpdate } from './services/appUpdate';
import { initPWAInstallCapture } from './services/pwaInstallStore';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    attemptChunkRecoveryReload();
  });
}

initAppAutoUpdate();
initPWAInstallCapture();

createRoot(document.getElementById('root')!).render(<App />);

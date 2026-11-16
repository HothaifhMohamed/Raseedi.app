import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initAppAutoUpdate } from './services/appUpdate';

initAppAutoUpdate();

createRoot(document.getElementById('root')!).render(<App />);

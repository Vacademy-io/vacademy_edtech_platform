// Vacademy Classroom entry. polyfills MUST stay the first import.
import './polyfills';
import '@/index.css';
import './panel.css';
import { boot } from './boot';

// No top-level await anywhere in the panel graph (esbuild fails chrome66 builds on it).
if (!window.__PANEL_UNSUPPORTED__) {
    boot();
}

/**
 * Entry for the Classroom phone page. The fragment comes off the URL first, before
 * React starts and before any request goes out.
 */
import { createRoot } from 'react-dom/client';
import { initRoute } from './lib/route';
import { App } from './App';
import './phone.css';

initRoute();

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);

/**
 * pdf.js 3.11 LEGACY worker, bundled locally (never PDF_WORKER_URL / unpkg).
 *
 * Imported as `./pdf.worker.ts?worker&url`, so Vite emits it as its own CLASSIC
 * iife worker (worker.format 'iife': Chrome 66 has no module workers), lowered
 * to chrome66. Workers get no page polyfills: ./pdfWorker/init installs the
 * few the legacy worker needs (globalThis, Array#at, replaceAll, flat, …) and
 * MUST stay the first import (owner decision 3). The worker banner in
 * vite.panel.config.ts shims globalThis as well.
 */
import './pdfWorker/init';
import 'pdfjs-dist/legacy/build/pdf.worker.js';

# App Size Diet — September 12, 2026

The Android bundle had grown to ~50 MB (.aab) / ~93 MB unpacked, and `dist/` to 64 MB. Almost
none of it was JavaScript: the raw `dist/` was 29 MB of JS and **35 MB of fonts + images**, most of
it never rendered on any device.

## What changed

| Item | Before | After | How |
|------|-------:|------:|-----|
| `@flaticon/flaticon-uicons` fonts + CSS | 13.2 MB fonts + 1.1 MB CSS | 0 | Imported in `src/index.css` for "play mode" in March; **not one `fi-*` class exists in either app**. Import and dependency removed. |
| `public/badge-library` (35 PNGs) | 9.3 MB | 1.4 MB | 512 px PNGs → WebP q90 (`badge-library.ts` in **both** apps now points at `.webp`; tokens in the DB are unchanged). |
| Brand logos / splashes in `public/` | 6.3 MB | 0.7 MB | `ssdc-logo.png` was 4096², SN logos 4167²; capped at 1024 px, quantized, same filenames. `banner`/`yoga-dashboard`/`meditation` → WebP (refs updated). |
| Font fallback formats (KaTeX ×20, Symbola) | eot 7.5 MB, woff 4 MB, ttf 0.9 MB, svg 0.8 MB | woff2 only, 0.6 MB | `prune-font-fallbacks` plugin in `vite.config.ts`: rewrites every `@font-face` src to its woff2 entry and drops the orphaned files (44 files, 2.5 MB after uicons was already gone). Every target (Android WebView, WKWebView, Electron, all browsers we support) selects woff2 first. |
| **`dist/` total** | **64 MB** | **34 MB** | gzip-equivalent (what Play/App Store compression sees): ~32 MB → **11.8 MB** |

Also in this pass: `@vitejs/plugin-react` → `@vitejs/plugin-react-swc` (same output, faster
transform), and an opt-in `ANALYZE=1 pnpm build` chunk report (`dist/chunk-report.txt`, no
dependency) so the next person can see what a chunk actually carries.

## What is left (all JavaScript, 28.8 MB raw ≈ 7.5 MB compressed)

| Chunk | Raw | What it is | Call |
|-------|----:|------------|------|
| `index` | 7.0 MB | the app itself (2,712 modules) + html2canvas/jspdf (0.75 MB), sweetalert2, docx-preview, country data, SVGs compiled to components | code-splitting would speed first load, not shrink the app |
| `mermaid` | 4.6 MB | mermaid 11 + elkjs (1.6 MB) + cytoscape (1.1 MB) for doc-slide diagrams | **product call:** the AI video player already loads mermaid from jsdelivr at runtime (`library-loader.ts`); doing the same in `MermaidDiagram.tsx` removes 4.6 MB but makes diagrams need network |
| `@spatius/avatarkit` | 8.5 MB total (2.6 MB SDK incl. an 0.8 MB OpenTelemetry bundle, 1.3 MB core JS, 1 MB wasm, 3.6 MB Opus workers) | premium teacher avatar | **product call:** largest single feature by weight |
| `excalidraw` | 3.8 MB | incl. ~1.5 MB of its own locale files | needed for presentation slides |
| `phosphor-icons` | 0.7 MB | **all 4,541 icons** because badges resolve Phosphor icons by name from the DB | curating an allow-list would cut ~0.6 MB |

## Native side (not changed — needs a device test first)

- `android/app/build.gradle` has `minifyEnabled false`. R8 with `shrinkResources true` typically
  halves the 15.5 MB of dex. Capacitor 7 core and `@capgo/capacitor-updater` ship consumer
  ProGuard rules; `@capacitor-community/sqlite` (SQLCipher JNI), `secure-storage`,
  `privacy-screen`, `firebase-messaging`, `app-update` do not, so enable it only with an
  emulator/device pass over login, offline media, push and the OTA updater.
- `lib/` is 19 MB across 4 ABIs (libsqlcipher). Play splits per ABI, so a phone downloads ~5 MB
  of it; only the side-loaded `.apk` builds carry all four.

---

# Build & Loading Time Optimization Report

**Generated:** December 16, 2025

## Summary of Changes Made

### ✅ Completed Optimizations

#### 1. **Vite Configuration Overhaul** (`vite.config.ts`)
- Implemented intelligent code splitting with `manualChunks`
- Separate chunks for React core, Router, UI libraries, Firebase, Charts, etc.
- Added Terser minification with console removal in production
- Better vendor chunking strategy

#### 2. **Deferred Service Initialization** (`main.tsx`)
- Sentry error tracking now initializes via `requestIdleCallback`
- Analytics initialization deferred until after first paint
- Lazy-loaded NotificationInitializer component
- React Query optimized with better caching defaults

#### 3. **Lazy-Loaded Heavy Components**
- ExcalidrawViewer (3.7MB) now lazy-loaded with Suspense
- NotificationInitializer extracted and lazy-loaded
- Firebase push notifications deferred

---

## Bundle Size Analysis

### Before Optimization
| Chunk | Size | Gzip |
|-------|------|------|
| index.js (monolithic) | **8.3 MB** | 2.17 MB |

### After Optimization - Initial Load
| Chunk | Size | Gzip | Purpose |
|-------|------|------|---------|
| react-core | 180 KB | 57 KB | React & ReactDOM |
| router | 60 KB | 17 KB | TanStack Router |
| ui-radix | 148 KB | 42 KB | UI Components |
| icons | 168 KB | 39 KB | Icon Libraries |
| animations | 176 KB | 61 KB | Framer Motion, GSAP |
| index.js | 2.1 MB | 545 KB | App Code |
| **Total Initial** | ~2.8 MB | ~761 KB | |

### After Optimization - Lazy Loaded (On Demand)
| Chunk | Size | Gzip | When Loaded |
|-------|------|------|-------------|
| excalidraw | 3.7 MB | 1.3 MB | Presentation slides |
| vendor-other | 5.6 MB | 1.5 MB | Various features |
| pdf-viewer | 216 KB | 52 KB | PDF viewing |
| charts | 280 KB | 60 KB | Dashboard charts |
| katex | 264 KB | 75 KB | Math rendering |
| quill-editor | 260 KB | 75 KB | Rich text |
| firebase | 88 KB | 16 KB | Push notifications |
| sentry | 204 KB | 64 KB | Error tracking |

### Initial Load Reduction
- **Before:** ~8.3 MB (gzip: 2.17 MB)
- **After:** ~2.8 MB (gzip: ~761 KB)
- **Improvement:** ~65% reduction in initial bundle size

---

## 🔴 Remaining Issues & Recommendations

### High Priority

#### 1. ✅ **Icon Library Migration** (COMPLETED)
Migrated from deprecated `phosphor-react` (58MB) to `@phosphor-icons/react`:
- **46 files updated** with new import path
- **~205 KB saved** in vendor bundle (gzip: ~63 KB)
- Removed deprecated package from dependencies

```bash
# Migration was done automatically:
# All imports changed from:
# import { Icon } from "phosphor-react"
# To:
# import { Icon } from "@phosphor-icons/react"
```

#### 2. **vendor-other Chunk Still Large** (5.6MB)
This chunk contains miscellaneous vendor code that should be split further. Consider:
- Lazy-loading PDF viewer components
- Lazy-loading Quill editor
- Lazy-loading video.js player

#### 3. **Excalidraw Optimization** (3.7MB chunk)
While now lazy-loaded, Excalidraw is still very large:
- Consider using Excalidraw's web component version
- Or creating a lighter custom implementation for view-only mode

### Medium Priority

#### 4. **Route-Based Code Splitting**
TanStack Router supports lazy loading routes. Consider lazy-loading less-used routes:
```typescript
// Example: Lazy load admin/settings routes
const AssessmentRoute = lazy(() => import('./routes/assessment'))
```

#### 5. **Image Optimization**
Found large images in `dist/`:
- `ssdc-logo.png` - 2.2MB (should be compressed)
- `meditation.png` - 781KB 
- Consider using WebP format with fallbacks

#### 6. **Font Subsetting**
Multiple font weights being loaded:
- KaTeX fonts (many variants)
- Symbola font (403KB)
- Consider subsetting to only used characters

---

## Development Commands

```bash
# Build with bundle analysis
pnpm run build

# Clear cache and rebuild
pnpm run clear-cache && pnpm run build

# Development with faster HMR
pnpm run dev
```

---

## Performance Testing Checklist

- [ ] Test initial page load time in browser DevTools
- [ ] Check Network tab for bundle chunk loading
- [ ] Verify lazy components load only when needed
- [ ] Test on slow 3G network throttling
- [ ] Run Lighthouse performance audit

---

## Files Modified

1. `vite.config.ts` - Complete rewrite with optimization focus
2. `src/main.tsx` - Deferred initialization, lazy loading
3. `src/components/lazy/NotificationInitializer.tsx` - New file
4. `src/components/.../presentation-viewer.tsx` - Lazy ExcalidrawViewer

# Cloudflare Pages Build Configuration

## Overview
This document explains the configuration needed to successfully build this application on Cloudflare Pages.

## Memory Issues Fix

The application was experiencing "JavaScript heap out of memory" errors during build on Cloudflare Pages. The following changes have been implemented to fix this:

### 1. Updated Build Script
The `package.json` build script is `build:tsc && build:vite`, run serially.

Since 2026-09-12 `build:tsc` runs **TypeScript 7's native compiler** (installed as the
`typescript-native` alias so `typescript@5.6` stays in place for ESLint, Vite and the IDE):
```bash
node node_modules/typescript-native/lib/tsc.js -p tsconfig.json   # build:tsc
cross-env NODE_OPTIONS=--max-old-space-size=8192 vite build         # build:vite
```
The native compiler needs no `--max-old-space-size` and uses roughly a quarter of the CPU time
of `tsc` 5.x on this codebase (13k files). `build:tsc:legacy` keeps the old TS 5.6 command.
Note that TS 7 removed `baseUrl`; `tsconfig.json` relies on `paths` alone.

### 2. Build Optimizations in vite.config.ts
- Changed minifier from `terser` to `esbuild` (faster, less memory-intensive)
- Disabled sourcemaps in production builds
- Disabled compressed size reporting
- Limited parallel file operations to 2 (reduces memory usage)

### 3. Node Version
Created `.node-version` and `.nvmrc` files to ensure consistent Node.js version (18.20.0)

## Cloudflare Pages Settings

### Build Configuration
Set the following in your Cloudflare Pages project settings:

**Framework preset:** None (or Vite)

**Build command:**
```bash
npm install -g pnpm && pnpm install && pnpm run build
```

**Build output directory:**
```
dist
```

### Environment Variables (Optional)
If the build still fails, you can add these environment variables in Cloudflare Pages dashboard:

1. Go to your Cloudflare Pages project
2. Navigate to Settings → Environment Variables
3. Add the following:

| Variable | Value | Scope |
|----------|-------|-------|
| `NODE_OPTIONS` | `--max-old-space-size=8192` | Production & Preview |
| `NODE_VERSION` | `18.20.0` | Production & Preview |

### Alternative: Use Cloudflare Workers Sites Build

If the issue persists, consider these alternatives:

1. **Split the build process:**
   - Build locally or in a CI/CD pipeline with higher memory limits
   - Deploy the pre-built `dist` folder to Cloudflare Pages

2. **Optimize dependencies:**
   - Review and remove unused dependencies
   - Consider lazy-loading heavy components (Excalidraw, PDF tools, etc.)

3. **Upgrade Cloudflare Pages plan:**
   - Cloudflare Pages Pro/Business plans may have higher build resource limits

## Testing Locally

To test if the build works with the new configuration:

```bash
# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Run build
pnpm run build
```

## Troubleshooting

### If build still fails:

1. **Check Cloudflare Pages build logs** for specific errors
2. **Verify Node version** in Cloudflare build logs matches 18.20.0
3. **Check if NODE_OPTIONS is applied** - look for memory limit in build logs
4. **Consider reducing chunk sizes** - review `manualChunks` in vite.config.ts
5. **Remove unnecessary assets** - check for large files in public directory

### Warning about Excalidraw
The build logs showed a warning about Excalidraw's `percentages.json` being both dynamically and statically imported. This is not causing the memory issue but can be optimized if needed.

## Additional Resources

- [Cloudflare Pages Build Configuration](https://developers.cloudflare.com/pages/platform/build-configuration/)
- [Node.js Memory Management](https://nodejs.org/api/cli.html#cli_max_old_space_size_size_in_megabytes)
- [Vite Build Optimizations](https://vitejs.dev/guide/build.html)


#!/usr/bin/env node
/**
 * Fails the build if the packaged app.asar is missing any module the main
 * process requires at runtime.
 *
 * Why this exists: electron-builder 23.6.0 cannot read pnpm's symlinked
 * node_modules. It packs the top-level entries and silently DROPS every
 * transitive dependency, exiting 0 with a perfectly normal-looking build. The
 * app then dies on its first require with
 *
 *     Error: Cannot find module 'clean-stack'
 *     Require stack: .../app.asar/node_modules/electron-unhandled/index.js
 *
 * which is what shipped to the Mac App Store as ZOE. The .npmrc in
 * this directory pins node-linker=hoisted so the layout is real directories;
 * this check is the belt to that suspenders — it walks the require() graph
 * inside the built asar and resolves every specifier for real.
 *
 * Usage: node verify-asar-deps.js <path-to-app.asar | path-to-.app>
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');
const { execFileSync } = require('child_process');

const RED = '\x1b[0;31m', GREEN = '\x1b[0;32m', YELLOW = '\x1b[1;33m', NC = '\x1b[0m';

let target = process.argv[2];
if (!target) {
    console.error('usage: node verify-asar-deps.js <app.asar | Foo.app>');
    process.exit(2);
}
if (target.endsWith('.app')) target = path.join(target, 'Contents/Resources/app.asar');
if (!fs.existsSync(target)) {
    console.error(`${RED}✖ no asar at ${target}${NC}`);
    process.exit(2);
}

// realpath: on macOS os.tmpdir() is /var/... which resolves to /private/var/...,
// and the mismatch turns every relative path below into ../../../.. noise.
const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'asar-verify-')));
try {
    execFileSync('npx', ['--yes', '@electron/asar', 'extract', target, workDir], { stdio: 'pipe' });
} catch (error) {
    console.error(`${RED}✖ could not extract ${target}${NC}\n${error.message}`);
    process.exit(2);
}

const entry = path.join(workDir, 'build/src/index.js');
if (!fs.existsSync(entry)) {
    console.error(`${RED}✖ asar has no build/src/index.js — the main process was not packaged${NC}`);
    process.exit(1);
}

// "electron" is provided by the runtime, not by node_modules.
const PROVIDED = new Set(Module.builtinModules.concat(['electron']));
const walked = new Set();
const unresolved = new Map();

function walk(file) {
    if (walked.has(file)) return;
    walked.add(file);

    let source;
    try {
        source = fs.readFileSync(file, 'utf8');
    } catch {
        return;
    }

    const require_ = Module.createRequire(file);
    for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = match[1];
        if (PROVIDED.has(spec) || spec.startsWith('node:')) continue;

        let resolved;
        try {
            resolved = require_.resolve(spec);
        } catch {
            const from = path.relative(workDir, file);
            if (!unresolved.has(spec)) unresolved.set(spec, from);
            continue;
        }
        if (path.isAbsolute(resolved) && /\.(js|cjs)$/.test(resolved)) walk(resolved);
    }
}

walk(entry);

const packages = fs.existsSync(path.join(workDir, 'node_modules'))
    ? fs.readdirSync(path.join(workDir, 'node_modules')).filter((f) => !f.startsWith('.')).length
    : 0;

console.log(`   walked ${walked.size} main-process files across ${packages} packaged modules`);

if (unresolved.size === 0) {
    console.log(`${GREEN}   ✅ every require() in the packaged main process resolves${NC}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    process.exit(0);
}

console.error(`${RED}   ✖ ${unresolved.size} module(s) are required but NOT packaged:${NC}`);
for (const [spec, from] of unresolved) {
    console.error(`${RED}       ${spec}${NC}  ${YELLOW}(required by ${from})${NC}`);
}
console.error('');
console.error(`${YELLOW}   This app would crash on launch with "Cannot find module '${[...unresolved.keys()][0]}'".${NC}`);
console.error(`${YELLOW}   Cause: electron-builder cannot follow pnpm symlinks. Fix:${NC}`);
console.error(`${YELLOW}       cd electron && rm -rf node_modules && pnpm install   # .npmrc pins node-linker=hoisted${NC}`);
fs.rmSync(workDir, { recursive: true, force: true });
process.exit(1);

/**
 * Regenerate src/routeTree.gen.ts without running a full Vite build.
 *
 * Route ids are TYPED from the generated tree, so a brand-new route file makes
 * `tsc` fail ("/erp/payroll/ is not assignable to …") until the tree is
 * regenerated. `vite dev` / `vite build` do it via TanStackRouterVite, but a
 * typecheck-only loop (agents, CI pre-checks, `pnpm typecheck`) has no reason to
 * pay for a bundle — hence this script.
 *
 * Usage: pnpm gen:routes   (then pnpm typecheck)
 *
 * Config comes from tsr.config.json, so this always matches what the plugin does.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// router-generator is a TRANSITIVE dep of router-plugin, and pnpm does not hoist
// it to the app's node_modules root — so resolve it from the plugin's own
// directory rather than the app's (where it simply isn't visible).
const pluginEntry = require.resolve('@tanstack/router-plugin', { paths: [appRoot] });
const generatorEntry = require.resolve('@tanstack/router-generator', {
    paths: [path.dirname(pluginEntry)],
});
const { Generator, getConfig } = await import(`file://${generatorEntry}`);

const config = await getConfig({}, appRoot);
await new Generator({ config, root: appRoot }).run();

console.log('✓ src/routeTree.gen.ts regenerated');

// Builds the standalone lead-form page (vite.audience-form.config.ts) into
// dist/, after the main build. It is the "postbuild" script rather than part
// of "build" so that `npm run build -- --mode x` still hands its arguments to
// the main build.
//
// Runs on Cloudflare Pages only (CF_PAGES is set there), because nothing else
// serves it: functions/_middleware.ts is what routes /audience-response to it,
// so the Electron, Capacitor and OTA bundles would only carry dead weight.
//
// Never fails the deploy. Without the page the middleware serves the full app,
// which is exactly how the form loaded before this existed.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.CF_PAGES && !process.env.BUILD_AUDIENCE_FORM) {
    console.log("[audience-form] not a Cloudflare Pages build; skipped (set BUILD_AUDIENCE_FORM=1 to force)");
    process.exit(0);
}

const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=4096", "node_modules/vite/bin/vite.js", "build", "-c", "vite.audience-form.config.ts"],
    { cwd: appRoot, stdio: "inherit" }
);

if (result.status !== 0) {
    console.warn("[audience-form] build failed; /audience-response will keep serving the full app");
}
process.exit(0);

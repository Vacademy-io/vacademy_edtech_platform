// Bundles the plugin into ../../plugins/vacademy-activeness/, which is what gets
// copied to /var/www/bigbluebutton-default/assets/plugins/ on each BBB server.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../plugins/vacademy-activeness");
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(here, "src/index.tsx")],
  outfile: resolve(out, "VacademyActiveness.js"),
  bundle: true,
  format: "iife",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  jsx: "automatic",
  // Chrome/Edge are ~85% of live-class learners; keep older Safari/Firefox working too.
  target: ["chrome100", "edge100", "firefox100", "safari15"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

// Relative entrypoint keeps the manifest valid on every pool server and custom domain.
// "version" makes BBB append ?version=… to the script URL, so browsers drop a stale copy.
const manifest = {
  requiredSdkVersion: "~0.0.96",
  name: "VacademyActiveness",
  version: pkg.version,
  javascriptEntrypointUrl: "VacademyActiveness.js",
};
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json written (version ${pkg.version})`);

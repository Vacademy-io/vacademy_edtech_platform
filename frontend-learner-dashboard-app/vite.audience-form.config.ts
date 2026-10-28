// vite.audience-form.config.ts
//
// Second, independent build for the public lead form: dist/audience-form.html
// + its own small set of assets, written next to the main app's output. See
// src/audience-form-entry.tsx for why, and functions/_middleware.ts for where
// it is served. The main build (vite.config.ts) is not changed by this file.
//
// Runs after the main build (package.json "postbuild"), so it must not empty
// dist/ or copy public/ again.
import path from "path";
import { readFileSync } from "fs";
import { mergeConfig, type Plugin, type PluginOption, type UserConfig } from "vite";
import base from "./vite.config";

// Not needed for one page: the router generator (no routeTree is used) and the
// avatar wasm copy. The main build already did both.
const SKIPPED_PLUGINS = /^(tanstack|avatarkit)/;

/**
 * audience-form.html is a stub; its real markup is index.html with the main
 * entry swapped for the form entry. Deriving it keeps the branding, boot
 * splash and stale-chunk recovery scripts identical to the app's without a
 * second copy to drift. The payment SDKs (jQuery for MathQuill, eWay) are
 * dropped — the form uses neither. A missing marker fails the build rather
 * than shipping a page that would boot the whole app.
 */
const deriveFromIndexHtml = (): Plugin => ({
    name: "audience-form-html",
    transformIndexHtml: {
        order: "pre",
        handler() {
            let html = readFileSync(path.resolve(__dirname, "index.html"), "utf8");
            const swap = (from: string, to: string) => {
                if (!html.includes(from)) {
                    throw new Error(`[audience-form-html] index.html no longer contains: ${from}`);
                }
                html = html.replace(from, to);
            };
            swap(`<script type="module" src="/src/main.tsx"></script>`, `<script type="module" src="/src/audience-form-entry.tsx"></script>`);
            swap(`<script src="/vendor/jquery.min.js"></script>`, "");
            swap(`<script src="https://secure.ewaypayments.com/scripts/eCrypt.min.js"></script>`, "");
            // An embedded form is never installed as an app; skip the per-host
            // manifest lookup the middleware would do for it.
            html = html.replace(`<link rel="manifest" href="/manifest.webmanifest" />`, "");
            // functions/_middleware.ts checks for this before serving the page.
            swap(`<head>`, `<head>\n    <meta name="vacademy-entry" content="audience-form" />`);
            return html;
        },
    },
});

const basePlugins = ((base.plugins ?? []) as PluginOption[])
    .flat(Infinity as 1)
    .filter((p): p is Plugin => !!p && typeof p === "object" && "name" in p && !SKIPPED_PLUGINS.test(p.name));

// mergeConfig concatenates plugin arrays, so start from an empty list.
export default mergeConfig({ ...(base as UserConfig), plugins: [] }, {
    plugins: [...basePlugins, deriveFromIndexHtml()],
    publicDir: false,
    build: {
        emptyOutDir: false,
        rollupOptions: {
            input: path.resolve(__dirname, "audience-form.html"),
        },
    },
} satisfies UserConfig);

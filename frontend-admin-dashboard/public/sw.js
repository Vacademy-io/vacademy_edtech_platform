// Service-worker kill switch.
//
// An earlier build of this app (vite-plugin-pwa era — the VitePWA block in
// vite.config.ts is now commented out) shipped a Workbox worker at this URL
// with an index.html precache + navigation fallback. Browsers that installed
// it keep serving that ancient index.html for every navigation, network
// unconsulted — users stay pinned to a bundle whose lazy chunks no longer
// exist (symptom: raw i18n keys, stale UI, reload doesn't help).
//
// Worse, once this path stopped being a real file the SPA fallback answered
// it with HTML 200, which browsers treat as a FAILED update — so the old
// worker could never be replaced. This file turns that failed update into a
// successful one that immediately unregisters itself and reloads its tabs.
//
// Keep this file deployed indefinitely: any long-dormant browser that comes
// back must still hit it. (/sw.js and /service-worker.js are excluded in
// public/_routes.json so they are served as real JS, not swallowed by the
// SPA function — without that exclusion this fix cannot reach anyone.)
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        self.registration
            .unregister()
            .then(() => self.clients.matchAll({ type: 'window' }))
            .then((clients) => {
                clients.forEach((client) => client.navigate(client.url));
            })
            .catch(() => {})
    );
});

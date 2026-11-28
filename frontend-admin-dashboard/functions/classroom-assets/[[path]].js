// The same uncacheable 404 for a missing /classroom-assets/* file as
// functions/assets/[[path]].js gives /assets/*: the phone page (classroom.html) is one
// JS and one CSS file, so the SPA fallback cached under its .js URL would leave the
// page on its spinner until that entry expired.
//
// Requires /classroom-assets/* NOT to be listed in public/_routes.json "exclude".

export { onRequest } from '../assets/[[path]].js';

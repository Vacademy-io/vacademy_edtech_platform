// Vacademy Lead Agent: pairing bridge for the Vacademy dashboard.
//
// The dashboard posts {type: "VACADEMY_LEAD_AGENT_PAIR", token, apiBase} with window.postMessage; this script
// forwards exactly that to the extension and posts the answer back. It does not read the page, and it forwards
// nothing else. It is also how the dashboard can tell the extension is installed (PING -> PRESENT).
// The background re-checks the page origin and the API address; the checks here only fail fast.
(() => {
  const PAIR = 'VACADEMY_LEAD_AGENT_PAIR';
  const PAIRED = 'VACADEMY_LEAD_AGENT_PAIRED';
  const PING = 'VACADEMY_LEAD_AGENT_PING';
  const PRESENT = 'VACADEMY_LEAD_AGENT_PRESENT';
  const PAIR_PAGE_HOSTS = ['dash.vacademy.io']; // keep in sync with lib.js

  const host = location.hostname.toLowerCase();
  const pageAllowed =
    (location.protocol === 'http:' && host === 'localhost') ||
    (location.protocol === 'https:' && PAIR_PAGE_HOSTS.includes(host));
  if (!pageAllowed) return;

  function validApiBase(value) {
    if (value === undefined || value === null || value === '') return true; // extension default
    if (typeof value !== 'string') return false;
    try {
      const u = new URL(value);
      if (u.username || u.password || u.search || u.hash) return false;
      const h = u.hostname.toLowerCase();
      if (u.protocol === 'https:') return h === 'vacademy.io' || h.endsWith('.vacademy.io');
      return u.protocol === 'http:' && h === 'localhost';
    } catch {
      return false;
    }
  }

  const reply = (body) => window.postMessage({ type: PAIRED, ...body }, location.origin);
  const announce = () => window.postMessage({ type: PRESENT, version: chrome.runtime.getManifest().version }, location.origin);

  let busy = false;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === PING) {
      announce();
      return;
    }
    if (data.type !== PAIR) return;

    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!token) return reply({ ok: false, institute_name: null, error: 'Missing pairing code.' });
    if (!validApiBase(data.apiBase)) return reply({ ok: false, institute_name: null, error: 'API address not allowed.' });
    if (busy) return reply({ ok: false, institute_name: null, error: 'Already connecting, please wait.' });

    busy = true;
    chrome.runtime
      .sendMessage({ type: 'PAIR', token, apiBase: data.apiBase || '' })
      .then((res) =>
        reply({
          ok: !!(res && res.ok),
          institute_name: (res && res.institute_name) || null,
          user_name: (res && res.user_name) || null,
          needs_site_access: !!(res && res.needs_site_access),
          error: (res && res.error) || null,
        }),
      )
      .catch(() => reply({ ok: false, institute_name: null, error: 'The extension could not be reached. Reload the page and try again.' }))
      .finally(() => {
        busy = false;
      });
  });

  announce();
})();

import { DEFAULT_API_BASE } from './lib.js';

const $ = (id) => document.getElementById(id);
const views = { connect: $('view-connect'), access: $('view-access'), connected: $('view-connected') };
let disconnectArmed = false;

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
}

function setNote(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${Math.max(0, s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ts).toLocaleString();
}

function fillWho(st) {
  for (const el of document.querySelectorAll('.institute')) el.textContent = st.instituteName || 'Connected';
  for (const el of document.querySelectorAll('.user')) el.textContent = st.userName ? `as ${st.userName}` : '';
}

function render(st) {
  if (!st || st.ok === false) return;
  $('version').textContent = `v${st.version}`;
  if (!st.connected) {
    show('connect');
    const d = st.disconnected;
    setNote(
      $('disconnected-note'),
      d ? `Disconnected${d.instituteName ? ` from ${d.instituteName}` : ''}: the dashboard revoked this browser. Create a new code to reconnect.` : '',
    );
    if (!$('api-base').value) $('api-base').value = st.apiBase || DEFAULT_API_BASE;
    return;
  }
  fillWho(st);
  if (!st.siteAccess) {
    show('access');
    return;
  }
  show('connected');

  const pill = $('state-pill');
  let label = 'Running';
  let cls = 'running';
  if (st.paused) [label, cls] = ['Paused', 'paused'];
  else if (st.backoffUntil) [label, cls] = ['Waiting after errors', 'problem'];
  else if (st.capReached) [label, cls] = ['Daily limit reached', 'paused'];
  else if (st.serverPaused) [label, cls] = ['Paused in dashboard', 'paused'];
  else if (st.running) [label, cls] = ['Reading pages…', 'running'];
  pill.textContent = label;
  pill.className = `pill ${cls}`;
  $('toggle').textContent = st.paused ? 'Resume' : 'Pause';

  $('server-paused').hidden = !(st.serverPaused && !st.paused);
  setNote(
    $('backoff'),
    st.backoffUntil ? `Several calls to Vacademy failed. Trying again at ${new Date(st.backoffUntil).toLocaleTimeString()}.` : '',
  );
  $('pages').textContent = `${st.stats.pages} / ${st.cap}`;
  $('failed').textContent = String(st.stats.errors);
  $('last-run').textContent = ago(st.stats.lastRunAt);
  $('last-error').textContent = st.stats.lastError ? `${st.stats.lastError} (${ago(st.stats.lastErrorAt)})` : 'none';
  $('cap').textContent = String(st.cap);
  $('run-now').disabled = st.paused || !!st.running;
}

async function refresh() {
  try {
    render(await send('STATUS'));
  } catch {
    /* service worker starting */
  }
}

$('connect').addEventListener('click', async () => {
  const btn = $('connect');
  setNote($('connect-error'), '');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    const res = await send('PAIR', { token: $('code').value.trim(), apiBase: $('api-base').value.trim() });
    if (!res || !res.ok) setNote($('connect-error'), (res && res.error) || 'Could not connect.');
    else $('code').value = '';
  } catch (e) {
    setNote($('connect-error'), String(e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
    refresh();
  }
});

// chrome.permissions.request must run directly in the click handler (user gesture): no await before it.
$('allow').addEventListener('click', () => {
  setNote($('access-error'), '');
  chrome.permissions
    .request({ origins: ['<all_urls>'] })
    .then((granted) => {
      if (!granted) setNote($('access-error'), 'Permission was not given. The extension cannot read websites without it.');
      refresh();
    })
    .catch((e) => setNote($('access-error'), String(e.message || e)));
});

$('toggle').addEventListener('click', async () => {
  const st = await send('STATUS');
  render(await send(st.paused ? 'RESUME' : 'PAUSE'));
});

$('run-now').addEventListener('click', async () => {
  render(await send('RUN_NOW'));
});

function onDisconnect(btn) {
  if (!disconnectArmed) {
    disconnectArmed = true;
    btn.textContent = 'Click again to disconnect';
    setTimeout(() => {
      disconnectArmed = false;
      btn.textContent = 'Disconnect';
    }, 4000);
    return;
  }
  disconnectArmed = false;
  btn.textContent = 'Disconnect';
  send('DISCONNECT').then(render);
}
$('disconnect').addEventListener('click', (e) => onDisconnect(e.currentTarget));
$('disconnect-2').addEventListener('click', (e) => onDisconnect(e.currentTarget));

refresh();
setInterval(refresh, 2000);

// Static checks: the manifest parses, files exist, and every chrome.* API the code calls is covered by
// the declared permissions. (Chrome itself cannot run here.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

// chrome namespace -> what the manifest must declare (null = no permission needed)
const NAMESPACE_NEEDS = {
  runtime: null,
  storage: 'storage',
  alarms: 'alarms',
  scripting: 'scripting',
  tabs: null, // create/get/update/remove/onUpdated/onRemoved need no permission; only url/title/favIconUrl do
  windows: null,
  permissions: null, // request/contains of optional permissions
  action: 'manifest.action',
};

// Tab fields that need the "tabs" permission. We must never read them.
const TABS_ONLY_FIELDS = /\b(?:tab|info|changeInfo)\.(?:url|title|favIconUrl|pendingUrl)\b/;

function chromeNamespaces(src) {
  const out = new Set();
  for (const m of src.matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) out.add(m[1]);
  return out;
}

test('manifest is MV3 with a module service worker, popup, icons and content script', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Vacademy Lead Agent');
  assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(manifest.background, { service_worker: 'background.js', type: 'module' });
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.host_permissions, ['https://*.vacademy.io/*', 'http://localhost/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['<all_urls>']);
  assert.ok(!manifest.permissions.includes('tabs'), 'tabs permission is not needed');
  assert.ok(!manifest.permissions.includes('cookies'));
  assert.ok(!manifest.permissions.includes('webRequest'));
  const cs = manifest.content_scripts;
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].js, ['content-pair.js']);
  assert.deepEqual(cs[0].matches, ['https://*.vacademy.io/*', 'http://localhost/*']);
  assert.ok(manifest.description.length <= 132, 'Chrome Web Store limit');
});

test('every referenced file exists; icons are PNGs of the declared size', () => {
  const files = ['background.js', 'lib.js', 'content-pair.js', 'popup.html', 'popup.js', 'popup.css'];
  for (const f of files) assert.ok(existsSync(join(root, f)), f);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const buf = readFileSync(join(root, path));
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', path);
    assert.equal(buf.readUInt32BE(16), Number(size), `${path} width`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${path} height`);
  }
});

test('every chrome.* namespace used is covered by declared permissions', () => {
  const perms = new Set(manifest.permissions);
  for (const f of ['background.js', 'popup.js', 'content-pair.js']) {
    for (const ns of chromeNamespaces(read(f))) {
      assert.ok(ns in NAMESPACE_NEEDS, `${f} uses chrome.${ns}, which this check does not know: add it`);
      const need = NAMESPACE_NEEDS[ns];
      if (need === 'manifest.action') assert.ok(manifest.action, `${f}: chrome.action needs "action" in the manifest`);
      else if (need) assert.ok(perms.has(need), `${f}: chrome.${ns} needs the "${need}" permission`);
    }
  }
});

test('the content script only talks to the runtime (no storage, tabs, or page reading)', () => {
  const src = read('content-pair.js');
  assert.deepEqual([...chromeNamespaces(src)].sort(), ['runtime']);
  assert.ok(!/document\.(?:body|documentElement|cookie|querySelector|getElement)/.test(src), 'must not read the page');
  assert.ok(!/localStorage|sessionStorage/.test(src));
  assert.match(src, /event\.source !== window/);
  assert.match(src, /event\.origin !== location\.origin/);
});

test('the code never reads tab fields that would need the "tabs" permission', () => {
  for (const f of ['background.js', 'popup.js']) assert.ok(!TABS_ONLY_FIELDS.test(read(f)), f);
});

test('scripting is only used on tabs the extension created', () => {
  const src = read('background.js');
  const calls = [...src.matchAll(/chrome\.scripting\.executeScript\(\{\s*target:\s*\{\s*tabId\s*\}/g)];
  assert.equal(calls.length, 1);
  assert.equal((src.match(/chrome\.scripting\./g) || []).length, 1);
  assert.ok(!/chrome\.tabs\.query/.test(src), 'never enumerates the user\'s tabs');
});

test('normal fetches omit credentials; API calls send the token header', () => {
  const src = read('background.js');
  const fetches = src.match(/await fetch\(/g) || [];
  const omits = src.match(/credentials: 'omit'/g) || [];
  assert.equal(fetches.length, 2);
  assert.equal(omits.length, 2);
  assert.match(src, /'X-Lead-Agent-Token': token/);
  for (const p of ['/ext/hello', '/ext/claim', '/ext/result']) assert.ok(src.includes(`'${p}'`), p);
});

test('popup has no remote resources and requests <all_urls> in the click handler', () => {
  const html = read('popup.html');
  assert.ok(!/(?:src|href)=["']https?:/i.test(html));
  const js = read('popup.js');
  const handler = js.slice(js.indexOf("$('allow').addEventListener"), js.indexOf("$('toggle').addEventListener"));
  assert.match(handler, /chrome\.permissions\s*\.request\(\{ origins: \['<all_urls>'\] \}\)/);
  assert.ok(!/await/.test(handler.split('chrome.permissions')[0]), 'nothing awaited before permissions.request');
});

test('content-script allow-list matches lib.js', async () => {
  const { PAIR_PAGE_HOSTS } = await import('../lib.js');
  const m = /const PAIR_PAGE_HOSTS = (\[[^\]]*\])/.exec(read('content-pair.js'));
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), PAIR_PAGE_HOSTS);
});

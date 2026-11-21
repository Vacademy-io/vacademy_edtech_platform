/**
 * Native side of "BBB live class inside the app" for the desktop shell.
 *
 * The class itself is a BigBlueButton meeting (https://meet.vacademy.io) shown in a
 * full-screen <iframe> by src/routes/study-library/live-class/classroom/index.tsx. The web
 * code only switches to in-app classes when `window.vacademyShell.liveClass.version >= 1`
 * exists (src/lib/live-class/native-live-class.ts), which preload.ts exposes. Shells
 * built before this file keep opening classes in the system browser — that is the
 * backward-compatibility rule, so never expose `liveClass` without these handlers.
 *
 * What this module adds:
 *   1. `live-class:enter` / `live-class:exit` IPC — keep the display awake and stop
 *      Chromium from throttling the page while a class runs (minimised / behind other
 *      windows). Idempotent, per window, cleaned up when the window goes away or reloads.
 *   2. A display-media handler so getDisplayMedia() (BBB screen share) works at all.
 *      Electron 26 rejects getDisplayMedia unless one is set. Electron 26 has no
 *      `useSystemPicker` (added in Electron 33), so we list sources with desktopCapturer
 *      and let the user pick in a small window.
 *
 * Permissions are deliberately NOT touched: there is no setPermissionRequestHandler /
 * setPermissionCheckHandler anywhere in the shell, and Electron then grants media,
 * fullscreen, clipboard, display-capture and notifications by default. Adding a handler
 * here would risk regressing the AI-assistant mic and everything else that works today.
 * Video picture-in-picture (BBB plugin -> HTMLVideoElement.requestPictureInPicture)
 * needs no permission in Electron and nothing in the shell disables it.
 */
import type { DesktopCapturerSource, WebContents } from 'electron';
import { BrowserWindow, desktopCapturer, dialog, ipcMain, powerSaveBlocker, session, systemPreferences } from 'electron';

/** What enterClass changed on one window, so exitClass can undo exactly that. */
interface ActiveClass {
  blockerId: number;
  cleanup: () => void;
}

const activeClasses = new Map<number, ActiveClass>();
let installed = false;

/** Frame origins allowed to start a screen share: the app itself and BBB servers. */
function isTrustedCaptureOrigin(origin: string, customScheme: string, isDev: boolean): boolean {
  if (!origin) return false;
  if (origin.startsWith(`${customScheme}:`)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && (u.hostname === 'meet.vacademy.io' || u.hostname.startsWith('meet.'))) {
      return true;
    }
    if (isDev && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  } catch {
    /* not a URL — e.g. "null" for an opaque origin */
  }
  return false;
}

function stopClass(webContentsId: number): void {
  const active = activeClasses.get(webContentsId);
  if (!active) return;
  activeClasses.delete(webContentsId);
  try {
    if (powerSaveBlocker.isStarted(active.blockerId)) powerSaveBlocker.stop(active.blockerId);
  } catch (e) {
    console.warn('[live-class] powerSaveBlocker.stop failed', e);
  }
  active.cleanup();
}

function startClass(contents: WebContents): void {
  if (activeClasses.has(contents.id)) return; // already in a class — enterClass is idempotent

  const blockerId = powerSaveBlocker.start('prevent-display-sleep');
  // Keep timers, rAF and media pipelines at full speed when the window is minimised,
  // occluded or behind other windows. Default for this window is `true` (setup.ts never
  // sets backgroundThrottling), so exitClass restores `true`.
  contents.setBackgroundThrottling(false);

  const id = contents.id;
  const onGone = () => stopClass(id);
  // A full reload / main-frame navigation unmounts the class without exitClass running.
  // `did-navigate` is main-frame only (frames use did-frame-navigate) and does not fire
  // for SPA route changes (did-navigate-in-page), so it only catches real reloads.
  const onNavigate = () => stopClass(id);
  contents.once('destroyed', onGone);
  contents.once('render-process-gone', onGone);
  contents.once('did-navigate', onNavigate);

  activeClasses.set(id, {
    blockerId,
    cleanup: () => {
      if (contents.isDestroyed()) return;
      contents.removeListener('destroyed', onGone);
      contents.removeListener('render-process-gone', onGone);
      contents.removeListener('did-navigate', onNavigate);
      contents.setBackgroundThrottling(true);
    },
  });

  // macOS: surface the system microphone prompt up front, as the class frame is about to
  // ask for it. Chromium would also prompt on getUserMedia; this just avoids a silent
  // failure path. Camera is NOT pre-asked — only when the learner turns it on in BBB.
  if (process.platform === 'darwin') {
    try {
      if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
        void systemPreferences.askForMediaAccess('microphone').catch(() => undefined);
      }
    } catch {
      /* never block entering the class */
    }
  }
}

/**
 * Small source picker. No preload, no node, sandboxed: the page reports the choice by
 * setting document.title to "pick:<index>" (read via page-title-updated), and closing the
 * window cancels. Resolves null on cancel.
 */
function pickSource(sources: DesktopCapturerSource[], parent: BrowserWindow | null): Promise<DesktopCapturerSource | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DesktopCapturerSource | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (!picker.isDestroyed()) picker.close();
    };

    const picker = new BrowserWindow({
      width: 720,
      height: 520,
      minWidth: 420,
      minHeight: 320,
      title: 'Share your screen',
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: !!parent && !parent.isDestroyed() && parent.isVisible(),
      show: false,
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: false,
      },
    });

    const items = sources.map((s, i) => ({
      i,
      name: s.name || (s.id.startsWith('screen:') ? `Screen ${i + 1}` : 'Window'),
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      // JPEG keeps the payload small even with dozens of open windows.
      thumb: s.thumbnail && !s.thumbnail.isEmpty() ? `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}` : '',
    }));

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Share your screen</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
  body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p { font-size: 12px; opacity: .7; margin: 0 0 12px; }
  h2 { font-size: 13px; margin: 16px 0 8px; opacity: .8; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  button.src { display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 2px solid transparent; border-radius: 8px;
    background: color-mix(in srgb, CanvasText 6%, Canvas); color: inherit; cursor: pointer; text-align: left; font: inherit; }
  button.src:hover, button.src:focus-visible { border-color: Highlight; outline: none; }
  .thumb { width: 100%; aspect-ratio: 16 / 10; object-fit: contain; background: black; border-radius: 4px; }
  .name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding-top: 12px; background: Canvas; }
  .bar button { padding: 6px 14px; border-radius: 6px; border: 1px solid color-mix(in srgb, CanvasText 25%, Canvas);
    background: Canvas; color: inherit; font: inherit; cursor: pointer; }
</style></head><body>
<h1>Choose what to share</h1>
<p>Everyone in the class will see it.</p>
<div id="screens"></div><div id="windows"></div>
<div class="bar"><button id="cancel">Cancel</button></div>
<script>
  window.renderSources = function (items) {
    function section(id, title, list) {
      if (!list.length) return;
      var host = document.getElementById(id);
      var h = document.createElement('h2'); h.textContent = title; host.appendChild(h);
      var grid = document.createElement('div'); grid.className = 'grid'; host.appendChild(grid);
      list.forEach(function (it) {
        var b = document.createElement('button'); b.className = 'src'; b.type = 'button';
        var img = document.createElement('img'); img.className = 'thumb'; img.alt = '';
        if (it.thumb) img.src = it.thumb;
        var n = document.createElement('span'); n.className = 'name'; n.textContent = it.name; n.title = it.name;
        b.appendChild(img); b.appendChild(n);
        b.addEventListener('click', function () { document.title = 'pick:' + it.i; });
        grid.appendChild(b);
      });
    }
    section('screens', 'Entire screen', items.filter(function (x) { return x.kind === 'screen'; }));
    section('windows', 'Window', items.filter(function (x) { return x.kind === 'window'; }));
    var first = document.querySelector('button.src'); if (first) first.focus();
  };
  document.getElementById('cancel').addEventListener('click', function () { document.title = 'cancel'; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.title = 'cancel'; });
</script></body></html>`;

    picker.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      if (title === 'cancel') return finish(null);
      const m = /^pick:(\d+)$/.exec(title);
      if (m) finish(sources[Number(m[1])] ?? null);
    });
    // The picker never navigates or opens anything.
    picker.webContents.on('will-navigate', (event) => event.preventDefault());
    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    picker.on('closed', () => finish(null));

    picker.webContents.once('did-finish-load', () => {
      picker.webContents
        .executeJavaScript(`window.renderSources(${JSON.stringify(items)})`)
        .then(() => {
          if (!picker.isDestroyed()) picker.show();
        })
        .catch(() => finish(null));
    });
    picker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => finish(null));
  });
}

async function chooseDisplaySource(): Promise<DesktopCapturerSource | null> {
  // macOS: screen sharing needs the Screen Recording privacy permission. When it is denied,
  // getSources still "works" but only returns the app's own windows with blank thumbnails.
  if (process.platform === 'darwin') {
    let status = 'unknown';
    try {
      status = systemPreferences.getMediaAccessStatus('screen');
    } catch {
      /* older macOS */
    }
    if (status === 'denied' || status === 'restricted') {
      const parent = BrowserWindow.getFocusedWindow();
      const opts = {
        type: 'info' as const,
        buttons: ['OK'],
        message: 'Screen sharing is turned off for this app',
        detail:
          'To share your screen in a live class, open System Settings > Privacy & Security > Screen Recording, ' +
          'turn this app on, then quit and reopen the app.',
      };
      if (parent) await dialog.showMessageBox(parent, opts);
      else await dialog.showMessageBox(opts);
      return null;
    }
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });

  // Our own windows render black in a share (setContentProtection), so do not offer them.
  const ownWindowIds = new Set<string>();
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      ownWindowIds.add(w.getMediaSourceId());
    } catch {
      /* window going away */
    }
  }
  const usable = sources.filter((s) => !ownWindowIds.has(s.id));
  if (usable.length === 0) return null;

  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  return pickSource(usable, parent);
}

/**
 * Install once per process (init() in setup.ts can run again from `activate` on macOS,
 * and ipcMain.handle throws on a second registration). Call after app.whenReady().
 */
export function setupLiveClass(customScheme: string, isDev: boolean): void {
  if (installed) return;
  installed = true;

  ipcMain.handle('live-class:enter', (event, _title?: unknown) => {
    // Only the app's own top-level page may drive this (the preload never reaches frames).
    if (event.senderFrame && event.senderFrame.parent) return;
    startClass(event.sender);
  });

  ipcMain.handle('live-class:exit', (event) => {
    stopClass(event.sender.id);
  });

  let pickerOpen = false;
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Deny = callback with no streams. Electron answers the page with a capture failure
    // (NotAllowed/Abort); passing `{}` would instead throw "Video was requested, but no
    // video stream was provided" in this process.
    const deny = () => {
      try {
        (callback as unknown as (streams?: unknown) => void)();
      } catch (e) {
        console.warn('[live-class] display media deny failed', e);
      }
    };

    const origin = request.securityOrigin || (request.frame ? request.frame.origin : '');
    if (!isTrustedCaptureOrigin(origin, customScheme, isDev) || !request.videoRequested) {
      console.warn('[live-class] screen share refused for origin', origin);
      deny();
      return;
    }
    if (pickerOpen) {
      deny();
      return;
    }

    pickerOpen = true;
    chooseDisplaySource()
      .then((source) => {
        if (!source) return deny();
        // No system audio: on a shared machine the loopback would carry the class audio
        // itself back to everyone (echo), and macOS has no loopback without a driver.
        callback({ video: source });
      })
      .catch((e) => {
        console.warn('[live-class] screen share failed', e);
        deny();
      })
      .finally(() => {
        pickerOpen = false;
      });
  });
}

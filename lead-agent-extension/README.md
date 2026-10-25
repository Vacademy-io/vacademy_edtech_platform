# Vacademy Lead Agent: Chrome extension (local mode)

The extension lets a Vacademy Lead Agent read organisation websites from the staff member's own Chrome
("local mode", see `docs/crm/LEAD_AGENT_PLAN.md` §3.3). The Vacademy server decides which pages to read; the
extension fetches them and sends the raw HTML back. All parsing, AI, scoring and billing stay on the server
(`docs/crm/LEAD_AGENT_BUILD_SPEC.md` §4.1).

Plain JavaScript, Manifest V3, no build step, no dependencies.

## What it does and does not do

It does:

- Every 30 seconds, while Chrome is open and the extension is connected, ask Vacademy for up to 2 pages to read
  (`POST /ext/claim`), read them, and send each page back (`POST /ext/result`).
- Read a page with a plain `fetch` **without cookies** (`credentials: "omit"`). Pages over 1.5 MB are cut at
  1.5 MB. For files that are not HTML (PDF, images) it reports only the content type.
- For pages built by JavaScript (the server asks for `render: "tab"`, or the fetched HTML is an empty shell with
  a `#__next` / `#root` / `#app` mount node and under 300 characters of text), open the page in a separate
  minimized window, wait for it to finish loading plus 2.5 s, copy the page's HTML, and close the tab.
- Read at most one page per website at a time, and at most **300 pages a day**.

It does not:

- **Search the web.** Search runs on Vacademy's servers through a search API. The extension never opens Google,
  Bing or any search page.
- Read your open tabs, your history, your bookmarks or the pages you visit. It never lists your tabs. It only
  touches the tabs it opens itself, in its own minimized window.
- Send your cookies with a normal page fetch.
- Fetch anything it was not asked to by the Vacademy server, or anything on your own network (localhost,
  `192.168.x.x`, `10.x.x.x`, `*.local` and similar addresses are refused, also after redirects).
- Run when Chrome is closed. The server's daily quota catches up when Chrome is back.

**Tab render and cookies.** A tab render loads the page like a normal visit, so the browser sends the cookies it
already has for that website, as it would if you opened it yourself. That is why tab render is used only for
pages that are built by JavaScript and cannot be read with a plain fetch. The tab's audio is muted, and the
minimized window is closed after 5 minutes without renders, and when you pause or disconnect.

## Install (developer / unlisted build)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `lead-agent-extension/` folder.
4. Pin the extension (puzzle-piece icon → pin) so its badge is visible.

Requires Chrome 120 or newer (30-second alarms).

## Pairing

The dashboard creates a worker token with `POST /ai-service/lead-agent/v1/workers/pair` (shown once). The
extension stores it and sends it as `X-Lead-Agent-Token` on every call. Two ways to hand it over:

1. **Connect from the dashboard** (extension installed): on `https://dash.vacademy.io` (or `http://localhost`
   while developing) the dashboard calls

   ```js
   window.postMessage({ type: 'VACADEMY_LEAD_AGENT_PAIR', token, apiBase }, location.origin);
   ```

   and listens for

   ```js
   { type: 'VACADEMY_LEAD_AGENT_PAIRED', ok, institute_name, user_name, needs_site_access, error }
   ```

   To find out whether the extension is installed, post `{ type: 'VACADEMY_LEAD_AGENT_PING' }`; the extension
   answers `{ type: 'VACADEMY_LEAD_AGENT_PRESENT', version }` (it also announces itself once on page load).
   `apiBase` is optional (default `https://backend-stage.vacademy.io/ai-service`) and must be
   `https://*.vacademy.io/...` or `http://localhost...`.
   Only the dashboard host can pair: other `*.vacademy.io` sites (institute websites, learner apps) can carry
   third-party content, so pairing messages from them are ignored. The allow-list is `PAIR_PAGE_HOSTS` in
   `lib.js` (keep `content-pair.js` in sync; a test checks it).
2. **Paste the code**: open the extension popup, paste the code, click **Connect**. The API address can be
   changed under **Advanced**.

Either way the extension calls `POST /ext/hello` before saving the code; a code that is not valid does not
replace a working connection. After connecting, the popup asks for permission to read websites (see below).

If the dashboard revokes the worker, the next call gets 401: the extension forgets the token, the badge shows
`!` and the popup says it was disconnected. **Disconnect** in the popup only forgets the token on this browser;
revoke the worker in the dashboard to invalidate the token itself.

## How it runs

- `chrome.alarms` "tick" every 0.5 min (Chrome's minimum). A tick does nothing if the extension is not connected,
  is paused, has no site access, or is waiting after errors.
- `POST /ext/hello` on pairing, on **Run now**, and at most every 10 minutes. Its `paused` and `max_parallel`
  are respected (parallelism is capped at 2).
- `POST /ext/claim {max}` with `max` = up to 2, fewer if the daily cap is close or if tasks were carried over.
- Each tick finishes within about 25 seconds so Chrome does not stop the service worker mid-page. A task that
  cannot start in the time left (or an empty shell that needs a tab render) is kept and run on the next tick,
  inside its 120 s lease.
- After 5 calls to Vacademy fail in a row (server down, offline), it waits 10 minutes. A website that does not
  load is not counted: that is a normal result and is reported to the server (`ok: false`, `error`).
- Badge: empty when idle, the number of pages read today while running, `!` on an error, missing site access or
  disconnection, `II` when paused.

## Files

| File | What |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | service worker: alarms, API calls, fetch and tab render, badge, messages |
| `lib.js` | pure helpers (scheduler, truncation, JS-shell detection, URL checks, daily cap, backoff, badge) |
| `content-pair.js` | pairing bridge on the dashboard page |
| `popup.html` / `popup.js` / `popup.css` | toolbar popup |
| `icons/` | 16 / 48 / 128 px icons |
| `test/` | `node --test test/` (unit tests, a mocked-Chrome run of `background.js`, static manifest checks) |

Tests: `cd lead-agent-extension && node --test test/` (Node 20+, no install). `package.json` exists only to mark
the files as ES modules for Node; leave `test/` and `package.json` out of the Web Store zip.

## Permissions (Chrome Web Store justification)

**Single purpose:** The extension reads the public websites of organisations that the user's Vacademy Lead Agent
has selected, and sends those pages to the user's Vacademy account for lead research.

| Permission | Justification |
|---|---|
| `storage` | Saves the connection token for the user's Vacademy account, the pause setting and today's page count on this device. |
| `alarms` | Checks every 30 seconds for pages the Lead Agent wants read, so the work continues while the service worker sleeps. |
| `scripting` | Some organisation websites are built with JavaScript and are empty until they run. For those pages only, the extension opens the page in its own tab and reads that tab's HTML. It never injects into tabs the user opened. |
| Host `https://*.vacademy.io/*` | Talks to the Vacademy API (the user's account) and receives the pairing code from the Vacademy dashboard. |
| Host `http://localhost/*` | Same, for Vacademy developers running the platform locally. |
| Optional host `<all_urls>` | Requested at runtime, only after the user clicks "Allow reading websites". The organisations' websites are on arbitrary domains that cannot be listed in advance. Used only to fetch the pages the Vacademy server asks for, without cookies, at most 300 a day, never the user's own tabs. |
| Content script on `*.vacademy.io` | Receives the pairing code when the user clicks Connect in the Vacademy dashboard. It does not read the page. |

No `tabs`, `cookies`, `history`, `webRequest` or `<all_urls>` content scripts. No remote code: all scripts are
in the package.

**Data use disclosure (for the store form):** The extension sends to Vacademy the HTML of the organisation pages
the Vacademy server asked it to read, and the extension version and a device label ("Chrome on macOS"). It
collects no personal information about the user, does not read browsing activity, and sells or shares nothing.

## Privacy notes

- What leaves the browser: the pages the server asked for (HTML up to 1.5 MB, status code, final URL, content
  type, error text), sent only to the API address the extension was paired with (`*.vacademy.io` or localhost).
- What is stored locally: the worker token, API address, institute and user name for display, pause state,
  today's counters and the last connection error. The token is kept away from content scripts.
- The token identifies this browser as a worker of one institute; revoking it in the dashboard stops it at once.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Badge `!`, popup says "Disconnected" | The worker was revoked or the code expired. Create a new code in the dashboard and connect again. |
| Badge `!`, popup asks for site access | Click **Allow reading websites**. If Chrome's site access for the extension is set to "On click" or "On specific sites", set it to "On all sites" in `chrome://extensions` → Details. |
| "Waiting after errors" | Five calls to Vacademy failed in a row. It retries by itself after 10 minutes; **Run now** retries at once. Check the internet connection and the API address (Advanced). |
| "Paused in dashboard" | The server reports the worker as paused (for example no active agent). Nothing to do on this side. |
| "Daily limit reached" | 300 pages today. It resumes after local midnight. |
| Connect does nothing on the dashboard | Reload the dashboard tab after installing or updating the extension (content scripts load with the page). |
| A minimized "about:blank" window appears | That is the render window for JavaScript-built pages. It closes itself after 5 idle minutes; closing it by hand is fine. |
| Nothing happens | Chrome must be open. Look at the service worker log: `chrome://extensions` → Vacademy Lead Agent → "service worker". |

## Known limitations (v0.1.0)

- Chrome's `fetch` cannot set a browser-like `User-Agent` from an extension service worker without
  `declarativeNetRequest`; a few sites may answer differently than to a normal visit.
- Pages in a minimized window get throttled timers and no animation frames, so sites that only render
  content on scroll or animation may come back partial (the server sees the partial HTML).
- Redirects are followed by the browser; a redirect into a local address is detected afterwards (the content is
  discarded, but the request was made).
- robots.txt and per-site delays are the server's job (it only hands out one task per site at a time).

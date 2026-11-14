/*! Vacademy Site Assistant loader. data-key, data-site, [data-position, data-api-base].
 * Session made here on first open; its token goes to the iframe only by postMessage to its origin. */
(function () {
"use strict";
var NS = "vacademy-site-assistant", w = window, d = document, L = location, ls = "localStorage", ss = "sessionStorage";
if (w.__vacademySiteAssistant) return;
var sc = d.currentScript || [].slice.call(d.querySelectorAll('script[data-key][src*="site-assistant.js"]')).pop();
if (!sc) return;
w.__vacademySiteAssistant = true;
var at = function (n) { return sc.getAttribute("data-" + n) || ""; };
var key = at("key"), site = at("site"), pos = /left/.test(at("position")) ? "left" : "right", origin, api;
if (!key || !site) return warn("data-key and data-site required");
try {
  origin = new URL(sc.src, L.href).origin;
  var b = new URL(at("api-base") || "https://backend-stage.vacademy.io");
  if (b.protocol !== "https:" && b.hostname !== "localhost") return warn("data-api-base must be https");
  api = b.origin + b.pathname.replace(/\/+$/, "") + "/ai-service/site-assistant/v1/sessions";
} catch (e) { return warn("bad URL"); }

var SKEY = "vsa:session:" + site, RKEY = "vsa:reopen:" + site;
var session, frame, btn, busy, open, href = L.href, overflow = null;

function warn(m) { w.console && console.warn("[site-assistant] " + m); }
function fail(e) { warn(e.message); }
function get(s, k) { try { return w[s].getItem(k); } catch (e) { return null; } }
function set(s, k, v) { try { v === null ? w[s].removeItem(k) : w[s].setItem(k, v); } catch (e) {} }
function visitor() {
  var v = get(ls, "vsa:visitor");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(v || "")) {
    try { v = crypto.randomUUID(); } catch (e) { v = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2); }
    set(ls, "vsa:visitor", v);
  }
  return v;
}
function saved() { try { return JSON.parse(get(ls, SKEY) || "null") || {}; } catch (e) { return {}; } }
function resumeId() { var s = saved(); return typeof s.id === "string" && Date.now() - s.at < 432e5 ? s.id : null; }
function page() { return { url: L.href.slice(0, 2000), route: L.pathname, title: (d.title || "").slice(0, 300) }; }
function lang() { return (d.documentElement.lang || "").slice(0, 16); }

function create(resume) {
  var body = { site_tag: site, page: page(), visitor_id: visitor() }, r = resume && resumeId(), utm = {}, any;
  try {
    new URLSearchParams(L.search).forEach(function (v, k) { if (/^utm_[a-z]+$/.test(k) && v) utm[k] = any = v.slice(0, 200); });
  } catch (e) {}
  if (any) body.utm = utm;
  if (lang()) body.locale = lang();
  if (r) body.resume_session_id = r;
  return fetch(api, {
    method: "POST", credentials: "omit", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-API-Key": key }
  }).then(function (res) {
    if (res.ok) return res.json();
    if (r && /^4/.test(res.status) && !/^(401|403|429)$/.test(res.status)) return create(false); // stale resume id
    throw new Error("session " + res.status);
  }).then(function (s) {
    if (!s || !s.session_id || !s.token) throw new Error("bad session");
    session = s;
    var a = s.assistant || {};
    set(ls, SKEY, JSON.stringify({ id: s.session_id, at: Date.now(), name: a.name, color: a.accent_color, pos: a.position }));
  });
}

function post(m) {
  if (!frame || !frame.contentWindow) return;
  m.ns = NS;
  frame.contentWindow.postMessage(m, origin);
}
function init() {
  var s = session;
  if (s) post({ type: "init", sid: s.session_id, token: s.token, expires_at: s.expires_at, assistant: s.assistant,
    history: s.history, page: page() });
}
function layout(o) {
  open = o;
  if (btn) { btn.remove(); btn = null; } // the frame has its own launcher now
  var full = o && w.innerWidth < 640, st = frame.style, rs = d.documentElement.style;
  st.display = "block";
  st.top = st.left = st.right = st.bottom = "auto";
  if (full) { st.top = st.left = "0"; st.width = st.height = "100%"; }
  else { st.bottom = st[pos] = "12px"; st.width = (o ? 400 : 80) + "px"; st.height = (o ? Math.min(680, w.innerHeight - 24) : 80) + "px"; }
  if (full && overflow === null) { overflow = rs.overflow; rs.overflow = "hidden"; }
  if (!full && overflow !== null) { rs.overflow = overflow; overflow = null; }
  post({ type: "layout", fullscreen: full });
}
function navigate(url) {
  try {
    var u = new URL(url, L.href);
    if (!/^https?:$/.test(u.protocol) || u.origin !== L.origin) return;
    if (w.innerWidth >= 640) set(ss, RKEY, "1"); // reopen
    L.href = u.href;
  } catch (e) {}
}
function mount() {
  var q = "sid=" + encodeURIComponent(session.session_id) + "&pos=" + pos + "&open=1";
  if (lang()) q += "&lang=" + encodeURIComponent(lang());
  set(ss, RKEY, null);
  frame = d.createElement("iframe");
  frame.src = origin + "/site-assistant-embed?" + q;
  frame.title = (session.assistant || {}).name || "Chat";
  frame.referrerPolicy = "strict-origin";
  frame.style.cssText = "position:fixed;display:none;border:0;margin:0;padding:0;background:transparent;" +
    "color-scheme:normal;z-index:2147483000;max-width:100%;max-height:100%";
  d.body.append(frame);
}
function changed() {
  if (L.href !== href) post({ type: "page", page: page() });
  href = L.href;
}

w.addEventListener("message", function (e) {
  var m = e.data;
  if (!frame || e.origin !== origin || e.source !== frame.contentWindow || !m || m.ns !== NS) return;
  if (m.type === "ready") init();
  else if (m.type === "resize") layout(m.open === true);
  else if (m.type === "navigate" && typeof m.url === "string") navigate(m.url);
  else if (m.type === "expired") create(false).then(init, fail);
});
w.addEventListener("resize", function () { if (frame && open) layout(true); });
w.addEventListener("popstate", changed);
w.addEventListener("hashchange", changed);
setInterval(changed, 1500); // SPA nav

// bubble until first open (no request per page view)
function launcher() {
  var s = saved(), p = /left|right/.exec(s.pos || "");
  btn = d.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Chat with " + String(s.name || "us").slice(0, 80));
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="2"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  btn.style.cssText = "position:fixed;bottom:24px;" + (p ? p[0] : pos) + ":24px;width:56px;height:56px;border:0;" +
    "border-radius:50%;display:grid;place-items:center;cursor:pointer;box-shadow:0 4px 16px #0004;z-index:2147483000;" +
    "background:" + (/^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : "#2563eb");
  btn.onclick = start;
  d.body.append(btn);
}
function start() {
  if (busy || frame) return;
  busy = true;
  create(true).then(mount, function (e) { busy = false; fail(e); });
}
function boot() {
  launcher();
  if (get(ss, RKEY) == "1") start(); // after "Take me there"
}
if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot);
else boot();
})();

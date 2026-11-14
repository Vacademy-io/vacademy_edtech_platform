// YouTube embed bridge for the native iOS app.
//
// Why this exists:
// YouTube refuses to play an embed whose request carries no Referer and shows
// "Video player configuration error — Error 153". The iOS app's WebView runs on
// capacitor://localhost, and WebKit never sends a Referer from a non-http(s)
// page, so every YouTube lesson failed there; the origin/widget_referrer
// query params do not help because YouTube checks the header.
//
// The app points the IFrame API's `host` option at this site (see
// src/utils/youtube-embed.ts), so the API's iframe loads
// https://<this host>/embed/<videoId>?… instead of youtube.com. This page nests
// the real youtube.com embed — now with an https Referer — and relays the API's
// postMessage traffic both ways, so the player code drives it unchanged:
// commands from the app go down to YouTube, YouTube's events come back up with
// this page as their origin, which is exactly the `host` the API expects.

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

const BRIDGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin"><meta name="robots" content="noindex">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body><iframe id="yt" title="YouTube video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
(function () {
  var id = location.pathname.split("/").pop();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return;
  var YT_ORIGIN = "https://www.youtube.com";
  // Keep the app's player vars; only the identity params must name this page.
  var q = new URLSearchParams(location.search);
  q.set("origin", location.origin);
  q.set("widget_referrer", location.origin + "/");
  q.set("enablejsapi", "1");
  var yt = document.getElementById("yt");
  yt.src = YT_ORIGIN + "/embed/" + id + "?" + q.toString();
  window.addEventListener("message", function (e) {
    if (e.source === yt.contentWindow && e.origin === YT_ORIGIN) {
      window.parent.postMessage(e.data, "*");
    } else if (e.source === window.parent && yt.contentWindow) {
      yt.contentWindow.postMessage(e.data, YT_ORIGIN);
    }
  });
})();
</script></body></html>`;

export const onRequest: PagesFunction = async (context) => {
  const videoId = String(context.params.videoId || "");
  if (!VIDEO_ID.test(videoId)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(BRIDGE_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-robots-tag": "noindex",
    },
  });
};

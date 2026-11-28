/**
 * Picture-in-picture that works when the class runs inside a frame.
 *
 * BBB's stock PiP plugin uses Document Picture-in-Picture, which browsers only
 * allow from a TOP-LEVEL page — inside the learner app's <iframe> it fails. This
 * draws the live videos (screen share first, then webcams) onto one canvas, turns
 * the canvas into a video, and puts THAT video in normal video PiP, which is
 * allowed in a frame with allow="picture-in-picture" (web, Electron, iOS WKWebView).
 *
 * Android's WebView has no video PiP at all; there the button asks the app to
 * shrink into Android's own PiP window instead (see index.tsx).
 */

const FPS = 15;
const W = 1280;
const H = 720;
const MAX_CAMS = 4;

type PipVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

/** A <video> that is actually showing a picture right now. */
function isLive(v: HTMLVideoElement | null | undefined): v is HTMLVideoElement {
  return !!v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
}

/** The class's videos, in the order a learner most wants them. */
export function findSources(): { share: HTMLVideoElement | null; cams: HTMLVideoElement[] } {
  const share =
    (document.querySelector("#screenshareContainer video") as HTMLVideoElement | null) ||
    (document.getElementById("screenshareVideo") as HTMLVideoElement | null);
  const seen = new Set<HTMLVideoElement>();
  const cams: HTMLVideoElement[] = [];
  document
    .querySelectorAll<HTMLVideoElement>('.videoContainer video, [data-test="webcamVideoItem"] video')
    .forEach((v) => {
      if (!seen.has(v) && isLive(v)) {
        seen.add(v);
        cams.push(v);
      }
    });
  return { share: isLive(share) ? share : null, cams: cams.slice(0, MAX_CAMS) };
}

/** Is any form of video PiP possible in this browser/WebView? */
export function videoPipSupported(): boolean {
  const probe = document.createElement("video") as PipVideo;
  if (typeof probe.requestPictureInPicture === "function" && document.pictureInPictureEnabled) return true;
  return typeof probe.webkitSupportsPresentationMode === "function" &&
    probe.webkitSupportsPresentationMode("picture-in-picture");
}

/** Draw `v` into the box, cropped to fill it (object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number) {
  const vr = v.videoWidth / v.videoHeight;
  const br = w / h;
  let sw = v.videoWidth;
  let sh = v.videoHeight;
  let sx = 0;
  let sy = 0;
  if (vr > br) {
    sw = sh * br;
    sx = (v.videoWidth - sw) / 2;
  } else {
    sh = sw / br;
    sy = (v.videoHeight - sh) / 2;
  }
  ctx.drawImage(v, sx, sy, sw, sh, x, y, w, h);
}

/** Draw `v` whole inside the box (object-fit: contain) — for screen share text. */
function drawContain(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / v.videoWidth, h / v.videoHeight);
  const dw = v.videoWidth * s;
  const dh = v.videoHeight * s;
  ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawFrame(ctx: CanvasRenderingContext2D, emptyText: string) {
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, W, H);
  const { share, cams } = findSources();
  try {
    if (share) {
      if (cams.length === 0) {
        drawContain(ctx, share, 0, 0, W, H);
      } else {
        // Share on the left, up to 3 webcams stacked on the right.
        const side = Math.round(W * 0.24);
        drawContain(ctx, share, 0, 0, W - side, H);
        const shown = cams.slice(0, 3);
        const th = Math.floor(H / 3);
        shown.forEach((v, i) => drawCover(ctx, v, W - side, i * th, side, th - 4));
      }
    } else if (cams.length === 1) {
      drawCover(ctx, cams[0] as HTMLVideoElement, 0, 0, W, H);
    } else if (cams.length === 2) {
      cams.forEach((v, i) => drawCover(ctx, v, i * (W / 2), 0, W / 2 - 2, H));
    } else if (cams.length > 2) {
      cams.forEach((v, i) => drawCover(ctx, v, (i % 2) * (W / 2), Math.floor(i / 2) * (H / 2), W / 2 - 2, H / 2 - 2));
    } else {
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "600 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emptyText, W / 2, H / 2);
    }
  } catch {
    // A video that just ended can throw on drawImage; the next frame is fine.
  }
}

/**
 * A steady ticker that keeps running when the page is hidden. Timers in a
 * hidden page can be slowed to once a second (or less); a dedicated worker's
 * timers are not, so the PiP picture keeps moving while the learner is in
 * another tab or app. Falls back to setInterval if workers are unavailable.
 */
function startTicker(fn: () => void): () => void {
  try {
    const src = `setInterval(function(){postMessage(0)}, ${Math.round(1000 / FPS)});`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(fn, Math.round(1000 / FPS));
    return () => window.clearInterval(id);
  }
}

export class CompositePip {
  private canvas: HTMLCanvasElement | null = null;
  private video: PipVideo | null = null;
  private stopTicker: (() => void) | null = null;

  constructor(private readonly emptyText: string, private readonly onChange: (active: boolean) => void) {}

  isActive(): boolean {
    const v = this.video;
    if (!v) return false;
    return document.pictureInPictureElement === v || v.webkitPresentationMode === "picture-in-picture";
  }

  /** Must be called straight from a click (browsers require a user gesture). */
  async open(): Promise<void> {
    if (this.isActive()) return;
    const canvas = this.canvas ?? document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.canvas = canvas;
    drawFrame(ctx, this.emptyText);

    const video = (this.video ?? document.createElement("video")) as PipVideo;
    video.muted = true; // the class audio keeps playing from BBB itself
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    // Kept in the DOM but invisible: some WebViews refuse PiP for detached videos.
    video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;bottom:0;right:0;";
    if (!video.isConnected) document.body.appendChild(video);
    if (!video.srcObject) video.srcObject = canvas.captureStream(FPS);
    this.video = video;

    this.stopTicker?.();
    this.stopTicker = startTicker(() => drawFrame(ctx, this.emptyText));

    const done = () => this.handleClosed();
    video.addEventListener("leavepictureinpicture", done, { once: true });
    video.addEventListener("webkitpresentationmodechanged", () => {
      if (video.webkitPresentationMode !== "picture-in-picture") done();
    });

    await video.play();
    if (typeof video.requestPictureInPicture === "function" && document.pictureInPictureEnabled) {
      await video.requestPictureInPicture();
    } else if (video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode("picture-in-picture");
    } else {
      this.handleClosed();
      throw new Error("picture-in-picture not supported");
    }
    this.onChange(true);
  }

  async close(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else this.video?.webkitSetPresentationMode?.("inline");
    } catch {
      // already closed
    }
    this.handleClosed();
  }

  private handleClosed() {
    this.stopTicker?.();
    this.stopTicker = null;
    this.onChange(false);
  }

  destroy() {
    void this.close();
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
    }
    this.video = null;
    this.canvas = null;
  }
}

import { normalizeAssistant, normalizeHistory } from "./api";
import type { SiteAssistantPageContext, SiteAssistantSession } from "./types";

/**
 * postMessage protocol between public/site-assistant.js (the loader, on the
 * institute's own page) and /site-assistant-embed (this app, in the iframe).
 *
 *   iframe → parent  ready     (no secrets; sent before the parent is known)
 *   parent → iframe  init      {sid, token, expires_at, assistant, history, page}
 *   parent → iframe  page      {page}            the visitor moved (SPA nav)
 *   parent → iframe  layout    {fullscreen}      phone-width full-screen sheet
 *   iframe → parent  resize    {open}            launcher ↔ panel
 *   iframe → parent  navigate  {url}             a link to the parent's own site
 *   iframe → parent  expired                     token refused; loader re-issues
 *
 * The session is created by the PARENT (so the browser's Origin header is the
 * institute's verified site) and its token crosses into the frame only by
 * postMessage with an exact target origin — never in the URL. The frame pins
 * the parent's origin at the handshake: the first `init` must come from
 * window.parent, from the origin the browser reports as our embedder
 * (location.ancestorOrigins / document.referrer) when it tells us, and carry
 * the sid the frame was opened with. Every later message must come from that
 * same origin, and everything the frame sends after the handshake is
 * addressed to it alone.
 */

export const SA_NS = "vacademy-site-assistant";

export type ParentMessage =
  | { type: "init"; session: SiteAssistantSession; page: SiteAssistantPageContext | null }
  | { type: "page"; page: SiteAssistantPageContext }
  | { type: "layout"; fullscreen: boolean };

export type FrameMessage =
  | { type: "ready" }
  | { type: "resize"; open: boolean }
  | { type: "navigate"; url: string }
  | { type: "expired" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** "https://a.com" / "http://localhost:3000" — never "null", "file://", or a URL with a path. */
export const isWebOrigin = (origin: unknown): origin is string => {
  if (typeof origin !== "string" || !origin) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === origin;
  } catch {
    return false;
  }
};

const originOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const o = new URL(url).origin;
    return isWebOrigin(o) ? o : null;
  } catch {
    return null;
  }
};

/** The embedder's origin as the browser reports it, when it does. */
export const reportedParentOrigin = (win: Pick<Window, "location" | "document">): string | null => {
  const ancestors = (win.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    const first = ancestors[0];
    if (isWebOrigin(first)) return first;
  }
  return originOf(win.document?.referrer);
};

export const parsePage = (raw: unknown): SiteAssistantPageContext | null => {
  if (!isObj(raw)) return null;
  const url = typeof raw.url === "string" ? raw.url.slice(0, 2000) : "";
  if (!url) return null;
  return {
    url,
    route: typeof raw.route === "string" ? raw.route.slice(0, 500) : "",
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    ...(typeof raw.course_id === "string" && raw.course_id ? { course_id: raw.course_id.slice(0, 64) } : {}),
  };
};

/** A raw message payload → a typed parent message (or null). */
export const parseParentMessage = (data: unknown): ParentMessage | null => {
  if (!isObj(data) || data.ns !== SA_NS) return null;
  switch (data.type) {
    case "init": {
      const sid = typeof data.sid === "string" ? data.sid : "";
      const token = typeof data.token === "string" ? data.token : "";
      if (!sid || !token) return null;
      return {
        type: "init",
        session: {
          session_id: sid,
          token,
          expires_at: typeof data.expires_at === "string" ? data.expires_at : null,
          assistant: normalizeAssistant(data.assistant),
          history: normalizeHistory(data.history),
        },
        page: parsePage(data.page),
      };
    }
    case "page": {
      const page = parsePage(data.page);
      return page ? { type: "page", page } : null;
    }
    case "layout":
      return { type: "layout", fullscreen: data.fullscreen === true };
    default:
      return null;
  }
};

export interface EmbedBridgeOptions {
  win: Window;
  /** The sid in the frame's own URL (?sid=); the first init must match it. */
  expectedSid: string | null;
  onMessage: (message: ParentMessage) => void;
}

export interface EmbedBridge {
  /** Origin pinned at the handshake (null until then). */
  parentOrigin: () => string | null;
  post: (message: FrameMessage) => void;
  dispose: () => void;
}

export const createEmbedBridge = ({ win, expectedSid, onMessage }: EmbedBridgeOptions): EmbedBridge => {
  let parentOrigin: string | null = null;
  const reported = reportedParentOrigin(win);

  const listener = (event: MessageEvent) => {
    if (!win.parent || win.parent === win || event.source !== win.parent) return;
    const message = parseParentMessage(event.data);
    if (!message) return;
    if (parentOrigin === null) {
      // Handshake: only an init, from a real web origin that agrees with what
      // the browser says embedded us, for the session this frame was opened for.
      if (message.type !== "init") return;
      if (!isWebOrigin(event.origin)) return;
      if (reported && reported !== event.origin) return;
      if (expectedSid && message.session.session_id !== expectedSid) return;
      parentOrigin = event.origin;
    } else if (event.origin !== parentOrigin) {
      return;
    }
    onMessage(message);
  };
  win.addEventListener("message", listener);

  return {
    parentOrigin: () => parentOrigin,
    post(message) {
      if (!win.parent || win.parent === win) return;
      const payload = { ns: SA_NS, ...message };
      if (message.type === "ready") {
        // Nothing secret in "ready"; address it to the reported embedder when known.
        win.parent.postMessage(payload, reported ?? "*");
        return;
      }
      if (!parentOrigin) return;
      win.parent.postMessage(payload, parentOrigin);
    },
    dispose: () => win.removeEventListener("message", listener),
  };
};

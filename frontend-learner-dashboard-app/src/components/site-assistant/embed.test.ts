// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbedBridge, isWebOrigin, parseParentMessage, SA_NS, type ParentMessage } from "./embed-protocol";
import { createEmbedRuntime } from "./embed-runtime";

/**
 * The embed handshake both ways: the iframe page (embed-protocol.ts) and the
 * loader on the institute's site (public/site-assistant.js). Tokens only move
 * by postMessage to an exact origin, and nothing is accepted from a window or
 * origin other than the one pinned at the handshake.
 */

const PARENT = "https://www.brahmvarchas.org";
const init = (over: Record<string, unknown> = {}) => ({
  ns: SA_NS,
  type: "init",
  sid: "s1",
  token: "tok",
  expires_at: null,
  assistant: { name: "Ask BV" },
  history: [],
  page: { url: `${PARENT}/courses`, route: "/courses", title: "Courses" },
  ...over,
});

interface FakeWin {
  win: Window;
  parent: { postMessage: ReturnType<typeof vi.fn> };
  deliver: (data: unknown, origin: string, source?: unknown) => void;
}

/** A frame window whose parent we control; `ancestorOrigins` / referrer as the browser would report them. */
const fakeFrame = (opts: { ancestor?: string; referrer?: string } = {}): FakeWin => {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const parent = { postMessage: vi.fn() };
  const win = {
    parent,
    location: { ancestorOrigins: opts.ancestor ? Object.assign([opts.ancestor], { contains: () => true, item: () => opts.ancestor }) : undefined },
    document: { referrer: opts.referrer ?? "" },
    addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.push(l),
    removeEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.splice(listeners.indexOf(l), 1),
  } as unknown as Window;
  return {
    win,
    parent,
    deliver: (data, origin, source = parent) => listeners.forEach((l) => l({ data, origin, source } as MessageEvent)),
  };
};

describe("embed bridge (iframe side)", () => {
  it("pins the parent's origin at the first valid init and only then talks to it", () => {
    const f = fakeFrame({ ancestor: PARENT });
    const got: ParentMessage[] = [];
    const bridge = createEmbedBridge({ win: f.win, expectedSid: "s1", onMessage: (m) => got.push(m) });

    bridge.post({ type: "ready" });
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ ns: SA_NS, type: "ready" }, PARENT);
    // Nothing else goes out before the handshake.
    bridge.post({ type: "navigate", url: `${PARENT}/about` });
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);

    f.deliver(init(), PARENT);
    expect(bridge.parentOrigin()).toBe(PARENT);
    expect(got[0]).toMatchObject({ type: "init", session: { session_id: "s1", token: "tok" } });

    bridge.post({ type: "resize", open: true });
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ ns: SA_NS, type: "resize", open: true }, PARENT);
  });

  it("rejects an init from another window, another origin, a 'null' origin or for another session", () => {
    const f = fakeFrame({ referrer: `${PARENT}/` });
    const got: ParentMessage[] = [];
    const bridge = createEmbedBridge({ win: f.win, expectedSid: "s1", onMessage: (m) => got.push(m) });
    f.deliver(init(), PARENT, {}); // not window.parent
    f.deliver(init(), "https://evil.example"); // not who embedded us
    f.deliver(init(), "null");
    f.deliver(init({ sid: "other" }), PARENT);
    f.deliver({ ...init(), ns: "something-else" }, PARENT);
    f.deliver({ ns: SA_NS, type: "page", page: { url: "x" } }, PARENT); // page before the handshake
    expect(got).toEqual([]);
    expect(bridge.parentOrigin()).toBeNull();
  });

  it("after the handshake, drops messages from any other origin", () => {
    const f = fakeFrame();
    const got: ParentMessage[] = [];
    createEmbedBridge({ win: f.win, expectedSid: "s1", onMessage: (m) => got.push(m) });
    f.deliver(init(), PARENT);
    f.deliver({ ns: SA_NS, type: "page", page: { url: "https://evil.example/x" } }, "https://evil.example");
    f.deliver({ ns: SA_NS, type: "layout", fullscreen: true }, PARENT);
    expect(got.map((m) => m.type)).toEqual(["init", "layout"]);
  });

  it("parses messages defensively", () => {
    expect(parseParentMessage({ ns: SA_NS, type: "init", sid: "s1" })).toBeNull(); // no token
    expect(parseParentMessage({ ns: SA_NS, type: "page", page: { url: "" } })).toBeNull();
    expect(isWebOrigin("https://a.example")).toBe(true);
    expect(isWebOrigin("https://a.example/")).toBe(false);
    expect(isWebOrigin("file://")).toBe(false);
  });

  it("the runtime adopts the handed-over session and answers expiry with a re-issued one", async () => {
    const rt = createEmbedRuntime();
    rt.onMessage(parseParentMessage(init())!);
    expect(rt.controller.store.getState()).toMatchObject({ status: "ready", sessionId: "s1" });
    const post = vi.fn();
    rt.bridge = { post, parentOrigin: () => PARENT, dispose: () => {} };
    rt.onMessage(parseParentMessage(init({ sid: "s2", token: "tok2" }))!);
    expect(rt.controller.store.getState().sessionId).toBe("s2");
  });
});

// ── the loader on the institute's page ─────────────────────────────────────

const LOADER = fs.readFileSync(path.resolve(__dirname, "../../../public/site-assistant.js"), "utf8");
const FRAME_ORIGIN = "https://learn.vacademy.example";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("public/site-assistant.js (loader)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete (window as { __vacademySiteAssistant?: boolean }).__vacademySiteAssistant;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    localStorage.clear();
    sessionStorage.clear();
    const s = document.createElement("script");
    s.setAttribute("src", `${FRAME_ORIGIN}/site-assistant.js`);
    s.setAttribute("data-key", "vak_pub_123");
    s.setAttribute("data-site", "brahm");
    s.setAttribute("data-position", "bottom-left");
    document.head.appendChild(s);
    fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ session_id: "s1", token: "secret-token", expires_at: null, assistant: { name: "Ask BV" }, history: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const launcherButton = () => document.querySelector("button") as HTMLButtonElement | null;
  /** The frame this loader made, with postMessage stubbed (a loader instance outlives its test's DOM). */
  const loaderFrame = () => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    if (frame?.contentWindow) Object.defineProperty(frame.contentWindow, "postMessage", { value: vi.fn(), configurable: true });
    return frame;
  };

  /** Load the loader, then open the chat from its launcher (the session is made on that click). */
  const boot = async () => {
    new Function(LOADER)();
    await flush();
    launcherButton()!.click();
    await flush();
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    const toFrame = vi.fn();
    Object.defineProperty(frame.contentWindow!, "postMessage", { value: toFrame, configurable: true });
    const fromFrame = (data: unknown, origin = FRAME_ORIGIN, source: unknown = frame.contentWindow) =>
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
    return { frame, toFrame, fromFrame };
  };

  it("stays small", () => {
    expect(new TextEncoder().encode(LOADER).length).toBeLessThan(7000);
  });

  it("draws only a launcher on page load: no session (and no conversation row) per page view", async () => {
    new Function(LOADER)();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    const btn = launcherButton()!;
    expect(btn.getAttribute("aria-label")).toBe("Chat with us");
    expect(btn.style.left).toBe("24px"); // data-position="bottom-left"
    btn.click();
    btn.click(); // a double click makes one session
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loaderFrame()).not.toBeNull();
  });

  it("remembers the assistant's name / colour / side for the next page's launcher", async () => {
    localStorage.setItem(
      "vsa:session:brahm",
      JSON.stringify({ id: "s0", at: Date.now(), name: "Ask BV", color: "#aa3300", pos: "bottom-right" }), // design-lint-ignore: an institute's saved accent colour (data)
    );
    new Function(LOADER)();
    await flush();
    const btn = launcherButton()!;
    expect(btn.getAttribute("aria-label")).toBe("Chat with Ask BV");
    expect(btn.style.right).toBe("24px");
    expect(btn.style.background).toContain("rgb(170, 51, 0)");
    btn.click();
    await flush();
    loaderFrame();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ resume_session_id: "s0" });
  });

  it("reopens at once after a 'Take me there' navigation", async () => {
    sessionStorage.setItem("vsa:reopen:brahm", "1");
    new Function(LOADER)();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loaderFrame()!.getAttribute("src")).toContain("&open=1");
    expect(sessionStorage.getItem("vsa:reopen:brahm")).toBeNull();
  });

  it("creates the session from this page with the publishable key, then frames the embed by sid", async () => {
    const { frame } = await boot();
    const [url, req] = fetchMock.mock.calls[0];
    expect(url).toBe("https://backend-stage.vacademy.io/ai-service/site-assistant/v1/sessions");
    expect((req.headers as Record<string, string>)["X-API-Key"]).toBe("vak_pub_123");
    expect(JSON.parse(req.body)).toMatchObject({ site_tag: "brahm", page: { route: "/" } });
    expect(frame.getAttribute("src")).toBe(`${FRAME_ORIGIN}/site-assistant-embed?sid=s1&pos=left&open=1`);
    expect(frame.src).not.toContain("secret-token");
    expect(frame.style.display).toBe("none"); // until the frame says it is ready to show
    expect(JSON.parse(localStorage.getItem("vsa:session:brahm")!)).toMatchObject({ id: "s1" });
  });

  it("hands the token over only to the frame's exact origin, after a 'ready' from the frame itself", async () => {
    const { toFrame, fromFrame } = await boot();
    fromFrame({ ns: SA_NS, type: "ready" }, "https://evil.example");
    fromFrame({ ns: SA_NS, type: "ready" }, FRAME_ORIGIN, window);
    expect(toFrame).not.toHaveBeenCalled();
    fromFrame({ ns: SA_NS, type: "ready" });
    expect(toFrame).toHaveBeenCalledWith(expect.objectContaining({ ns: SA_NS, type: "init", sid: "s1", token: "secret-token" }), FRAME_ORIGIN);
  });

  it("sizes the frame on resize and tells it the layout", async () => {
    const { frame, toFrame, fromFrame } = await boot();
    expect(launcherButton()).not.toBeNull(); // until the frame can show itself
    fromFrame({ ns: SA_NS, type: "resize", open: false });
    expect(launcherButton()).toBeNull();
    expect(frame.style.display).toBe("block");
    expect(frame.style.width).toBe("80px");
    expect(frame.style.left).toBe("12px");
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    fromFrame({ ns: SA_NS, type: "resize", open: true });
    expect(frame.style.width).toBe("400px");
    expect(toFrame).toHaveBeenLastCalledWith({ ns: SA_NS, type: "layout", fullscreen: false }, FRAME_ORIGIN);
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    fromFrame({ ns: SA_NS, type: "resize", open: true });
    expect(frame.style.width).toBe("100%");
    expect(toFrame).toHaveBeenLastCalledWith({ ns: SA_NS, type: "layout", fullscreen: true }, FRAME_ORIGIN);
  });

  it("navigates this page only to http(s) URLs on its own origin", async () => {
    const { fromFrame } = await boot();
    const start = window.location.href;
    fromFrame({ ns: SA_NS, type: "navigate", url: "javascript:alert(1)" });
    fromFrame({ ns: SA_NS, type: "navigate", url: "https://evil.example/#x" });
    expect(window.location.href).toBe(start);
    fromFrame({ ns: SA_NS, type: "navigate", url: "https://evil.example/#x" }, "https://evil.example");
    expect(window.location.href).toBe(start);
    fromFrame({ ns: SA_NS, type: "navigate", url: `${window.location.origin}${window.location.pathname}#team` });
    expect(window.location.hash).toBe("#team");
  });

  it("does nothing without data-key / data-site", async () => {
    document.head.querySelector("script")!.removeAttribute("data-key");
    new Function(LOADER)();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    expect(launcherButton()).toBeNull();
  });
});

describe("edge middleware", () => {
  it("treats /site-assistant-embed as an app route, never as a catalogue page", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../../functions/_middleware.ts"), "utf8");
    const set = /const APP_ROUTE_SEGMENTS = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? "";
    expect(set).toContain('"site-assistant-embed"');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SITE_CART_OPEN_EVENT,
  SITE_CART_REOPEN_WINDOW_MS,
  hasSiteCartOpener,
  openSiteCartDrawer,
  registerSiteCartOpener,
  requestSiteCartReopen,
  subscribeSiteCartOpeners,
  takeSiteCartReopenRequest,
} from "./site-cart-events";

// A window that records its listeners, so the test can see the single
// listener come and go.
class FakeWindow extends EventTarget {
  listeners = new Map<string, number>();
  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, cb);
  }
  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, cb);
  }
}

let win: FakeWindow;
const cleanups: Array<() => void> = [];
const register = (open: () => void) => {
  const off = registerSiteCartOpener(open);
  cleanups.push(off);
  return off;
};

beforeEach(() => {
  win = new FakeWindow();
  vi.stubGlobal("window", win);
  takeSiteCartReopenRequest(); // no request left over from another test
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

describe("site cart opener registry", () => {
  it("hands an open request to the most recently mounted button only", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = register(first);
    const offSecond = register(second);
    expect(hasSiteCartOpener()).toBe(true);
    // One window listener, however many buttons.
    expect(win.listeners.get(SITE_CART_OPEN_EVENT)).toBe(1);

    win.dispatchEvent(new CustomEvent(SITE_CART_OPEN_EVENT));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    // openSiteCartDrawer goes through the same event.
    expect(openSiteCartDrawer()).toBe(true);
    expect(second).toHaveBeenCalledTimes(2);

    // The newest unmounts: the request falls back to the one still mounted.
    offSecond();
    win.dispatchEvent(new CustomEvent(SITE_CART_OPEN_EVENT));
    expect(first).toHaveBeenCalledTimes(1);

    offFirst();
    expect(hasSiteCartOpener()).toBe(false);
    expect(win.listeners.get(SITE_CART_OPEN_EVENT)).toBe(0);
    // With no button left the caller is told to show its own drawer.
    expect(openSiteCartDrawer()).toBe(false);
  });

  it("tells subscribers when buttons mount and unmount", () => {
    const watcher = vi.fn();
    const unsubscribe = subscribeSiteCartOpeners(watcher);
    const off = register(() => {});
    expect(watcher).toHaveBeenCalledTimes(1);
    off();
    expect(watcher).toHaveBeenCalledTimes(2);
    unsubscribe();
    register(() => {});
    expect(watcher).toHaveBeenCalledTimes(2);
  });
});

describe("reopen after the store checkout's Back", () => {
  it("opens the drawer of the last button to mount, once", async () => {
    const first = vi.fn();
    const second = vi.fn();
    requestSiteCartReopen();
    register(first);
    register(second);
    await Promise.resolve(); // the open runs after the mounting commit
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // Taken: a later mount does not reopen it.
    const third = vi.fn();
    register(third);
    await Promise.resolve();
    expect(third).not.toHaveBeenCalled();
  });

  it("drops a request nobody took in time", () => {
    const now = 1_000_000;
    requestSiteCartReopen(now);
    expect(takeSiteCartReopenRequest(now + SITE_CART_REOPEN_WINDOW_MS + 1)).toBe(false);
    requestSiteCartReopen(now);
    expect(takeSiteCartReopenRequest(now + 50)).toBe(true);
    expect(takeSiteCartReopenRequest(now + 60)).toBe(false);
  });
});

describe("open requests carry their intent", () => {
  it("passes a checkout request through to the opener ('Buy now')", () => {
    if (typeof window === "undefined") return; // node env: the event bus needs a window
    const seen: (string | undefined)[] = [];
    const unregister = registerSiteCartOpener((request) => seen.push(request?.intent));
    expect(openSiteCartDrawer({ intent: "checkout" })).toBe(true);
    expect(openSiteCartDrawer()).toBe(true);
    window.dispatchEvent(new CustomEvent(SITE_CART_OPEN_EVENT, { detail: { intent: "checkout", packageSessionId: "x", source: "course" } }));
    unregister();
    expect(seen).toEqual(["checkout", undefined, "checkout"]);
  });
});


// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every pending getChatUser() call stays unresolved until resolveUser() releases all of them, so
// tests can interleave pause/resume with in-flight connects.
let pendingUsers: (() => void)[] = [];
const resolveUser = () => {
  const toResolve = pendingUsers;
  pendingUsers = [];
  toResolve.forEach((r) => r());
};
vi.mock("@/services/chat/getChatUser", () => ({
  getChatUser: () =>
    new Promise((resolve) => {
      pendingUsers.push(() => resolve({ userId: "u1", instituteId: "i1", token: "t" }));
    }),
}));

// Lifecycle listeners by event name ("appStateChange" on Android/web, "pause"/"resume" on iOS).
let listeners: Record<string, (s: { isActive: boolean }) => void> = {};
let appStateCb: ((s: { isActive: boolean }) => void) | null = null;
vi.mock("@/utils/app-plugin", () => ({
  App: {
    addListener: (event: string, cb: (s: { isActive: boolean }) => void) => {
      listeners[event] = cb;
      if (event === "appStateChange") appStateCb = cb;
      return Promise.resolve({ remove: async () => {} });
    },
  },
}));

let platform = "web";
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform } }));

vi.mock("@/constants/urls", () => ({ BASE_URL: "http://x" }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

const { useChatStream } = await import("./useChatStream");

function Harness() {
  useChatStream({});
  return null;
}

const open = () => FakeEventSource.instances.filter((e) => !e.closed);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("useChatStream background handling", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    FakeEventSource.instances = [];
    pendingUsers = [];
    listeners = {};
    appStateCb = null;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
    resolveUser();
    await flush();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("opens one stream on mount", () => {
    expect(open()).toHaveLength(1);
  });

  it("closes the stream when the native app goes to background", async () => {
    await act(async () => appStateCb?.({ isActive: false }));
    expect(open()).toHaveLength(0);
  });

  it("opens exactly one stream when visibilitychange and appStateChange both fire on resume", async () => {
    await act(async () => appStateCb?.({ isActive: false }));
    await act(async () => {
      setHidden(false);
      appStateCb?.({ isActive: true });
    });
    resolveUser();
    await flush();
    expect(open()).toHaveLength(1);
  });

  it("does not open a stream if paused while connecting", async () => {
    await act(async () => appStateCb?.({ isActive: false }));
    await act(async () => appStateCb?.({ isActive: true })); // connect() now awaiting the user
    await act(async () => appStateCb?.({ isActive: false })); // backgrounded again mid-connect
    resolveUser();
    await flush();
    expect(open()).toHaveLength(0);
  });

  it("still connects if paused and resumed while a connect is in flight", async () => {
    await act(async () => appStateCb?.({ isActive: false }));
    await act(async () => appStateCb?.({ isActive: true }));
    await act(async () => appStateCb?.({ isActive: false }));
    await act(async () => appStateCb?.({ isActive: true }));
    resolveUser();
    await flush();
    expect(open()).toHaveLength(1);
  });

  it("iOS: follows pause/resume, and a transient inactive state does not close the stream", async () => {
    await act(async () => root.unmount());
    platform = "ios";
    listeners = {};
    FakeEventSource.instances = [];
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
    resolveUser();
    await flush();
    expect(open()).toHaveLength(1);
    expect(listeners.appStateChange).toBeUndefined(); // not subscribed on iOS

    await act(async () => listeners.pause?.({ isActive: false }));
    expect(open()).toHaveLength(0);
    await act(async () => listeners.resume?.({ isActive: true }));
    resolveUser();
    await flush();
    expect(open()).toHaveLength(1);
    platform = "web";
  });
});

/**
 * Views and clicks on the builder home (spec 10.1).
 *
 * - A block counts as viewed once per dashboard mount, after it has been at
 *   least half visible for a second. A carousel slide counts once per mount
 *   when it has been the active slide and visible for a second. A shortcut tile
 *   counts on its first visibility. Shelf cards count clicks only.
 * - Clicks are queued and, for a link that leaves the app, flushed before it
 *   leaves.
 * - The queue holds up to 50 events and is flushed every 10 s, when the page is
 *   hidden, when the native app goes to the background and on unmount.
 * - Nothing is ever sent from the admin's preview.
 */
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import type { HomeEvent } from "@/services/learner-home";

export const FLUSH_INTERVAL_MS = 10_000;
export const MAX_QUEUE = 50;
export const VIEW_DWELL_MS = 1000;

export type HomeDeviceClass = HomeEvent["device"];
export type HomePlatform = HomeEvent["platform"];

export function deviceClassFor(width: number): HomeDeviceClass {
  if (width < 768) return "PHONE";
  if (width < 1024) return "TABLET";
  return "DESKTOP";
}

export function currentPlatform(): HomePlatform {
  if (typeof window !== "undefined" && (window as { electronAPI?: unknown }).electronAPI) return "ELECTRON";
  try {
    const p = Capacitor.getPlatform();
    if (p === "ios") return "IOS";
    if (p === "android") return "ANDROID";
  } catch {
    // web
  }
  return "WEB";
}

export interface HomeAnalytics {
  view: (blockKey: string, itemKey?: string) => void;
  click: (blockKey: string, itemKey?: string) => void;
  flush: () => void;
}

/**
 * The queue itself: pure apart from `send` and `now`, so it is unit-tested
 * without timers or a network.
 */
export function createHomeAnalytics(opts: {
  send: (events: HomeEvent[]) => void | Promise<void>;
  layoutVersion: number;
  device: () => HomeDeviceClass;
  platform: HomePlatform;
  disabled: boolean;
  now?: () => Date;
}): HomeAnalytics {
  const queue: HomeEvent[] = [];
  const viewed = new Set<string>();
  const now = opts.now ?? (() => new Date());

  const flush = () => {
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    try {
      void opts.send(batch);
    } catch {
      // swallowed
    }
  };

  const push = (type: HomeEvent["type"], blockKey: string, itemKey?: string) => {
    if (opts.disabled || !blockKey) return;
    const event: HomeEvent = {
      block_key: blockKey,
      type,
      device: opts.device(),
      platform: opts.platform,
      layout_version: opts.layoutVersion,
      ts: now().toISOString(),
    };
    if (itemKey) event.item_key = itemKey;
    queue.push(event);
    if (queue.length >= MAX_QUEUE) flush();
  };

  return {
    view: (blockKey, itemKey) => {
      const id = `${blockKey}\u0000${itemKey ?? ""}`;
      if (viewed.has(id)) return;
      viewed.add(id);
      push("VIEW", blockKey, itemKey);
    },
    click: (blockKey, itemKey) => push("CLICK", blockKey, itemKey),
    flush,
  };
}

/** One analytics queue per dashboard mount, with its flush triggers wired. */
export function useHomeAnalytics(opts: {
  layoutVersion: number;
  disabled: boolean;
  send: (events: HomeEvent[]) => void | Promise<void>;
}): HomeAnalytics {
  const sendRef = useRef(opts.send);
  sendRef.current = opts.send;
  const analytics = useMemo(
    () =>
      createHomeAnalytics({
        send: (events) => sendRef.current(events),
        layoutVersion: opts.layoutVersion,
        device: () => deviceClassFor(typeof window === "undefined" ? 1280 : window.innerWidth),
        platform: currentPlatform(),
        disabled: opts.disabled,
      }),
    [opts.layoutVersion, opts.disabled]
  );

  useEffect(() => {
    if (opts.disabled) return;
    const timer = window.setInterval(analytics.flush, FLUSH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") analytics.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", analytics.flush);
    let removePause: (() => void) | undefined;
    let cancelled = false;
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app")
        .then(({ App }) => App.addListener("pause", analytics.flush))
        .then((handle) => {
          if (cancelled) void handle.remove();
          else removePause = () => void handle.remove();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", analytics.flush);
      removePause?.();
      analytics.flush();
    };
  }, [analytics, opts.disabled]);

  return analytics;
}

/**
 * Calls `onView` once the element has been at least `threshold` visible for
 * `dwellMs`. `active` = false pauses the dwell (a carousel slide that is not
 * the current one). Fires at most once per mount.
 */
export function useViewDwell(
  ref: RefObject<Element | null>,
  onView: () => void,
  opts: { threshold?: number; dwellMs?: number; active?: boolean; disabled?: boolean } = {}
): void {
  const { threshold = 0.5, dwellMs = VIEW_DWELL_MS, active = true, disabled = false } = opts;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled || done.current || !active) return;
    if (typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= threshold);
        window.clearTimeout(timer);
        if (visible) {
          timer = window.setTimeout(() => {
            if (done.current) return;
            done.current = true;
            onViewRef.current();
            observer.disconnect();
          }, dwellMs);
        }
      },
      { threshold: [threshold] }
    );
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref, threshold, dwellMs, active, disabled]);
}

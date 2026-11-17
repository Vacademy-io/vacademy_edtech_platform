import { Capacitor } from "@capacitor/core";

/**
 * In-app BBB classroom helpers (shared by the join helper and the class view).
 *
 * The join URL is a personal, signed credential, so it lives only in memory —
 * never in the address bar, router state history or storage. A page reload
 * loses it; the class view then asks the backend for a fresh one.
 */

/** The platform name the backend's bbb.inapp.clients list uses. */
export function liveClassClient(): "web" | "android" | "ios" | "electron" {
  const p = Capacitor.getPlatform();
  if (p === "android" || p === "ios" || p === "electron") return p;
  return "web";
}

/**
 * Can this device show a live class inside the app? Web only for now: Android
 * needs a native release (keep-awake, lock-screen audio, PiP) and iOS/desktop
 * follow after device tests — even if the backend were misconfigured to allow
 * them, the app refuses until it ships that support.
 */
export function canHostClassInApp(): boolean {
  if (typeof window === "undefined") return false;
  if (Capacitor.getPlatform() !== "web") return false;
  if (!window.isSecureContext) return false;
  if (!navigator.mediaDevices) return false;
  // Never nest: the learner portal itself inside a frame (e.g. admin preview).
  if (window.self !== window.top) return false;
  // The learner chose "Open in browser" recently on this device.
  try {
    const until = Number(localStorage.getItem(EXTERNAL_UNTIL_KEY) || 0);
    if (until > Date.now()) return false;
  } catch {
    // storage blocked — ignore
  }
  return true;
}

const EXTERNAL_UNTIL_KEY = "vx.bbb.externalUntil";
const EXTERNAL_DAYS = 7;

/** "Open in browser" sticks for a week on this device. */
export function preferExternalForAWeek(): void {
  try {
    localStorage.setItem(
      EXTERNAL_UNTIL_KEY,
      String(Date.now() + EXTERNAL_DAYS * 24 * 60 * 60 * 1000)
    );
  } catch {
    // storage blocked — the choice just won't persist
  }
}

type PendingJoin = { scheduleId: string; joinUrl: string; title?: string };
let pending: PendingJoin | null = null;

export function rememberClassroomJoin(scheduleId: string, joinUrl: string, title?: string) {
  pending = { scheduleId, joinUrl, title };
}

/** Hand the join URL to the class view once; a second read (or reload) gets null. */
export function takeClassroomJoin(scheduleId: string): PendingJoin | null {
  if (!pending || pending.scheduleId !== scheduleId) return null;
  const p = pending;
  pending = null;
  return p;
}

/** Message the class's exit page posts from inside the frame (see index.html). */
export const BBB_EXIT_MESSAGE = "vacademy:bbb-exit";

/** Everything the frame may need; the class view sets no sandbox. */
export const BBB_FRAME_ALLOW = [
  "camera",
  "microphone",
  "display-capture",
  "fullscreen",
  "picture-in-picture",
  "autoplay",
  "clipboard-read",
  "clipboard-write",
  "screen-wake-lock",
  "speaker-selection",
].join("; ");

import { Capacitor } from "@capacitor/core";
import { shellCanHostLiveClass } from "@/lib/live-class/native-live-class";

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
 * Can this device show a live class inside the app? Web always; Android, iOS and
 * desktop only when the installed shell carries the native live-class support
 * (an app store / installer update). An older shell keeps opening classes
 * outside, even though it runs the new JS — see native-live-class.ts.
 */
export function canHostClassInApp(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (!navigator.mediaDevices) return false;
  // Never nest: the learner portal itself inside a frame (e.g. admin preview).
  if (window.self !== window.top) return false;
  return shellCanHostLiveClass();
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

/** Message the Vacademy PiP plugin posts from inside the frame when the app must do PiP (Android). */
export const BBB_PIP_MESSAGE = "vacademy:bbb-pip";
/** The PiP plugin asks (HELLO) whether the app can do PiP; the app answers (REPLY). */
export const BBB_PIP_HELLO = "vacademy:bbb-pip-hello";
export const BBB_PIP_REPLY = "vacademy:bbb-pip-native";

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

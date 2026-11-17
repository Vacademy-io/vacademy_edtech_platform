import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Contract between the in-app live class view and the native shells.
 *
 * Android and iOS implement a local Capacitor plugin named "VacademyLiveClass"
 * (android/app/src/main/java/.../liveclass/, ios/App/App/VacademyLiveClassPlugin.swift).
 * Electron exposes the same calls on window.vacademyShell.liveClass (preload.ts).
 *
 * Backward compatibility: JS reaches every installed app over the air, but a
 * native shell only has this support after a store/installer update. A shell
 * WITHOUT it must keep opening classes outside the app — so the presence of the
 * native piece is the gate (see shellCanHostLiveClass), never the JS version.
 */
export interface VacademyLiveClassPlugin {
  /** Ask for microphone (+ camera, optional) BEFORE the class frame loads, so BBB's own requests are already granted. */
  prepare(options?: { camera?: boolean }): Promise<{ microphone: "granted" | "denied"; camera: "granted" | "denied" }>;
  /** Class started: keep the screen on, keep audio/mic alive when the app is backgrounded or the screen locks, allow PiP. */
  enterClass(options?: { title?: string }): Promise<void>;
  /** Class ended or left: undo everything enterClass did. Safe to call twice. */
  exitClass(): Promise<void>;
  /** Shrink the whole app into the system picture-in-picture window (Android). */
  enterPictureInPicture(): Promise<{ entered: boolean }>;
  addListener(
    event: "pictureInPictureChanged",
    cb: (state: { active: boolean }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const VacademyLiveClass = registerPlugin<VacademyLiveClassPlugin>("VacademyLiveClass");

/** Electron's equivalent, exposed by electron/src/preload.ts (version >= 1 = supported). */
interface ElectronLiveClass {
  version: number;
  enterClass(title?: string): Promise<void>;
  exitClass(): Promise<void>;
}

function electronLiveClass(): ElectronLiveClass | null {
  const shell = (window as unknown as { vacademyShell?: { liveClass?: ElectronLiveClass } }).vacademyShell;
  const lc = shell?.liveClass;
  return lc && typeof lc.version === "number" && lc.version >= 1 ? lc : null;
}

/** Does THIS installed shell carry the native live-class support? */
export function shellCanHostLiveClass(): boolean {
  const platform = Capacitor.getPlatform();
  if (platform === "web") return true;
  if (platform === "electron") return electronLiveClass() !== null;
  if (platform === "android" || platform === "ios") {
    return Capacitor.isPluginAvailable("VacademyLiveClass");
  }
  return false;
}

/** Native prep before mounting the frame. Never throws; reports whether the mic is usable. */
export async function prepareNativeClass(): Promise<{ micOk: boolean }> {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return { micOk: true };
  try {
    const r = await withTimeout(VacademyLiveClass.prepare({ camera: true }), 15_000);
    return { micOk: r?.microphone === "granted" };
  } catch {
    return { micOk: false };
  }
}

export async function enterNativeClass(title?: string): Promise<void> {
  try {
    const platform = Capacitor.getPlatform();
    if (platform === "electron") await electronLiveClass()?.enterClass(title);
    else if (platform === "android" || platform === "ios") await VacademyLiveClass.enterClass({ title });
  } catch (e) {
    console.warn("[live-class] enterClass failed", e);
  }
}

export async function exitNativeClass(): Promise<void> {
  try {
    const platform = Capacitor.getPlatform();
    if (platform === "electron") await electronLiveClass()?.exitClass();
    else if (platform === "android" || platform === "ios") await VacademyLiveClass.exitClass();
  } catch (e) {
    console.warn("[live-class] exitClass failed", e);
  }
}

/** Can the app itself do system PiP (Android shell with the live-class plugin)? */
export function nativePictureInPictureAvailable(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("VacademyLiveClass");
}

/** System PiP of the whole app (Android). False where the shell can't. */
export async function enterNativePictureInPicture(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "android") return false;
  try {
    const r = await VacademyLiveClass.enterPictureInPicture();
    return !!r?.entered;
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

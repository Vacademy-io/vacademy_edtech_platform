/**
 * Camera access and the problems learners actually hit, with fixes worded for
 * their machine. Most live-class learners are on Windows + Chrome/Edge, then
 * macOS + Chrome; phones are not offered the score (see isDesktop).
 */

export type CameraProblem =
  | "denied" // the learner (or a site setting) blocked the camera in the browser
  | "os-blocked" // Windows / macOS privacy settings block the browser itself
  | "in-use" // another app holds the camera (Windows locks it exclusively)
  | "not-found" // no camera at all
  | "ended" // the camera stopped mid-class (unplugged, lid closed, taken by another app)
  | "slow" // this computer cannot keep up; turned off to protect the class audio/video
  | "load" // the face model could not be downloaded
  | "unknown";

export type Platform = "windows" | "mac" | "other";

export const platform = (): Platform => {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  return "other";
};

const browserName = (): string => {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "your browser";
};

/** Laptop / desktop with a mouse or trackpad, wide enough for the class plus the panel. */
export const isDesktop = (): boolean =>
  typeof window !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(any-pointer: fine)").matches &&
  window.innerWidth >= 900 &&
  !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const constraints = (deviceId?: string): MediaStreamConstraints => ({
  // BBB's own webcam default (640x480 @ 15): when a second getUserMedia shares an
  // already-open camera it gets that capture format, so opening ours small first
  // would cap a webcam the learner shares later. The tracker scales frames down
  // to 320 px before detection, so the reading cost does not change.
  video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15, max: 15 },
  },
  audio: false,
});

export class CameraError extends Error {
  readonly problem: CameraProblem;
  constructor(problem: CameraProblem, cause?: unknown) {
    super(problem);
    this.problem = problem;
    this.cause = cause;
  }
}

export const classify = (error: unknown): CameraProblem => {
  const name = (error as { name?: string })?.name ?? "";
  const message = String((error as { message?: string })?.message ?? "");
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      // Chromium says "Permission denied by system" when the OS privacy switch is off.
      return /system/i.test(message) ? "os-blocked" : "denied";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in-use";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "not-found";
    default:
      return "unknown";
  }
};

export const openCamera = async (deviceId?: string): Promise<MediaStream> => {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (first) {
    const problem = classify(first);
    // A chosen camera that disappeared, or a driver that rejects the size hints
    // (seen with some virtual cameras): retry with no constraints at all.
    if (problem === "not-found" || problem === "unknown") {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (second) {
        throw new CameraError(classify(second), second);
      }
    }
    throw new CameraError(problem, first);
  }
};

export const stopStream = (stream: MediaStream | null | undefined) => {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Already stopped.
    }
  });
};

export const listCameras = async (): Promise<MediaDeviceInfo[]> => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput" && d.deviceId);
  } catch {
    return [];
  }
};

/** What to tell the learner, on their own OS and browser. */
export const problemHelp = (problem: CameraProblem): { title: string; body: string } => {
  const os = platform();
  const browser = browserName();
  switch (problem) {
    case "denied":
      return {
        title: "Camera is blocked for this class",
        body: "Click the camera icon at the right end of the address bar, choose Allow, then press Try again.",
      };
    case "os-blocked":
      return os === "mac"
        ? {
            title: "macOS is blocking the camera",
            body: `Open System Settings → Privacy & Security → Camera and turn on ${browser}. macOS may ask you to quit and reopen ${browser}; rejoin the class after that.`,
          }
        : os === "windows"
          ? {
              title: "Windows is blocking the camera",
              body: "Open Settings → Privacy & security → Camera. Turn on “Camera access” and “Let desktop apps access your camera”, then press Try again.",
            }
          : { title: "Your system is blocking the camera", body: "Allow camera access for this browser in your system settings, then press Try again." };
    case "in-use":
      return {
        title: "Camera is busy",
        body:
          os === "windows"
            ? "Another app is using the camera. Close Zoom, Teams, WhatsApp or the Camera app, then press Try again."
            : "Another app is using the camera. Close it, then press Try again.",
      };
    case "not-found":
      return { title: "No camera found", body: "Connect a camera (or open the laptop lid), then press Try again." };
    case "ended":
      return { title: "Camera stopped", body: "The camera was disconnected or taken by another app. Press Try again." };
    case "slow":
      return {
        title: "Paused to keep the class smooth",
        body: "This computer is busy, so the score was turned off to protect the class audio and video. Close other tabs and press Try again.",
      };
    case "load":
      return {
        title: "Could not load",
        body: "The score needs a one-time download that did not finish. Check your internet and press Try again.",
      };
    default:
      return { title: "Camera did not start", body: "Press Try again. If it keeps failing, reload the class." };
  }
};

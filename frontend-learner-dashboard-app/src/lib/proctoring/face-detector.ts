/**
 * On-device face counting for the BASIC proctoring tier.
 *
 * Three backends, most reliable first:
 *
 *  1. `mediapipe` — MediaPipe Tasks Vision (BlazeFace short-range), loaded from
 *                   the CDN only when this runs, so the app bundle every other
 *                   learner downloads is untouched. ~3 MB of WASM + a 200 KB
 *                   model, cached by the browser after the first exam. Same
 *                   model on every platform, so behaviour is predictable.
 *  2. `native`    — the browser's Shape Detection `FaceDetector`. Only exposed
 *                   when a Chrome experimental flag is on, and platform-backed
 *                   (macOS Vision, Android ML Kit), so results vary by OS. Used
 *                   only if MediaPipe cannot load. Never with `fastMode`: on
 *                   macOS it returned 0 faces for a clearly lit, centred face
 *                   that MediaPipe scored 0.94 (2026-09-23 repro).
 *  3. `none`      — neither could load (old Safari, offline CDN). Snapshots
 *                   still upload; a reviewer looks at them instead.
 *
 * Every backend answers the same question: how many faces are in this frame.
 * Nothing here identifies anyone — that is deliberately out of scope for a
 * tier whose whole cost is storage.
 */

export type FaceDetectorName = "native" | "mediapipe" | "none";

export interface FaceCounter {
  readonly name: FaceDetectorName;
  /** Faces in the current frame, or null if the frame could not be read. */
  count(video: HTMLVideoElement): Promise<number | null>;
  close(): void;
}

interface NativeDetectedFace {
  boundingBox: DOMRectReadOnly;
}
interface NativeFaceDetector {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<NativeDetectedFace[]>;
}
type NativeFaceDetectorCtor = new (options?: {
  maxDetectedFaces?: number;
  fastMode?: boolean;
}) => NativeFaceDetector;

interface MediaPipeDetection {
  categories?: { score: number }[];
}
interface MediaPipeFaceDetector {
  detectForVideo(
    video: HTMLVideoElement | HTMLCanvasElement,
    timestampMs: number
  ): { detections: MediaPipeDetection[] };
  close(): void;
}
interface MediaPipeVisionModule {
  FilesetResolver: {
    forVisionTasks(wasmPath: string): Promise<unknown>;
  };
  FaceDetector: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate?: "GPU" | "CPU" };
        runningMode: "VIDEO";
        minDetectionConfidence?: number;
      }
    ): Promise<MediaPipeFaceDetector>;
  };
}

export const MEDIAPIPE_VERSION = "0.10.14";
export const MEDIAPIPE_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MEDIAPIPE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const isFrameReady = (video: HTMLVideoElement) =>
  video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;

/**
 * The current video frame copied into a 2D canvas, which is what the
 * detectors actually read.
 *
 * Handing a live camera <video> straight to a detector makes it import the
 * frame itself, and on macOS a camera frame is a GPU surface — a path that
 * returned 0 faces for a face MediaPipe scores 0.94 from a still copy of the
 * same frame (2026-09-23). drawImage is the same read the snapshots already
 * use successfully, so detection and evidence now see identical pixels.
 * One canvas per counter, reused every tick.
 */
export const makeFrameReader = () => {
  let canvas: HTMLCanvasElement | null = null;
  return (video: HTMLVideoElement): HTMLCanvasElement | null => {
    if (!isFrameReady(video)) return null;
    canvas ??= document.createElement("canvas");
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas;
    } catch {
      return null;
    }
  };
};

const createNative = (): FaceCounter | null => {
  const Ctor = (window as unknown as { FaceDetector?: NativeFaceDetectorCtor })
    .FaceDetector;
  if (typeof Ctor !== "function") return null;
  let detector: NativeFaceDetector;
  try {
    detector = new Ctor({ maxDetectedFaces: 4, fastMode: false });
  } catch {
    return null;
  }
  const readFrame = makeFrameReader();
  return {
    name: "native",
    async count(video) {
      const frame = readFrame(video);
      if (!frame) return null;
      try {
        const faces = await detector.detect(frame);
        return faces.length;
      } catch {
        return null;
      }
    },
    close() {
      // Nothing to release.
    },
  };
};

const createMediaPipe = async (): Promise<FaceCounter | null> => {
  try {
    const vision = (await import(
      /* @vite-ignore */ MEDIAPIPE_BUNDLE
    )) as MediaPipeVisionModule;
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    const detector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate: "CPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
    let lastTimestamp = 0;
    const readFrame = makeFrameReader();
    return {
      name: "mediapipe",
      async count(video) {
        const frame = readFrame(video);
        if (!frame) return null;
        try {
          // MediaPipe requires strictly increasing timestamps per video stream.
          const now = Math.max(performance.now(), lastTimestamp + 1);
          lastTimestamp = now;
          return detector.detectForVideo(frame, now).detections.length;
        } catch {
          return null;
        }
      },
      close() {
        try {
          detector.close();
        } catch {
          // Already closed.
        }
      },
    };
  } catch (error) {
    console.warn("[proctoring] MediaPipe unavailable; snapshots only", error);
    return null;
  }
};

const none: FaceCounter = {
  name: "none",
  async count() {
    return null;
  },
  close() {
    // Nothing to release.
  },
};

/** Best available counter for this device. Never rejects. */
export const createFaceCounter = async (
  enabled: boolean
): Promise<FaceCounter> => {
  if (!enabled) return none;
  const counter = (await createMediaPipe()) ?? createNative() ?? none;
  console.info(`[proctoring] face detector: ${counter.name}`);
  return counter;
};

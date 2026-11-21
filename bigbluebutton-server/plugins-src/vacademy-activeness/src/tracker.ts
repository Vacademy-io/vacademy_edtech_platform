/**
 * On-device attention signals, ported from the learner app's AI-tutor tracker
 * (frontend-learner-dashboard-app/src/lib/tutor/attention-tracker.ts), which is
 * proven on prod. MediaPipe Face Landmarker loads from the CDN when the camera
 * starts; every frame stays in this browser tab.
 *
 *  - face:     is someone in front of the camera
 *  - facing:   is their head turned towards the screen
 *  - eyesOpen: are the eyes open (a long closure reads as dozing)
 *
 * Head direction is measured against the learner's own resting pose, so a
 * laptop camera mounted low or to the side does not read as "looking away".
 * The resting pose is re-learnt after the learner comes back from being away
 * (they may have moved the laptop or their chair).
 */
import type { Sample, Turn } from "./meter";

const MEDIAPIPE_VERSION = "0.10.14";
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface FrameReading {
  sample: Sample;
  /** Mean luminance 0–255 of the frame (low = lens covered or a very dark room). */
  brightness: number;
}

export interface AttentionTracker {
  /** One reading of the current frame, or null when no frame could be read. */
  read(video: HTMLVideoElement): FrameReading | null;
  /** Forget the resting pose (the learner came back and may sit differently). */
  recalibrate(): void;
  /** Still learning this learner's normal head position and eye openness. */
  readonly calibrating: boolean;
  /** The model threw (e.g. a WASM abort): it must be closed and loaded again, not reused. */
  readonly broken: boolean;
  close(): void;
}

interface Landmark {
  x: number;
  y: number;
}
interface FaceLandmarkerResult {
  faceLandmarks: Landmark[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
}
interface FaceLandmarker {
  detectForVideo(frame: HTMLCanvasElement, timestampMs: number): FaceLandmarkerResult;
  close(): void;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  FaceLandmarker: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate?: "GPU" | "CPU" };
        runningMode: "VIDEO";
        numFaces: number;
        outputFaceBlendshapes: boolean;
        minFaceDetectionConfidence?: number;
        minTrackingConfidence?: number;
      }
    ): Promise<FaceLandmarker>;
  };
}

// Face mesh indices: nose tip, outer eye corners, chin.
const NOSE = 1;
const EYE_L = 33;
const EYE_R = 263;
const CHIN = 152;

const CALIBRATION_SAMPLES = 8;
/**
 * A calibration sample must face the camera roughly (a learner glancing at a phone
 * during the first seconds must not become "normal"). A camera far off to the side
 * never passes this, so after CALIBRATION_GIVE_UP face samples the median of
 * everything seen is used instead.
 */
const CALIBRATION_MAX_YAW = 0.35;
const CALIBRATION_GIVE_UP = 24;
const YAW_TOLERANCE = 0.32;
const PITCH_TOLERANCE = 0.16;
/**
 * Eyes count as closed above this blink score — raised per learner from their own
 * resting blink score (narrow eyes, glasses glare and a low camera all read
 * "half closed" while watching), never above BLINK_CLOSED_MAX.
 */
const BLINK_CLOSED = 0.55;
const BLINK_MARGIN = 0.3;
const BLINK_CLOSED_MAX = 0.85;
/** Frames are scaled down to this width before detection (the model needs ~256 px). */
const DETECT_WIDTH = 320;
/** Consecutive closed readings before it is "eyes shut" rather than a blink (~3 s at 1 Hz). */
const CLOSED_SAMPLES = 3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const headPose = (lm: Landmark[]): { yaw: number; pitch: number } | null => {
  const nose = lm[NOSE];
  const l = lm[EYE_L];
  const r = lm[EYE_R];
  const chin = lm[CHIN];
  if (!nose || !l || !r || !chin) return null;
  const midX = (l.x + r.x) / 2;
  const midY = (l.y + r.y) / 2;
  const eyeDist = Math.hypot(r.x - l.x, r.y - l.y);
  const faceHeight = chin.y - midY;
  if (eyeDist < 1e-4 || faceHeight < 1e-4) return null;
  return { yaw: (nose.x - midX) / eyeDist, pitch: (nose.y - midY) / faceHeight };
};

/**
 * Copy the current frame into a 2D canvas and read that. Handing the camera
 * <video> straight to MediaPipe returned no faces on macOS (a camera frame is a
 * GPU surface there) — the same finding as the proctoring and tutor code.
 */
const makeFrameReader = () => {
  let canvas: HTMLCanvasElement | null = null;
  let tiny: HTMLCanvasElement | null = null;
  return {
    frame(video: HTMLVideoElement): HTMLCanvasElement | null {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      canvas ??= document.createElement("canvas");
      // The camera may run larger (so BBB's own webcam is not capped); detection
      // only needs a small frame, which keeps each reading cheap.
      const scale = Math.min(1, DETECT_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas;
      } catch {
        return null;
      }
    },
    brightness(source: HTMLCanvasElement): number {
      tiny ??= Object.assign(document.createElement("canvas"), { width: 16, height: 12 });
      const ctx = tiny.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 128;
      try {
        ctx.drawImage(source, 0, 0, 16, 12);
        const px = ctx.getImageData(0, 0, 16, 12).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
        return sum / (px.length / 4);
      } catch {
        return 128;
      }
    },
  };
};

export const createAttentionTracker = async (): Promise<AttentionTracker> => {
  const vision = (await import(/* webpackIgnore: true */ /* @vite-ignore */ BUNDLE)) as VisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
  // CPU: the GPU delegate returned nothing for camera frames on macOS, and GPU
  // drivers on budget Windows laptops are the least predictable part of the stack.
  const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  const reader = makeFrameReader();
  let lastTimestamp = 0;
  let yaws: number[] = [];
  let pitches: number[] = [];
  let blinks: number[] = [];
  let seen: { yaw: number; pitch: number; blink: number }[] = [];
  let base: { yaw: number; pitch: number } | null = null;
  let blinkClosed = BLINK_CLOSED;
  let closedRun = 0;
  let broken = false;

  const lockBase = (from: { yaw: number; pitch: number; blink: number }[]) => {
    base = { yaw: median(from.map((x) => x.yaw)), pitch: median(from.map((x) => x.pitch)) };
    blinkClosed = Math.min(BLINK_CLOSED_MAX, Math.max(BLINK_CLOSED, median(from.map((x) => x.blink)) + BLINK_MARGIN));
  };

  return {
    read(video) {
      const frame = reader.frame(video);
      if (!frame) return null;
      const brightness = reader.brightness(frame);
      let result: FaceLandmarkerResult;
      try {
        // MediaPipe needs strictly increasing timestamps per stream.
        const now = Math.max(performance.now(), lastTimestamp + 1);
        lastTimestamp = now;
        result = landmarker.detectForVideo(frame, now);
      } catch (error) {
        console.warn("[activeness] face model failed", error);
        broken = true;
        return null;
      }
      const lm = result.faceLandmarks?.[0];
      if (!lm) {
        closedRun = 0;
        return { sample: { face: false, facing: false, eyesOpen: false }, brightness };
      }
      const shapes = result.faceBlendshapes?.[0]?.categories ?? [];
      const blinkScore = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
      const blinkL = blinkScore("eyeBlinkLeft");
      const blinkR = blinkScore("eyeBlinkRight");
      const pose = headPose(lm);
      let turn: Turn | null = pose === null ? "side" : null;
      if (pose) {
        if (!base) {
          const sample = { yaw: pose.yaw, pitch: pose.pitch, blink: (blinkL + blinkR) / 2 };
          seen.push(sample);
          if (Math.abs(pose.yaw) < CALIBRATION_MAX_YAW) {
            yaws.push(sample.yaw);
            pitches.push(sample.pitch);
            blinks.push(sample.blink);
          }
          if (yaws.length >= CALIBRATION_SAMPLES) {
            lockBase(yaws.map((yaw, i) => ({ yaw, pitch: pitches[i]!, blink: blinks[i]! })));
          } else if (seen.length >= CALIBRATION_GIVE_UP) {
            lockBase(seen);
          }
          // Until calibrated, only an extreme turn counts as looking away.
          if (Math.abs(pose.yaw) >= 0.5) turn = "side";
        } else {
          const dPitch = pose.pitch - base.pitch;
          // Sideways first: a head turned to the side also shifts the pitch proxy.
          if (Math.abs(pose.yaw - base.yaw) >= YAW_TOLERANCE) turn = "side";
          else if (dPitch >= PITCH_TOLERANCE) turn = "down";
          else if (dPitch <= -PITCH_TOLERANCE) turn = "up";
        }
      }
      const closed = blinkL > blinkClosed && blinkR > blinkClosed;
      closedRun = closed ? closedRun + 1 : 0;
      return {
        sample: { face: true, facing: turn === null, eyesOpen: closedRun < CLOSED_SAMPLES, turn },
        brightness,
      };
    },
    recalibrate() {
      base = null;
      yaws = [];
      pitches = [];
      blinks = [];
      seen = [];
      blinkClosed = BLINK_CLOSED;
      closedRun = 0;
    },
    get calibrating() {
      return base === null;
    },
    get broken() {
      return broken;
    },
    close() {
      try {
        landmarker.close();
      } catch {
        // Already closed.
      }
    },
  };
};

/**
 * On-device attention signals for the tutor's activeness score.
 *
 * MediaPipe Face Landmarker, loaded from the same CDN as the proctoring face
 * counter and only when the learner turns the camera on, so nobody else
 * downloads it. Every frame stays on the device: the tracker answers three
 * yes/no questions per sample and nothing else leaves this module.
 *
 *  - face:     is someone in front of the camera
 *  - facing:   is their head turned towards the screen (not away / far down)
 *  - eyesOpen: are the eyes open (a long closure reads as dozing)
 *
 * Head direction is measured against the learner's own resting pose (the
 * first seconds with a face), so a laptop camera mounted low or to the side
 * does not read as "looking away".
 */
import { MEDIAPIPE_BUNDLE, MEDIAPIPE_WASM, makeFrameReader } from "@/lib/proctoring/face-detector";

export interface AttentionSample {
  face: boolean;
  facing: boolean;
  eyesOpen: boolean;
}

export interface AttentionTracker {
  /** One reading of the current frame, or null when the frame could not be read. */
  sample(video: HTMLVideoElement): AttentionSample | null;
  close(): void;
}

interface Landmark {
  x: number;
  y: number;
}
interface Blendshapes {
  categories: { categoryName: string; score: number }[];
}
interface FaceLandmarkerResult {
  faceLandmarks: Landmark[][];
  faceBlendshapes?: Blendshapes[];
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

const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Face mesh indices: nose tip, outer eye corners, chin.
const NOSE = 1;
const EYE_L = 33;
const EYE_R = 263;
const CHIN = 152;

/** Samples that set the resting pose; later samples are compared with it. */
const CALIBRATION_SAMPLES = 8;
/** How far the head may turn / tilt from the resting pose and still count as facing. */
const YAW_TOLERANCE = 0.32;
const PITCH_TOLERANCE = 0.16;
/** Both eyes this closed on consecutive samples = eyes shut, not a blink. */
const BLINK_CLOSED = 0.55;
const CLOSED_SAMPLES = 3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Head yaw / pitch proxies from 2D landmarks, scale-free (divided by eye distance / face height). */
export const headPose = (lm: Landmark[]): { yaw: number; pitch: number } | null => {
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

export const createAttentionTracker = async (): Promise<AttentionTracker | null> => {
  try {
    const vision = (await import(/* @vite-ignore */ MEDIAPIPE_BUNDLE)) as VisionModule;
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    // CPU: the GPU delegate returned nothing for camera frames on macOS
    // (same finding as the proctoring counter).
    const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    const readFrame = makeFrameReader();
    let lastTimestamp = 0;
    const yaws: number[] = [];
    const pitches: number[] = [];
    let base: { yaw: number; pitch: number } | null = null;
    let closedRun = 0;
    return {
      sample(video) {
        const frame = readFrame(video);
        if (!frame) return null;
        let result: FaceLandmarkerResult;
        try {
          const now = Math.max(performance.now(), lastTimestamp + 1);
          lastTimestamp = now;
          result = landmarker.detectForVideo(frame, now);
        } catch {
          return null;
        }
        const lm = result.faceLandmarks?.[0];
        if (!lm) {
          closedRun = 0;
          return { face: false, facing: false, eyesOpen: false };
        }
        const pose = headPose(lm);
        let facing = pose !== null;
        if (pose) {
          if (!base) {
            yaws.push(pose.yaw);
            pitches.push(pose.pitch);
            if (yaws.length >= CALIBRATION_SAMPLES) base = { yaw: median(yaws), pitch: median(pitches) };
            // Until calibrated, only an extreme turn counts as looking away.
            facing = Math.abs(pose.yaw) < 0.5;
          } else {
            facing =
              Math.abs(pose.yaw - base.yaw) < YAW_TOLERANCE && Math.abs(pose.pitch - base.pitch) < PITCH_TOLERANCE;
          }
        }
        const shapes = result.faceBlendshapes?.[0]?.categories ?? [];
        const blink = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
        const closed = blink("eyeBlinkLeft") > BLINK_CLOSED && blink("eyeBlinkRight") > BLINK_CLOSED;
        closedRun = closed ? closedRun + 1 : 0;
        return { face: true, facing, eyesOpen: closedRun < CLOSED_SAMPLES };
      },
      close() {
        try {
          landmarker.close();
        } catch {
          // Already closed.
        }
      },
    };
  } catch (error) {
    console.warn("[tutor] attention tracker unavailable", error);
    return null;
  }
};

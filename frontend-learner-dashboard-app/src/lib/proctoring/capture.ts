/** Snapshot geometry. 320 px wide at q=0.6 is ~12–20 KB: legible for a reviewer, cheap to keep. */
const SNAPSHOT_WIDTH = 320;
const SNAPSHOT_QUALITY = 0.6;

/** The current video frame as a small JPEG, or null if the frame is not ready. */
export const captureJpeg = (video: HTMLVideoElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      resolve(null);
      return;
    }
    const scale = SNAPSHOT_WIDTH / video.videoWidth;
    const canvas = document.createElement("canvas");
    canvas.width = SNAPSHOT_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      resolve(null);
      return;
    }
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", SNAPSHOT_QUALITY);
    } catch {
      resolve(null);
    }
  });

/** Low-res, front camera, no audio: enough for a face, cheap on CPU and battery. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 10, max: 15 },
    facingMode: "user",
  },
  audio: false,
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

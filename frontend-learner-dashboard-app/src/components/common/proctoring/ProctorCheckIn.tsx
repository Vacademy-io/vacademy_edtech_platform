import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, CheckCircle, WarningCircle, SpinnerGap } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";
import { createFaceCounter, type FaceCounter } from "@/lib/proctoring/face-detector";
import { CAMERA_CONSTRAINTS, captureJpeg, stopStream } from "@/lib/proctoring/capture";
import { stashCheckIn } from "@/services/proctoring";
import type { ProctoringConfig } from "@/types/proctoring";

type Step = "intro" | "starting" | "preview" | "denied" | "done";

const OVERRIDE_AFTER_MS = 10_000;

/**
 * Camera check-in on the instructions page, before the timer starts.
 *
 * Asks for the camera, shows the learner what the camera sees, waits for one
 * face (when a detector is available) and keeps a single frame as the
 * check-in selfie. The frame is uploaded by the live page once an attempt id
 * exists. The stream is released on "done" — the live page re-acquires it,
 * and the browser does not prompt twice for the same origin.
 *
 * If the camera is refused and the assessment requires it, Start stays
 * disabled; if it is optional, the learner can continue and the refusal is
 * logged as a flag by the live page.
 */
export const ProctorCheckIn = ({
  assessmentId,
  config,
  onReadyChange,
}: {
  assessmentId: string;
  config: ProctoringConfig;
  onReadyChange: (ready: boolean) => void;
}) => {
  const { t } = useTranslation("proctoring");
  const [step, setStep] = useState<Step>("intro");
  const [faces, setFaces] = useState<number | null>(null);
  const [detector, setDetector] = useState<string>("none");
  const [detectorLoading, setDetectorLoading] = useState(false);
  // A detector can be wrong (it was, on macOS). After this long without a
  // confirmed single face the learner may continue anyway; the check-in is
  // then recorded as unverified for the teacher instead of blocking the exam.
  const [allowOverride, setAllowOverride] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const counterRef = useRef<FaceCounter | null>(null);

  const required = !!config.camera_required;

  useEffect(() => {
    onReadyChange(step === "done" || (!required && step === "denied"));
  }, [step, required, onReadyChange]);

  // Release everything on unmount, whatever step we were at.
  useEffect(
    () => () => {
      stopStream(streamRef.current);
      counterRef.current?.close();
    },
    []
  );

  // The <video> only exists in the "preview" step; attach the stream after it mounts.
  useEffect(() => {
    if (step !== "preview") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);
  }, [step]);

  useEffect(() => {
    if (step !== "preview" || detectorLoading || faces === 1) {
      setAllowOverride(false);
      return;
    }
    const timer = setTimeout(() => setAllowOverride(true), OVERRIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [step, detectorLoading, faces]);

  // While previewing, count faces so the learner can line themselves up.
  useEffect(() => {
    if (step !== "preview" || !config.face_check) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    setDetectorLoading(true);
    createFaceCounter(true).then((counter) => {
      if (cancelled) {
        counter.close();
        return;
      }
      counterRef.current = counter;
      setDetector(counter.name);
      setDetectorLoading(false);
      if (counter.name === "none") return;
      interval = setInterval(async () => {
        const video = videoRef.current;
        if (!video) return;
        const n = await counter.count(video);
        if (!cancelled && n !== null) setFaces(n);
      }, 800);
    });
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [step, config.face_check]);

  const startCamera = async () => {
    setStep("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;
      setStep("preview"); // The effect below attaches the stream once <video> exists.
    } catch {
      setStep("denied");
    }
  };

  const confirm = async () => {
    const video = videoRef.current;
    if (video) {
      const blob = await captureJpeg(video);
      if (blob) {
        const verified = detector === "none" || !config.face_check || faces === 1;
        stashCheckIn({
          assessmentId,
          blob,
          detector,
          faces: detector === "none" ? null : faces,
          unverified: !verified,
        });
      }
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    counterRef.current?.close();
    counterRef.current = null;
    setStep("done");
  };

  // With a detector, wait for exactly one face; without one, trust the learner.
  const faceConfirmed = detector === "none" || !config.face_check || faces === 1;
  const canConfirm = step === "preview" && !detectorLoading && (faceConfirmed || allowOverride);

  return (
    <section
      className={cn(
        "mt-5 rounded-xl border p-4",
        step === "done"
          ? "border-success-300 bg-success-50"
          : step === "denied" && required
            ? "border-danger-300 bg-danger-50"
            : "border-neutral-200 bg-white"
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 flex-none items-center justify-center rounded-lg bg-primary-50 text-primary-500">
          <Camera size={20} weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-subtitle font-semibold text-neutral-700">
            {t("checkIn.title")}
          </p>
          <p className="mt-1 text-body text-neutral-500">
            {t(required ? "checkIn.descriptionRequired" : "checkIn.descriptionOptional")}
          </p>

          {step === "intro" && (
            <MyButton
              type="button"
              buttonType="primary"
              scale="medium"
              className="mt-3"
              onClick={startCamera}
            >
              {t("checkIn.allowCamera")}
            </MyButton>
          )}

          {step === "starting" && (
            <p className="mt-3 flex items-center gap-2 text-body text-neutral-500">
              <SpinnerGap size={18} className="animate-spin" weight="bold" />
              {t("checkIn.starting")}
            </p>
          )}

          {step === "preview" && (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="relative w-full max-w-reg-280 overflow-hidden rounded-lg bg-neutral-900">
                <video
                  ref={videoRef}
                  className="aspect-video w-full object-cover"
                  autoPlay
                  muted
                  playsInline
                />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <p className="text-body text-neutral-600">
                  {config.face_check && detector !== "none"
                    ? faces === 1
                      ? t("checkIn.faceOk")
                      : faces === 0
                        ? t("checkIn.faceNone")
                        : faces && faces > 1
                          ? t("checkIn.faceMany")
                          : t("checkIn.faceLooking")
                    : t("checkIn.noDetector")}
                </p>
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="medium"
                  disabled={!canConfirm}
                  onClick={confirm}
                >
                  {faceConfirmed ? t("checkIn.confirm") : t("checkIn.continueAnyway")}
                </MyButton>
                {!faceConfirmed && allowOverride && (
                  <p className="text-caption text-neutral-500">{t("checkIn.overrideNote")}</p>
                )}
              </div>
            </div>
          )}

          {step === "denied" && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="flex items-center gap-2 text-body text-danger-600">
                <WarningCircle size={18} weight="fill" />
                {t(required ? "checkIn.deniedRequired" : "checkIn.deniedOptional")}
              </p>
              <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                onClick={startCamera}
              >
                {t("checkIn.retry")}
              </MyButton>
            </div>
          )}

          {step === "done" && (
            <p className="mt-3 flex items-center gap-2 text-body text-success-600">
              <CheckCircle size={18} weight="fill" />
              {t("checkIn.done")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

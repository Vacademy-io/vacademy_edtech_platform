import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";
import { Camera, CameraSlash, Warning } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useCameraProctor } from "@/hooks/proctoring/useCameraProctor";
import { fetchProctoringConfig } from "@/services/proctoring";
import { isProctored, PROCTORING_OFF, type ProctoringConfig } from "@/types/proctoring";

/**
 * Mounted inside the live test shell. Renders nothing at all for an
 * unproctored assessment — the config fetch is the only thing that runs, and
 * a failed fetch resolves to "off" — so the ~all existing exams are untouched.
 *
 * For a proctored one it owns the camera for the life of the attempt and
 * shows a small self-view (when the admin left it on) so the learner always
 * knows they are on camera. The <video> element is rendered even when the
 * self-view is hidden: the detector needs a playing element to read frames.
 */
export const ProctorLayer = ({ assessmentId }: { assessmentId: string }) => {
  const { t } = useTranslation("proctoring");
  const [config, setConfig] = useState<ProctoringConfig | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const attemptId = useAssessmentStore((s) => s.assessment?.attempt_id);
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  const requestProctorAutoSubmit = useAssessmentStore((s) => s.requestProctorAutoSubmit);

  useEffect(() => {
    if (!assessmentId) return;
    let cancelled = false;
    fetchProctoringConfig(assessmentId).then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    Preferences.get({ key: "StudentDetails" }).then((result) => {
      if (cancelled || !result.value) return;
      try {
        setUserId(JSON.parse(result.value)?.user_id ?? null);
      } catch {
        setUserId(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const effective = config ?? PROCTORING_OFF;
  const enabled = isProctored(effective) && !isSubmitted;

  const { status, faces, flagCount, videoRef, flush } = useCameraProctor({
    enabled,
    config: effective,
    assessmentId,
    attemptId,
    userId,
    onCeilingReached: requestProctorAutoSubmit,
  });

  // Drain the queue when the attempt ends so the last flags reach the server.
  useEffect(() => {
    if (isSubmitted) void flush();
  }, [isSubmitted, flush]);

  if (!enabled) return null;

  const showSelfView = !!effective.show_self_view;
  const trouble = status === "denied" || status === "lost";
  const faceTrouble = status === "on" && faces !== null && faces !== 1;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-20 end-3 z-40 flex flex-col items-end gap-1",
        !showSelfView && "sr-only"
      )}
      aria-live="polite"
    >
      <div
        className={cn(
          "relative w-reg-120 overflow-hidden rounded-lg border-2 bg-neutral-900 shadow-md",
          trouble || faceTrouble ? "border-danger-400" : "border-success-400"
        )}
      >
        <video
          ref={videoRef}
          className="aspect-video w-full object-cover"
          autoPlay
          muted
          playsInline
        />
        <span className="absolute start-1 top-1 flex items-center gap-1 rounded-sm bg-neutral-900/70 px-1 py-0.5 text-caption text-white">
          {trouble ? (
            <CameraSlash size={12} weight="fill" />
          ) : (
            <Camera size={12} weight="fill" />
          )}
          {t("selfView.recording")}
        </span>
      </div>
      {(trouble || faceTrouble) && (
        <span className="flex items-center gap-1 rounded-md bg-danger-50 px-2 py-1 text-caption text-danger-600">
          <Warning size={12} weight="fill" />
          {status === "denied"
            ? t("selfView.denied")
            : status === "lost"
              ? t("selfView.lost")
              : faces === 0
                ? t("selfView.noFace")
                : t("selfView.manyFaces")}
        </span>
      )}
      {flagCount > 0 && (effective.max_violations ?? 0) > 0 && (
        <span className="rounded-md bg-neutral-100 px-2 py-1 text-caption text-neutral-600">
          {t("selfView.flags", { count: flagCount, max: effective.max_violations })}
        </span>
      )}
    </div>
  );
};

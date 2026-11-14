import { useEffect, useMemo, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import confetti from "canvas-confetti";
import LocalStorageUtils from "@/utils/localstorage";
import {
  generateCertificateWithCache,
  getCachedCertificateStatus,
  getCertificateConfig,
} from "@/services/certificates";

type SearchParamsLike = {
  courseId?: string;
  percentageCompleted?: number;
  percentage_completed?: unknown;
};

// percent can come from query param (carried over from the course list)
const readPctFromSearch = (
  searchParams: SearchParamsLike,
): number | undefined => {
  const raw =
    searchParams.percentageCompleted ?? searchParams.percentage_completed;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

// Enhanced multi-burst confetti (professional feel)
const fireCelebrationConfetti = () => {
  try {
    const colors = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"]; // design-lint-ignore: confetti effect palette
    const defaults = {
      colors,
      origin: { y: 0.6 },
    } as const;

    function fire(
      particleRatio: number,
      opts: {
        [K in keyof import("canvas-confetti").Options]?: import("canvas-confetti").Options[K];
      } = {},
    ) {
      confetti({
        ...defaults,
        particleCount: Math.floor(220 * particleRatio),
        ...opts,
      });
    }

    // Central bursts
    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.9,
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2,
    });
    fire(0.1, { spread: 120, startVelocity: 45 });

    // Side cannons
    confetti({
      ...defaults,
      particleCount: 60,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      gravity: 0.9,
    });
    confetti({
      ...defaults,
      particleCount: 60,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      gravity: 0.9,
    });

    // Subtle fireworks loop for 2s
    const end = Date.now() + 2000;
    (function frame() {
      confetti({
        ...defaults,
        particleCount: 3,
        startVelocity: 40,
        ticks: 60,
        origin: {
          x: Math.random(),
          y: Math.random() * 0.4 + 0.2,
        },
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  } catch {
    // Confetti error handling
  }
};

// Owns the completion percentage shown on the page and the
// certificate-generation flow (threshold gate, cached certificate display,
// one-time confetti celebration, backend re-confirmation).
export function useCertificateGeneration({
  packageSessionIdForCurrentLevel,
  courseDetailsData,
  searchParams,
}: {
  packageSessionIdForCurrentLevel: string | null;
  courseDetailsData: unknown;
  searchParams: SearchParamsLike;
}) {
  const { t } = useTranslation("courseDetailsB");
  const [certificateUrl, setCertificateUrl] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState<boolean>(false);
  const [certificateDialogOpen, setCertificateDialogOpen] =
    useState<boolean>(false);
  const [completionPercentage, setCompletionPercentage] = useState<number>(0);
  const [certificateThreshold, setCertificateThreshold] = useState<number>(80);
  // Whether certificates are switched on for this batch, resolved server-side.
  // Starts false so no certificate UI flashes before the answer arrives.
  const [certificatesEnabled, setCertificatesEnabled] = useState<boolean>(false);

  // Progress is recorded per batch, not per course, so the number shown has to
  // belong to the package_session whose content this page is rendering. A
  // learner enrolled in several batches of one course has a different
  // percentage in each, and the course-level value is the best of them — it
  // used to leak another batch's number onto this page.
  //
  // Precedence: this batch → course-level (best-of-batches, for learners whose
  // batch hasn't resolved yet) → the snapshot the catalogue card carried in the
  // URL → localStorage. The last two are cold-start fallbacks only; they go
  // stale the moment the learner studies anything, so the backend always wins.
  const resolvedCompletionPercentage = useMemo(() => {
    const data = courseDetailsData as
      | {
          course?: { percentage_completed?: number | null };
          package_sessions?: Array<{
            id?: string;
            percentage_completed?: number | null;
          }>;
        }
      | null
      | undefined;

    // Only the authenticated course-init response carries per-batch numbers. If
    // not one batch has one, we're on an older backend (or an unauthenticated
    // payload) and must not read "no entry" as "no progress" — fall through.
    const batches = data?.package_sessions;
    const hasPerBatchProgress = batches?.some(
      (ps) => typeof ps.percentage_completed === "number",
    );

    if (packageSessionIdForCurrentLevel && hasPerBatchProgress) {
      const thisBatch = batches?.find(
        (ps) => ps.id === packageSessionIdForCurrentLevel,
      );
      // A batch present in the payload with no stored rollup genuinely has no
      // progress. Returning 0 rather than falling through is the point of the
      // fix: the course-level value below is some other batch's number.
      if (thisBatch) return thisBatch.percentage_completed ?? 0;
    }

    const pctFromCourse = data?.course?.percentage_completed;
    if (typeof pctFromCourse === "number") return pctFromCourse;

    const pctFromQuery = readPctFromSearch(searchParams);
    if (typeof pctFromQuery === "number") return pctFromQuery;

    const pctFromLocal = LocalStorageUtils.get<{
      value: number;
      ts: number;
    }>(`COURSE_PCT_${searchParams.courseId}`)?.value;
    return typeof pctFromLocal === "number" ? pctFromLocal : undefined;
  }, [courseDetailsData, packageSessionIdForCurrentLevel, searchParams]);

  useEffect(() => {
    if (typeof resolvedCompletionPercentage === "number") {
      setCompletionPercentage(resolvedCompletionPercentage);
    }
  }, [resolvedCompletionPercentage]);

  // Trigger certificate generation after entering this page once essentials are available
  useEffect(() => {
    const tryGenerateCertificate = async () => {
      if (!packageSessionIdForCurrentLevel) return;

      // Resolved server-side from Certificate Settings, per batch, so a course
      // that overrides the institute default is honoured here too. Fails closed:
      // a fetch error yields enabled=false rather than attempting issuance.
      const certificateConfig = await getCertificateConfig(
        packageSessionIdForCurrentLevel,
      );
      setCertificatesEnabled(certificateConfig.enabled);

      if (!certificateConfig.enabled) {
        return;
      }

      try {
        const threshold = certificateConfig.thresholdPercent;
        setCertificateThreshold(threshold);
        // Same batch-scoped value the progress card shows — certificates are
        // issued per package_session, so gating on another batch's percentage
        // would issue the wrong certificate (or none at all).
        const percentageCompleted = resolvedCompletionPercentage;
        const userDetailsRaw = await Preferences.get({
          key: "StudentDetails",
        });
        const user = userDetailsRaw.value
          ? JSON.parse(userDetailsRaw.value)
          : null;
        const userId: string | null = user?.user_id || user?.id || null;

        if (!userId || !packageSessionIdForCurrentLevel) return;

        // Always surface cached certificate if present
        const cached = getCachedCertificateStatus(
          userId,
          packageSessionIdForCurrentLevel,
        );
        if (cached?.url) {
          setCertificateUrl(cached.url);
        }

        if (percentageCompleted == null) return;

        if (
          typeof percentageCompleted === "number" &&
          percentageCompleted >= threshold
        ) {
          const celebrationKey = `CERTIFICATE_CELEBRATED_${userId}_${packageSessionIdForCurrentLevel}`;
          const alreadyCelebrated =
            !!LocalStorageUtils.get<boolean>(celebrationKey);

          const res = await generateCertificateWithCache(
            {
              user_id: userId,
              package_session_id: packageSessionIdForCurrentLevel,
              // Required by the backend eligibility gate: a fresh render returns
              // no certificate when the percentage is missing/below threshold.
              // course_name is intentionally omitted here — the backend falls
              // back to the package name (the authoritative course title).
              completion_percentage: percentageCompleted,
            },
            // Confirm with the backend instead of trusting the 3-hour local
            // cache: the instant-display above (getCachedCertificateStatus)
            // already painted any cached URL, but the backend is the source of
            // truth for the *current* template. Repeat calls are cheap because
            // the backend returns its own cached file id (202) when present and
            // only re-renders after an admin saves new certificate settings.
            { bypassCache: true },
          );

          setCertificateUrl(res.url || null);

          if (res.status === 200 && !alreadyCelebrated) {
            fireCelebrationConfetti();
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 3000);
            setTimeout(() => setCertificateDialogOpen(true), 3200);
            toast.success(t("certificateGeneration.toast.successTitle"), {
              description: t("certificateGeneration.toast.successDescription"),
            });
            // Mark celebration as shown to avoid repeating confetti on future visits
            LocalStorageUtils.set(celebrationKey, true);
          }
        }
      } catch (error) {
        // Since we already checked that certificate generation is enabled above,
        // we can safely show the error toast

        // Handle specific error types for better user experience
        if (error instanceof Error && error.message.includes("404")) {
          // Don't show error toast for 404 - this suggests the API endpoint is not configured
          return;
        }

        toast.error(t("certificateGeneration.toast.error"));
      }
    };

    // Only attempt after we have course data and package session id
    if (packageSessionIdForCurrentLevel && courseDetailsData) {
      tryGenerateCertificate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    packageSessionIdForCurrentLevel,
    courseDetailsData,
    resolvedCompletionPercentage,
  ]);

  return {
    certificateUrl,
    showConfetti,
    certificateDialogOpen,
    setCertificateDialogOpen,
    completionPercentage,
    certificateThreshold,
    certificatesEnabled,
  };
}

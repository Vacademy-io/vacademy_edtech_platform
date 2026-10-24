import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState, useCallback } from "react";
import { Star, Warning, CheckCircle, CircleNotch } from "@phosphor-icons/react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getPublicUrl } from "@/services/upload_file";
import { cn } from "@/lib/utils";
import { MyButton } from "@/components/design-system/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import type {
  FeedbackConfigResponse,
  FeedbackQuestion,
} from "../-types/types";
import { useTranslation } from "react-i18next";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";

export const Route = createFileRoute("/study-library/live-class/feedback/")(
  {
    validateSearch: z.object({
      scheduleId: z.string(),
    }),
    component: FeedbackPage,
  }
);

/* Shared page shell so every state (loading / success / form) sits on the same
   centred, subtly brand-tinted background. */
function FeedbackShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-primary-50/40 via-background to-background p-4">
      {children}
    </div>
  );
}

/* ─────────────────────── Star Rating Component ─────────────────────── */

function StarRating({
  value,
  onChange,
  maxStars = 5,
  allowHalf = true,
}: {
  value: number;
  onChange: (v: number) => void;
  maxStars?: number;
  allowHalf?: boolean;
}) {
  const { t } = useTranslation("study");
  const RATING_WORDS = [
    t("liveClass.feedback.rating.poor"),
    t("liveClass.feedback.rating.fair"),
    t("liveClass.feedback.rating.good"),
    t("liveClass.feedback.rating.veryGood"),
    t("liveClass.feedback.rating.excellent"),
  ];
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value;

  const valueFromEvent = (
    starIndex: number,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (!allowHalf) return starIndex + 1;
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeft = e.clientX - rect.left < rect.width / 2;
    return isLeft ? starIndex + 0.5 : starIndex + 1;
  };

  const word =
    displayValue > 0
      ? RATING_WORDS[
          Math.max(0, Math.min(RATING_WORDS.length - 1, Math.round(displayValue) - 1))
        ]
      : "";

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHoverValue(null)}
      >
        {Array.from({ length: maxStars }, (_, i) => {
          const fill =
            displayValue >= i + 1
              ? "full"
              : displayValue >= i + 0.5
                ? "half"
                : "none";
          return (
            <button
              key={i}
              type="button"
              aria-label={t("liveClass.feedback.rating.starAriaLabel", { count: i + 1 })}
              className="relative rounded-md transition-transform duration-150 ease-out hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
              onClick={(e) => onChange(valueFromEvent(i, e))}
              onMouseMove={(e) => setHoverValue(valueFromEvent(i, e))}
            >
              {/* Empty base */}
              <Star weight="regular" className="h-9 w-9 text-neutral-300" />
              {/* Filled overlay, width-clipped to the fill amount */}
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 overflow-hidden",
                  fill === "full" ? "w-full" : fill === "half" ? "w-1/2" : "w-0"
                )}
              >
                <Star weight="fill" className="h-9 w-9 text-warning-400" />
              </span>
            </button>
          );
        })}
      </div>
      {displayValue > 0 && (
        <p className="text-caption font-medium text-muted-foreground">
          <span className="text-warning-600">{displayValue}</span> / {maxStars}
          {word && <span className="text-foreground"> · {word}</span>}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────── Main Feedback Page ─────────────────────── */

function FeedbackPage() {
  const { t } = useTranslation("study");
  const session = getTerminology(ContentTerms.Session, SystemTerms.Session);
  const liveSessions = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const instructor = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
  const { scheduleId } = Route.useSearch();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [config, setConfig] = useState<FeedbackConfigResponse | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string | number>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // First letter of the institute name, used as a graceful logo fallback when
  // there is no logo or it fails to load.
  const instituteInitial =
    config?.institute_name?.trim().charAt(0).toUpperCase() ?? "";

  // Fetch feedback config. Do NOT auto-redirect when feedback is missing /
  // disabled — silently bouncing the learner away after the meeting ends made
  // it look like the page "flashed and disappeared". Instead, render a clear
  // thank-you state and let the learner navigate back themselves.
  useEffect(() => {
    if (!scheduleId) {
      navigate({ to: "/study-library/live-class" });
      return;
    }

    authenticatedAxiosInstance
      .get(
        `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/feedback-config`,
        { params: { scheduleId } }
      )
      .then((res) => {
        const data: FeedbackConfigResponse = res.data;
        // Diagnostic — verify what the API actually returned for this schedule.
        // Helpful when an admin enabled feedback but the form still doesn't
        // render (data may not have persisted on the matching session row).
        // eslint-disable-next-line no-console
        console.log("[Feedback] config response", data);
        setConfig(data);
        if (data.already_submitted) {
          setSubmitted(true);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[Feedback] failed to load feedback config", err);
        setConfig(null);
      })
      .finally(() => setLoading(false));
  }, [scheduleId, navigate]);

  // Resolve the institute logo. The backend returns institute_logo as the raw
  // media file ID (not a public URL), so a direct <img src> 404s — that was the
  // broken-logo bug. getPublicUrl() resolves a file ID to a signed URL and
  // passes any already-direct http(s) URL through unchanged, so this is safe
  // regardless of what the API sends.
  useEffect(() => {
    let cancelled = false;
    const raw = config?.institute_logo;
    if (!raw) {
      setLogoUrl(null);
      return;
    }
    getPublicUrl(raw)
      .then((url) => {
        if (!cancelled) setLogoUrl(url || null);
      })
      .catch(() => {
        if (!cancelled) setLogoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [config?.institute_logo]);

  // Auto-redirect after successful submission
  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => {
      navigate({ to: "/study-library/live-class" });
    }, 4000);
    return () => clearTimeout(timer);
  }, [submitted, navigate]);

  // ─── Compulsory feedback lock-in ──────────────────────────────────────────
  // When the admin sets feedback as compulsory (allow_skip === false), the
  // learner cannot exit the page through the app UI until they submit.
  // useBlocker.shouldBlockFn intercepts every in-app navigation — sidebar
  // links, back button, programmatic navigate() — and hard-blocks them
  // (returns true = block, no prompt). Tab close / refresh / external URLs
  // are intentionally NOT blocked; the browser-level beforeunload prompt
  // tends to be intrusive and the admin still gets backend enforcement
  // (LiveSessionProviderController.submitFeedback rejects empty mandatory
  // answers when allow_skip is false). UI also hides the Skip button and
  // shows a "Feedback required" banner so the learner understands why.
  const mustSubmit =
    !loading &&
    !submitted &&
    config?.feedback_config?.enabled === true &&
    config?.feedback_config?.allow_skip === false;

  useBlocker({
    shouldBlockFn: () => mustSubmit,
  });

  const enabledQuestions = (config?.feedback_config?.questions ?? []).filter(
    (q) => q.enabled
  );

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, boolean> = {};
    let valid = true;
    for (const q of enabledQuestions) {
      if (q.mandatory) {
        const val = responses[q.id];
        if (val === undefined || val === "" || val === 0) {
          newErrors[q.id] = true;
          valid = false;
        }
      }
    }
    setErrors(newErrors);
    return valid;
  }, [enabledQuestions, responses]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await authenticatedAxiosInstance.post(
        `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/feedback`,
        { schedule_id: scheduleId, responses }
      );
      // Server already collapses duplicates into 200 ({status: 'already_submitted'}),
      // so this branch is the only "submission succeeded" path.
      setSubmitted(true);
    } catch (e) {
      // Server-side rejections must NOT be treated as success — the prior
      // catch-all flipped to the success screen even when the backend
      // returned 400 validation_failed (e.g. compulsory feedback with an
      // empty mandatory answer), recording nothing. Keep the form visible
      // so the learner can fix and retry.
      // eslint-disable-next-line no-console
      console.error("[Feedback] submit failed", e);
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <FeedbackShell>
        <div className="flex flex-col items-center gap-stack text-muted-foreground">
          <CircleNotch className="h-8 w-8 animate-spin text-primary-500" />
          <p className="text-body">{t("liveClass.feedback.loadingForm")}</p>
        </div>
      </FeedbackShell>
    );
  }

  /* ── Already-submitted / success state ── */
  if (submitted) {
    return (
      <FeedbackShell>
        <Card className="w-full max-w-lg p-8 text-center shadow-md animate-in fade-in zoom-in-95 duration-500">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-success-100">
            <CheckCircle weight="fill" className="h-9 w-9 text-success-500" />
          </div>
          <h2 className="text-h3 font-semibold text-foreground">
            {t("liveClass.feedback.thankYouTitle")}
          </h2>
          <p className="mt-2 text-body text-muted-foreground">
            {t("liveClass.feedback.responsesRecorded")}
          </p>
        </Card>
      </FeedbackShell>
    );
  }

  /* ── No feedback configured for this session ── */
  // Reached when the API returned no feedback_config or feedback_config.enabled
  // is false. Show a friendly thank-you screen instead of silently redirecting,
  // so the learner sees something after the meeting and can navigate back when
  // ready.
  if (!config?.feedback_config?.enabled) {
    return (
      <FeedbackShell>
        <Card className="w-full max-w-lg p-8 text-center shadow-md animate-in fade-in zoom-in-95 duration-500">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-success-100">
            <CheckCircle weight="fill" className="h-9 w-9 text-success-500" />
          </div>
          <h2 className="text-h3 font-semibold text-foreground">
            {t("liveClass.feedback.thanksForAttending")}
          </h2>
          <p className="mt-2 text-body text-muted-foreground">
            {config?.session_title
              ? t("liveClass.feedback.hopeFoundTitled", { title: config.session_title })
              : t("liveClass.feedback.hopeFoundGeneric", { session: session.toLowerCase() })}
          </p>
          <MyButton
            buttonType="primary"
            scale="large"
            className="mt-6 w-full min-w-0"
            onClick={() => navigate({ to: "/study-library/live-class" })}
          >
            {t("liveClass.feedback.backToLiveClasses", { liveSessions })}
          </MyButton>
        </Card>
      </FeedbackShell>
    );
  }

  /* ── Main feedback form ── */
  return (
    <FeedbackShell>
      <Card className="w-full max-w-lg p-6 shadow-md sm:p-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        {/* Header / Branding */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={config?.institute_name ?? t("liveClass.feedback.instituteLogoAlt")}
                className="h-full w-full object-contain p-1.5"
                onError={() => setLogoUrl(null)}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-400 to-primary-500 text-h2 font-semibold text-primary-foreground">
                {instituteInitial || <Star weight="fill" className="h-6 w-6" />}
              </span>
            )}
          </div>
          <h1 className="text-h2 font-semibold text-foreground sm:text-h1">
            {t("liveClass.feedback.sessionFeedbackTitle", { session })}
          </h1>
          {config?.session_title && (
            <p className="mt-1 text-body text-muted-foreground">
              {config.session_title}
            </p>
          )}
          {config?.institute_name && (
            <p className="mt-1 text-caption uppercase tracking-wide text-neutral-400">
              {config.institute_name}
            </p>
          )}
        </div>

        {/* Compulsory-feedback notice */}
        {config?.feedback_config?.allow_skip === false && (
          <Alert className="mt-6 border-warning-200 bg-warning-50 text-warning-700 [&>svg]:text-warning-600">
            <Warning weight="fill" className="h-4 w-4" />
            <AlertDescription className="text-warning-700">
              <span className="font-semibold text-warning-700">
                {t("liveClass.feedback.requiredLabel")}
              </span>{" "}
              {t("liveClass.feedback.requiredBody", {
                instructor: instructor.toLowerCase(),
                session: session.toLowerCase(),
              })}
            </AlertDescription>
          </Alert>
        )}

        {/* Questions */}
        <div className="mt-6 flex flex-col gap-4">
          {enabledQuestions.map((q: FeedbackQuestion) => (
            <Card key={q.id} className="p-4 shadow-sm sm:p-5">
              <Label className="text-subtitle font-semibold text-foreground">
                {q.label}
                {q.mandatory && (
                  <span className="ms-0.5 text-danger-500">*</span>
                )}
              </Label>

              <div className="mt-3">
                {q.type === "star_rating" ? (
                  <StarRating
                    value={(responses[q.id] as number) || 0}
                    onChange={(v) =>
                      setResponses((prev) => ({ ...prev, [q.id]: v }))
                    }
                    maxStars={q.max_stars ?? 5}
                    allowHalf={q.allow_half ?? true}
                  />
                ) : (
                  <Textarea
                    className={cn(
                      "min-h-24 resize-y bg-background",
                      errors[q.id] &&
                        "border-danger-400 focus-visible:ring-danger-400"
                    )}
                    placeholder={t("liveClass.feedback.responsePlaceholder")}
                    value={(responses[q.id] as string) || ""}
                    onChange={(e) => {
                      setResponses((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }));
                      if (errors[q.id]) {
                        setErrors((prev) => ({ ...prev, [q.id]: false }));
                      }
                    }}
                    rows={3}
                    maxLength={2000}
                  />
                )}
              </div>

              {errors[q.id] && (
                <p className="mt-1.5 text-caption text-danger-600">
                  {t("liveClass.feedback.fieldRequired")}
                </p>
              )}
            </Card>
          ))}
        </div>

        {/* Submit */}
        <MyButton
          buttonType="primary"
          scale="large"
          className="mt-6 w-full min-w-0"
          onClick={handleSubmit}
          disable={submitting}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <CircleNotch className="h-4 w-4 animate-spin" /> {t("liveClass.feedback.submitting")}
            </span>
          ) : (
            t("liveClass.feedback.submitFeedback")
          )}
        </MyButton>

        {config?.feedback_config?.allow_skip !== false && (
          <MyButton
            buttonType="text"
            scale="medium"
            className="mt-2 w-full"
            onClick={() => navigate({ to: "/study-library/live-class" })}
          >
            {t("liveClass.feedback.skip")}
          </MyButton>
        )}
      </Card>
    </FeedbackShell>
  );
}

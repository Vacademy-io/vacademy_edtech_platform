import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CircleNotch, Star } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { celebrateCompletion } from "@/lib/play-celebration";
import { applyResultToPointsCache } from "@/services/points";
import type { EngagementSubmitResponse } from "@/services/engagement";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import {
  SLIDE_COMPLETED_EVENT,
  claimSlideEngagement,
  type SlideCompletedDetail,
  isEngagementSlideType,
  type SlideEngagementStatus,
} from "@/services/slide-engagement";
import type { CompletionContext } from "../mark-complete-button";

/**
 * Retry schedule after a completion. Question and quiz completion is rolled up on the
 * server in the background, so the first ask can land before the slide reads as done.
 */
const CLAIM_RETRY_MS = [300, 1500, 4000, 9000];

/** Slides already celebrated in this tab, so a remount never celebrates twice. */
const celebrated = new Set<string>();

/**
 * The strip above a course slide the teacher marked "Count as engagement": what it is
 * worth, and — once earned — that the points are the learner's. Collects the points
 * when the slide opens (it may have been finished before the teacher switched it on)
 * and after every completion of it. An HTML activity gets its own "Mark as done",
 * since a page cannot always tell the app it is finished.
 */
export function EngagementBanner({
  slideId,
  sourceType,
  documentType,
  context,
}: {
  slideId: string;
  sourceType: string | null | undefined;
  documentType: string | null | undefined;
  context: CompletionContext;
}) {
  const { t } = useTranslation("studyContent");
  const queryClient = useQueryClient();
  const eligible = isEngagementSlideType(sourceType, documentType);
  const queryKey = ["slide-engagement", slideId];
  const packageSessionId = context.packageSessionId;

  const { data } = useQuery({
    queryKey,
    queryFn: () => claimSlideEngagement(slideId, packageSessionId),
    enabled: eligible && Boolean(slideId),
    staleTime: 60_000,
    retry: false,
  });

  const onAward = useCallback(
    (s: SlideEngagementStatus) => {
      if (!s.pointsAwarded || s.pointsAwarded <= 0 || celebrated.has(slideId)) return;
      celebrated.add(slideId);
      const result = {
        attemptId: `slide-engagement:${slideId}`,
        pointsAwarded: s.pointsAwarded,
        newTotalPoints: s.newTotalPoints ?? null,
      };
      applyResultToPointsCache(queryClient, result);
      usePlayGamificationStore
        .getState()
        .applyEngagementResult(result as unknown as EngagementSubmitResponse);
      celebrateCompletion();
      toast.success(
        t("slideEngagement.toastEarned", {
          defaultValue: "+{{points}} points! Activity complete",
          points: s.pointsAwarded,
        })
      );
    },
    [queryClient, slideId, t]
  );

  useEffect(() => {
    if (data) onAward(data);
  }, [data, onAward]);

  // Ask again after the learner completes the slide, until the server pays or says no.
  const timers = useRef<number[]>([]);
  const claimAfterCompletion = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    let done = false;
    CLAIM_RETRY_MS.forEach((delay) => {
      const id = window.setTimeout(async () => {
        if (done) return;
        try {
          const s = await claimSlideEngagement(slideId, packageSessionId);
          queryClient.setQueryData(queryKey, s);
          if (s.earned || !s.active) done = true;
        } catch {
          // Offline or a blip: the next attempt (or the next open) collects it.
        }
      }, delay);
      timers.current.push(id);
    });
    // queryKey is derived from slideId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId, packageSessionId, queryClient]);

  // The handler below reads the latest status without re-subscribing.
  const latest = useRef<SlideEngagementStatus | undefined>(data);
  latest.current = data;
  const markDoneRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!eligible) return;
    const onCompleted = (e: Event) => {
      const detail = (e as CustomEvent<SlideCompletedDetail>).detail;
      if (detail?.slideId !== slideId) return;
      const s = latest.current;
      // An HTML activity that reports "done" is marked complete for the learner,
      // which is what pays; any other completion is already on the server.
      if (detail.pageReported && documentType === "HTML" && s?.active && !s.completed) {
        markDoneRef.current();
        return;
      }
      claimAfterCompletion();
    };
    window.addEventListener(SLIDE_COMPLETED_EVENT, onCompleted);
    return () => {
      window.removeEventListener(SLIDE_COMPLETED_EVENT, onCompleted);
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
  }, [eligible, slideId, documentType, claimAfterCompletion]);

  const [marking, setMarking] = useState(false);
  const markDone = async () => {
    if (marking) return;
    setMarking(true);
    try {
      await markSlideCompletion({ slideId, slideType: "DOCUMENT", completed: true, ...context });
      if (context.chapterId) {
        queryClient.invalidateQueries({ queryKey: ["slides", context.chapterId] });
      }
      claimAfterCompletion();
    } catch {
      toast.error(
        t("slideEngagement.markFailed", {
          defaultValue: "Could not mark this as done. Please try again.",
        })
      );
    } finally {
      setMarking(false);
    }
  };

  markDoneRef.current = markDone;

  if (!eligible || !data || (!data.active && !data.earned)) return null;

  if (data.earned) {
    return (
      <div
        role="status"
        className="flex flex-shrink-0 items-center gap-2 border-b border-success-200 bg-success-50 px-3 py-1.5 text-xs font-semibold text-success-600 sm:px-4 sm:text-sm"
      >
        <CheckCircle size={16} weight="fill" className="shrink-0" />
        <span className="min-w-0 truncate">
          {t("slideEngagement.earned", {
            defaultValue: "You earned {{points}} points for this activity",
            points: data.points,
          })}
        </span>
      </div>
    );
  }

  const showDone = documentType === "HTML" && !data.completed;
  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-primary-100 bg-primary-50 px-3 py-1.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-neutral-700 sm:text-sm">
        <Star size={16} weight="fill" className="shrink-0 text-primary-500" />
        <span className="min-w-0 truncate">
          {t("slideEngagement.toEarn", {
            defaultValue: "Activity · finish it to earn {{points}} points",
            points: data.points,
          })}
        </span>
      </div>
      {showDone && (
        <button
          type="button"
          onClick={markDone}
          disabled={marking}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 sm:text-sm",
            "[.ui-play_&]:rounded-xl"
          )}
        >
          {marking ? <CircleNotch size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          {t("slideEngagement.markDone", { defaultValue: "Mark as done" })}
        </button>
      )}
    </div>
  );
}

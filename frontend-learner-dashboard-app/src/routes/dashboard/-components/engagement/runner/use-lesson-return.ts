import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { useNavigate } from "@tanstack/react-router";
import {
  engagementErrorMessage,
  engagementReasonCode,
  parseSlideTarget,
  submitEngagementItem,
  type EngagementItem,
  type EngagementSubmitResponse,
} from "@/services/engagement";
import { POINTS_ME_KEY, applyResultToPointsCache } from "@/services/points";
import { ENGAGEMENT_FEED_KEY, ENGAGEMENT_HISTORY_KEY } from "../use-engagement-feed";

/**
 * The lesson task's round trip (D12).
 *
 * "Open lesson" leaves the dashboard for the slide viewer, so the task can't
 * wait in an open runner. Before navigating, the caller stores a small flag
 * (`markLessonReturn`). When the learner comes back to a page that mounts the
 * task host, `useLessonReturn` finds the flag and claims the task silently:
 *
 * - the server checks the learner's real slide progress, so finishing the lesson
 *   the normal way is what earns the points;
 * - slide progress is written asynchronously, so a LESSON_NOT_FINISHED right
 *   after returning is usually a sync race: retry up to 3 times over ~10 s with
 *   "Syncing your progress…" showing, and never show a refusal toast for it;
 * - a success shows a toast; the row then reads Done. If the race outlasts the
 *   retries the row stays claimable ("Claim +10") for when the sync lands.
 */

const STORAGE_KEY = "vacademy.engagementLessonReturn.v1";
/** A flag older than this is stale (the learner wandered off); ignore it. */
export const LESSON_RETURN_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Waits before each retry after LESSON_NOT_FINISHED: 2 s + 3 s + 5 s ≈ 10 s. */
export const LESSON_RETRY_DELAYS_MS: readonly number[] = [2_000, 3_000, 5_000];

export interface LessonReturnFlag {
  itemId: string;
  /** When the learner left for the lesson (device clock, ms). */
  ts: number;
}

/** Remember that the learner left for this lesson. Storage failures are ignored. */
export function markLessonReturn(item: Pick<EngagementItem, "id">, now: number = Date.now()): void {
  try {
    const flag: LessonReturnFlag = { itemId: item.id, ts: now };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flag));
  } catch {
    // Private mode or storage full: the row still offers "Claim" once the lesson syncs.
  }
}

/**
 * Leave for the lesson a COURSE_SLIDE task points at, remembering to claim it on
 * the way back. False (and nothing happens) when the task has no usable target.
 */
export function openLessonTarget(
  navigate: ReturnType<typeof useNavigate>,
  item: EngagementItem
): boolean {
  const target = parseSlideTarget(item);
  if (!target) return false;
  markLessonReturn(item);
  void navigate({
    to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
    search: {
      courseId: target.courseId ?? "",
      levelId: target.levelId,
      subjectId: target.subjectId ?? "",
      moduleId: target.moduleId ?? "",
      chapterId: target.chapterId ?? "",
      slideId: target.slideId,
      sessionId: target.sessionId ?? "",
    },
  });
  return true;
}

/** The pending return, or null when there is none, it is stale or unreadable. */
export function readLessonReturn(now: number = Date.now()): LessonReturnFlag | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LessonReturnFlag> | null;
    if (!parsed || typeof parsed.itemId !== "string" || !parsed.itemId) return null;
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) return null;
    const age = now - parsed.ts;
    if (age < 0 || age > LESSON_RETURN_MAX_AGE_MS) return null;
    return { itemId: parsed.itemId, ts: parsed.ts };
  } catch {
    return null;
  }
}

export function clearLessonReturn(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** How a silent claim ended. */
export type LessonClaimOutcome =
  | { kind: "claimed"; response: EngagementSubmitResponse }
  /** Still LESSON_NOT_FINISHED after every retry: leave the row claimable. */
  | { kind: "notYet" }
  | { kind: "failed"; error: unknown };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Claim a lesson task, retrying only while the server says the lesson isn't
 * finished yet. `onSyncing` fires once, before the first retry.
 */
export async function claimLessonWithRetry(
  itemId: string,
  submit: (itemId: string) => Promise<EngagementSubmitResponse>,
  opts: {
    delays?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    onSyncing?: () => void;
  } = {}
): Promise<LessonClaimOutcome> {
  const delays = opts.delays ?? LESSON_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { kind: "claimed", response: await submit(itemId) };
    } catch (error) {
      if (engagementReasonCode(error) !== "LESSON_NOT_FINISHED") return { kind: "failed", error };
      if (attempt >= delays.length) return { kind: "notYet" };
      if (attempt === 0) opts.onSyncing?.();
      await sleep(delays[attempt]!);
    }
  }
}

/** One claim per item at a time, even if two hosts mount (or StrictMode re-runs). */
const inFlight = new Set<string>();

/**
 * Claims a pending lesson return once, when the host mounts. `showPoints` false
 * leaves the points out of the success toast (gamification off).
 */
export function useLessonReturn({
  enabled = true,
  showPoints = true,
}: { enabled?: boolean; showPoints?: boolean } = {}): void {
  const queryClient = useQueryClient();
  const { t: translate } = useTranslation("dashboardEngagement");
  // Read through refs: the claim must run once per mount (the learner coming
  // back), never again because `t` or a setting changed identity meanwhile.
  const tRef = useRef(translate);
  tRef.current = translate;
  const showPointsRef = useRef(showPoints);
  showPointsRef.current = showPoints;

  useEffect(() => {
    if (!enabled) return;
    const t = tRef.current;
    const showPoints = showPointsRef.current;
    const flag = readLessonReturn();
    if (!flag || inFlight.has(flag.itemId)) return;
    clearLessonReturn();
    inFlight.add(flag.itemId);
    const toastId = `engagement-lesson-${flag.itemId}`;

    void claimLessonWithRetry(flag.itemId, (id) => submitEngagementItem(id, {}), {
      onSyncing: () => {
        toast.loading(t("runner.lesson.syncing"), { id: toastId });
      },
    })
      .then((outcome) => {
        if (outcome.kind === "claimed") {
          const { response } = outcome;
          // The gamification store already moved inside submitEngagementItem;
          // this moves ['points','me'] at most once for the same result.
          applyResultToPointsCache(queryClient, response);
          if (response.alreadyCompleted) {
            toast.dismiss(toastId);
          } else {
            const points = response.pointsAwarded ?? 0;
            toast.success(
              showPoints && points > 0
                ? t("runner.lesson.claimed", { count: points })
                : t("runner.lesson.claimedNoPoints"),
              { id: toastId }
            );
          }
        } else if (outcome.kind === "notYet") {
          // A sync race, not a refusal: say nothing more; the row stays claimable.
          toast.dismiss(toastId);
        } else {
          const { message } = engagementErrorMessage(outcome.error, t);
          toast.error(message, { id: toastId });
        }
      })
      .finally(() => {
        inFlight.delete(flag.itemId);
        void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_FEED_KEY });
        void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_HISTORY_KEY });
        void queryClient.invalidateQueries({ queryKey: POINTS_ME_KEY });
      });
  }, [enabled, queryClient]);
}

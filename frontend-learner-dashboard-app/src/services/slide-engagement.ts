import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";

/**
 * Course slides a teacher marked "Count as engagement" (Question, Quiz, HTML,
 * Flashcards, Poll, Game). The learner earns the slide's points once, the first time
 * they finish it; there is no time window. The server pays only for a completion it
 * can see, so the app simply asks after every completion (and when the slide opens).
 */

const CLAIM_URL = `${BASE_URL}/admin-core-service/slide-activity/learner/v1/engagement/claim`;

/** SlideEngagementService.LearnerView. */
export interface SlideEngagementStatus {
  slideId: string;
  /** Counts as an engagement for this learner right now. */
  active: boolean;
  points: number;
  /** This learner holds the slide's points. */
  earned: boolean;
  /** The server sees the slide completed. */
  completed: boolean;
  /** Paid by this call (0 when already earned or not complete yet). */
  pointsAwarded: number;
  newTotalPoints?: number | null;
}

export async function claimSlideEngagement(
  slideId: string,
  packageSessionId?: string | null
): Promise<SlideEngagementStatus> {
  const { data } = await authenticatedAxiosInstance.post<SlideEngagementStatus>(CLAIM_URL, {
    slideId,
    packageSessionId: packageSessionId || null,
  });
  return data;
}

/** Same rule as SlideEngagementService.isEligible: only these slides can be engagements. */
export function isEngagementSlideType(
  sourceType: string | null | undefined,
  documentType: string | null | undefined
): boolean {
  if (sourceType === "QUESTION" || sourceType === "QUIZ") return true;
  return (
    sourceType === "DOCUMENT" &&
    (documentType === "HTML" ||
      documentType === "FLASHCARDS" ||
      documentType === "POLL" ||
      documentType === "GAME")
  );
}

/** Window event fired when the learner completes a slide (any kind). */
export const SLIDE_COMPLETED_EVENT = "vacademy:slide-completed";

export interface SlideCompletedDetail {
  slideId: string;
  /**
   * An HTML page said it is finished (`vacademy:complete`) but nothing has marked the
   * slide complete on the server yet. The banner marks it, for engagement slides only.
   */
  pageReported?: boolean;
}

/**
 * Tell the engagement banner that this slide was just completed, so it can collect the
 * points. Safe to call for any slide: a slide that is not an engagement ignores it.
 */
export function announceSlideCompleted(
  slideId: string | null | undefined,
  opts: { pageReported?: boolean } = {}
): void {
  if (!slideId || typeof window === "undefined") return;
  try {
    const detail: SlideCompletedDetail = { slideId, pageReported: opts.pageReported === true };
    window.dispatchEvent(new CustomEvent(SLIDE_COMPLETED_EVENT, { detail }));
  } catch {
    // CustomEvent missing in a very old WebView: the next open of the slide still pays.
  }
}

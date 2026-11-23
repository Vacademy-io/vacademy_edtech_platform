import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { toast } from "sonner";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import {
  canHostClassInApp,
  liveClassClient,
  rememberClassroomJoin,
} from "@/lib/live-class/bbb-classroom";

/**
 * True if a live session is a BigBlueButton meeting.
 *
 * BBB is the ONLY provider whose stored `meeting_link` is a generic, SHARED
 * "Attendee"/"attendee-id" URL. Every other provider (Zoom, Google Meet, Zoho)
 * stores a correct per-meeting link, so those must keep using `meeting_link`
 * directly. BBB joins MUST instead go through the personalized /meeting/join
 * endpoint, which resolves the learner's real name + unique userId. Opening the
 * stored BBB `meeting_link` makes every learner join as "Attendee" sharing the
 * single userId "attendee-id", which trips maxUserConcurrentAccesses and ejects
 * them ("You have been removed from the session").
 */
export function isBbbSession(linkType?: string | null): boolean {
  return linkType === "bbb" || linkType === "BBB_MEETING";
}

/**
 * How a join ended up:
 * - IN_APP: the class view inside the app was opened (callers must NOT navigate
 *   away afterwards, or they tear the class down);
 * - EXTERNAL: opened in a new tab / Chrome / Safari (today's behaviour);
 * - FAILED: nothing opened (a toast already explained why).
 */
export type BbbJoinResult = "IN_APP" | "EXTERNAL" | "FAILED";

/** Minimal shape of TanStack's navigate, so callers can pass their own. */
type NavigateLike = (opts: { to: string; search?: Record<string, unknown> }) => unknown;

/** Fetch the personalized join response; also used by the class view to rejoin. */
export async function fetchBbbJoin(scheduleId: string, role: string = "VIEWER") {
  // `client` asks the backend whether this platform may show the class in-app.
  // The backend falls back to EXTERNAL for anything it does not explicitly allow.
  return authenticatedAxiosInstance.get(
    `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/join`,
    { params: { scheduleId, role, client: liveClassClient() } }
  );
}

/** Open a join URL outside the app — the behaviour every app had before in-app classes. */
export async function openBbbExternally(joinUrl: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: joinUrl, presentationStyle: "fullscreen" });
  } else {
    window.open(joinUrl, "_blank", "noopener,noreferrer");
  }
}

/**
 * Fetch a per-user BBB join URL (personalized with the learner's real name +
 * userId) from the backend and open it — inside the app when the backend says
 * IN_APP and this device can host it, otherwise outside like before. Handles
 * its own errors/toasts. Does NOT mark attendance; callers already do that.
 *
 * @param scheduleId the session schedule id
 * @param role BBB role, defaults to VIEWER (learner)
 * @param opts.navigate the caller's router navigate; without it the class always
 *   opens outside the app (safe default for any caller not yet updated)
 */
export async function openBbbJoinForLearner(
  scheduleId: string,
  role: string = "VIEWER",
  opts: { navigate?: NavigateLike; title?: string } = {}
): Promise<BbbJoinResult> {
  try {
    const response = await fetchBbbJoin(scheduleId, role);

    // The host starts the class. Until they do, the backend returns NOT_STARTED
    // rather than creating a room — otherwise whichever learner arrived first
    // would open a meeting the teacher is not in. Distinct from "ended" so the
    // learner is told to wait instead of being told the class is over.
    if (response.data?.status === "NOT_STARTED") {
      toast.info(
        response.data?.message ||
          "Your teacher hasn't started this class yet. Please wait a moment and try again."
      );
      return "FAILED";
    }

    // Backend returns { error: "Meeting has ended" } if the meeting was force-ended
    if (response.data?.error) {
      toast.error("This class has ended.");
      return "FAILED";
    }

    const joinUrl = response.data?.joinUrl;
    if (!joinUrl) {
      toast.error("Failed to get video class URL");
      return "FAILED";
    }

    // In-app only when the server allows it AND this device can host it. Any
    // doubt (old backend without openMode, no navigate, check throws) = outside.
    let inApp = false;
    try {
      inApp =
        response.data?.openMode === "IN_APP" &&
        typeof opts.navigate === "function" &&
        canHostClassInApp();
    } catch {
      inApp = false;
    }

    if (inApp && opts.navigate) {
      rememberClassroomJoin(scheduleId, joinUrl, opts.title);
      opts.navigate({
        to: "/study-library/live-class/classroom",
        search: { scheduleId },
      });
      return "IN_APP";
    }

    await openBbbExternally(joinUrl);
    return "EXTERNAL";
  } catch (err: any) {
    console.error("Failed to get BBB join URL:", err);
    const errMsg =
      err?.response?.data?.message || err?.response?.data?.error || "";
    if (
      errMsg.toLowerCase().includes("ended") ||
      errMsg.toLowerCase().includes("not found")
    ) {
      toast.error("This class has ended.");
    } else {
      toast.error("Failed to join video class. Please try again.");
    }
    return "FAILED";
  }
}

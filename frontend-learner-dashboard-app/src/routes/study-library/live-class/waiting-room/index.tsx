import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { Helmet } from "react-helmet";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionDetails } from "../-hooks/useSessionDetails";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { CountdownTimer } from "./-components/CountdownTimer";
import { getPublicUrl } from "@/services/upload_file";
import { BackgroundMusic } from "./-components/BackgroundMusic";
import { SessionStreamingServiceType, LinkType } from "@/routes/register/live-class/-types/enum";
import { useMarkAttendance } from "../-hooks/useMarkAttendance";
import { openBbbJoinForLearner } from "@/lib/live-class/bbb-join";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useServerTime, getServerTime } from "@/hooks/use-server-time";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  isYouTubeUrl,
  convertToYouTubeEmbedUrl,
} from "@/routes/$tagName/-utils/video-url";

export const Route = createFileRoute("/study-library/live-class/waiting-room/")(
  {
    validateSearch: z.object({
      sessionId: z.string(),
    }),
    component: WaitingRoomComponent,
  }
);

function WaitingRoomComponent() {
  const { t } = useTranslation("studyContent");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const { sessionId } = Route.useSearch();
  const { setNavHeading } = useNavHeadingStore();
  const navigate = useNavigate();
  const { mutateAsync: markAttendance } = useMarkAttendance();
  const {
    data: sessionDetails,
    isLoading,
    error,
  } = useSessionDetails(sessionId);
  const { data: serverTimeData } = useServerTime();

  // checkSessionStart below runs on a 30s poll. Without these guards a single
  // join re-hit mark-attendance on every tick — harmless for the stored row,
  // but it re-sent the "attendance marked" mail and, for redirect sessions,
  // re-opened the meeting link forever because nothing unmounts this route.
  const hasMarkedRef = useRef(false);
  const hasJoinedRef = useRef(false);

  // A YouTube link on the session plays while learners wait. Muted so it can
  // never drown out the class starting, looped because people arrive across the
  // whole waiting window, and controls left on so they can unmute if they want.
  const waitingRoomVideoUrl = (() => {
    const raw = sessionDetails?.waitingRoomLink;
    if (!raw || !isYouTubeUrl(raw)) return null;
    const embed = convertToYouTubeEmbedUrl(raw);
    if (!embed) return null;
    const videoId = embed.split("/embed/")[1]?.split(/[?&]/)[0];
    const params = new URLSearchParams({
      autoplay: "1",
      mute: "1",
      loop: "1",
      rel: "0",
      playsinline: "1",
      // loop only takes effect on a single video when it is also the playlist
      ...(videoId ? { playlist: videoId } : {}),
    });
    return `${embed.split("?")[0]}?${params.toString()}`;
  })();

  const fetchThumbnail = useCallback(async () => {
    if (sessionDetails?.thumbnailFileId) {
      const thumbnailUrl = await getPublicUrl(sessionDetails.thumbnailFileId);
      setThumbnail(thumbnailUrl);
    }
  }, [sessionDetails?.thumbnailFileId]);

  useEffect(() => {
    setNavHeading(t("liveClass.waitingRoom"));
    if (sessionDetails?.thumbnailFileId) {
      fetchThumbnail();
    }
  }, [sessionDetails?.thumbnailFileId, setNavHeading, fetchThumbnail, t]);

  const checkSessionStart = useCallback(async () => {
    if (!sessionDetails || !serverTimeData) return;

    // Get current time from server converted to user timezone
    const serverTimestamp = getServerTime(serverTimeData);
    const now = new Date(serverTimestamp);

    // Convert session start and end times to user timezone
    const sessionStartInUserTimezone = convertSessionTimeToUserTimezone(
      sessionDetails.meetingDate,
      sessionDetails.scheduleStartTime,
      sessionDetails.timezone
    );

    const sessionEndInUserTimezone = convertSessionTimeToUserTimezone(
      sessionDetails.meetingDate,
      sessionDetails.scheduleLastEntryTime,
      sessionDetails.timezone
    );

    // Check if class has ended
    if (now > sessionEndInUserTimezone) {
      toast.error(t("liveClass.classHasEnded"));
      navigate({ to: "/study-library/live-class" });
      return;
    }

    // Check if current time is >= session start time
    // BBB sessions may not have a defaultMeetLink (room is auto-created on join)
    const isBbb = sessionDetails.linkType === LinkType.BBB_MEETING || sessionDetails.linkType === "bbb";
    if (now >= sessionStartInUserTimezone && (sessionDetails.defaultMeetLink || isBbb)) {
      // Already sent to the meeting — later ticks only keep watching for the
      // class-ended redirect above, they must not re-join.
      if (hasJoinedRef.current) return;

      // One mark per join. Reset on failure so a mark that genuinely did not
      // land can still be retried by the next tick.
      const markOnce = async () => {
        if (hasMarkedRef.current) return;
        hasMarkedRef.current = true;
        try {
          await markAttendance({
            sessionId: sessionDetails.sessionId,
            scheduleId: sessionId,
            userSourceType: "USER",
            userSourceId: "",
            details: "Joined live class from waiting room",
          });
        } catch (error) {
          hasMarkedRef.current = false;
          throw error;
        }
      };

      // Unchanged join behaviour, shared by the success and failure paths.
      const proceedToJoin = async () => {
        if (isBbb) {
          // BBB: open the personalized join URL (real name + userId) directly.
          // Do NOT route to the embed page — its session data can resolve linkType
          // to "other" and fail with "Unsupported session type". The backend
          // /meeting/join is authoritative. Then leave the waiting room.
          const joined = await openBbbJoinForLearner(sessionId, "VIEWER", {
            navigate: navigate as any,
            title: sessionDetails?.title,
          });
          hasJoinedRef.current = true;
          // In-app: the class view is now open — navigating away would close it.
          if (joined !== "IN_APP") navigate({ to: "/study-library/live-class" });
        } else if (
          sessionDetails.sessionStreamingServiceType ===
          SessionStreamingServiceType.EMBED
        ) {
          hasJoinedRef.current = true;
          navigate({
            to: "/study-library/live-class/embed",
            search: { sessionId },
          });
        } else {
          const joinLink = sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
          window.open(joinLink, "_blank", "noopener,noreferrer");
          hasJoinedRef.current = true;
        }
      };

      try {
        await markOnce();
        await proceedToJoin();
      } catch (error) {
        console.error("Failed to mark attendance:", error);
        toast.error(t("liveClass.failedToMarkAttendance"));
        await proceedToJoin();
      }
    }
  }, [sessionDetails, serverTimeData, markAttendance, navigate, sessionId]);

  useEffect(() => {
    if (sessionDetails) {
      // Check immediately
      checkSessionStart();
      // Check every 30 seconds
      const timer = setInterval(checkSessionStart, 30000);
      return () => clearInterval(timer);
    }
  }, [sessionDetails, checkSessionStart]);

  if (isLoading) {
    return <DashboardLoader />;
  }

  if (error) {
    return (
      <LayoutContainer>
        <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
          {t("liveClass.errorLoadingSession", { message: (error as Error).message })}
        </div>
      </LayoutContainer>
    );
  }

  if (!sessionDetails) {
    return (
      <LayoutContainer>
        <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
          {t("liveClass.sessionNotFound")}
        </div>
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer>
      <Helmet>
        <title>{document?.title || getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession)}</title>
        <meta name="description" content={t("liveClass.metaDescription")} />
      </Helmet>

      <div className="flex flex-col items-center w-full justify-center p-1 gap-4">
        <h1 className="text-2xl font-bold text-center mb-6">
          {sessionDetails?.title || getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}
        </h1>
        <div>{t("liveClass.getReady")}</div>
        <div className="space-y-6">
          {sessionDetails && (
            <CountdownTimer
              sessionDetails={sessionDetails}
              waitingRoomTime={sessionDetails.waitingRoomTime}
              onExpire={checkSessionStart}
            />
          )}
        </div>
        {/* Something to watch while the class fills up. The session's
            waitingRoomLink carries it — a breathing exercise, last week's
            recording, a welcome message — and falls back to the thumbnail when
            no video is set. Muted autoplay so it can't talk over the class
            starting, and looped because learners arrive at different times. */}
        {waitingRoomVideoUrl ? (
          <div className="w-full max-w-3xl overflow-hidden rounded-lg shadow-lg">
            <div className="relative aspect-video bg-black">
              <iframe
                src={waitingRoomVideoUrl}
                title={t("liveClass.waitingRoomVideoTitle", {
                  defaultValue: "While you wait",
                })}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="size-full"
              />
            </div>
          </div>
        ) : (
          thumbnail && (
            <img
              src={thumbnail}
              alt={t("liveClass.sessionThumbnailAlt")}
              className="w-full max-h-72 rounded-lg object-contain bg-gray-50"
            />
          )
        )}
        {sessionDetails && (
          <BackgroundMusic
            backgroundScoreFileId={sessionDetails.backgroundScoreFileId}
          />
        )}
      </div>
    </LayoutContainer>
  );
}

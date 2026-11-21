import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionDetails } from "../-hooks/useSessionDetails";
import { useGuestAccessRecovery } from "../-hooks/useGuestAccessRecovery";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { CountdownTimer } from "@/routes/study-library/live-class/waiting-room/-components/CountdownTimer";
// No-login variant: guests have no auth token, so the authenticated
// getPublicUrl silently 401s and the thumbnail/hero never render.
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { BackgroundMusic } from "@/routes/study-library/live-class/waiting-room/-components/BackgroundMusic";
import { SessionStreamingServiceType } from "@/routes/register/live-class/-types/enum";
import { useMarkAttendance } from "../-hooks/useMarkAttendance";
import { useServerTime, getServerTime } from "@/hooks/use-server-time";
import { toast } from "sonner";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/live-class-guest/waiting-room/")({
  validateSearch: z.object({
    sessionId: z.string(),
    guestId: z.string(),
  }),
  component: GuestWaitingRoomComponent,
});

function GuestWaitingRoomComponent() {
  const { t } = useTranslation("liveClassGuest");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  // Hero backdrop: the per-schedule waiting-room media wins, then the session
  // cover; without either the page keeps its plain theme background.
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const { sessionId, guestId } = Route.useSearch();
  const navigate = useNavigate();
  const { data: serverTimeData } = useServerTime();
  const { mutateAsync: markAttendance } = useMarkAttendance();
  const {
    data: sessionDetails,
    isLoading,
    error,
  } = useSessionDetails(sessionId);
  // Paid session opened without a local registration (new browser): bounce to
  // the registration page to recover identity instead of showing a 403 error.
  useGuestAccessRecovery(sessionId, error);

  // The session check below runs on a 30s poll and again from the countdown's
  // onExpire. Without these guards one join re-hit mark-attendance on every
  // tick and, for redirect sessions, re-opened the meeting link forever —
  // nothing unmounts this route once window.open takes over.
  const hasMarkedRef = useRef(false);
  const hasJoinedRef = useRef(false);

  // One mark per join. Reset on failure so a mark that genuinely did not land
  // can still be retried by the next tick.
  const markAttendanceOnce = useCallback(async () => {
    if (hasMarkedRef.current || !sessionDetails) return;
    hasMarkedRef.current = true;
    try {
      await markAttendance({
        sessionId: sessionDetails.sessionId,
        scheduleId: sessionId,
        userSourceType: "EXTERNAL_USER",
        userSourceId: guestId,
        details: "Guest joined live class from waiting room",
      });
    } catch (error) {
      hasMarkedRef.current = false;
      throw error;
    }
  }, [markAttendance, sessionDetails, sessionId, guestId]);

  // Unchanged redirect behaviour, shared by the poll, the countdown's onExpire,
  // and both the success and failure paths of each.
  const proceedToJoin = useCallback(async () => {
    if (!sessionDetails) return;
    const streamingType = sessionDetails.sessionStreamingServiceType?.toLowerCase();
    if (streamingType === SessionStreamingServiceType.EMBED.toLowerCase()) {
      hasJoinedRef.current = true;
      navigate({
        to: "/live-class-guest/embed",
        search: { sessionId },
      });
    } else {
      const joinLink = sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
      window.open(joinLink, "_blank", "noopener,noreferrer");
      hasJoinedRef.current = true;
    }
  }, [navigate, sessionDetails, sessionId]);

  useEffect(() => {
    const fetchThumbnail = async () => {
      if (sessionDetails?.thumbnailFileId) {
        const thumbnailUrl = await getPublicUrlWithoutLogin(sessionDetails.thumbnailFileId);
        setThumbnail(thumbnailUrl);
      }
    };

    if (sessionDetails?.thumbnailFileId) {
      fetchThumbnail();
    }

    const heroFileId =
      sessionDetails?.customWaitingRoomMediaId || sessionDetails?.coverFileId;
    if (heroFileId) {
      getPublicUrlWithoutLogin(heroFileId)
        .then((url) => setHeroUrl(url))
        .catch(() => setHeroUrl(null));
    }
  }, [sessionDetails]);

  // Handle session start
  useEffect(() => {
    if (sessionDetails) {
      const checkSessionStatus = async () => {
        const serverTimestamp = getServerTime(serverTimeData);
        const now = new Date(serverTimestamp);

        // Convert session time to user timezone
        const sessionStartInUserTimezone = convertSessionTimeToUserTimezone(
          sessionDetails.meetingDate,
          sessionDetails.scheduleStartTime,
          sessionDetails.timezone
        );

        const waitingRoomStart = new Date(sessionStartInUserTimezone);
        waitingRoomStart.setMinutes(
          waitingRoomStart.getMinutes() - (sessionDetails?.waitingRoomTime ?? 0)
        );

        // Check if we're in waiting room period or main session
        const isInWaitingRoom =
          now >= waitingRoomStart && now < sessionStartInUserTimezone;
        const isInMainSession = now >= sessionStartInUserTimezone;

        // Case 1: Session has already started.
        if (isInMainSession) {
          if (sessionDetails.defaultMeetLink && !hasJoinedRef.current) {
            try {
              // Mark attendance before redirecting
              await markAttendanceOnce();

              await proceedToJoin();
            } catch (error) {
              console.error("Failed to mark attendance:", error);
              toast.error(t("common.markAttendanceFailed"));
              // Still proceed with redirection
              await proceedToJoin();
            }
          }
        } else if (isInWaitingRoom) {
          // We are in the waiting room window, let the component render
        }
        // Case 2: It's too early for the waiting room.
        else {
          toast.info(t("waitingRoom.toast.notOpenYetTitle"), {
            description: t("waitingRoom.toast.notOpenYetDescription", {
              minutes: sessionDetails.waitingRoomTime,
            }),
          });
          navigate({
            to: "/register/live-class",
            search: { sessionId: sessionDetails.sessionId },
          });
        }
        // Case 3: We are in the waiting room window. Let the component render.
      };

      // Check immediately
      checkSessionStatus();

      // Check every 30 seconds
      const timer = setInterval(checkSessionStatus, 30000);

      return () => clearInterval(timer);
    }
  }, [
    sessionDetails,
    navigate,
    markAttendanceOnce,
    proceedToJoin,
    sessionId,
    guestId,
  ]);

  if (isLoading) {
    return <DashboardLoader />;
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
        {t("common.errorLoadingSession", { message: (error as Error).message })}
      </div>
    );
  }

  return (
    <div className="relative w-screen min-h-screen overflow-hidden bg-primary-50 flex items-center justify-center p-4 sm:p-8">
      {/* Hero backdrop (waiting-room media or session cover) with a dark
          gradient for contrast; the content sits on a frosted card. */}
      {heroUrl && (
        <>
          <img
            src={heroUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
        </>
      )}

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-5 rounded-2xl bg-white/90 p-6 shadow-xl backdrop-blur-md sm:p-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-center text-gray-900">
          {sessionDetails?.title || getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}
        </h1>
        <div className="text-gray-600">
          {t("waitingRoom.getReady")}
        </div>
        <div className="space-y-6">
          {sessionDetails && (
            <CountdownTimer
              sessionDetails={sessionDetails}
              waitingRoomTime={sessionDetails.waitingRoomTime}
              onExpire={() => {
                // Force an immediate check when countdown expires
                const checkSessionStatus = async () => {
                  const now = new Date();
                  const sessionDate = new Date(
                    `${sessionDetails?.meetingDate}T${sessionDetails?.scheduleStartTime}`
                  );
                  const isInMainSession = now >= sessionDate;

                  if (
                    isInMainSession &&
                    sessionDetails.defaultMeetLink &&
                    !hasJoinedRef.current
                  ) {
                    try {
                      // Mark attendance before redirecting
                      await markAttendanceOnce();

                      await proceedToJoin();
                    } catch (error) {
                      console.error("Failed to mark attendance:", error);
                      toast.error(t("common.markAttendanceFailed"));
                      // Still proceed with redirection
                      await proceedToJoin();
                    }
                  }
                };
                checkSessionStatus();
              }}
            />
          )}
        </div>
        {thumbnail && (
          <img
            src={thumbnail}
            alt={t("waitingRoom.thumbnailAlt")}
            className="w-full max-h-72 rounded-xl object-contain bg-gray-50"
          />
        )}
        {sessionDetails && (
          <BackgroundMusic
            backgroundScoreFileId={sessionDetails.backgroundScoreFileId}
          />
        )}
      </div>
    </div>
  );
}

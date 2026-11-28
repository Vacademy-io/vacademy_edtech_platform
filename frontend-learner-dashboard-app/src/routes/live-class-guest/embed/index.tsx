import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getStoredGuestRegistrationId,
  useSessionDetails,
} from "../-hooks/useSessionDetails";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { LinkType } from "@/routes/register/live-class/-types/enum";
import { getStoredRegistration } from "@/routes/register/live-class/-utils/guestSessionStorage";
import YouTubePlayerWrapper from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/youtube-player";
import { extractYouTubeVideoId, isLiveYouTubeSession, isYouTubeUrl } from "@/utils/youtube";
import { useGuestAccessRecovery } from "../-hooks/useGuestAccessRecovery";
import ZoomEmbedPlayer from "@/routes/study-library/live-class/embed/-components/ZoomEmbedPlayer";
import ZohoEmbedPlayer from "@/routes/study-library/live-class/embed/-components/ZohoEmbedPlayer";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import { useServerTime } from "@/hooks/use-server-time";
import { BASE_URL } from "@/constants/urls";
import axios from "axios";

import { useState } from "react";
import { SafetyWarningModal } from "@/components/common/safety/safety-warning-modal";

export const Route = createFileRoute("/live-class-guest/embed/")({
  validateSearch: z.object({
    sessionId: z.string(),
  }),
  component: GuestEmbedComponent,
});


import { ENABLE_LIVE_CLASS_SAFETY_MODAL } from "@/constants/feature-flags";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useTranslation } from "react-i18next";

function GuestEmbedComponent() {
  const { t } = useTranslation("liveClassGuest");
  const liveSession = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const { sessionId } = Route.useSearch();
  const {
    data: sessionDetails,
    isLoading,
    error,
  } = useSessionDetails(sessionId);
  // Paid session opened without a local registration (new browser): bounce to
  // the registration page to recover identity instead of showing a 403 error.
  useGuestAccessRecovery(sessionId, error);
  // Server clock for the live-class sync: the player positions the video by
  // "now − scheduled start", and a guest's device clock is not to be trusted.
  const { data: serverTimeData } = useServerTime();
  // If safety modal is disabled, we are "verified" by default.
  const [isSafetyVerified, setIsSafetyVerified] = useState(!ENABLE_LIVE_CLASS_SAFETY_MODAL);

  const [bbbJoining, setBbbJoining] = useState(false);
  const [bbbError, setBbbError] = useState<string | null>(null);

  const handleBbbGuestJoin = async () => {
    if (!sessionDetails) return;
    setBbbJoining(true);
    setBbbError(null);
    try {
      // The server resolves the display name from the registration (the Full
      // Name typed on the form) so the learner shows up in BBB under their
      // own name; only an unregistered visitor falls back to "Guest".
      // Prefer this session's own registration over the device-wide "latest
      // registration" key — a learner who already signed up for next week's
      // class would otherwise send that id here and be treated as unregistered.
      const registrationId =
        getStoredRegistration(sessionDetails.sessionId)?.registrationId ||
        (await getStoredGuestRegistrationId());
      const response = await axios.get(
        `${BASE_URL}/admin-core-service/live-session/guest/bbb-join`,
        {
          params: {
            scheduleId: sessionDetails.scheduleId,
            ...(registrationId ? { registrationId } : {}),
          },
        }
      );
      if (response.data?.error) {
        setBbbError(response.data.error);
        return;
      }
      const joinUrl = response.data?.joinUrl;
      if (!joinUrl) {
        setBbbError(t("embed.errors.videoUrlUnavailable"));
        return;
      }
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      const errMsg =
        err?.response?.data?.error || err?.response?.data?.message || "";
      if (
        errMsg.toLowerCase().includes("ended") ||
        errMsg.toLowerCase().includes("not started")
      ) {
        setBbbError(t("embed.errors.notStartedOrEnded"));
      } else {
        setBbbError(t("embed.errors.joinFailed"));
      }
    } finally {
      setBbbJoining(false);
    }
  };

  const renderEmbededSession = () => {
    console.log("[GuestEmbed] Session details:", sessionDetails);

    if (!sessionDetails) return null;

    console.log("[GuestEmbed] Session detail keys:", Object.keys(sessionDetails));

    const linkType = sessionDetails.linkType?.toLowerCase();

    if (!linkType) return null;

    // ----- BBB (live video class) -----
    if (isBbb) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8">
          {bbbError && (
            <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700 text-center">
              {bbbError}
            </div>
          )}
          <button
            onClick={handleBbbGuestJoin}
            disabled={bbbJoining}
            className="px-8 py-4 bg-primary-500 text-white rounded-lg text-lg font-semibold hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {bbbJoining
              ? t("embed.bbb.joining")
              : t("embed.bbb.joinButton", { liveSession })}
          </button>
          <p className="text-sm text-gray-500">
            {t("embed.bbb.joinHint", { liveSession })}
          </p>
        </div>
      );
    }

    // ----- YouTube (live or recorded) -----
    // Detect by URL as well as by declared link type: admins paste
    // youtu.be/shorts links with the platform dropdown on "other", and those
    // must still render in the embedded player (a raw YouTube page refuses to
    // load inside an iframe).
    const meetingLink =
      sessionDetails.customMeetingLink ?? sessionDetails.defaultMeetLink;
    if (
      linkType === LinkType.YOUTUBE ||
      linkType === LinkType.YOUTUBE_RECORDED ||
      isYouTubeUrl(meetingLink)
    ) {
      const videoId = extractYouTubeVideoId(meetingLink);
      if (!videoId) {
        return (
          <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
            {t("embed.youtube.invalidUrl")}
            <a href={sessionDetails.defaultMeetLink} target="_blank">
              {t("embed.youtube.viewLiveLink")}
            </a>
          </div>
        );
      }

      const allowPlayPause =
        typeof sessionDetails.allowPlayPause === "string"
          ? sessionDetails.allowPlayPause === "true"
          : sessionDetails.allowPlayPause ?? true;
      const allowRewind = sessionDetails.allowRewind === "true";

      // Live (clock-synced) unless explicitly a recording — by URL as well as
      // declared type, matching the player choice above (see isLiveYouTubeSession).
      const isLive = isLiveYouTubeSession({
        linkType,
        link: meetingLink,
        hasSchedule: true,
      });
      const sessionStartTime = convertSessionTimeToUserTimezone(
        sessionDetails.meetingDate,
        sessionDetails.scheduleStartTime,
        sessionDetails.timezone
      );
      return (
        <div className="w-full h-full">
          <YouTubePlayerWrapper
            videoId={videoId}
            allowPlayPause={allowPlayPause}
            allowRewind={allowRewind}
            isLiveStream={isLive}
            enableConcentrationScore={false}
            liveClassStartTime={
              isLive ? sessionStartTime.toISOString() : undefined
            }
            liveClockOffsetMs={
              serverTimeData
                ? serverTimeData.serverTimestamp - serverTimeData.fetchedAt
                : 0
            }
          />
        </div>
      );
    }

    // ----- Zoom (live or recorded) -----
    if (
      linkType === LinkType.ZOOM_RECORDED ||
      linkType === LinkType.ZOOM
    ) {
      return <ZoomEmbedPlayer recordingUrl={sessionDetails.defaultMeetLink} />;
    }

    // ----- Zoho -----
    if (
      linkType === LinkType.ZOHO ||
      linkType === LinkType.ZOHO_MEETING ||
      linkType === LinkType.ZOHO_RECORDED
    ) {
      const zohoUrl = sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
      return (
        <ZohoEmbedPlayer
          providerHostUrl={sessionDetails.providerHostUrl}
          meetingUrl={zohoUrl}
        />
      );
    }

    // Check if embedding is enabled — if not, open the link in a new tab
    if (sessionDetails.sessionStreamingServiceType &&
      sessionDetails.sessionStreamingServiceType.toLowerCase() !== "embed") {
      const joinLink = sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
      window.open(joinLink, "_blank", "noopener,noreferrer");
      return (
        <div className="flex flex-col items-center justify-center p-12 h-screen bg-white">
          <p className="mt-4 text-neutral-600">{t("embed.openingNewTab")}</p>
        </div>
      );
    }

    // TODO: handle Google Meet etc.
    return null;
  };

  if (isLoading) return <DashboardLoader />;

  if (error) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
        {t("common.errorLoadingSession", { message: (error as Error).message })}
      </div>
    );
  }

  const isBbb =
    sessionDetails?.linkType === "bbb" ||
    sessionDetails?.linkType === LinkType.BBB_MEETING;

  if (!sessionDetails?.defaultMeetLink && !isBbb) {
    return (
      <div className="p-4 border border-yellow-200 rounded-lg bg-yellow-50 text-yellow-700">
        {t("embed.noMeetingLink")}
      </div>
    );
  }

  if (!isSafetyVerified) {
    return (
      <div className="w-screen h-screen bg-primary-50 flex items-center justify-center">
        <SafetyWarningModal
          open={true}
          onAccept={() => setIsSafetyVerified(true)}
          onReject={() => window.history.back()}
        />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-primary-50">
      <div className="flex flex-col h-full">
        <div className="flex justify-between items-center p-4">
          <h1 className="text-2xl font-bold">
            {sessionDetails?.title || getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}
          </h1>
          <div className="bg-red-600 text-white px-2 py-1 rounded text-sm animate-pulse">
            {t("common.liveBadge")}
          </div>
        </div>
        <div className="flex-grow relative flex items-center justify-center p-2">
          <div className="absolute top-10 end-10 p-2 px-4 bg-red-500 text-white z-1 rounded">
            {t("common.liveBadge")}
          </div>
          {renderEmbededSession()}
        </div>
      </div>
    </div>
  );
}

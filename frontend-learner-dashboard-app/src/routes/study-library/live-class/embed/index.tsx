import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { Helmet } from "react-helmet";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { useEffect, useState, useMemo, useRef } from "react";
import { useSessionDetails } from "../-hooks/useSessionDetails";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { LinkType } from "@/routes/register/live-class/-types/enum";
import YouTubePlayerWrapper from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/youtube-player";
import ZoomEmbedPlayer from "./-components/ZoomEmbedPlayer";
import ZoomMeetingSdkPlayer from "./-components/ZoomMeetingSdkPlayer";
import ZohoEmbedPlayer from "./-components/ZohoEmbedPlayer";
import GoogleMeetLauncher from "./-components/GoogleMeetLauncher";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import { extractYouTubeVideoId, isLiveYouTubeSession, isYouTubeUrl } from "@/utils/youtube";
import { useServerTime, getServerTime } from "@/hooks/use-server-time";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { SessionDetailsResponse } from "../-types/types";
import { useLiveSessions } from "../-hooks/useLiveSessions";
import { getAllPackageSessionIds } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { DefaultClassCard } from "../-components/DefaultClassCard";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

// Only text and url are required — a button is defined by where it sends the
// learner. Colours and `visible` are optional because these rows are authored by
// admins in the workflow config tab: demanding every field made one blank colour
// (or a row saved without `visible`) fail validation and silently drop EVERY
// button on the screen. Missing `visible` means visible; only an explicit false
// hides a button.
const LearnerButtonConfigSchema = z.object({
  text: z.string(),
  url: z.string(),
  background_color: z.string().optional(),
  text_color: z.string().optional(),
  visible: z.boolean().optional(),
});

// A session may carry ONE button (legacy) or a LIST of buttons (e.g. YouTube
// subscribe + Instagram + Facebook, set by the session-creator workflow).
const LearnerButtonsSchema = z.union([
  LearnerButtonConfigSchema,
  z.array(LearnerButtonConfigSchema),
]);

type LearnerButton = z.infer<typeof LearnerButtonConfigSchema>;

/** Normalize single-or-array config to the list of visible buttons. */
const toVisibleButtons = (config: unknown): LearnerButton[] => {
  const parsed = LearnerButtonsSchema.safeParse(config);
  if (!parsed.success) return [];
  const list = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  return list.filter((b) => b.visible !== false && b.url);
};

/** Right-aligned action buttons row under the player (YouTube/IG/FB etc.). */
const LearnerActionButtons = ({ config }: { config: unknown }) => {
  const buttons = toVisibleButtons(config);
  if (buttons.length === 0) return null;
  return (
    <div className="mt-2 flex w-full flex-wrap justify-end gap-2">
      {buttons.map((button, index) => (
        <Button
          key={index}
          variant="default"
          size="sm"
          className="h-9 rounded-full px-6 text-sm font-medium shadow-sm transition-all duration-200 hover:shadow"
          // Admin-chosen brand colours (YouTube red, Instagram pink…) can only be
          // inline. When a row leaves them blank the Button's own styling stands in.
          style={
            button.background_color
              ? {
                  backgroundColor: button.background_color,
                  color: button.text_color,
                  border: `1px solid ${button.background_color}20`,
                }
              : { color: button.text_color }
          }
          onClick={() => window.open(button.url, "_blank")}
        >
          <span>{button.text}</span>
          <ArrowSquareOut size={14} weight="bold" className="ms-2 opacity-90" />
        </Button>
      ))}
    </div>
  );
};

export const Route = createFileRoute("/study-library/live-class/embed/")({
  validateSearch: z.object({
    sessionId: z.string().optional(),
    videoUrl: z.string().optional(),
    title: z.string().optional(),
    learnerButtonConfig: LearnerButtonsSchema.optional(),
  }),
  component: EmbedComponent,
});

import { SafetyWarningModal } from "@/components/common/safety/safety-warning-modal";

import { ENABLE_LIVE_CLASS_SAFETY_MODAL } from "@/constants/feature-flags";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { useTranslation } from "react-i18next";

function EmbedComponent() {
  const { t } = useTranslation("study");
  const liveSession = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const session = getTerminology(ContentTerms.Session, SystemTerms.Session);
  const instructor = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
  const { sessionId, videoUrl, title, learnerButtonConfig: searchLearnerButtonConfig } = Route.useSearch();
  const { setNavHeading } = useNavHeadingStore();
  const navigate = useNavigate();
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null); // null = checking

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { getTokenFromStorage } = await import("@/lib/auth/sessionUtility");
        const { TokenKey } = await import("@/constants/auth/tokens");
        const token = await getTokenFromStorage(TokenKey.accessToken);
        setIsAuthenticated(!!token);
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated !== true) return;
    const fetchBatchIds = async () => {
      const ids = await getAllPackageSessionIds();
      setBatchIds(ids);
    };
    fetchBatchIds();
  }, [isAuthenticated]);

  const { data: sessions } = useLiveSessions(batchIds);

  // Derive learnerButtonConfig: prefer URL search params, fallback to matching live session data
  const learnerButtonConfig = useMemo(() => {
    if (searchLearnerButtonConfig) return searchLearnerButtonConfig;
    if (sessionId && sessions?.live_sessions) {
      const matchingSession = sessions.live_sessions.find(
        (s) => s.schedule_id === sessionId
      );
      if (matchingSession?.learner_button_config) {
        return matchingSession.learner_button_config;
      }
    }
    return undefined;
  }, [searchLearnerButtonConfig, sessionId, sessions?.live_sessions]);

  useEffect(() => {
    // If we are watching a default class (no sessionId) and a live session starts, redirect
    if (!sessionId && sessions?.live_sessions && sessions.live_sessions.length > 0) {
      toast.info(t("liveClass.embed.toast.liveSessionStarted", { liveSession: liveSession.toLowerCase() }));
      navigate({ to: "/study-library/live-class" });
    }
  }, [sessions?.live_sessions, sessionId, navigate]);

  const {
    data: fetchedSessionDetails,
    isLoading,
    error,
  } = useSessionDetails(sessionId || null);

  // BBB join URL state
  const [bbbJoinUrl, setBbbJoinUrl] = useState<string | null>(null);
  const [bbbLoading, setBbbLoading] = useState(false);
  const bbbFetchedRef = useRef(false);

  // Auto-fetch BBB join URL when session is identified as BBB
  useEffect(() => {
    if (!sessionId || bbbFetchedRef.current) return;
    const lt = fetchedSessionDetails?.linkType;
    if (lt !== LinkType.BBB_MEETING && lt !== "bbb") return;

    bbbFetchedRef.current = true;
    setBbbLoading(true);

    authenticatedAxiosInstance
      .get(`${BASE_URL}/admin-core-service/live-sessions/provider/meeting/join`, {
        params: { scheduleId: sessionId, role: "VIEWER" },
      })
      .then((response) => {
        // The host starts the class; until then the backend returns NOT_STARTED
        // instead of creating a room. Leave bbbJoinUrl unset (an undefined src
        // would render an empty frame) and allow the learner to retry.
        if (response.data?.status === "NOT_STARTED") {
          toast.info(
            response.data?.message ||
            t("liveClass.embed.toast.classNotStarted", {
              instructor: instructor.toLowerCase(),
              liveClass: liveSession.toLowerCase(),
            })
          );
          bbbFetchedRef.current = false;
          return;
        }
        setBbbJoinUrl(response.data.joinUrl);
      })
      .catch((err) => {
        console.error("Failed to get BBB join URL:", err);
        toast.error(t("liveClass.embed.toast.joinFailed", { liveClass: liveSession.toLowerCase() }));
        bbbFetchedRef.current = false; // allow retry
      })
      .finally(() => {
        setBbbLoading(false);
      });
  }, [sessionId, fetchedSessionDetails?.linkType]);

  // If safety modal is disabled, we are "verified" by default.
  const [isSafetyVerified, setIsSafetyVerified] = useState(
    !ENABLE_LIVE_CLASS_SAFETY_MODAL
  );
  const { data: serverTimeData } = useServerTime();

  // Construct effective session details
  const sessionDetails: Partial<SessionDetailsResponse> | undefined =
    fetchedSessionDetails ||
    (videoUrl
      ? {
        title: title || (sessions as any)?.defaultDayConfig?.defaultClassName || t("liveClass.defaultClassCard.defaultTitle", { session }),
        defaultMeetLink: videoUrl,
        linkType: LinkType.YOUTUBE, // Assuming default links are YouTube for now, can be improved
        allowPlayPause: true,
        allowRewind: "true",
        meetingDate: new Date().toISOString().split("T")[0],
        scheduleStartTime: "00:00:00",
        scheduleLastEntryTime: "23:59:59",
        timezone: "UTC", // Default fallback
      }
      : undefined);

  useEffect(() => {
    const liveSessionTerm = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const prefix = sessionId ? liveSessionTerm : sessionTerm;
    if (sessionDetails?.title) {
      setNavHeading(`${prefix} - ${sessionDetails.title}`);
    } else {
      setNavHeading(prefix);
    }
  }, [sessionDetails, setNavHeading, sessionId]);

  // Check if class has ended (Only for real sessions). Skip entirely for
  // Zoom — Zoom decides its own lifecycle (waiting-for-host, in-progress,
  // ended) and the SDK surfaces a real error if the meeting truly ended.
  // Our scheduled last_entry_time is a soft deadline only; treating it as
  // hard here was causing "class has ended" toasts on perfectly live meetings.
  useEffect(() => {
    if (!sessionId || !fetchedSessionDetails || !serverTimeData) return;

    const lt = (fetchedSessionDetails.linkType ?? "").toLowerCase();
    if (lt === "zoom" || lt === "zoom_meeting") return;
    // Google Meet is URL-join and can legitimately run past the soft last_entry_time — don't
    // redirect with "class has ended" while it may still be live (matches the Zoom carve-out).
    if (["google_meet", "googlemeet", "gmeet", "google meet"].includes(lt)) return;

    const serverTimestamp = getServerTime(serverTimeData);
    const now = new Date(serverTimestamp);

    // Convert session times to user timezone
    const sessionStartInUserTimezone = convertSessionTimeToUserTimezone(
      fetchedSessionDetails.meetingDate,
      fetchedSessionDetails.scheduleStartTime,
      fetchedSessionDetails.timezone
    );

    let sessionEndInUserTimezone = convertSessionTimeToUserTimezone(
      fetchedSessionDetails.meetingDate,
      fetchedSessionDetails.scheduleLastEntryTime,
      fetchedSessionDetails.timezone
    );

    // If session spans midnight (end < start), add 1 day to end time
    if (sessionEndInUserTimezone < sessionStartInUserTimezone) {
      sessionEndInUserTimezone = new Date(
        sessionEndInUserTimezone.getTime() + 24 * 60 * 60 * 1000
      );
    }

    // Check if class has ended
    if (now > sessionEndInUserTimezone) {
      toast.error(t("liveClass.toast.classEnded", { liveClass: liveSession.toLowerCase() }));
      navigate({ to: "/study-library/live-class" });
      return;
    }

    // Set up interval to check periodically (every 30 seconds)
    const checkInterval = setInterval(() => {
      const currentTime = new Date();
      if (currentTime > sessionEndInUserTimezone) {
        toast.error(t("liveClass.toast.classEnded", { liveClass: liveSession.toLowerCase() }));
        navigate({ to: "/study-library/live-class" });
        clearInterval(checkInterval);
      }
    }, 30000);

    return () => clearInterval(checkInterval);
  }, [fetchedSessionDetails, serverTimeData, navigate, sessionId]);

  const renderEmbeddedSession = () => {
    console.log("[LearnerEmbed] Session details:", sessionDetails);
    // Check link type first — BBB sessions may not have a defaultMeetLink.
    // Fall back to the fetched session details (authoritative, loaded by scheduleId)
    // when the passed-in sessionDetails.linkType is missing/"other" — otherwise a BBB
    // session can slip through to "Unsupported session type". Mirrors isBbbSession below.
    const linkType =
      sessionDetails?.linkType ||
      fetchedSessionDetails?.linkType ||
      (videoUrl ? LinkType.YOUTUBE : undefined);

    // Handle BBB early — room is auto-created, no defaultMeetLink needed
    if (linkType === LinkType.BBB_MEETING || linkType === "bbb") {
      if (bbbLoading) {
        return <DashboardLoader />;
      }

      if (bbbJoinUrl) {
        return (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8">
            <div className="text-center space-y-3">
              <h3 className="text-lg font-semibold">{t("liveClass.embed.classReady", { liveClass: liveSession })}</h3>
              <p className="text-sm text-muted-foreground">
                {Capacitor.getPlatform() === "web"
                  ? t("liveClass.embed.clickToJoinNewWindow", { liveClass: liveSession.toLowerCase() })
                  : t("liveClass.embed.tapToJoin", { liveClass: liveSession.toLowerCase() })}
              </p>
              <Button
                onClick={() => {
                  if (Capacitor.isNativePlatform()) {
                    Browser.open({ url: bbbJoinUrl, presentationStyle: "fullscreen" });
                  } else {
                    window.open(bbbJoinUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                className="gap-2"
              >
                <ArrowSquareOut size={18} />
                {t("liveClass.button.joinLiveClass")}
              </Button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center justify-center p-8">
          <DashboardLoader />
        </div>
      );
    }

    // --- Google Meet (URL-join, no SDK; backend persists linkType "GOOGLE_MEET") ---
    if (["google_meet", "googlemeet", "gmeet", "google meet"].includes((linkType ?? "").toString().toLowerCase())) {
      return (
        <GoogleMeetLauncher
          scheduleId={sessionId ?? ""}
          fallbackUrl={sessionDetails?.customMeetingLink ?? sessionDetails?.defaultMeetLink}
        />
      );
    }

    // NOTE: integration-created Zoom meetings (link_type ZOOM + providerMeetingId)
    // are handled earlier by the full-screen `isZoomFullscreen` branch (which renders
    // ZoomMeetingSdkPlayer on both web and native), so they never reach here. A pasted
    // Zoom link (no providerMeetingId) or a recording falls through to the players below.

    if (!sessionDetails?.defaultMeetLink) return null;

    // --- YouTube & recorded YouTube links ---
    // Detect by URL as well as by declared link type: a pasted youtu.be/shorts
    // link stored with link_type "other" must still use the embedded player
    // (a raw YouTube page refuses to load inside an iframe).
    const youTubeCandidateLink =
      sessionDetails.customMeetingLink ?? sessionDetails.defaultMeetLink;
    if (
      linkType === LinkType.YOUTUBE ||
      linkType === LinkType.YOUTUBE_RECORDED ||
      isYouTubeUrl(youTubeCandidateLink)
    ) {
      const videoId = extractYouTubeVideoId(youTubeCandidateLink);

      // Handle case where video ID extraction fails
      if (!videoId) {
        return (
          <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
            {t("liveClass.embed.invalidYoutubeUrl")}
            <a href={sessionDetails.defaultMeetLink} target="_blank">
              {t("liveClass.embed.clickToViewLive")}
            </a>
          </div>
        );
      }

      const allowPlayPause =
        typeof sessionDetails.allowPlayPause === "string"
          ? sessionDetails.allowPlayPause === "true"
          : sessionDetails.allowPlayPause ?? true;
      const allowRewind = sessionDetails.allowRewind === "true";

      // Live (clock-synced) unless explicitly a recording. Decided by the URL
      // as well as the declared type, like the player choice above: a session
      // saved with the platform on "other" and a youtu.be link (this is how
      // 377107b8 was stored) otherwise ran as a free recording — no late-join
      // seek, resume-from-pause, restart at the end. No sessionId = the
      // default-class flow, which has no slot to sync to.
      const isLive = isLiveYouTubeSession({
        linkType,
        link: youTubeCandidateLink,
        hasSchedule: !!sessionId,
      });

      let sessionStartTime;
      if (isLive && sessionDetails.meetingDate && sessionDetails.scheduleStartTime && sessionDetails.timezone) {
        sessionStartTime = convertSessionTimeToUserTimezone(
          sessionDetails.meetingDate,
          sessionDetails.scheduleStartTime,
          sessionDetails.timezone
        );
      }

      // The player derives the live position from "now − scheduled start". Hand
      // it the server's view of "now" so a phone whose clock runs a few minutes
      // off does not put its owner a few minutes away from the rest of the class.
      const liveClockOffsetMs = serverTimeData
        ? serverTimeData.serverTimestamp - serverTimeData.fetchedAt
        : 0;

      return (
        <div className="w-full h-full flex flex-col gap-4">
          <YouTubePlayerWrapper
            videoId={videoId}
            allowPlayPause={allowPlayPause}
            allowRewind={allowRewind}
            isLiveStream={isLive}
            liveClassStartTime={
              isLive && sessionStartTime ? sessionStartTime.toISOString() : undefined
            }
            liveClockOffsetMs={liveClockOffsetMs}
            enableConcentrationScore={false}
          />
          <LearnerActionButtons config={learnerButtonConfig} />
        </div>
      );
    }

    // --- Zoom recorded links ---
    if (
      linkType === LinkType.ZOOM_RECORDED ||
      linkType === LinkType.ZOOM
    ) {
      return (
        <div className="w-full h-full flex flex-col gap-4">
          <ZoomEmbedPlayer recordingUrl={sessionDetails.defaultMeetLink} />
          <LearnerActionButtons config={learnerButtonConfig} />
        </div>
      );
    }

    // --- Zoho links ---
    if (
      linkType === LinkType.ZOHO ||
      linkType === LinkType.ZOHO_MEETING ||
      linkType === LinkType.ZOHO_RECORDED
    ) {
      const zohoUrl = sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
      return (
        <div className="w-full h-full flex flex-col gap-4">
          <ZohoEmbedPlayer
            providerHostUrl={sessionDetails.providerHostUrl}
            meetingUrl={zohoUrl}
          />
          <LearnerActionButtons config={learnerButtonConfig} />
        </div>
      );
    }

    // Check if embedding is enabled — if not, open the link in a new tab
    if (sessionDetails.sessionStreamingServiceType &&
      sessionDetails.sessionStreamingServiceType.toLowerCase() !== "embed") {
      const joinLink = sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
      window.open(joinLink, "_blank", "noopener,noreferrer");
      return (
        <div className="flex flex-col items-center justify-center p-8 h-full">
          <p className="mt-4 text-neutral-600">{t("liveClass.embed.openingInNewTab")}</p>
        </div>
      );
    }

    // Handle unsupported link types
    return (
      <div className="p-4 border border-yellow-200 rounded-lg bg-yellow-50 text-yellow-700">
        {t("liveClass.embed.unsupportedSessionType", { session, linkType })}
      </div>
    );
  };

  // Auth check: show loading while checking, then login prompt if unauthenticated
  if (isAuthenticated === null) return <DashboardLoader />;

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center space-y-4 p-8 max-w-md">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-800">{t("liveClass.embed.loginRequired")}</h2>
          <p className="text-gray-600">
            {t("liveClass.embed.loginRequiredDescription", { session: session.toLowerCase() })}
          </p>
          <Button
            onClick={() => navigate({ to: "/login" })}
            className="mt-4"
          >
            {t("liveClass.embed.goToLogin")}
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading && sessionId) return <DashboardLoader />;

  if (error && sessionId) {
    return (
      <LayoutContainer>
        <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
          {t("liveClass.embed.errorLoadingSessionDetails", { session, message: (error as Error).message })}
        </div>
      </LayoutContainer>
    );
  }

  // BBB sessions may not have a defaultMeetLink — the room is auto-created on join
  const isBbbSession = sessionDetails?.linkType === LinkType.BBB_MEETING ||
    sessionDetails?.linkType === "bbb" ||
    fetchedSessionDetails?.linkType === LinkType.BBB_MEETING ||
    fetchedSessionDetails?.linkType === "bbb";

  const isGoogleSession = ["google_meet", "googlemeet", "gmeet", "google meet"].includes(
    (sessionDetails?.linkType ?? fetchedSessionDetails?.linkType ?? "").toString().toLowerCase()
  );

  if (!sessionDetails?.defaultMeetLink && !isBbbSession && !isGoogleSession) {
    if ((sessions as any)?.defaultDayConfig?.defaultClassLink) {
      return (
        <LayoutContainer>
          <div className="flex justify-center p-4">
            <DefaultClassCard
              defaultClassLink={(sessions as any)?.defaultDayConfig?.defaultClassLink}
              // learnerButtonConfig={(sessions as any)?.defaultDayConfig?.learnerButtonConfig}
              defaultClassName={(sessions as any)?.defaultDayConfig?.defaultClassName}
            />
          </div>
        </LayoutContainer>
      );
    }

    return (
      <LayoutContainer>
        <div className="p-4 border border-yellow-200 rounded-lg bg-yellow-50 text-yellow-700">
          {t("liveClass.embed.noMeetingLink", { session: session.toLowerCase() })}
        </div>
      </LayoutContainer>
    );
  }

  if (!isSafetyVerified) {
    return (
      <LayoutContainer fullWidth>
        <div className="w-full h-nav-offset flex items-center justify-center">
          <SafetyWarningModal
            open={true}
            onAccept={() => setIsSafetyVerified(true)}
            onReject={() => navigate({ to: "/study-library/live-class" })}
          />
        </div>
      </LayoutContainer>
    );
  }

  // Fullscreen layout for the in-portal Zoom embed — bypass the dashboard
  // sidebar / header so the learner can focus on the meeting itself, matching
  // the admin "Start as Host" experience. Same pattern as
  // frontend-admin-dashboard/.../live-session/host/$scheduleId.tsx.
  const learnerLinkType =
    sessionDetails?.linkType || (videoUrl ? LinkType.YOUTUBE : undefined);
  // Full-screen on BOTH web and native (Capacitor WebView) — the Client View
  // embeds in the app now rather than launching an external browser.
  const isZoomFullscreen =
    (learnerLinkType === LinkType.ZOOM || learnerLinkType === "zoom") &&
    sessionDetails?.providerMeetingId &&
    sessionId;

  if (isZoomFullscreen) {
    return (
      <div className="fixed inset-0 flex h-screen w-screen flex-col bg-black">
        <Helmet>
          <title>{sessionDetails.title}</title>
        </Helmet>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-black/60 px-3 backdrop-blur">
          <button
            onClick={() => navigate({ to: "/study-library/live-class" })}
            className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-white"
          >
            {t("liveClass.embed.back")}
          </button>
          <span className="truncate text-xs font-medium text-white/80">
            {sessionDetails.title}
          </span>
          <span className="ms-auto rounded bg-red-600 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white">
            {t("liveClass.badge.live")}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <ZoomMeetingSdkPlayer
          scheduleId={sessionId}
          leaveUrl={`${window.location.origin}/study-library/live-class`}
          nativeFallbackUrl={sessionDetails.defaultMeetLink}
        />
        </div>
      </div>
    );
  }

  return (
    <LayoutContainer fullWidth>
      <Helmet>
        <title>
          {document?.title || sessionDetails.title || (sessionId ? getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession) : getTerminology(ContentTerms.Session, SystemTerms.Session))}
        </title>
        <meta
          name="description"
          content={`${sessionId ? getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession) : getTerminology(ContentTerms.Session, SystemTerms.Session)}: ${sessionDetails.title}`}
        />
      </Helmet>

      <div className="flex flex-col h-nav-offset gap-section">
        <div className="flex items-center justify-between gap-2">
          {/* Scales with the viewport: a session title like
              "Suchbliss.com - 07:30 (Day 2)" wrapped onto two lines on a phone
              at a fixed 2xl. min-w-0 lets it shrink beside the LIVE badge
              instead of pushing it off the row. */}
          <h1 className="min-w-0 text-subtitle font-bold leading-tight xs:text-h3 md-tablets:text-h2">
            {sessionDetails?.title || getTerminology(ContentTerms.Session, SystemTerms.Session)}
          </h1>
          {/* A recording dot rather than the word "Live". These classes are a
              scheduled playback, not a broadcast, and "LIVE" alongside YouTube's
              own chrome read as a claim the class could not keep. The dot carries
              the meaning on its own — the "REC" label beside it was redundant next
              to YouTube's own chrome. The accessible name is kept on the wrapper so
              screen readers still announce it. The dot is shrink-0 so the title
              truncates against it instead of squashing it. */}
          {sessionId ? (
            <span
              className="flex shrink-0 items-center rounded px-2 py-1"
              role="status"
              aria-label={t("liveClass.embed.recording")}
              title={t("liveClass.embed.recording")}
            >
              <span className="size-2 shrink-0 rounded-full bg-red-600" aria-hidden="true" />
            </span>
          ) : (
            <span className="shrink-0 rounded bg-primary-300 px-3 py-1 text-sm font-semibold uppercase text-white shadow">
              {t("liveClass.badge.session")}
            </span>
          )}
        </div>
        <div className="flex-grow relative flex items-center justify-center p-2">
          {renderEmbeddedSession()}
        </div>
      </div>
    </LayoutContainer>
  );
}

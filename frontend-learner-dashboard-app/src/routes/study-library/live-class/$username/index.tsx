import { useState, useEffect, useCallback } from "react";
import { AuthPageBranding } from "@/components/common/institute-branding";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { getInstituteId } from "@/constants/helper";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { Preferences } from "@capacitor/preferences";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { SessionLoginForm } from "./components/SessionLoginForm";
import { SessionSelectionDialog } from "./components/SessionSelectionDialog";
import { useLiveSessions } from "../-hooks/useLiveSessions";
import { getAllPackageSessionIds } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import {
  getActiveSessions,
  SessionStatus,
} from "./-helpers/checkSessionStatus";
import { SessionDetails } from "../-types/types";
import { isBbbSession, openBbbJoinForLearner } from "@/lib/live-class/bbb-join";
import { SessionStreamingServiceType } from "@/routes/register/live-class/-types/enum";
import { getLiveClassDisclaimer } from "@/services/live-class-disclaimer";
import { DisclaimerVideoScreen } from "@/routes/study-library/live-class/-components/DisclaimerVideoScreen";
import { useMarkAttendance } from "../-hooks/useMarkAttendance";
import {
  fetchLiveSessionPaymentStatus,
  registerAndPayForLiveSession,
} from "../-services/livePayment";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";


export const Route = createFileRoute("/study-library/live-class/$username/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation("study");
  const params = Route.useParams();
  const navigate = useNavigate();
  const domainRouting = useDomainRouting();

  // Sometimes during SPA navigation, params might be undefined momentarily
  // In that case, fall back to parsing the URL directly
  let username = params.username || '';

  if (!username) {
    // Fallback: Parse params from URL directly
    // URL structure: /study-library/live-class/$username
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 3 && pathParts[0] === 'study-library' && pathParts[1] === 'live-class') {
      username = pathParts[2] || '';
    }
  }

  const [authState, setAuthState] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [showSessionSelection, setShowSessionSelection] = useState(false);
  const [activeSessions, setActiveSessions] = useState<
    Array<{ session: SessionDetails; status: SessionStatus }>
  >([]);

  // Fetch live sessions data (only when batchIds are available)
  const { data: sessions, isLoading: isSessionsLoading } = useLiveSessions(
    batchIds.length > 0 ? batchIds : null
  );

  // Set while a disclaimer is showing, so the join can resume once it is watched.
  const [pendingJoin, setPendingJoin] = useState<{
    session: SessionDetails;
    isInWaitingRoom: boolean;
  } | null>(null);
  const [disclaimerUrl, setDisclaimerUrl] = useState<string | null>(null);

  // Mark attendance mutation
  const { mutateAsync: markAttendance } = useMarkAttendance();

  // Fetch batch IDs
  useEffect(() => {
    const fetchBatchIds = async () => {
      const ids = await getAllPackageSessionIds();
      console.log("Fetched batchIds:", ids);
      setBatchIds(ids);
    };
    if (authState === "authenticated") {
      fetchBatchIds();
    }
  }, [authState]);

  // Handle navigation to a specific session
  const proceedToSession = useCallback(
    async (session: SessionDetails, isInWaitingRoom: boolean) => {
      // Paid class gate, same as the Live Classes list: BBB and plain links have
      // no server-side payment check, so an unpaid learner must go via the
      // invoice first. On lookup failure fall through — Zoom/Meet still enforce.
      try {
        const payStatus = await fetchLiveSessionPaymentStatus(session.session_id);
        if (payStatus.payment_required && payStatus.payment_status !== "PAID") {
          toast.info(
            t("liveClass.toast.paymentRequired", {
              session: getTerminology(ContentTerms.Session, SystemTerms.Session).toLowerCase(),
            })
          );
          const registration = await registerAndPayForLiveSession(session.session_id);
          if (registration.invoice_id) {
            (navigate as any)({
              to: "/pay/invoice/$invoiceId",
              params: { invoiceId: registration.invoice_id },
              search: { redirect: "/study-library/live-class" },
            });
            return;
          }
        }
      } catch (error) {
        console.error("Live-session payment status check failed:", error);
      }

      // PRE_JOINING sessions join the live class directly during the
      // waiting-room window instead of entering the waiting-room screen.
      const isPreJoining = session.waiting_room_type === "PRE_JOINING";
      if (isInWaitingRoom && !isPreJoining) {
        // Navigate to waiting room (waiting room will handle attendance marking)
        console.log("Navigating to waiting room for:", session.title);
        navigate({
          to: "/study-library/live-class/waiting-room",
          search: { sessionId: session.schedule_id },
        });
      } else {
        // Mark attendance before joining live session
        try {
          console.log("Marking attendance for live session:", session.title);
          await markAttendance({
            sessionId: session.session_id,
            scheduleId: session.schedule_id,
            userSourceType: "USER",
            userSourceId: "",
            details: "Auto-joined live class from username route",
          });

          // Navigate to live session after marking attendance
          if (isBbbSession(session.link_type)) {
            // BBB: open the personalized join URL (real name + userId). Checked FIRST
            // so BBB never routes to the embed page (which can't resolve a BBB room →
            // "Unsupported session type") or the shared generic meeting_link.
            await openBbbJoinForLearner(session.schedule_id);
            navigate({ to: "/study-library/live-class" });
          } else if (
            session.session_streaming_service_type ===
            SessionStreamingServiceType.EMBED
          ) {
            navigate({
              to: "/study-library/live-class/embed",
              search: { sessionId: session.schedule_id },
            });
          } else {
            window.open(session.meeting_link, "_blank", "noopener,noreferrer");
            navigate({ to: "/study-library/live-class" });
          }
        } catch (error) {
          console.error("Failed to mark attendance:", error);
          toast.error(t("liveClass.toast.markAttendanceFailed"));

          // Still proceed with navigation even if attendance marking fails
          if (isBbbSession(session.link_type)) {
            // BBB: open the personalized join URL (real name + userId). Checked FIRST
            // so BBB never routes to the embed page (which can't resolve a BBB room →
            // "Unsupported session type") or the shared generic meeting_link.
            await openBbbJoinForLearner(session.schedule_id);
            navigate({ to: "/study-library/live-class" });
          } else if (
            session.session_streaming_service_type ===
            SessionStreamingServiceType.EMBED
          ) {
            navigate({
              to: "/study-library/live-class/embed",
              search: { sessionId: session.schedule_id },
            });
          } else {
            window.open(session.meeting_link, "_blank", "noopener,noreferrer");
            navigate({ to: "/study-library/live-class" });
          }
        }
      }
    },
    [navigate, markAttendance, t]
  );

  /**
   * Join a class, showing the institute's disclaimer first when this learner has
   * not been in THIS class before.
   *
   * The check must happen here rather than on the class screen: proceedToSession
   * marks attendance as it joins, and once that row exists the learner counts as
   * present, so a check made any later always answers "not required" and the
   * video would never appear.
   */
  const handleNavigateToSession = useCallback(
    async (session: SessionDetails, isInWaitingRoom: boolean) => {
      // The institute the learner is logged into (selectedInstituteId), not the
      // token's first key — for a learner in two institutes that is arbitrary.
      const instituteId = await getInstituteId();
      if (instituteId) {
        const disclaimer = await getLiveClassDisclaimer(
          instituteId,
          session.schedule_id
        );
        if (disclaimer.required && disclaimer.videoUrl) {
          setPendingJoin({ session, isInWaitingRoom });
          setDisclaimerUrl(disclaimer.videoUrl);
          return;
        }
      }
      await proceedToSession(session, isInWaitingRoom);
    },
    [proceedToSession]
  );

  // Check for active sessions and auto-navigate or show selection
  useEffect(() => {
    if (
      authState === "authenticated" &&
      sessions &&
      !isSessionsLoading &&
      batchIds.length > 0
    ) {
      // Combine live and upcoming sessions
      const allSessions = [
        ...(sessions?.live_sessions ?? []),
        ...(sessions?.upcoming_sessions ?? []),
      ];

      // Get sessions that are currently active (in waiting room or live)
      const activeSessionsData = getActiveSessions(allSessions);
      try {
        // Auto-join policy: a session that is LIVE right now always wins — the learner
        // opened their unique link to attend class, so join it without asking. The
        // selection dialog is only for a genuine tie (2+ simultaneously live) or when
        // everything active is still in its waiting-room window.
        const liveNow = activeSessionsData.filter(({ status }) => status.isLive);
        if (activeSessionsData.length === 0) {
          // No active sessions, redirect to live-class page
          navigate({ to: "/study-library/live-class" });
        } else if (liveNow.length === 1) {
          // Exactly one session live right now — auto-join it, even if other
          // sessions are in their waiting-room window.
          const { session, status } = liveNow[0];
          handleNavigateToSession(session, status.isInWaitingRoom);
        } else if (activeSessionsData.length === 1) {
          // Nothing live yet but one session active (waiting room) — auto-navigate
          const { session, status } = activeSessionsData[0];
          handleNavigateToSession(session, status.isInWaitingRoom);
        } else {
          // Multiple candidates and no unambiguous live session — let the learner pick
          setActiveSessions(activeSessionsData);
          setShowSessionSelection(true);
        }
      } catch (err) {
        console.error(
          `Error processing active sessions for user: ${username}`,
          err
        );
      }
    }
  }, [
    authState,
    sessions,
    isSessionsLoading,
    batchIds,
    navigate,
    handleNavigateToSession,
  ]);

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await getTokenFromStorage(TokenKey.accessToken);
        const studentDetails = await Preferences.get({ key: "StudentDetails" });
        const instituteDetails = await Preferences.get({
          key: "InstituteDetails",
        });

        const hasToken = !isNullOrEmptyOrUndefined(token);
        const hasStudentDetails = !isNullOrEmptyOrUndefined(
          studentDetails.value
        );
        const hasInstituteDetails = !isNullOrEmptyOrUndefined(
          instituteDetails.value
        );

        if (hasToken && hasStudentDetails && hasInstituteDetails) {
      
          setAuthState("authenticated");
        } else {
        
          setAuthState("unauthenticated");
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
        
        setAuthState("unauthenticated");
      }
    };

    // Only check auth after domain routing is resolved
    if (!domainRouting.isLoading) {
      checkAuth();
    }
  }, [domainRouting.isLoading, domainRouting]);

  const handleLoginSuccess = () => {
    // After successful login, set authenticated state
    setAuthState("authenticated");
  };

  const handleSessionSelect = async (session: SessionDetails) => {
    const activeSession = activeSessions.find(
      (s) => s.session.schedule_id === session.schedule_id
    );
    if (activeSession) {
      setShowSessionSelection(false);
      await handleNavigateToSession(
        session,
        activeSession.status.isInWaitingRoom
      );
    }
  };

  // A join is waiting on the disclaimer. Shown ahead of every other branch —
  // including the loader — so the class cannot start behind it.
  if (disclaimerUrl && pendingJoin) {
    return (
      <DisclaimerVideoScreen
        videoUrl={disclaimerUrl}
        onContinue={() => {
          const { session, isInWaitingRoom } = pendingJoin;
          setDisclaimerUrl(null);
          setPendingJoin(null);
          void proceedToSession(session, isInWaitingRoom);
        }}
      />
    );
  }

  // Show loading while checking auth or domain routing or sessions
  if (
    domainRouting.isLoading ||
    authState === "loading" ||
    (authState === "authenticated" && isSessionsLoading)
  ) {
    return <DashboardLoader />;
  }

  // Show session selection dialog if there are multiple active sessions
  if (authState === "authenticated" && showSessionSelection) {
    return (
      <>
        <DashboardLoader />
        <SessionSelectionDialog
          open={showSessionSelection}
          onOpenChange={setShowSessionSelection}
          sessions={activeSessions}
          onSelectSession={handleSessionSelect}
        />
      </>
    );
  }

  // Don't render anything if we're redirecting authenticated users
  if (authState === "authenticated") {
    return <DashboardLoader />;
  }

  // Show login form for unauthenticated users
  return (
    <div className="min-h-screen  flex flex-col bg-gray-50 w-full ">
      {/* Institute Branding */}
      {domainRouting.instituteId && (
        <div className="w-full bg-white shadow-sm">
          <div className="mx-auto px-4 py-4">
            <AuthPageBranding
              branding={{
                instituteId: domainRouting.instituteId,
                instituteName: domainRouting.instituteName,
                instituteLogoFileId: domainRouting.instituteLogoFileId,
                instituteThemeCode: domainRouting.instituteThemeCode,
              }}
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Login Form.
              instituteId is optional: institutes served from a shared domain have
              no domain-routing row, so it resolves to null here. The username in
              the URL is globally unique, which is enough to look the learner up —
              blocking on a missing institute locked those learners out of their
              own join link. */}
          <SessionLoginForm
            username={username}
            instituteId={domainRouting.instituteId ?? undefined}
            onLoginSuccess={handleLoginSuccess}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white border-t">
        <div className="mx-auto px-4 py-4">
          <p className="text-center text-sm text-gray-500">
            {t("liveClass.usernameLogin.footerHelp", {
              liveSession: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession).toLowerCase(),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

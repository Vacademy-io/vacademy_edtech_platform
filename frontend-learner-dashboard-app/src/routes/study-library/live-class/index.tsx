import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { createFileRoute } from "@tanstack/react-router";
import { Helmet } from "react-helmet";
import { useEffect, useState, useLayoutEffect, useCallback, useMemo, type ReactNode } from "react";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { useLiveSessions } from "./-hooks/useLiveSessions";
import { usePastSessions } from "./-hooks/usePastSessions";
import { useCalendarPastSessions } from "./-hooks/useCalendarPastSessions";
import { SessionDetails, PastSessionDetails } from "./-types/types";
import { PastSessionCard } from "./-components/PastSessionCard";
import { InstructorLine } from "./-components/InstructorLine";

import { useNavigate } from "@tanstack/react-router";
import { SessionStreamingServiceType } from "@/routes/register/live-class/-types/enum";
import { getAllPackageSessionIds } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { useMarkAttendance } from "./-hooks/useMarkAttendance";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Calendar,
  List,
  Clock,
  MapPin,
  Users,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { calculateDuration } from "@/lib/live-class/utils";
import { isBbbSession, openBbbJoinForLearner } from "@/lib/live-class/bbb-join";
import {
  fetchLiveSessionPaymentStatus,
  registerAndPayForLiveSession,
} from "./-services/livePayment";
import {
  formatSessionTimeInUserTimezone,
  convertSessionTimeToUserTimezone,
  getTimezoneDisplayInfo,
} from "@/utils/timezone";
import { getUserTimezone } from "@/hooks/use-server-time";
import { DefaultClassCard } from "./-components/DefaultClassCard";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { SessionFilter, FilterChangePayload } from "@/components/common/session-filter";
import { useTranslation } from "react-i18next";
import {
  formatDate as formatDateIntl,
  formatDateTime as formatDateTimeIntl,
} from "@/lib/formatters";

/**
 * Calendar labels live in the lazily-loaded `study` catalog, so a render can land
 * before that namespace resolves (or after its chunk fails to fetch) with t()
 * still handing back the raw key. Reading `.map` off that string took the whole
 * page down, so these stand in until the catalog is actually in.
 */
const FALLBACK_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const FALLBACK_DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** t(key, { returnObjects: true }) yields the key itself until the catalog loads. */
const asStringArray = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) && value.length > 0 ? (value as string[]) : fallback;

export const Route = createFileRoute("/study-library/live-class/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <LiveClassView />;
}

const EmbeddedShell = ({ children }: { children: ReactNode }) => <>{children}</>;

/**
 * The learner's live/upcoming session list. `embedded` drops the page chrome
 * (layout, nav heading, document title) so another screen can host it — the
 * Courses page's "Live sessions" custom tab does.
 */
export function LiveClassView({ embedded = false }: { embedded?: boolean }) {
  const Shell = embedded ? EmbeddedShell : LayoutContainer;
  const { t } = useTranslation("study");
  const liveSessionTerm = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const liveSessionsTerm = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
  const sessionsTerm = getTerminologyPlural(ContentTerms.Session, SystemTerms.Session);
  const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

  const { setNavHeading } = useNavHeadingStore();
  const navigate = useNavigate();
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [selectedView, setSelectedView] = useState<string>("list");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dayModalOpen, setDayModalOpen] = useState<boolean>(false);
  const [selectedDayData, setSelectedDayData] = useState<{
    date: Date;
    sessions: SessionDetails[];
    pastSessions: PastSessionDetails[];
  } | null>(null);


  // Filter states — updated by SessionFilter via onFilterChange callback
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");
  // Mirrors the active filterType returned from SessionFilter (used for display/labels)
  const [activeFilterType, setActiveFilterType] = useState<FilterChangePayload["filterType"]>("none");
  const [apiPage, setApiPage] = useState<number>(0);
  const [upcomingPage, setUpcomingPage] = useState<number>(0); // Client-side pagination for upcoming sessions
  const [pastPage, setPastPage] = useState<number>(0); // Server-side pagination for past sessions
  const SESSIONS_PER_PAGE = 5;

  /**
   * Called by SessionFilter whenever the user picks or clears a filter.
   * The parent's only job here is to store the dates and reset pagination.
   */
  const handleFilterChange = useCallback(({ filterType, startDate, endDate }: FilterChangePayload) => {
    setActiveFilterType(filterType);
    setStartDateFilter(startDate);
    setEndDateFilter(endDate);
    setUpcomingPage(0);
    setApiPage(0);
  }, []);


  // Helper function to format date as YYYY-MM-DD
  const formatDateToISO = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };


  const { mutateAsync: markAttendance } = useMarkAttendance();

  // State to trigger re-renders for time-based updates
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000); // Check every 10 seconds for smoother transitions
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchBatchIds = async () => {
      const ids = await getAllPackageSessionIds();
      console.log('Fetched batch IDs:', ids);
      setBatchIds(ids);
    };
    fetchBatchIds();
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [apiPage]);

  const {
    data: sessions,
    isLoading,
    isFetching,
    error,
  } = useLiveSessions(batchIds, {
    startDate:
      selectedView === "calendar"
        ? formatDateToISO(
          new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
        )
        : undefined,
    endDate:
      selectedView === "calendar"
        ? formatDateToISO(
          new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)
        )
        : undefined,
    size: 500,
    page: selectedView === "list" ? apiPage : 0,
  });

  const {
    sessions: pastSessions,
    displayFlags: pastDisplayFlags,
    totalPages: pastTotalPages,
    isLoading: isPastLoading,
    isFetching: isPastFetching,
  } = usePastSessions(batchIds.length > 0 ? batchIds : null, {
    page: pastPage,
    size: 5,
  });

  // Calendar View's month-scoped past sessions — bounded to the visible
  // month's past-date window (not the List View's flat page), so any past
  // day shown on the grid/day-modal is fully loaded. Reuses the
  // `show_past_sessions` flag from the List View's usePastSessions call
  // above instead of fetching settings twice.
  const {
    sessions: calendarPastSessions,
  } = useCalendarPastSessions(
    batchIds.length > 0 ? batchIds : null,
    selectedDate,
    selectedView === "calendar" && pastDisplayFlags.show_past_sessions
  );



  useLayoutEffect(() => {
    if (embedded) return;
    setNavHeading(getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession));
  }, [setNavHeading, embedded]);
  const hasNextPage = (sessions?.totalReturned ?? 0) === 10;

  const formatDateTime = (date: string, time: string, timezone?: string) => {
    if (timezone) {
      return formatSessionTimeInUserTimezone(date, time, timezone);
    }
    // Fallback to original logic for sessions without timezone
    const datetime = new Date(`${date}T${time}`);
    return formatDateTimeIntl(datetime, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatDate = (date: Date) => {
    return formatDateIntl(date, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleJoinSession = async (session: SessionDetails) => {
    if (
      session.session_streaming_service_type ===
      SessionStreamingServiceType.EMBED
    ) {
      console.log("Embed session clicked:", session);
    }

    // Paid live class gate: the backend refuses joins until this learner's
    // registration is PAID, so intercept and route through the payment page
    // first. On any lookup failure, fall through — the server still enforces.
    try {
      const payStatus = await fetchLiveSessionPaymentStatus(session.session_id);
      if (payStatus.payment_required && payStatus.payment_status !== "PAID") {
        toast.info(t("liveClass.toast.paymentRequired", { session: sessionTerm.toLowerCase() }));
        const registration = await registerAndPayForLiveSession(
          session.session_id
        );
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

    const now = new Date();

    let sessionDate, sessionEndDate, waitingRoomStart;

    if (session.timezone) {
      // Use timezone-aware calculation
      sessionDate = convertSessionTimeToUserTimezone(
        session.meeting_date,
        session.start_time,
        session.timezone
      );
      sessionEndDate = convertSessionTimeToUserTimezone(
        session.meeting_date,
        session.last_entry_time,
        session.timezone
      );

      // If end time is before start time, session spans midnight - add 1 day
      if (sessionEndDate < sessionDate) {
        sessionEndDate = new Date(sessionEndDate.getTime() + 24 * 60 * 60 * 1000);
      }

      waitingRoomStart = new Date(sessionDate);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - session.waiting_room_time
      );
    } else {
      // Fallback to original logic
      sessionDate = new Date(`${session.meeting_date}T${session.start_time}`);
      sessionEndDate = new Date(`${session.meeting_date}T${session.last_entry_time}`);

      // If end time is before start time, session spans midnight - add 1 day
      if (sessionEndDate < sessionDate) {
        sessionEndDate = new Date(sessionEndDate.getTime() + 24 * 60 * 60 * 1000);
      }

      waitingRoomStart = new Date(sessionDate);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - session.waiting_room_time
      );
    }

    // Check timing status
    const isBeforeWaitingRoom = now < waitingRoomStart;
    const isInWaitingRoom = now >= waitingRoomStart && now < sessionDate;
    const isLiveClassStarted = now >= sessionDate;
    const hasSessionEnded = now > sessionEndDate;

    // Zoom relaxation: any Zoom session lets Zoom decide its own lifecycle —
    // don't gate by our scheduled last_entry_time (soft deadline) or by
    // provider_meeting_id presence (the list API may not include it in older
    // cached responses; the SDK / backend will surface a real "meeting ended"
    // if Zoom has actually ended it). Match link_type case-insensitively —
    // backend may send "ZOOM", "zoom" or "ZOOM_MEETING".
    const lt = (session.link_type ?? "").toLowerCase();
    const isZoomReady = lt === "zoom" || lt === "zoom_meeting";

    // PRE_JOINING: during the waiting-room window the learner joins the live
    // class directly instead of entering the waiting-room screen.
    const isPreJoining = session.waiting_room_type === "PRE_JOINING";

    // If session has ended, show error — except for Zoom-ready sessions; the
    // SDK / backend will surface a real "meeting ended" if Zoom has ended it.
    if (hasSessionEnded && !isZoomReady) {
      toast.error(t("liveClass.toast.classEnded", { liveClass: liveSessionTerm.toLowerCase() }));
      return;
    }

    // If it's before waiting room time, show error — skip for Zoom-ready
    // sessions so learners can join early.
    if (isBeforeWaitingRoom && !isZoomReady) {
      toast.error(
        t("liveClass.toast.classNotStartedYet")
      );
      return;
    }

    // If we're in waiting room period, ONLY go to waiting room — skip for
    // Zoom-ready sessions; they go straight to the SDK / Zoom app, which has
    // its own waiting room and handles the host-not-started case.
    if (isInWaitingRoom && !isZoomReady && !isPreJoining) {
      // Navigate to waiting room without marking attendance
      (navigate as any)({
        to: "/study-library/live-class/waiting-room",
        search: { sessionId: session.schedule_id },
      });
      return;
    }

    // If live class has started (or it's a Zoom session with a meeting that's
    // joinable any time, or a PRE_JOINING session whose waiting-room window is
    // open), proceed to join the live class directly.
    if (isLiveClassStarted || isZoomReady || (isInWaitingRoom && isPreJoining)) {
      // Helper to navigate/open based on session type
      const isBbb = isBbbSession(session.link_type);

      const openSession = async () => {
        if (isBbb) {
          // BBB: fetch a personalized per-user join URL (real name + userId) and
          // open it. NEVER open the stored generic meeting_link for BBB — it is a
          // shared "Attendee"/"attendee-id" URL that causes duplicate-userId ejects.
          await openBbbJoinForLearner(session.schedule_id);
        } else if (
          session.session_streaming_service_type ===
          SessionStreamingServiceType.EMBED
        ) {
          (navigate as any)({
            to: "/study-library/live-class/embed",
            search: {
              sessionId: session.schedule_id,
              learnerButtonConfig: session.learner_button_config ?? undefined,
            },
          });
        } else {
          const joinLink = (session as any).custom_meeting_link || (session as any).customMeetingLink || session.meeting_link;
          window.open(joinLink, "_blank", "noopener,noreferrer");
        }
      };

      try {
        // Mark attendance only when directly joining live session
        await markAttendance({
          sessionId: session.session_id,
          scheduleId: session.schedule_id,
          userSourceType: "USER",
          userSourceId: "",
          details: "Joined live class directly",
        });
        await openSession();
      } catch (error) {
        console.error("Failed to mark attendance:", error);
        toast.error(t("liveClass.toast.markAttendanceFailed"));

        // Still proceed even if attendance marking fails — openSession() already
        // routes BBB / EMBED / external links correctly (BBB via the personalized
        // join URL). Do NOT also open meeting_link here: for BBB that is the shared
        // generic link, and it would double-open the session.
        await openSession();
      }
    } else {
      // This should not happen, but add a fallback
      console.warn("Unexpected timing state - no action taken");
      toast.error(t("liveClass.toast.statusUndetermined", { session: sessionTerm.toLowerCase() }));
    }
  };

  // Helper function to filter sessions based on date range and subject
  const filterSessions = (sessions: SessionDetails[]) => {
    return sessions.filter((session) => {
      // Use string comparison for YYYY-MM-DD which is more robust than Date objects
      const sessionDateStr = session.meeting_date;

      // Date range filter
      if (startDateFilter && sessionDateStr < startDateFilter) {
        return false;
      }

      if (endDateFilter && sessionDateStr > endDateFilter) {
        return false;
      }

      return true;
    });
  };

  // Reset pagination when filters change
  useEffect(() => {
    setApiPage(0);
    setPastPage(0);
  }, [startDateFilter, endDateFilter, selectedView]);

  // Helper function to determine if a session is currently live (in waiting room or active)
  const isSessionLive = useCallback((session: SessionDetails) => {
    const now = new Date();

    let sessionStart, sessionEnd, waitingRoomStart;

    if (session.timezone) {
      // Use timezone-aware calculation
      sessionStart = convertSessionTimeToUserTimezone(
        session.meeting_date,
        session.start_time,
        session.timezone
      );
      sessionEnd = convertSessionTimeToUserTimezone(
        session.meeting_date,
        session.last_entry_time,
        session.timezone
      );

      // If end time is before start time, session spans midnight - add 1 day
      if (sessionEnd < sessionStart) {
        sessionEnd = new Date(sessionEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      waitingRoomStart = new Date(sessionStart);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - session.waiting_room_time
      );
    } else {
      // Fallback to original logic
      sessionStart = new Date(`${session.meeting_date}T${session.start_time}`);
      sessionEnd = new Date(`${session.meeting_date}T${session.last_entry_time}`);

      // If end time is before start time, session spans midnight - add 1 day
      if (sessionEnd < sessionStart) {
        sessionEnd = new Date(sessionEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      waitingRoomStart = new Date(sessionStart);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - session.waiting_room_time
      );
    }

    // Session is considered "live" if:
    // 1. Current time is after waiting room start
    // 2. Current time is before session end
    return now >= waitingRoomStart && now <= sessionEnd;
  }, [currentTime]);

  const renderSession = (session: SessionDetails, isLive: boolean) => {
    // Calculate session timing for button text and status
    const now = new Date();
    let sessionDate, waitingRoomStart;

    if (session.timezone) {
      sessionDate = convertSessionTimeToUserTimezone(
        session.meeting_date,
        session.start_time,
        session.timezone
      );
      waitingRoomStart = new Date(sessionDate);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - session.waiting_room_time
      );
    } else {
      sessionDate = new Date(`${session.meeting_date}T${session.start_time}`);
      waitingRoomStart = new Date(sessionDate);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - session.waiting_room_time
      );
    }

    const isBeforeWaitingRoom = now < waitingRoomStart;
    const isInWaitingRoom = now >= waitingRoomStart && now < sessionDate;
    const isLiveClassStarted = now >= sessionDate;

    // Zoom: joinable any time (no scheduled-window gate) — Zoom handles "waiting for host"
    // and "meeting ended" itself. But we DO gate on provider_meeting_id: an un-provisioned
    // Zoom meeting would 409 in the SDK, so show "Setting up…" until it exists. BBB/others
    // provision at join time, so they're never gated this way.
    const lt = (session.link_type ?? "").toLowerCase();
    const isZoom = lt === "zoom" || lt === "zoom_meeting";
    const canJoinEarlyZoom = isZoom;
    const zoomSettingUp = isZoom && !session.provider_meeting_id;
    // PRE_JOINING: during the waiting-room window, offer "Join Live Class"
    // (direct join) instead of "Join Waiting Room".
    const isPreJoining = session.waiting_room_type === "PRE_JOINING";

    return (
      <div
        key={session.schedule_id}
        className="group p-4 border rounded-xl bg-white dark:bg-neutral-900 hover:bg-primary-50/30 dark:hover:bg-primary-900/20 border-neutral-200 dark:border-neutral-800 hover:border-primary-200/60 dark:hover:border-primary-700/60 hover:shadow-sm transition-all duration-200 w-full"
      >
        {/* Desktop Layout: Button on the right */}
        <div className="hidden sm:flex justify-between items-start gap-4">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                {session.title}
              </h3>
              {isLive && (
                <span
                  className={`px-2 py-1 text-white text-xs font-medium rounded-full animate-pulse whitespace-nowrap ${isInWaitingRoom
                    ? "bg-orange-600"
                    : isLiveClassStarted
                      ? "bg-danger-600"
                      : "bg-gray-600"
                    }`}
                >
                  {isInWaitingRoom
                    ? t("liveClass.badge.waitingRoom")
                    : isLiveClassStarted
                      ? t("liveClass.badge.live")
                      : t("liveClass.badge.startingSoon")}
                </span>
              )}
            </div>
            {/* Subject - Display if not 'none', for both Live and Upcoming */}
            {session.subject && session.subject.toLowerCase() !== 'none' && (
              <div className="flex items-center gap-1 text-sm text-neutral-600 mb-2">
                <MapPin
                  size={16}
                  className="text-neutral-500 dark:text-neutral-400"
                />
                <span className="capitalize dark:text-neutral-300">
                  {session.subject}
                </span>
              </div>
            )}

            <InstructorLine instructors={session.instructors} className="mb-2" />

            {/* Date - Display only for Upcoming sessions */}
            {!isLive && (
              <div className="flex items-center gap-1 text-sm text-neutral-600 mb-2">
                <Calendar
                  size={16}
                  className="text-neutral-500 dark:text-neutral-400"
                />
                <span className="capitalize dark:text-neutral-300">
                  {formatDateIntl(session.meeting_date, {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock
                  size={16}
                  className="text-neutral-500 dark:text-neutral-400"
                />
                <span className="text-neutral-600 dark:text-neutral-300">
                  <span className="font-medium">{t("liveClass.field.starts")}</span>{" "}
                  {formatDateTime(
                    session.meeting_date,
                    session.start_time,
                    session.timezone
                  )}
                  {session.timezone && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 ms-1">
                      ({getTimezoneDisplayInfo(session.timezone).sessionTz})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Users
                  size={16}
                  className="text-neutral-500 dark:text-neutral-400"
                />
                <span className="text-neutral-600 dark:text-neutral-300">
                  <span className="font-medium">{t("liveClass.field.duration")}</span>{" "}
                  {calculateDuration(session.start_time, session.last_entry_time)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {(isLive || canJoinEarlyZoom) && (session.meeting_link || session.link_type === "bbb" || session.link_type === "BBB_MEETING" || canJoinEarlyZoom) && (
              <Button
                variant="default"
                size="sm"
                disabled={zoomSettingUp}
                title={zoomSettingUp ? t("liveClass.zoomSettingUpTooltip") : undefined}
                className="shrink-0 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => handleJoinSession(session)}
              >
                <ArrowSquareOut size={16} className="me-1.5" />
                {zoomSettingUp
                  ? t("liveClass.button.settingUp")
                  : !isLive && canJoinEarlyZoom
                    ? t("liveClass.button.joinEarly")
                    : isBeforeWaitingRoom
                      ? t("liveClass.button.notStarted")
                      : isInWaitingRoom
                        ? isPreJoining
                          ? t("liveClass.button.joinLiveClass")
                          : t("liveClass.button.joinWaitingRoom")
                        : t("liveClass.button.joinSession")}
              </Button>
            )}
          </div>
        </div>

        {/* Mobile Layout: Button at the bottom */}
        <div className="flex flex-col gap-stack sm:hidden">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                {session.title}
              </h3>
              {isLive && (
                <span
                  className={`px-2 py-1 text-white text-xs font-medium rounded-full animate-pulse whitespace-nowrap ${isInWaitingRoom
                    ? "bg-orange-600"
                    : isLiveClassStarted
                      ? "bg-danger-600"
                      : "bg-gray-600"
                    }`}
                >
                  {isInWaitingRoom
                    ? t("liveClass.badge.waitingRoom")
                    : isLiveClassStarted
                      ? t("liveClass.badge.live")
                      : t("liveClass.badge.startingSoon")}
                </span>
              )}
            </div>
            {/* Subject - Display if not 'none', for both Live and Upcoming */}
            {session.subject && session.subject.toLowerCase() !== 'none' && (
              <div className="flex items-center gap-1 text-sm text-neutral-600 mb-2">
                <MapPin
                  size={16}
                  className="text-neutral-500 dark:text-neutral-400"
                />
                <span className="capitalize dark:text-neutral-300">
                  {session.subject}
                </span>
              </div>
            )}

            <InstructorLine instructors={session.instructors} className="mb-2" />

            {/* Date - Display only for Upcoming sessions */}
            {!isLive && (
              <div className="flex items-center gap-1 text-sm text-neutral-600 mb-2">
                <Calendar
                  size={16}
                  className="text-neutral-500 dark:text-neutral-400"
                />
                <span className="capitalize dark:text-neutral-300">
                  {formatDateIntl(session.meeting_date, {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock
                size={16}
                className="text-neutral-500 dark:text-neutral-400"
              />
              <span className="text-neutral-600 dark:text-neutral-300">
                <span className="font-medium">{t("liveClass.field.starts")}</span>{" "}
                {formatDateTime(
                  session.meeting_date,
                  session.start_time,
                  session.timezone
                )}
                {session.timezone && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 ms-1">
                    ({getTimezoneDisplayInfo(session.timezone).sessionTz})
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Users
                size={16}
                className="text-neutral-500 dark:text-neutral-400"
              />
              <span className="text-neutral-600 dark:text-neutral-300">
                <span className="font-medium">{t("liveClass.field.duration")}</span>{" "}
                {calculateDuration(session.start_time, session.last_entry_time)}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {(isLive || canJoinEarlyZoom) && (session.meeting_link || session.link_type === "bbb" || session.link_type === "BBB_MEETING" || canJoinEarlyZoom) && (
              <Button
                variant="default"
                size="sm"
                disabled={zoomSettingUp}
                title={zoomSettingUp ? t("liveClass.zoomSettingUpTooltip") : undefined}
                className="w-full bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => handleJoinSession(session)}
              >
                <ArrowSquareOut size={16} className="me-1.5" />
                {zoomSettingUp
                  ? t("liveClass.button.settingUp")
                  : !isLive && canJoinEarlyZoom
                    ? t("liveClass.button.joinEarly")
                    : isBeforeWaitingRoom
                      ? t("liveClass.button.notStarted")
                      : isInWaitingRoom
                        ? isPreJoining
                          ? t("liveClass.button.joinLiveClass")
                          : t("liveClass.button.joinWaitingRoom")
                        : t("liveClass.button.joinSession")}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Calendar view functions
  const getCurrentMonth = () => {
    return selectedDate.getMonth();
  };

  const getCurrentYear = () => {
    return selectedDate.getFullYear();
  };

  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month: number, year: number) => {
    return new Date(year, month, 1).getDay();
  };

  const navigateMonth = (direction: "prev" | "next") => {
    setSelectedDate((prev) => {
      const newDate = new Date(prev);
      if (direction === "prev") {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  const getSessionsForDate = (date: Date) => {
    if (selectedView !== "calendar") return [];

    const formattedDate = formatDateToISO(date);

    return [
      ...(sessions?.live_sessions ?? []),
      ...(sessions?.upcoming_sessions ?? []),
    ].filter((session) => session.meeting_date === formattedDate);
  };

  // Month-scoped past sessions for a given calendar day — sourced from
  // useCalendarPastSessions, which already fetched exactly this month's
  // past-date window, so any past day on the visible grid is fully loaded.
  const getPastSessionsForDate = (date: Date): PastSessionDetails[] => {
    if (selectedView !== "calendar" || !pastDisplayFlags.show_past_sessions) return [];
    const formattedDate = formatDateToISO(date);
    return calendarPastSessions.filter((s) => s.meeting_date === formattedDate);
  };

  const handleDayClick = (
    date: Date,
    sessionsForDay: SessionDetails[],
    pastSessionsForDay: PastSessionDetails[]
  ) => {
    const isToday = date.toDateString() === new Date().toDateString();
    const hasDefaultClass = !!(sessions as any)?.defaultDayConfig?.defaultClassLink;
    if (
      sessionsForDay.length > 0 ||
      pastSessionsForDay.length > 0 ||
      (isToday && hasDefaultClass)
    ) {
      setSelectedDayData({ date, sessions: sessionsForDay, pastSessions: pastSessionsForDay });
      setDayModalOpen(true);
    }
  };

  const renderDayModal = () => {
    if (!selectedDayData) return null;

    const liveSessions = selectedDayData.sessions.filter((session) =>
      sessions?.live_sessions?.includes(session)
    );
    const upcomingSessions = selectedDayData.sessions.filter((session) =>
      sessions?.upcoming_sessions?.includes(session)
    );

    // Past Sessions for this day — month-scoped data from
    // useCalendarPastSessions, already loaded for the whole visible month,
    // so no "list not loaded" fallback is needed here.
    const pastSessionsForDay = selectedDayData.pastSessions;

    // const defaultDayConfig = (sessions as any)?.defaultDayConfig;
    // const isToday = selectedDayData.date.toDateString() === new Date().toDateString();
    // const showDefaultClass = isToday && defaultDayConfig?.defaultClassLink && liveSessions.length === 0;

    return (
      <Dialog open={dayModalOpen} onOpenChange={setDayModalOpen}>
        <DialogContent className="max-w-2xl max-h-screen-80 overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
              {t("liveClass.dayModal.classesOn", { date: formatDate(selectedDayData.date) })}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {liveSessions.length > 0 && (
              <div className="space-y-stack">
                <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-danger-600 animate-pulse"></div>
                  {liveSessionsTerm}
                </h3>
                <div className="space-y-3">
                  {liveSessions
                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                    .map((session) => (
                      <div
                        key={session.schedule_id}
                        className="p-4 border rounded-lg bg-gradient-to-r from-danger-50/50 to-danger-100/30 border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-900"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1 space-y-1">
                            <h4 className="font-semibold text-neutral-800 dark:text-neutral-100">
                              {session.title}
                            </h4>
                            <div className="flex items-center gap-4 text-sm text-neutral-600 dark:text-neutral-300">
                              <div className="flex items-center gap-1">
                                <Clock size={14} />
                                <span>
                                  {formatDateTime(
                                    session.meeting_date,
                                    session.start_time,
                                    session.timezone
                                  )}{" "}
                                  -{" "}
                                  {formatDateTime(
                                    session.meeting_date,
                                    session.last_entry_time,
                                    session.timezone
                                  )}
                                  {session.timezone && (
                                    <span className="text-xs text-neutral-500 dark:text-neutral-400 ms-1">
                                      (
                                      {
                                        getTimezoneDisplayInfo(session.timezone)
                                          .sessionTz
                                      }
                                      )
                                    </span>
                                  )}
                                </span>
                              </div>
                              {session.subject && session.subject.toLowerCase() !== "none" && (
                                <div className="flex items-center gap-1">
                                  <MapPin size={14} />
                                  <span className="capitalize dark:text-neutral-300">
                                    {session.subject}
                                  </span>
                                </div>
                              )}
                              <InstructorLine
                                instructors={session.instructors}
                                iconSize={14}
                              />
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0 ms-4">
                            {(session.meeting_link || session.link_type === "bbb" || session.link_type === "BBB_MEETING") && (
                              <Button
                                size="sm"
                                className="bg-danger-600 hover:bg-danger-700 text-white"
                                onClick={() => {
                                  handleJoinSession(session);
                                  setDayModalOpen(false);
                                }}
                              >
                                <ArrowSquareOut size={14} className="me-1" />
                                {(session.session_streaming_service_type?.toLowerCase() === SessionStreamingServiceType.EMBED.toLowerCase())
                                  ? t("liveClass.button.join")
                                  : t("liveClass.button.join")}
                                {t("liveClass.button.join")}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {upcomingSessions.length > 0 && (
              <div className="space-y-stack">
                <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-info-600"></div>
                  {t("liveClass.dayModal.upcomingSessions", { sessions: sessionsTerm })}
                </h3>
                <div className="space-y-3">
                  {upcomingSessions
                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                    .map((session) => (
                      <div
                        key={session.schedule_id}
                        className="p-4 border rounded-lg bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1 space-y-1">
                            <h4 className="font-semibold text-neutral-800 dark:text-neutral-100">
                              {session.title}
                            </h4>
                            <div className="flex items-center gap-4 text-sm text-neutral-600 dark:text-neutral-300">
                              <div className="flex items-center gap-1">
                                <Clock size={14} />
                                <span>
                                  {formatDateTime(
                                    session.meeting_date,
                                    session.start_time,
                                    session.timezone
                                  )}{" "}
                                  -{" "}
                                  {formatDateTime(
                                    session.meeting_date,
                                    session.last_entry_time,
                                    session.timezone
                                  )}
                                  {session.timezone && (
                                    <span className="text-xs text-neutral-500 dark:text-neutral-400 ms-1">
                                      (
                                      {
                                        getTimezoneDisplayInfo(session.timezone)
                                          .sessionTz
                                      }
                                      )
                                    </span>
                                  )}
                                </span>
                              </div>
                              {session.subject && session.subject.toLowerCase() !== "none" && (
                                <div className="flex items-center gap-1">
                                  <MapPin size={14} />
                                  <span className="capitalize dark:text-neutral-300">
                                    {session.subject}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {pastSessionsForDay.length > 0 && (
              <div className="space-y-stack">
                <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-neutral-400"></div>
                  {t("liveClass.dayModal.pastSessions", { sessions: sessionsTerm })}
                </h3>
                <div className="space-y-3">
                  {pastSessionsForDay.map((session) => (
                    <PastSessionCard key={session.schedule_id} session={session} />
                  ))}
                </div>
              </div>
            )}

            {selectedDayData.sessions.length === 0 && pastSessionsForDay.length === 0 && (
              <div className="text-center py-8 space-y-stack">
                <Clock size={48} className="mx-auto text-neutral-400" />
                <p className="text-neutral-600 dark:text-neutral-300">
                  {t("liveClass.dayModal.noneScheduled", { liveSessions: liveSessionsTerm.toLowerCase() })}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const renderCalendarView = () => {
    const month = getCurrentMonth();
    const year = getCurrentYear();
    const daysInMonth = getDaysInMonth(month, year);
    const firstDay = getFirstDayOfMonth(month, year);

    const monthNames = asStringArray(
      t("liveClass.calendar.monthNames", { returnObjects: true }),
      FALLBACK_MONTH_NAMES
    );

    const dayNames = asStringArray(
      t("liveClass.calendar.dayNamesShort", { returnObjects: true }),
      FALLBACK_DAY_NAMES_SHORT
    );

    const days = [];

    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(
        <div
          key={`empty-${i}`}
          className="h-24 border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
        ></div>
      );
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(year, month, day);
      const sessionsForDay = getSessionsForDate(currentDate);
      const pastSessionsForDay = getPastSessionsForDate(currentDate);
      const isToday = currentDate.toDateString() === new Date().toDateString();
      const hasLive = sessionsForDay.some((session) =>
        sessions?.live_sessions?.includes(session)
      );
      const hasUpcoming = sessionsForDay.length > 0 && !hasLive;
      const hasDefaultClass = isToday && !!(sessions as any)?.defaultDayConfig?.defaultClassLink && !hasLive;
      const sessionCount = sessionsForDay.length + pastSessionsForDay.length;
      const isClickable = sessionCount > 0 || hasDefaultClass;
      // Combined preview: Live/Upcoming first, then Past — used for the
      // day-cell's single-line preview and the dot color below.
      const previewItems = [
        ...sessionsForDay.map((session) => ({
          key: session.schedule_id,
          title: session.title,
          time: formatSessionTimeInUserTimezone(
            session.meeting_date,
            session.start_time,
            session.timezone
          ).slice(0, 5),
          kind: sessions?.live_sessions?.includes(session) ? ("live" as const) : ("upcoming" as const),
        })),
        ...pastSessionsForDay.map((session) => ({
          key: session.schedule_id,
          title: session.title,
          time: formatSessionTimeInUserTimezone(
            session.meeting_date,
            session.start_time,
            session.timezone
          ).slice(0, 5),
          kind: "past" as const,
        })),
      ];

      days.push(
        <div
          key={day}
          className={`h-24 border border-neutral-200 dark:border-neutral-800 p-1 transition-all duration-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer ${isToday
            ? "bg-primary-50/50 border-primary-200 dark:bg-primary-950/30 dark:border-primary-700"
            : "bg-white dark:bg-neutral-900"
            } ${isClickable ? "hover:shadow-sm" : ""}`}
          onClick={() => handleDayClick(currentDate, sessionsForDay, pastSessionsForDay)}
        >
          <div
            className={`text-sm font-medium mb-1 flex items-center justify-between ${isToday
              ? "text-primary-700 dark:text-primary-300"
              : "text-neutral-700 dark:text-neutral-200"
              }`}
          >
            <span>{day}</span>
            {sessionCount > 0 && (
              <div
                className={`flex items-center gap-1 ${hasLive
                  ? "text-red-600 dark:text-red-400"
                  : hasUpcoming
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-neutral-500 dark:text-neutral-400"
                  }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${hasLive
                    ? "bg-danger-600 animate-pulse"
                    : hasUpcoming
                      ? "bg-info-600"
                      : "bg-neutral-400"
                    }`}
                ></div>
                <span className="text-xs font-semibold">{sessionCount}</span>
              </div>
            )}
          </div>

          {/* Compact session indicators */}
          <div className="space-y-1">
            {previewItems.slice(0, 1).map((item) => (
              <div
                key={item.key}
                className={`text-xs p-1 rounded truncate transition-all duration-200 ${item.kind === "live"
                  ? "bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
                  : item.kind === "upcoming"
                    ? "bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"
                    : "bg-neutral-100 text-neutral-600 border border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700"
                  }`}
                title={item.title}
              >
                {item.time} {item.title}
              </div>
            ))}

            {/* Default class indicator for today */}
            {hasDefaultClass && sessionCount === 0 && (
              <div
                className="text-xs p-1 rounded truncate transition-all duration-200 bg-green-100 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900"
                title={(sessions as any)?.defaultDayConfig?.defaultClassName || getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}
              >
                {(sessions as any)?.defaultDayConfig?.defaultClassName || getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}
              </div>
            )}

            {sessionCount > 1 && (
              <div
                className={`text-xs text-center font-medium rounded py-1 ${hasLive
                  ? "bg-red-100/80 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
                  : hasUpcoming
                    ? "bg-blue-100/80 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"
                    : "bg-neutral-100/80 text-neutral-600 border border-neutral-200 dark:bg-neutral-800/60 dark:text-neutral-300 dark:border-neutral-700"
                  }`}
              >
                {t("liveClass.calendar.moreCount", { count: sessionCount - 1 })}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
        {/* Calendar Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
            {monthNames[month]} {year}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateMonth("prev")}
              className="border-neutral-300 dark:border-neutral-700 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"
            >
              ←
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDate(new Date())}
              className="border-neutral-300 dark:border-neutral-700 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"
            >
              {t("liveClass.button.today")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateMonth("next")}
              className="border-neutral-300 dark:border-neutral-700 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"
            >
              →
            </Button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-0">
          {/* Day headers */}
          {dayNames.map((day) => (
            <div
              key={day}
              className="h-10 border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center font-medium text-sm text-neutral-700 dark:text-neutral-200"
            >
              {day}
            </div>
          ))}
          {/* Calendar days */}
          {days}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gradient-to-r from-danger-500/20 to-danger-600/20 border border-red-200 dark:from-red-900/40 dark:to-red-800/40 dark:border-red-900"></div>
            <span className="text-neutral-600 dark:text-neutral-300">
              {liveSessionsTerm}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-100 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-900"></div>
            <span className="text-neutral-600 dark:text-neutral-300">
              {t("liveClass.dayModal.upcomingSessions", { sessions: sessionsTerm })}
            </span>
          </div>
          {pastDisplayFlags.show_past_sessions && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-neutral-100 border border-neutral-300 dark:bg-neutral-800 dark:border-neutral-600"></div>
              <span className="text-neutral-600 dark:text-neutral-300">
                {t("liveClass.dayModal.pastSessions", { sessions: sessionsTerm })}
              </span>
            </div>
          )}
          <div className="text-neutral-500 dark:text-neutral-400 text-xs italic">
            {t("liveClass.calendar.clickDayHint", { liveSessions: liveSessionsTerm.toLowerCase() })}
          </div>
        </div>
      </div>
    );
  };

  // Combine and re-classify sessions dynamically
  // This ensures that if a session enters waiting room, it moves to "Live" immediately
  const { derivedLiveSessions, derivedUpcomingSessions } = useMemo(() => {
    if (!sessions) return { derivedLiveSessions: [], derivedUpcomingSessions: [] };

    // Combine all sessions from backend (since backend categorization might lag behind client time)
    const allSessions = [
      ...(sessions.live_sessions || []),
      ...(sessions.upcoming_sessions || []),
    ];

    // Deduplicate in case API returns same session in both
    const uniqueSessionsMap = new Map<string, SessionDetails>();
    allSessions.forEach(s => uniqueSessionsMap.set(s.schedule_id, s));
    const uniqueSessions = Array.from(uniqueSessionsMap.values());

    const live: SessionDetails[] = [];
    const upcoming: SessionDetails[] = [];

    uniqueSessions.forEach(session => {
      if (isSessionLive(session)) {
        live.push(session);
      } else {
        upcoming.push(session);
      }
    });

    // Sort live sessions: earliest start time first
    live.sort((a, b) => {
      const startA = new Date(`${a.meeting_date}T${a.start_time}`).getTime();
      const startB = new Date(`${b.meeting_date}T${b.start_time}`).getTime();
      return startA - startB;
    });

    // Sort upcoming sessions: earliest start time first
    upcoming.sort((a, b) => {
      const startA = new Date(`${a.meeting_date}T${a.start_time}`).getTime();
      const startB = new Date(`${b.meeting_date}T${b.start_time}`).getTime();
      return startA - startB;
    });

    return { derivedLiveSessions: live, derivedUpcomingSessions: upcoming };
  }, [sessions, isSessionLive]); // Re-calculate when sessions change or isSessionLive logic changes (which depends on currentTime)

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center min-h-52">
          <div className="flex flex-col items-center gap-stack">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <div className="text-neutral-600 dark:text-neutral-300">
              {t("liveClass.state.loadingSessions")}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="p-4 border border-red-200 dark:border-red-900 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("liveClass.state.errorLoadingPrefix")}</span>
            <span>{(error as Error).message}</span>
          </div>
        </div>
      </Shell>
    );
  }

  const liveSessions = selectedView === "list" ? derivedLiveSessions : [];
  const upcomingSessions = selectedView === "list" ? derivedUpcomingSessions : [];
  return (
    <Shell>
      {!embedded && (
        <Helmet>
          <title>{document?.title || t("liveClass.meta.pageTitle", { liveClasses: liveSessionsTerm })}</title>
          <meta name="description" content={t("liveClass.meta.pageDescription", { liveClasses: liveSessionsTerm.toLowerCase() })} />
        </Helmet>
      )}

      <div className="space-y-6">
        {/* View Toggle */}
        <Tabs
          value={selectedView}
          onValueChange={setSelectedView}
          className="w-full"
        >
          <TabsList className="h-auto border-b border-neutral-200/80 dark:border-neutral-800 bg-transparent p-0">
            <TabsTrigger
              value="list"
              className="data-[state=active]:text-primary data-[state=active]:border-primary hover:text-primary -mb-px px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-gradient-to-r hover:from-primary-50/60 hover:to-info-50/40 dark:hover:from-primary-900/20 dark:hover:to-transparent focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1 data-[state=active]:rounded-t-lg data-[state=active]:border-b-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-white data-[state=active]:to-primary-50/30 dark:data-[state=active]:from-neutral-900 dark:data-[state=active]:to-primary-900/20 data-[state=inactive]:text-neutral-500 dark:data-[state=inactive]:text-neutral-400 data-[state=inactive]:hover:rounded-t-lg"
            >
              <List size={18} className="me-2" />
              {t("liveClass.tabs.list")}
            </TabsTrigger>
            <TabsTrigger
              value="calendar"
              className="data-[state=active]:text-primary data-[state=active]:border-primary hover:text-primary -mb-px px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-gradient-to-r hover:from-primary-50/60 hover:to-info-50/40 dark:hover:from-primary-900/20 dark:hover:to-transparent focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1 data-[state=active]:rounded-t-lg data-[state=active]:border-b-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-white data-[state=active]:to-primary-50/30 dark:data-[state=active]:from-neutral-900 dark:data-[state=active]:to-primary-900/20 data-[state=inactive]:text-neutral-500 dark:data-[state=inactive]:text-neutral-400 data-[state=inactive]:hover:rounded-t-lg"
            >
              <Calendar size={18} className="me-2" />
              {t("liveClass.tabs.calendar")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-6" key={`list-view-${apiPage}`}>
            <div className={`space-y-6 transition-opacity duration-200 ${isFetching && !isLoading ? 'opacity-50' : 'opacity-100'}`} key={`page-${apiPage}`}>
              {/* Live Sessions Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
                    {t("liveClass.section.liveSessionsHeading", { liveSessions: liveSessionsTerm, timezone: getUserTimezone() })}
                  </h2>
                  {liveSessions.length > 0 && (
                    <span className="text-sm text-neutral-600 dark:text-neutral-300">
                      {t("liveClass.section.sessionCount", { count: liveSessions.length })}
                    </span>
                  )}
                </div>
                {liveSessions.length > 0 ? (
                  <div className="space-y-4 w-full">
                    {liveSessions.map((session) =>
                      renderSession(session, isSessionLive(session))
                    )}
                  </div>
                ) : (sessions as any)?.defaultDayConfig?.defaultClassLink ? (
                  <div className="w-full">
                    <DefaultClassCard
                      defaultClassLink={(sessions as any)?.defaultDayConfig?.defaultClassLink}
                      defaultClassName={(sessions as any)?.defaultDayConfig?.defaultClassName}
                    />
                  </div>
                ) : (
                  <div className="text-neutral-600 dark:text-neutral-300 p-4 sm:p-6 bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-900/60 rounded-lg w-full border border-neutral-200 dark:border-neutral-800">
                    <div className="text-center">
                      <Users
                        size={48}
                        className="mx-auto text-neutral-400 dark:text-neutral-500 mb-3"
                      />
                      <p className="font-medium">
                        {t("liveClass.section.noneAtTheMoment", { liveSessions: liveSessionsTerm.toLowerCase() })}
                      </p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                        {t("liveClass.section.checkBackLater", { sessions: sessionsTerm.toLowerCase() })}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Upcoming Sessions Section */}
              <div>
                {/* Row 1: Title + SessionFilter (reusable component) */}
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
                    {t("liveClass.dayModal.upcomingSessions", { sessions: sessionsTerm })}
                  </h2>

                  {/* Drop-in SessionFilter — all state, dropdown, and animation live inside it */}
                  <SessionFilter
                    onFilterChange={handleFilterChange}
                    alignment="right"
                  />
                </div>

                {/* Row 2: Session count subtitle */}
                {(() => {
                  const filteredUpcomingSessions = filterSessions(upcomingSessions);
                  return (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                      {filteredUpcomingSessions.length > 0
                        ? t("liveClass.section.foundCount", {
                            count: filteredUpcomingSessions.length,
                            liveSessions:
                              filteredUpcomingSessions.length === 1
                                ? liveSessionTerm.toLowerCase()
                                : liveSessionsTerm.toLowerCase(),
                          })
                        : t("liveClass.section.noneFound", { liveSessions: liveSessionsTerm.toLowerCase() })}
                      {activeFilterType !== "none" && (
                        <span className="ms-1 text-primary-500 font-medium">
                          · {activeFilterType === "custom" && startDateFilter && endDateFilter
                            ? `${startDateFilter.split("-").reverse().join("/")} - ${endDateFilter.split("-").reverse().join("/")}`
                            : activeFilterType === "1day" ? t("liveClass.filter.days", { count: 1 })
                              : activeFilterType === "3days" ? t("liveClass.filter.days", { count: 3 })
                                : activeFilterType === "7days" ? t("liveClass.filter.days", { count: 7 })
                                  : activeFilterType === "15days" ? t("liveClass.filter.days", { count: 15 })
                                    : ""}
                        </span>
                      )}
                    </p>
                  );
                })()}
                {(() => {
                  const filteredUpcomingSessions =
                    filterSessions(upcomingSessions);

                  // Client-side pagination
                  const startIndex = upcomingPage * SESSIONS_PER_PAGE;
                  const endIndex = startIndex + SESSIONS_PER_PAGE;
                  const paginatedSessions = filteredUpcomingSessions.slice(startIndex, endIndex);
                  const totalPages = Math.ceil(filteredUpcomingSessions.length / SESSIONS_PER_PAGE);

                  return (
                    <>
                      {filteredUpcomingSessions.length > 0 ? (
                        <>
                          <div className="space-y-4 w-full">
                            {paginatedSessions.map((session) =>
                              renderSession(session, false)
                            )}
                          </div>

                          {/* Client-side pagination for upcoming sessions */}
                          <div className="mt-6 flex items-center justify-center gap-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setUpcomingPage(p => Math.max(0, p - 1))}
                              disabled={upcomingPage === 0}
                            >
                              {t("liveClass.button.previous")}
                            </Button>
                            <span className="text-sm text-neutral-600 dark:text-neutral-300">
                              {t("liveClass.pagination.pageOf", { page: upcomingPage + 1, totalPages })}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setUpcomingPage(p => Math.min(totalPages - 1, p + 1))}
                              disabled={upcomingPage >= totalPages - 1}
                            >
                              {t("liveClass.button.next")}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="text-neutral-600 dark:text-neutral-300 p-4 sm:p-6 bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-900/60 rounded-lg w-full border border-neutral-200 dark:border-neutral-800">
                          <div className="text-center">
                            <Clock
                              size={48}
                              className="mx-auto text-neutral-400 dark:text-neutral-500 mb-3"
                            />
                            <p className="font-medium">
                              {startDateFilter || endDateFilter
                                ? t("liveClass.section.noUpcomingMatchFilters", { sessions: sessionsTerm.toLowerCase() })
                                : t("liveClass.section.noUpcomingScheduled", { sessions: sessionsTerm.toLowerCase() })}
                            </p>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                              {startDateFilter || endDateFilter
                                ? t("liveClass.section.adjustFilters", { sessions: sessionsTerm.toLowerCase() })
                                : t("liveClass.section.newSessionsWillAppear", { sessions: sessionsTerm.toLowerCase() })}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Past Sessions Section — admin-governed; rendered only when the
                  institute has turned on "Show past sessions to learners". */}
              {pastDisplayFlags.show_past_sessions && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
                      {t("liveClass.dayModal.pastSessions", { sessions: sessionsTerm })}
                    </h2>
                  </div>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                    {t("liveClass.section.pastSessionsSubtitle", { batch: batchTerm.toLowerCase() })}
                  </p>

                  {isPastLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                    </div>
                  ) : pastSessions.length > 0 ? (
                    <>
                      <div
                        className={`space-y-4 w-full transition-opacity duration-200 ${isPastFetching ? "opacity-50" : "opacity-100"
                          }`}
                      >
                        {pastSessions.map((session) => (
                          <PastSessionCard key={session.schedule_id} session={session} />
                        ))}
                      </div>

                      {pastTotalPages > 1 && (
                        <div className="mt-6 flex items-center justify-center gap-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPastPage((p) => Math.max(0, p - 1))}
                            disabled={pastPage === 0}
                          >
                            {t("liveClass.button.previous")}
                          </Button>
                          <span className="text-sm text-neutral-600 dark:text-neutral-300">
                            {t("liveClass.pagination.pageOf", { page: pastPage + 1, totalPages: pastTotalPages })}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPastPage((p) => Math.min(pastTotalPages - 1, p + 1))}
                            disabled={pastPage >= pastTotalPages - 1}
                          >
                            {t("liveClass.button.next")}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-neutral-600 dark:text-neutral-300 p-4 sm:p-6 bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-900/60 rounded-lg w-full border border-neutral-200 dark:border-neutral-800">
                      <div className="text-center">
                        <Clock
                          size={48}
                          className="mx-auto text-neutral-400 dark:text-neutral-500 mb-3"
                        />
                        <p className="font-medium">{t("liveClass.section.noPastSessionsYet")}</p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                          {t("liveClass.section.classesWillShowUp")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* API Pagination - To navigate through the sized results */}
              {(sessions as any)?.totalReturned >= 500 || apiPage > 0 ? (
                <div className="mt-12 flex flex-col items-center gap-4 border-t pt-8">
                  <div className="text-sm text-neutral-500">
                    {t("liveClass.pagination.viewingPage", { page: apiPage + 1 })}
                  </div>
                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setApiPage((p) => Math.max(0, p - 1));

                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={apiPage === 0}
                    >
                      {t("liveClass.button.previousSessions", { sessions: sessionsTerm })}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setApiPage(apiPage + 1);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={!hasNextPage}

                    >
                      {t("liveClass.button.nextSessions", { sessions: sessionsTerm })}
                    </Button>
                  </div>
                </div>
              ) : null}


            </div>
          </TabsContent>

          <TabsContent value="calendar" className="mt-6">
            {/* Called eagerly by JSX, so keep it behind the same condition that
                mounts this panel — the list tab paid for a full month render. */}
            {selectedView === "calendar" && renderCalendarView()}
          </TabsContent>
        </Tabs >

        {/* Day Details Modal */}
        {renderDayModal()}
      </div >
    </Shell>
  );
}

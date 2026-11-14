import { useQuery } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { DaySession, SessionDetails, LearnerButtonConfig } from "../-types/types";
import { LIVE_SESSION_GET_LIVE_AND_UPCOMING } from "@/constants/urls";
import {
  getTokenDecodedData,
  getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { getInstituteId } from "@/constants/helper";
import {
  isSessionLiveTimezoneAware,
  isSessionUpcomingTimezoneAware,
  convertSessionTimeToUserTimezone,
} from "@/utils/timezone";

export interface LiveSessionsParams {
  startDate?: string;
  endDate?: string;
  size?: number;
  page?: number;
}

const fetchLiveAndUpcomingSessions = async (
  batchId: string | undefined,
  params?: LiveSessionsParams
): Promise<{
  live_sessions: SessionDetails[];
  upcoming_sessions: SessionDetails[];
  totalReturned: number;
  defaultDayConfig?: {
    learnerButtonConfig?: LearnerButtonConfig | null;
    defaultClassLink?: string | null;
    defaultClassName?: string | null;
  } | null;
}> => {
  try {
    const accessToken = await getTokenFromStorage(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    // instituteId lets the backend add the institute's public classes that have
    // no batch (when the institute opted in), even on the no-batch call.
    const instituteId = await getInstituteId();
    const response = await authenticatedAxiosInstance({
      method: "GET",
      url: LIVE_SESSION_GET_LIVE_AND_UPCOMING,
      params: {
        batchId,
        userId: tokenData?.user,
        instituteId: instituteId || undefined,
        ...params,
      },
    });



    const allSessions = (response.data as DaySession[]).reduce<
      SessionDetails[]
    >((acc, day) => [...acc, ...day.sessions], []);

    const live_sessions = allSessions.filter(isSessionLiveTimezoneAware);
    const upcoming_sessions = allSessions.filter(
      isSessionUpcomingTimezoneAware
    );

    upcoming_sessions.sort((a, b) => {
      const dateA = a.timezone
        ? convertSessionTimeToUserTimezone(a.meeting_date, a.start_time, a.timezone)
        : new Date(`${a.meeting_date}T${a.start_time}`);
      const dateB = b.timezone
        ? convertSessionTimeToUserTimezone(b.meeting_date, b.start_time, b.timezone)
        : new Date(`${b.meeting_date}T${b.start_time}`);
      return dateA.getTime() - dateB.getTime();
    });

    const todayString = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
    const todaySession = (response.data as DaySession[]).find(
      (day) => day.date === todayString
    );

    const defaultDayConfig = todaySession
      ? {
        learnerButtonConfig: todaySession.learnerButtonConfig,
        defaultClassLink: todaySession.defaultClassLink,
        defaultClassName: todaySession.defaultClassName,
      }
      : null;

    const transformedData = {
      live_sessions,
      upcoming_sessions,
      totalReturned: allSessions.length,
      defaultDayConfig,
    };

    return transformedData;
  } catch (error) {
    console.error("Error fetching live and upcoming sessions:", error);
    throw error;
  }
};

// Fetch sessions for multiple batches and combine results
const fetchLiveAndUpcomingSessionsForMultipleBatches = async (
  batchIds: string[],
  params?: LiveSessionsParams
): Promise<{
  live_sessions: SessionDetails[];
  upcoming_sessions: SessionDetails[];
  totalReturned: number;
  defaultDayConfig?: {
    learnerButtonConfig?: LearnerButtonConfig | null;
    defaultClassLink?: string | null;
    defaultClassName?: string | null;
  } | null;
}> => {
  try {
    // No batches: still ask once without a batchId, so classes the learner was
    // invited to directly, and the institute's unassigned public classes, show.
    const targets: (string | undefined)[] =
      batchIds && batchIds.length > 0 ? batchIds : [undefined];

    // Fetch sessions for all batches in parallel
    const results = await Promise.all(
      targets.map((batchId) => fetchLiveAndUpcomingSessions(batchId, params))
    );

    // Combine all sessions from all batches
    const allLiveSessions: SessionDetails[] = [];
    const allUpcomingSessions: SessionDetails[] = [];
    let defaultDayConfig: {
      learnerButtonConfig?: LearnerButtonConfig | null;
      defaultClassLink?: string | null;
      defaultClassName?: string | null;
    } | null = null;

    results.forEach((result) => {
      allLiveSessions.push(...result.live_sessions);
      allUpcomingSessions.push(...result.upcoming_sessions);
      if (result.defaultDayConfig && !defaultDayConfig) {
        defaultDayConfig = result.defaultDayConfig;
      }
    });

    // Deduplicate sessions by session_id, meeting_date, and start_time
    // This handles cases where a user is in multiple batches that have the same session scheduled
    const uniqueLiveSessions = Array.from(
      new Map(
        allLiveSessions.map((session) => [
          `${session.session_id}_${session.meeting_date}_${session.start_time}`,
          session,
        ])
      ).values()
    );

    const uniqueUpcomingSessions = Array.from(
      new Map(
        allUpcomingSessions.map((session) => [
          `${session.session_id}_${session.meeting_date}_${session.start_time}`,
          session,
        ])
      ).values()
    );

    uniqueUpcomingSessions.sort((a, b) => {
      const dateA = a.timezone
        ? convertSessionTimeToUserTimezone(a.meeting_date, a.start_time, a.timezone)
        : new Date(`${a.meeting_date}T${a.start_time}`);
      const dateB = b.timezone
        ? convertSessionTimeToUserTimezone(b.meeting_date, b.start_time, b.timezone)
        : new Date(`${b.meeting_date}T${b.start_time}`);
      return dateA.getTime() - dateB.getTime();
    });

    return {
      live_sessions: uniqueLiveSessions,
      upcoming_sessions: uniqueUpcomingSessions,
      totalReturned: uniqueLiveSessions.length + uniqueUpcomingSessions.length,
      defaultDayConfig,
    };
  } catch (error) {
    console.error("Error fetching sessions for multiple batches:", error);
    throw error;
  }
};

export const useLiveSessions = (
  batchIds: string[] | null,
  params?: LiveSessionsParams
) => {
  return useQuery({
    queryKey: [
      "liveSessions",
      batchIds,
      params?.page,
      params?.size,
      params?.startDate,
      params?.endDate,
    ],
    queryFn: () => fetchLiveAndUpcomingSessionsForMultipleBatches(batchIds!, params),
    // null = batches not resolved yet; [] = resolved, learner has none.
    enabled: !!batchIds,
    refetchInterval: 60000, // Refetch every minute to keep live status updated
  });
};

import { useQuery } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { LIVE_SESSION_GET_PAST } from "@/constants/urls";
import {
  getTokenDecodedData,
  getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import {
  PastDisplayFlags,
  PastSessionDetails,
  PastSessionsPageResponse,
} from "../-types/types";

export interface PastSessionsParams {
  page: number;
  size?: number;
  startDate?: string;
  endDate?: string;
}

export const DEFAULT_DISPLAY_FLAGS: PastDisplayFlags = {
  show_past_sessions: false,
  show_recordings: false,
  show_attendance: false,
  show_activity_stats: false,
  show_class_materials: false,
};

export const fetchPastSessions = async (
  batchId: string,
  userId: string | undefined,
  params: PastSessionsParams
): Promise<PastSessionsPageResponse> => {
  const response = await authenticatedAxiosInstance({
    method: "GET",
    url: LIVE_SESSION_GET_PAST,
    params: {
      batchId,
      userId,
      page: params.page,
      size: params.size ?? 20,
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return response.data as PastSessionsPageResponse;
};

export interface MergedPastSessionsResult {
  sessions: PastSessionDetails[];
  displayFlags: PastDisplayFlags;
  totalPages: number;
  totalElements: number;
}

// Fetch the same page from every batch in parallel and merge. With multiple
// batches this slightly over-fetches (we ask each batch for `page N` even
// though the true global page boundary may differ per batch) — accepted
// trade-off to keep this simple, per plan A4.
export const fetchPastSessionsForMultipleBatches = async (
  batchIds: string[],
  userId: string | undefined,
  params: PastSessionsParams
): Promise<MergedPastSessionsResult> => {
  if (!batchIds || batchIds.length === 0) {
    return {
      sessions: [],
      displayFlags: DEFAULT_DISPLAY_FLAGS,
      totalPages: 0,
      totalElements: 0,
    };
  }

  const results = await Promise.all(
    batchIds.map((batchId) => fetchPastSessions(batchId, userId, params))
  );

  // If the institute has past sessions disabled, every batch reports
  // all-false flags + empty content — surface that as-is.
  const displayFlags = results.reduce<PastDisplayFlags>(
    (acc, r) => ({
      show_past_sessions: acc.show_past_sessions || r.display_flags.show_past_sessions,
      show_recordings: acc.show_recordings || r.display_flags.show_recordings,
      show_attendance: acc.show_attendance || r.display_flags.show_attendance,
      show_activity_stats: acc.show_activity_stats || r.display_flags.show_activity_stats,
      show_class_materials:
        acc.show_class_materials || r.display_flags.show_class_materials,
    }),
    { ...DEFAULT_DISPLAY_FLAGS }
  );

  const allSessions = results.flatMap((r) => r.content);

  // Deduplicate in case a learner is in multiple batches sharing a session.
  const uniqueSessions = Array.from(
    new Map(allSessions.map((s) => [s.schedule_id, s])).values()
  );

  // Newest first.
  uniqueSessions.sort((a, b) => {
    const dateA = `${a.meeting_date}T${a.start_time}`;
    const dateB = `${b.meeting_date}T${b.start_time}`;
    return dateB.localeCompare(dateA);
  });

  const totalPages = Math.max(...results.map((r) => r.total_pages), 0);
  // A session shared by batches — or an unassigned public class, which every
  // batch returns — is counted once per batch by the backend; take back the
  // repeats seen on this page so the count isn't inflated per batch.
  const duplicates = allSessions.length - uniqueSessions.length;
  const totalElements = Math.max(
    results.reduce((sum, r) => sum + r.total_elements, 0) - duplicates,
    uniqueSessions.length
  );

  return { sessions: uniqueSessions, displayFlags, totalPages, totalElements };
};

export const usePastSessions = (
  batchIds: string[] | null,
  params: PastSessionsParams
) => {
  const query = useQuery({
    queryKey: [
      "pastSessions",
      batchIds,
      params.page,
      params.size,
      params.startDate,
      params.endDate,
    ],
    queryFn: async () => {
      const accessToken = await getTokenFromStorage(TokenKey.accessToken);
      const tokenData = getTokenDecodedData(accessToken);
      return fetchPastSessionsForMultipleBatches(batchIds!, tokenData?.user, params);
    },
    enabled: !!batchIds && batchIds.length > 0,
    // Past data is cold — refetch on mount/param-change only, no polling.
    refetchInterval: false,
  });

  return {
    sessions: query.data?.sessions ?? [],
    displayFlags: query.data?.displayFlags ?? DEFAULT_DISPLAY_FLAGS,
    totalPages: query.data?.totalPages ?? 0,
    totalElements: query.data?.totalElements ?? 0,
    page: params.page,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
};

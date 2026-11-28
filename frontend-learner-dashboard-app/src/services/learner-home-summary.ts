/**
 * The learner home summary (GET /admin-core-service/learner-home/v1/summary):
 * whether this learner's home leads with their classes ("class first") and the
 * facts that layout shows. The server decides class first for the token's user:
 * a live class in one of their batches within the last / next 14 days, and no
 * published learning content in any of their batches.
 *
 * The answer is remembered per institute and learner so a returning class
 * learner does not see the classic home flash first; every other learner has
 * nothing remembered and keeps the classic home exactly as before.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import { getTokenDecodedData, getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import type { PastSessionDetails } from "@/routes/study-library/live-class/-types/types";

export const LEARNER_HOME_SUMMARY_API = `${BASE_URL}/admin-core-service/learner-home/v1/summary`;

/** snake_case, as admin-core-service sends it. */
export interface LearnerHomeSummary {
  class_first: boolean;
  /** The soonest class in the learner's own batches that has not ended. */
  next_class?: {
    session_id: string;
    schedule_id: string;
    package_session_id: string;
    meeting_date: string;
    start_time: string;
    last_entry_time: string | null;
    timezone: string;
  } | null;
  /** This calendar month (IST), up to now. */
  attendance_month?: { attended: number; held: number } | null;
  /** The institute shows past classes and recordings to learners. */
  recordings_shown?: boolean;
  /** Classes in the last 14 days that have a recording. */
  new_recordings?: number;
  /** The newest past class with a recording, as the Live Class page lists it. */
  last_recorded_class?: PastSessionDetails | null;
}

const NOT_CLASS_FIRST: LearnerHomeSummary = { class_first: false };

export const fetchLearnerHomeSummary = async (instituteId: string): Promise<LearnerHomeSummary> => {
  const response = await authenticatedAxiosInstance.get(LEARNER_HOME_SUMMARY_API, {
    params: { instituteId },
  });
  const data = (response.data ?? {}) as Partial<LearnerHomeSummary>;
  return { ...data, class_first: data.class_first === true };
};

const rememberKey = (instituteId: string, userId: string) => `CLASS_FIRST_HOME_${instituteId}_${userId}`;

function readRemembered(key: string | null): boolean {
  if (!key) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeRemembered(key: string | null, value: boolean) {
  if (!key) return;
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the next visit just asks again.
  }
}

/**
 * The summary for the current learner. `classFirst` is the server's answer once
 * it lands, before that the remembered one (false for anyone never told yes).
 * A failed request keeps the classic home.
 */
export function useLearnerHomeSummary(enabled: boolean) {
  const [scope, setScope] = useState<{ instituteId: string; key: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const instituteId = await getInstituteId();
      const token = await getTokenFromStorage(TokenKey.accessToken);
      const userId = getTokenDecodedData(token)?.user;
      if (alive && instituteId && userId) setScope({ instituteId, key: rememberKey(instituteId, userId) });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);

  const query = useQuery({
    queryKey: ["LEARNER_HOME_SUMMARY", scope?.instituteId],
    queryFn: () => fetchLearnerHomeSummary(scope!.instituteId),
    enabled: enabled && !!scope,
    staleTime: 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (query.data) writeRemembered(scope?.key ?? null, query.data.class_first);
  }, [query.data, scope?.key]);

  const summary = query.data ?? NOT_CLASS_FIRST;
  const classFirst = enabled && (query.data ? query.data.class_first : query.isError ? false : readRemembered(scope?.key ?? null));
  return { summary, classFirst, isLoading: enabled && (!scope || query.isPending) && !query.isError, query };
}

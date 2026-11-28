import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceReport, ScheduleItem } from "./getAttendanceReport";
import { useGetBatchesQuery } from "../get-batches";
import { format, parseISO, subDays, isPast, isToday } from "date-fns";

export type AttendancePeriod = "7d" | "30d" | "90d";

export interface AttendanceStats {
  attendancePercentage: number;
  currentStreak: number;
  totalClassDays: number;
  presentDays: number;
  absentDays: number;
  unmarkedDays: number;
  totalSessions: number;
  /**
   * yyyy-MM-dd of the EARLIEST class day actually counted, or null when none.
   *
   * The window the learner picks is only an upper bound: the backend also floors
   * results at their enrolment date, and a studio may simply have no older
   * sessions. When that happens "30 Days" and "3 Months" return the identical
   * set and the card looks frozen — surfacing the real span explains why.
   */
  firstClassDay: string | null;
}

/**
 * A class that has not STARTED yet (today's later classes, future classes).
 * The backend coalesces missing attendance to "UNMARKED", so without a time
 * check these would count as unmarked/absent before the class even began.
 */
export function notStartedYet(s: ScheduleItem, now: Date): boolean {
  if (!s.meetingDate) return false;
  const start = new Date(`${s.meetingDate}T${s.startTime || "00:00:00"}`);
  return !Number.isNaN(start.getTime()) && start > now;
}

/**
 * Pure function: compute day-wise attendance stats from raw schedules.
 * Multiple classes in one day count as one day.
 * PRESENT if any class that day was attended.
 */
export function computeAttendanceStats(
  schedules: ScheduleItem[]
): AttendanceStats {
  if (!schedules || schedules.length === 0) {
    return {
      attendancePercentage: 0,
      currentStreak: 0,
      totalClassDays: 0,
      presentDays: 0,
      absentDays: 0,
      unmarkedDays: 0,
      totalSessions: schedules?.length ?? 0,
      firstClassDay: null,
    };
  }

  // Group schedules by date
  const dayMap = new Map<string, ScheduleItem[]>();
  for (const schedule of schedules) {
    const dateKey = schedule.meetingDate; // yyyy-MM-dd string
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, []);
    }
    dayMap.get(dateKey)!.push(schedule);
  }

  // Compute per-day status
  const dayStatuses: { date: string; status: "PRESENT" | "ABSENT" | "UNMARKED" }[] = [];

  const now = new Date();
  for (const [dateKey, daySchedules] of dayMap) {
    const dayDate = parseISO(dateKey);
    const isDayInPast = isPast(dayDate) && !isToday(dayDate);

    const hasAnyPresent = daySchedules.some(
      (s) => s.attendanceStatus === "PRESENT"
    );
    // Pending = no status yet, OR the class simply hasn't started (the backend
    // reports not-yet-started classes as UNMARKED, which must not read as
    // absent/unmarked before the class begins).
    const hasAnyPending = daySchedules.some(
      (s) =>
        !s.attendanceStatus ||
        (s.attendanceStatus === "UNMARKED" && notStartedYet(s, now))
    );
    const hasAnyUnmarked = daySchedules.some(
      (s) => s.attendanceStatus === "UNMARKED"
    );

    if (hasAnyPresent) {
      dayStatuses.push({ date: dateKey, status: "PRESENT" });
    } else if (hasAnyPending && !isDayInPast) {
      // Future/today with pending classes — skip from stats
      continue;
    } else if (hasAnyUnmarked) {
      dayStatuses.push({ date: dateKey, status: "UNMARKED" });
    } else {
      dayStatuses.push({ date: dateKey, status: "ABSENT" });
    }
  }

  const totalClassDays = dayStatuses.length;
  const presentDays = dayStatuses.filter((d) => d.status === "PRESENT").length;
  const absentDays = dayStatuses.filter((d) => d.status === "ABSENT").length;
  const unmarkedDays = dayStatuses.filter((d) => d.status === "UNMARKED").length;
  const attendancePercentage =
    totalClassDays > 0 ? Math.round((presentDays / totalClassDays) * 100) : 0;

  // Streak: sort descending, walk from most recent, count consecutive PRESENT
  const sorted = [...dayStatuses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  let currentStreak = 0;
  for (const day of sorted) {
    if (day.status === "PRESENT") {
      currentStreak++;
    } else {
      break;
    }
  }

  return {
    attendancePercentage,
    currentStreak,
    totalClassDays,
    presentDays,
    absentDays,
    unmarkedDays,
    totalSessions: schedules.length,
    // dayStatuses is built from a Map keyed by date, so sort rather than assume order.
    firstClassDay:
      dayStatuses.length > 0
        ? dayStatuses.map((d) => d.date).sort()[0]!
        : null,
  };
}

/**
 * Calendar days each period covers, INCLUDING today.
 *
 * The backend filters `meeting_date BETWEEN startDate AND endDate` — both ends
 * inclusive — so subtracting the full period length made every window one day
 * too long: "7 Days" spanned 8 calendar days and could report 8 class days out
 * of a 7-day period. Subtract length-1 so the label matches what is counted.
 */
const PERIOD_DAYS: Record<AttendancePeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function getPeriodStartDate(period: AttendancePeriod): Date {
  return subDays(new Date(), PERIOD_DAYS[period] - 1);
}

export const useAttendanceStats = (options?: {
  period?: AttendancePeriod;
  batchId?: string | null;
}) => {
  const period = options?.period ?? "7d";
  const { data: batches } = useGetBatchesQuery();

  // Resolve batchId: use passed value or fall back to first batch
  const resolvedBatchId =
    options?.batchId ??
    (Array.isArray(batches) && batches.length > 0
      ? batches[0]?.batches?.[0]?.package_session_id
      : batches?.batches?.[0]?.package_session_id) ??
    null;

  return useQuery<AttendanceStats | null>({
    queryKey: ["ATTENDANCE_STATS", resolvedBatchId, period],
    queryFn: async () => {
      if (!resolvedBatchId) return null;

      const startDate = format(getPeriodStartDate(period), "yyyy-MM-dd");
      const endDate = format(new Date(), "yyyy-MM-dd");

      const response = await fetchAttendanceReport({
        startDate,
        endDate,
        batchId: resolvedBatchId,
      });

      return computeAttendanceStats(response.schedules);
    },
    enabled: !!resolvedBatchId,
    staleTime: 5 * 60 * 1000,
  });
};

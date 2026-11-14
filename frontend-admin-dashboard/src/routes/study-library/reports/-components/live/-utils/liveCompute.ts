import type { TFunction } from 'i18next';
import { LiveSessionRow, LiveStudentReport } from '../-services/liveReportApi';

/**
 * Aggregation for the Live Class report. All metrics are derived from the raw
 * per-learner / per-class rows. Deliberate choices (learned from the slide-wise
 * report's data bugs):
 *  - durations are NULL-skipped, never 0-filled (OFFLINE marks have no duration);
 *  - a single class duration is capped so one runaway provider value can't skew an average;
 *  - UNMARKED counts as "not present" (stays in the denominator);
 *  - engagement only exists for ONLINE provider-synced rows.
 */

/** Hard ceiling for one class so a bad provider value can't explode an average. */
const MAX_CLASS_MINUTES = 1440;

export interface Engagement {
    chats: number;
    talks: number;
    talkTimeSeconds: number;
    raiseHand: number;
    emojis: number;
    pollVotes: number;
}

export const EMPTY_ENGAGEMENT: Engagement = {
    chats: 0,
    talks: 0,
    talkTimeSeconds: 0,
    raiseHand: 0,
    emojis: 0,
    pollVotes: 0,
};

export function parseEngagement(raw: string | null | undefined): Engagement | null {
    if (!raw) return null;
    try {
        const e = JSON.parse(raw);
        // The opt-in activeness score lands in the same JSON during the class; with
        // none of BBB's counters present there is no engagement data yet (not zeros).
        const hasBbbCounters =
            !!e &&
            typeof e === 'object' &&
            ['chats', 'talks', 'talkTime', 'raisehand', 'raiseHand', 'emojis', 'pollVotes'].some((k) => k in e);
        if (!hasBbbCounters) return null;
        return {
            chats: Number(e.chats) || 0,
            talks: Number(e.talks) || 0,
            talkTimeSeconds: Number(e.talkTime) || 0,
            raiseHand: Number(e.raisehand ?? e.raiseHand) || 0,
            emojis: Number(e.emojis) || 0,
            pollVotes: Number(e.pollVotes) || 0,
        };
    } catch {
        return null;
    }
}

function addEngagement(a: Engagement, b: Engagement): Engagement {
    return {
        chats: a.chats + b.chats,
        talks: a.talks + b.talks,
        talkTimeSeconds: a.talkTimeSeconds + b.talkTimeSeconds,
        raiseHand: a.raiseHand + b.raiseHand,
        emojis: a.emojis + b.emojis,
        pollVotes: a.pollVotes + b.pollVotes,
    };
}

/**
 * A single transparent "engagement index" — a weighted count of interactions,
 * NOT a percentage (so it can never read as >100%).
 *
 * Deliberately driven by ACTUAL talk time (minutes spoken) and structured
 * participation (chats, polls, raise-hands). We do NOT use the provider's raw
 * `talks` segment-count: it counts every micro-unmute/audio blip (hundreds per
 * learner over a term) and, when weighted, completely dominated the score —
 * turning "engagement" into "who unmuted most often". Talk time already
 * captures meaningful speaking, so the segment count is dropped.
 */
export function engagementIndex(e: Engagement): number {
    return Math.round(
        (e.talkTimeSeconds / 60) * 3 +
            e.chats +
            e.pollVotes * 2 +
            e.raiseHand +
            e.emojis * 0.5
    );
}

export const isPresent = (status: string | null): boolean => status === 'PRESENT';

function cappedDuration(row: LiveSessionRow): number | null {
    if (row.durationMinutes == null) return null;
    return Math.min(Math.max(row.durationMinutes, 0), MAX_CLASS_MINUTES);
}

function mean(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * `t` is optional so this shared util still works, untranslated, for callers
 * that don't (yet) have a namespace wired up. Pass a `t` bound to the
 * `studyLibraryBatchLiveReport` namespace (its `duration.*` keys) to get a
 * localized short duration like "5m" / "2h" / "2h 30m".
 */
export function formatDuration(minutes: number | null | undefined, t?: TFunction): string {
    if (minutes == null || Number.isNaN(minutes)) return t ? t('duration.none') : '—';
    const total = Math.round(minutes);
    if (total <= 0) return t ? t('duration.minutes', { count: 0 }) : '0m';
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return t ? t('duration.minutes', { count: m }) : `${m}m`;
    if (m === 0) return t ? t('duration.hours', { count: h }) : `${h}h`;
    return t ? t('duration.hoursMinutes', { h, m }) : `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Learner-level
// ---------------------------------------------------------------------------

export interface LearnerLiveStats {
    studentId: string;
    fullName: string;
    email: string;
    attendancePercentage: number;
    attended: number;
    total: number;
    avgDurationMinutes: number | null;
    engagement: Engagement;
    engagementIndex: number;
}

export function computeLearnerStats(student: LiveStudentReport): LearnerLiveStats {
    const presentRows = student.sessions.filter((s) => isPresent(s.attendanceStatus));
    const durations = presentRows
        .map(cappedDuration)
        .filter((d): d is number => d != null);

    let engagement = { ...EMPTY_ENGAGEMENT };
    for (const row of presentRows) {
        const e = parseEngagement(row.engagementData);
        if (e) engagement = addEngagement(engagement, e);
    }

    return {
        studentId: student.studentId,
        fullName: student.fullName,
        email: student.email,
        attendancePercentage: student.attendancePercentage ?? 0,
        attended: presentRows.length,
        total: student.sessions.length,
        avgDurationMinutes: durations.length ? mean(durations) : null,
        engagement,
        engagementIndex: engagementIndex(engagement),
    };
}

// ---------------------------------------------------------------------------
// Batch-level
// ---------------------------------------------------------------------------

export interface AttendancePoint {
    scheduleId: string;
    date: string;
    title: string;
    attendancePct: number;
    present: number;
    invited: number;
}

export interface PerClassStats {
    scheduleId: string;
    title: string;
    date: string;
    startTime: string | null;
    present: number;
    absent: number;
    unmarked: number;
    total: number;
    attendancePct: number;
    avgDurationMinutes: number | null;
    avgEngagementIndex: number;
}

export interface LeaderboardRow {
    rank: number;
    studentId: string;
    fullName: string;
    attendancePercentage: number;
    attended: number;
    total: number;
    avgDurationMinutes: number | null;
    engagementIndex: number;
    /** 0–100 participation score (per-class, normalized to the batch's most active learner). */
    engagementScore: number;
    /** Raw interaction totals behind the score (talk time, chats, polls, raise-hands…). */
    engagement: Engagement;
}

/** Per-class participation (raw weighted interactions ÷ classes attended). */
export function perClassEngagement(index: number, attended: number): number {
    return attended > 0 ? index / attended : 0;
}

export interface BatchLiveSummary {
    learnerCount: number;
    totalClassesHeld: number;
    avgAttendancePct: number;
    avgDurationMinutes: number | null;
    avgEngagementIndex: number;
    /** Highest per-class engagement in the batch — the 100-point reference. */
    maxEngagementPerClass: number;
    /** Batch-average 0–100 engagement score. */
    avgEngagementScore: number;
    avgEngagement: Engagement;
    timeline: AttendancePoint[];
    perClass: PerClassStats[];
    leaderboard: LeaderboardRow[];
}

export function computeBatchSummary(students: LiveStudentReport[]): BatchLiveSummary {
    const learnerStats = students.map(computeLearnerStats);

    // Per-class grouping across all learners.
    const byClass = new Map<
        string,
        { title: string; date: string; startTime: string | null; rows: LiveSessionRow[] }
    >();
    for (const student of students) {
        for (const row of student.sessions) {
            const key = row.scheduleId;
            if (!byClass.has(key)) {
                byClass.set(key, {
                    title: row.title,
                    date: row.meetingDate ?? '',
                    startTime: row.startTime,
                    rows: [],
                });
            }
            byClass.get(key)!.rows.push(row);
        }
    }

    const perClass: PerClassStats[] = [];
    const timeline: AttendancePoint[] = [];
    for (const [scheduleId, group] of byClass) {
        const present = group.rows.filter((r) => isPresent(r.attendanceStatus)).length;
        const absent = group.rows.filter((r) => r.attendanceStatus === 'ABSENT').length;
        const unmarked = group.rows.length - present - absent;
        const total = group.rows.length;
        const attendancePct = total ? (present / total) * 100 : 0;

        const durations = group.rows
            .filter((r) => isPresent(r.attendanceStatus))
            .map(cappedDuration)
            .filter((d): d is number => d != null);

        const indices = group.rows
            .filter((r) => isPresent(r.attendanceStatus))
            .map((r) => parseEngagement(r.engagementData))
            .filter((e): e is Engagement => e != null)
            .map(engagementIndex);

        perClass.push({
            scheduleId,
            title: group.title,
            date: group.date,
            startTime: group.startTime,
            present,
            absent,
            unmarked,
            total,
            attendancePct,
            avgDurationMinutes: durations.length ? mean(durations) : null,
            avgEngagementIndex: indices.length ? Math.round(mean(indices)) : 0,
        });

        timeline.push({
            scheduleId,
            date: group.date,
            title: group.title,
            attendancePct: Math.round(attendancePct * 100) / 100,
            present,
            invited: total,
        });
    }

    const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);
    perClass.sort(byDate);
    timeline.sort(byDate);

    // 0–100 engagement score: per-class participation normalized to the batch's
    // most-active learner (so it's fair regardless of how many classes attended).
    const maxEngagementPerClass = Math.max(
        0,
        ...learnerStats.map((s) => perClassEngagement(s.engagementIndex, s.attended))
    );
    const scoreFor = (s: LearnerLiveStats) =>
        maxEngagementPerClass > 0
            ? Math.round((perClassEngagement(s.engagementIndex, s.attended) / maxEngagementPerClass) * 100)
            : 0;

    // Leaderboard: attendance desc, engagement index as tiebreaker, dense rank.
    const ranked = [...learnerStats].sort(
        (a, b) =>
            b.attendancePercentage - a.attendancePercentage ||
            b.engagementIndex - a.engagementIndex
    );
    const leaderboard: LeaderboardRow[] = [];
    let lastKey = '';
    let rank = 0;
    ranked.forEach((s) => {
        const key = `${s.attendancePercentage}-${s.engagementIndex}`;
        if (key !== lastKey) {
            rank += 1;
            lastKey = key;
        }
        leaderboard.push({
            rank,
            studentId: s.studentId,
            fullName: s.fullName,
            attendancePercentage: s.attendancePercentage,
            attended: s.attended,
            total: s.total,
            avgDurationMinutes: s.avgDurationMinutes,
            engagementIndex: s.engagementIndex,
            engagementScore: scoreFor(s),
            engagement: s.engagement,
        });
    });

    // Batch averages (null-skip the learners with no recorded duration/engagement).
    const learnerDurations = learnerStats
        .map((s) => s.avgDurationMinutes)
        .filter((d): d is number => d != null);
    const avgEngagement: Engagement = learnerStats.length
        ? {
              chats: mean(learnerStats.map((s) => s.engagement.chats)),
              talks: mean(learnerStats.map((s) => s.engagement.talks)),
              talkTimeSeconds: mean(learnerStats.map((s) => s.engagement.talkTimeSeconds)),
              raiseHand: mean(learnerStats.map((s) => s.engagement.raiseHand)),
              emojis: mean(learnerStats.map((s) => s.engagement.emojis)),
              pollVotes: mean(learnerStats.map((s) => s.engagement.pollVotes)),
          }
        : { ...EMPTY_ENGAGEMENT };

    return {
        learnerCount: students.length,
        totalClassesHeld: byClass.size,
        avgAttendancePct: mean(learnerStats.map((s) => s.attendancePercentage)),
        avgDurationMinutes: learnerDurations.length ? mean(learnerDurations) : null,
        avgEngagementIndex: Math.round(mean(learnerStats.map((s) => s.engagementIndex))),
        maxEngagementPerClass,
        avgEngagementScore: learnerStats.length
            ? Math.round(mean(learnerStats.map((s) => scoreFor(s))))
            : 0,
        avgEngagement,
        timeline,
        perClass,
        leaderboard,
    };
}

import type {
    AssessmentBatchStats,
    AssessmentDashboardRow,
    AssessmentStatus,
} from '../-services/assessment-dashboard';

// ─── Shareable view (URL search params) ────────────────────────────────────

export interface AssessmentDashboardUrlState {
    from?: string;
    to?: string;
    batches?: string;
    types?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const list = (v?: string) =>
    (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

/** Reads URL filters back into state; anything malformed is ignored. */
export const parseAssessmentDashboardUrl = (search: AssessmentDashboardUrlState) => {
    const from = search.from && ISO_DATE.test(search.from) ? search.from : null;
    const to = search.to && ISO_DATE.test(search.to) ? search.to : null;
    return {
        range: from && to && from <= to ? { start: from, end: to } : null,
        batchIds: list(search.batches),
        playModes: list(search.types).map((m) => m.toUpperCase()),
    };
};

export const toAssessmentDashboardUrl = (state: {
    startDate: string;
    endDate: string;
    batchIds: string[];
    playModes: string[];
}): AssessmentDashboardUrlState => ({
    from: state.startDate,
    to: state.endDate,
    batches: state.batchIds.length ? state.batchIds.join(',') : undefined,
    types: state.playModes.length ? state.playModes.join(',') : undefined,
});

// ─── Navigation ─────────────────────────────────────────────────────────────

/** The assessment list tab a test lives on, which the details page takes as a param. */
export const listTabForStatus = (status: AssessmentStatus): string => {
    switch (status) {
        case 'UPCOMING':
            return 'upcomingTests';
        case 'CLOSED':
            return 'previousTests';
        default:
            return 'liveTests';
    }
};

// ─── Play modes ─────────────────────────────────────────────────────────────

/** i18n key suffix for a play mode; unknown modes fold into "other". */
export const playModeKey = (mode: string | null | undefined): string => {
    switch ((mode ?? '').toUpperCase()) {
        case 'EXAM':
            return 'exam';
        case 'MOCK':
            return 'mock';
        case 'PRACTICE':
            return 'practice';
        case 'SURVEY':
            return 'survey';
        case 'MANUAL_UPLOAD':
        case 'MANUAL_UPLOAD_EXAM':
            return 'offline';
        case 'ASSIGNMENT':
        case 'HOMEWORK':
            return 'assignment';
        default:
            return 'other';
    }
};

/** The four the product creates, then anything else the institute has in range. */
export const DEFAULT_PLAY_MODES = ['EXAM', 'MOCK', 'PRACTICE', 'SURVEY'];

export const playModeOptions = (fromServer: string[] | undefined, selected: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    [...DEFAULT_PLAY_MODES, ...(fromServer ?? []), ...selected].forEach((m) => {
        const key = m.toUpperCase();
        if (!seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    });
    return out;
};

// ─── Insights ───────────────────────────────────────────────────────────────

/** Tests smaller than this are too noisy to call "best" or "lowest". */
export const MIN_FOR_RANKING = 5;

export interface AssessmentInsights {
    bestTest: AssessmentDashboardRow | null;
    lowestParticipation: AssessmentDashboardRow | null;
    topBatch: AssessmentBatchStats | null;
    backlogTests: number;
    backlogSubmissions: number;
}

export const computeAssessmentInsights = (
    rows: AssessmentDashboardRow[],
    batches: AssessmentBatchStats[]
): AssessmentInsights => {
    const scored = rows.filter((r) => r.avg_score !== null && r.scored >= MIN_FOR_RANKING);
    const bestTest =
        [...scored].sort(
            (a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0) || b.scored - a.scored
        )[0] ?? null;

    const closed = rows.filter(
        (r) =>
            r.status === 'CLOSED' && r.expected >= MIN_FOR_RANKING && r.participation_rate !== null
    );
    const lowestParticipation =
        closed.length > 1
            ? [...closed].sort(
                  (a, b) =>
                      (a.participation_rate ?? 0) - (b.participation_rate ?? 0) ||
                      b.expected - a.expected
              )[0] ?? null
            : null;

    const rankedBatches = batches.filter(
        (b) => b.avg_score !== null && b.submissions >= MIN_FOR_RANKING
    );
    const topBatch =
        rankedBatches.length > 1
            ? [...rankedBatches].sort(
                  (a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0) || b.submissions - a.submissions
              )[0] ?? null
            : null;

    const backlog = rows.filter((r) => r.awaiting_evaluation + r.awaiting_release > 0);
    return {
        bestTest,
        lowestParticipation,
        topBatch,
        backlogTests: backlog.length,
        backlogSubmissions: backlog.reduce(
            (sum, r) => sum + r.awaiting_evaluation + r.awaiting_release,
            0
        ),
    };
};

/** Tests with work left for the staff, biggest backlog first. */
export const evaluationQueue = (rows: AssessmentDashboardRow[]) =>
    rows
        .filter((r) => r.awaiting_evaluation + r.awaiting_release > 0)
        .sort(
            (a, b) =>
                b.awaiting_evaluation - a.awaiting_evaluation ||
                b.awaiting_release - a.awaiting_release
        );

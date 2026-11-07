import { describe, expect, it } from 'vitest';
import type {
    AssessmentBatchStats,
    AssessmentDashboardRow,
} from '../-services/assessment-dashboard';
import {
    computeAssessmentInsights,
    evaluationQueue,
    listTabForStatus,
    parseAssessmentDashboardUrl,
    playModeKey,
    playModeOptions,
    toAssessmentDashboardUrl,
} from './assessment-dashboard-utils';

const row = (over: Partial<AssessmentDashboardRow>): AssessmentDashboardRow => ({
    assessment_id: 'a',
    name: 'Test',
    play_mode: 'EXAM',
    visibility: 'PRIVATE',
    evaluation_type: 'AUTO',
    status: 'CLOSED',
    start_time: '2026-09-22T04:30:00Z',
    end_time: '2026-09-22T06:30:00Z',
    duration_minutes: 60,
    subject_id: null,
    batch_ids: [],
    max_marks: 100,
    expected: 10,
    attempted: 8,
    in_progress: 0,
    not_attempted: 2,
    participation_rate: 0.8,
    submissions: 8,
    scored: 8,
    avg_score: 0.6,
    highest_score: 0.9,
    lowest_score: 0.2,
    avg_time_minutes: 40,
    evaluated: 8,
    awaiting_evaluation: 0,
    awaiting_release: 0,
    checked_by_teacher: 0,
    checked_by_ai: 0,
    evaluator_ids: [],
    ...over,
});

const batch = (over: Partial<AssessmentBatchStats>): AssessmentBatchStats => ({
    package_session_id: 'b',
    assessments: 2,
    expected: 20,
    attempted: 15,
    participation_rate: 0.75,
    submissions: 15,
    avg_score: 0.5,
    evaluated: 15,
    awaiting_evaluation: 0,
    ...over,
});

describe('assessment dashboard URL state', () => {
    it('round-trips filters and ignores malformed values', () => {
        const url = toAssessmentDashboardUrl({
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            batchIds: ['b1', 'b2'],
            playModes: ['EXAM'],
        });
        expect(url).toEqual({
            from: '2026-09-01',
            to: '2026-09-30',
            batches: 'b1,b2',
            types: 'EXAM',
        });
        expect(parseAssessmentDashboardUrl(url)).toEqual({
            range: { start: '2026-09-01', end: '2026-09-30' },
            batchIds: ['b1', 'b2'],
            playModes: ['EXAM'],
        });
        expect(
            parseAssessmentDashboardUrl({ from: '2026-09-30', to: '2026-09-01' }).range
        ).toBeNull();
        expect(
            parseAssessmentDashboardUrl({ from: 'yesterday', to: '2026-09-01' }).range
        ).toBeNull();
        expect(parseAssessmentDashboardUrl({ types: 'mock, ,practice' }).playModes).toEqual([
            'MOCK',
            'PRACTICE',
        ]);
    });

    it('leaves empty filters out of the URL', () => {
        expect(
            toAssessmentDashboardUrl({
                startDate: '2026-09-01',
                endDate: '2026-09-30',
                batchIds: [],
                playModes: [],
            })
        ).toEqual({ from: '2026-09-01', to: '2026-09-30', batches: undefined, types: undefined });
    });
});

describe('navigation and labels', () => {
    it('opens a test on the list tab its status belongs to', () => {
        expect(listTabForStatus('LIVE')).toBe('liveTests');
        expect(listTabForStatus('OPEN')).toBe('liveTests');
        expect(listTabForStatus('UPCOMING')).toBe('upcomingTests');
        expect(listTabForStatus('CLOSED')).toBe('previousTests');
    });

    it('folds legacy and unknown play modes', () => {
        expect(playModeKey('MANUAL_UPLOAD_EXAM')).toBe('offline');
        expect(playModeKey('HOMEWORK')).toBe('assignment');
        expect(playModeKey('mock')).toBe('mock');
        expect(playModeKey('SOMETHING')).toBe('other');
        expect(playModeKey(null)).toBe('other');
    });

    it('offers the four standard modes first, then what the range has', () => {
        expect(playModeOptions(['EXAM', 'HOMEWORK'], ['homework'])).toEqual([
            'EXAM',
            'MOCK',
            'PRACTICE',
            'SURVEY',
            'HOMEWORK',
        ]);
    });
});

describe('computeAssessmentInsights', () => {
    it('ranks only tests big enough to mean something', () => {
        const rows = [
            row({ assessment_id: 'small', avg_score: 1, scored: 2 }),
            row({ assessment_id: 'good', avg_score: 0.8, scored: 20 }),
            row({ assessment_id: 'ok', avg_score: 0.5, scored: 20, participation_rate: 0.4 }),
        ];
        const insights = computeAssessmentInsights(rows, []);
        expect(insights.bestTest?.assessment_id).toBe('good');
        expect(insights.lowestParticipation?.assessment_id).toBe('ok');
    });

    it('does not call a single closed test the lowest', () => {
        expect(computeAssessmentInsights([row({})], []).lowestParticipation).toBeNull();
    });

    it('needs two batches before naming a top batch', () => {
        expect(computeAssessmentInsights([], [batch({})]).topBatch).toBeNull();
        const insights = computeAssessmentInsights(
            [],
            [
                batch({ package_session_id: 'x', avg_score: 0.4 }),
                batch({ package_session_id: 'y', avg_score: 0.7 }),
            ]
        );
        expect(insights.topBatch?.package_session_id).toBe('y');
    });

    it('adds up the evaluation backlog', () => {
        const rows = [
            row({ assessment_id: 'a', awaiting_evaluation: 3, awaiting_release: 1 }),
            row({ assessment_id: 'b', awaiting_evaluation: 0, awaiting_release: 2 }),
            row({ assessment_id: 'c' }),
        ];
        const insights = computeAssessmentInsights(rows, []);
        expect(insights.backlogTests).toBe(2);
        expect(insights.backlogSubmissions).toBe(6);
        expect(evaluationQueue(rows).map((r) => r.assessment_id)).toEqual(['a', 'b']);
    });
});

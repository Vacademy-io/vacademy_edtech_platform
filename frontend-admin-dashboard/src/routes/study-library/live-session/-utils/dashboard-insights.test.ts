import { describe, expect, it } from 'vitest';
import type {
    DashboardClassRow,
    DashboardDailyPoint,
    DashboardInstructorStats,
} from '../-services/live-class-dashboard';
import {
    avatarTint,
    buildHeatmap,
    computeDelta,
    computeInsights,
    formatDeltaValue,
    heatKey,
    heatLevel,
    initialsOf,
    isDoubt,
} from './dashboard-insights';

const row = (over: Partial<DashboardClassRow>): DashboardClassRow => ({
    schedule_id: 's',
    session_id: 'x',
    title: 'Class',
    subject: null,
    meeting_date: '2026-09-21',
    start_time: '18:30:00',
    end_time: '19:20:00',
    timezone: 'Asia/Kolkata',
    platform: 'bbb',
    access_level: 'private',
    status: 'COMPLETED',
    scheduled_minutes: 50,
    instructors: [],
    batch_ids: [],
    expected: 10,
    joined: 5,
    present: 5,
    guests: 0,
    attendance_rate: 0.5,
    avg_attended_minutes: 30,
    engagement_rate: null,
    chats: 0,
    talks: 0,
    raise_hands: 0,
    poll_votes: 0,
    emojis: 0,
    feedback_count: 0,
    avg_rating: null,
    ...over,
});

const teacher = (over: Partial<DashboardInstructorStats>): DashboardInstructorStats => ({
    user_id: 't',
    name: 'T',
    email: null,
    classes: 1,
    completed: 1,
    expected: 10,
    joined: 5,
    present: 5,
    attendance_rate: 0.5,
    avg_attended_minutes: null,
    engagement_rate: null,
    feedback_count: 0,
    avg_rating: null,
    ...over,
});

describe('computeDelta', () => {
    it('compares rates in points, counts in %, ratings as-is', () => {
        expect(computeDelta(0.32, 0.27, 'rate')).toEqual({
            value: expect.closeTo(5, 5),
            direction: 'up',
        });
        expect(computeDelta(90, 100, 'relative')?.direction).toBe('down');
        expect(formatDeltaValue(computeDelta(90, 100, 'relative')!, 'relative')).toBe('−10');
        expect(formatDeltaValue(computeDelta(4.7, 4.5, 'absolute')!, 'absolute')).toBe('+0.2');
    });

    it('is null without a baseline and flat for tiny moves', () => {
        expect(computeDelta(5, 0, 'relative')).toBeNull();
        expect(computeDelta(0.5, null, 'rate')).toBeNull();
        expect(computeDelta(0.5, 0.498, 'rate')?.direction).toBe('flat');
    });
});

describe('people helpers', () => {
    it('makes initials and a stable tint', () => {
        expect(initialsOf('Asha Kumari Verma')).toBe('AV');
        expect(initialsOf('ravi')).toBe('R');
        expect(initialsOf(null)).toBe('?');
        expect(avatarTint('user-1')).toBe(avatarTint('user-1'));
    });
});

describe('computeInsights', () => {
    it('ranks only completed classes with a real audience', () => {
        const classes = [
            row({ schedule_id: 'tiny', expected: 2, attendance_rate: 1 }),
            row({ schedule_id: 'best', expected: 40, attendance_rate: 0.9 }),
            row({ schedule_id: 'worst', expected: 40, attendance_rate: 0.1 }),
            row({
                schedule_id: 'upcoming',
                status: 'UPCOMING',
                expected: 40,
                attendance_rate: null,
            }),
            row({ schedule_id: 'empty', expected: 30, joined: 0, attendance_rate: 0.2 }),
        ];
        const daily: DashboardDailyPoint[] = [
            {
                date: '2026-09-21',
                classes: 3,
                completed: 3,
                expected: 0,
                joined: 0,
                present: 0,
                present_in_audience: 0,
                attendance_rate: null,
                feedback_count: 0,
                avg_rating: null,
            },
            {
                date: '2026-09-22',
                classes: 7,
                completed: 7,
                expected: 0,
                joined: 0,
                present: 0,
                present_in_audience: 0,
                attendance_rate: null,
                feedback_count: 0,
                avg_rating: null,
            },
        ];
        const insights = computeInsights(
            classes,
            [
                teacher({ user_id: 'few', avg_rating: 5, feedback_count: 1 }),
                teacher({ user_id: 'top', avg_rating: 4.8, feedback_count: 12 }),
            ],
            daily
        );
        expect(insights.bestClass?.schedule_id).toBe('best');
        expect(insights.lowestClass?.schedule_id).toBe('worst');
        expect(insights.topTeacher?.user_id).toBe('top');
        expect(insights.zeroJoinClasses).toBe(1);
        expect(insights.busiestDay?.date).toBe('2026-09-22');
    });
});

describe('buildHeatmap', () => {
    it('buckets by Monday-first weekday and start hour', () => {
        // 21 Sep 2026 is a Monday, 27 Sep a Sunday.
        const map = buildHeatmap([
            row({ meeting_date: '2026-09-21', start_time: '18:30:00' }),
            row({ meeting_date: '2026-09-21', start_time: '18:00:00' }),
            row({
                meeting_date: '2026-09-27',
                start_time: '07:15:00',
                status: 'UPCOMING',
                attendance_rate: null,
            }),
        ]);
        expect(map.hours[0]).toBe(7);
        expect(map.hours[map.hours.length - 1]).toBe(18);
        expect(map.cells.get(heatKey(0, 18))).toEqual({ classes: 2, expected: 20, present: 10 });
        expect(map.cells.get(heatKey(6, 7))?.classes).toBe(1);
        expect(map.maxClasses).toBe(2);
    });

    it('scales levels 1..5 and keeps empty cells at 0', () => {
        expect(heatLevel(0, 10)).toBe(0);
        expect(heatLevel(1, 10)).toBe(1);
        expect(heatLevel(10, 10)).toBe(5);
    });
});

describe('isDoubt', () => {
    const answer = (question_id: string, text: string) => ({
        question_id,
        label: question_id,
        text,
    });
    it('counts a real question and ignores "no"-style answers', () => {
        expect(isDoubt({ answers: [answer('doubts', 'please do perimeter and area again')] })).toBe(
            true
        );
        expect(isDoubt({ answers: [answer('doubts', 'No')] })).toBe(false);
        expect(isDoubt({ answers: [answer('doubts', 'no doubts.')] })).toBe(false);
        expect(isDoubt({ answers: [answer('doubts', 'NOO')] })).toBe(false);
        expect(isDoubt({ answers: [answer('learnings', 'what is a mole?')] })).toBe(false);
    });
});

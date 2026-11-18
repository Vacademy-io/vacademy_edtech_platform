import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNING_NUDGE, normalizePlanningNudge } from '../engagement-settings';

describe('normalizePlanningNudge (mirrors PlanningNudgeSettings on the server)', () => {
    it('is off with defaults when nothing is saved', () => {
        expect(normalizePlanningNudge(undefined)).toEqual(DEFAULT_PLANNING_NUDGE);
        expect(DEFAULT_PLANNING_NUDGE.enabled).toBe(false);
        expect(DEFAULT_PLANNING_NUDGE.autoPublish).toBe(false);
    });

    it('clamps numbers and drops unknown run days', () => {
        const n = normalizePlanningNudge({
            enabled: true,
            sendDay: 9,
            sendHour: -1,
            reminderHours: 500,
            tasksPerDay: 0,
            runDays: 'WEEKENDS',
        });
        expect(n).toMatchObject({
            enabled: true,
            sendDay: 7,
            sendHour: 0,
            reminderHours: 96,
            tasksPerDay: 1,
            runDays: 'MON_FRI',
        });
    });

    it('only a real true turns things on, and batch ids are trimmed and de-duplicated', () => {
        const n = normalizePlanningNudge({
            enabled: 'yes',
            autoPublish: 1,
            packageSessionIds: [' b1 ', 'b1', '', 3, 'b2'],
        });
        expect(n.enabled).toBe(false);
        expect(n.autoPublish).toBe(false);
        expect(n.packageSessionIds).toEqual(['b1', 'b2']);
    });
});

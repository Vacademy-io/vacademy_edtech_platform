import type { TodayClass } from '@/classroom-shared/apiTypes';

/** 2026-11-04 10:00 at UTC+5:30. */
export const T0 = Date.UTC(2026, 10, 4, 4, 30);
export const MIN = 60 * 1000;

export function makeClass(overrides: Partial<TodayClass> = {}): TodayClass {
    return {
        schedule_id: 'sched-1',
        session_id: 'session-1',
        title: 'Forces',
        subject: 'Physics',
        batches: ['Class 8'],
        meeting_date: '2026-11-04',
        starts_at_ms: T0,
        ends_at_ms: T0 + 45 * MIN,
        time_label: '10:00',
        timezone: 'IST',
        link_type: 'bbb',
        streaming_type: 'bbb',
        live_now: false,
        instructors: [{ user_id: 'u1', name: 'Tara' }],
        external_link: null,
        ...overrides,
    };
}

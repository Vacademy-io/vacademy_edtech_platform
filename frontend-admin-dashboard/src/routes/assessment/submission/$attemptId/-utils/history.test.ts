import { describe, expect, it } from 'vitest';
import type { MarkEventView } from '@/services/submission-review/types';
import { historyLine } from './history';

const ev = (over: Partial<MarkEventView>): MarkEventView => ({
    id: 'e1',
    created_at: '2026-11-18T05:22:00Z',
    event_type: 'TEACHER_EDITED',
    section_id: 's1',
    question_id: 'q1',
    old_marks: 0,
    new_marks: 7,
    max_marks: 10,
    old_source: null,
    new_source: 'MANUAL',
    old_state: 'NEEDS_MARKING',
    new_state: 'MARKED',
    old_feedback: null,
    new_feedback: null,
    reason: 'Marked by hand',
    actor_type: 'TEACHER',
    actor: { user_id: 'u1', name: 'Riya' },
    after_release: true,
    payload: null,
    ...over,
});

describe('historyLine', () => {
    it('acceptance 3: a teacher edit after release reads "0 → 7" with its reason and tag', () => {
        expect(historyLine(ev({}))).toEqual({
            who: 'Riya',
            whoKey: null,
            key: 'history.edited',
            params: { old: '0', new: '7' },
            reason: 'Marked by hand',
            afterRelease: true,
        });
    });
    it('recognises an accepted AI mark and "marked as not answered"', () => {
        expect(historyLine(ev({ old_marks: 5, new_marks: 5, old_source: 'AI', new_source: 'AI_REVIEWED' })).key).toBe(
            'history.acceptedAi'
        );
        expect(historyLine(ev({ new_state: 'NOT_ANSWERED', new_marks: 0 })).key).toBe('history.markedNotAnswered');
    });
    it('falls back to "a teacher" when the name is unknown', () => {
        const line = historyLine(ev({ actor: { user_id: 'u9', name: null } }));
        expect(line.who).toBeNull();
        expect(line.whoKey).toBe('history.actor.someone');
    });
    it('words the submission-level events', () => {
        expect(historyLine(ev({ event_type: 'RELEASED', payload: { resend: true } })).key).toBe('history.releasedResent');
        expect(historyLine(ev({ event_type: 'RELEASED_WITH_UNMARKED', payload: { unmarked_keys: ['a', 'b'], count: 2 } })).params).toEqual({ count: 2 });
        expect(
            historyLine(ev({ event_type: 'TOTAL_RECOMPUTED', payload: { stored_total: 13, r6_before: 18, r6_after: 19 } })).params
        ).toEqual({ stored: '13', r6: '18' });
        expect(historyLine(ev({ event_type: 'SKIPPED_PROTECTED', actor_type: 'SYSTEM', actor: null })).whoKey).toBe(
            'history.actor.system'
        );
        expect(historyLine(ev({ event_type: 'UPDATE_SENT' })).key).toBe('history.updateSent');
        expect(historyLine(ev({ event_type: 'WITHDRAWN' })).key).toBe('history.withdrawn');
    });
});

import { describe, expect, it } from 'vitest';
import {
    buildQuickMarksItems,
    canMarkRestNotAnswered,
    clampMark,
    draftRevisions,
    emptyRestCount,
    notifyByDefault,
    formatMark,
    formatMarkOutOf,
    initialQuickDrafts,
    markRestNotAnswered,
    nextNeedsMarking,
    quickTotal,
    releaseTokenOf,
    staleKeysOf,
} from './marks';
import { qrow } from './test-fixtures';

describe('clampMark', () => {
    it('keeps a value inside the range', () => expect(clampMark(6, 0, 10)).toBe(6));
    it('clamps above max and below min', () => {
        expect(clampMark(11, 0, 10)).toBe(10);
        expect(clampMark(-3, -1, 4)).toBe(-1);
    });
    it('has no upper bound when max is null', () => expect(clampMark(99, 0, null)).toBe(99));
    it('rounds to two decimals and maps NaN to min', () => {
        expect(clampMark(2.345, 0, 10)).toBe(2.35);
        expect(clampMark(Number.NaN, 0, 10)).toBe(0);
    });
});

describe('formatMark', () => {
    it('prints whole and decimal marks without trailing zeros', () => {
        expect(formatMark(6)).toBe('6');
        expect(formatMark(6.5)).toBe('6.5');
        expect(formatMark(6.25)).toBe('6.25');
        expect(formatMark(6.1)).toBe('6.1');
    });
    it('prints a dash for a missing value', () => {
        expect(formatMark(null)).toBe('—');
        expect(formatMarkOutOf(6, null)).toBe('6 / —');
        expect(formatMarkOutOf(6, 10)).toBe('6 / 10');
    });
});

describe('releaseTokenOf', () => {
    it('echoes the release token', () => {
        expect(releaseTokenOf({ token: 'RELEASED|1762861800000' })).toBe('RELEASED|1762861800000');
        expect(releaseTokenOf(null)).toBe('NONE|0');
    });
});

describe('nextNeedsMarking', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const marking = {
        a: { marking: 'DONE' as const },
        b: { marking: 'NEEDS_MARKING' as const },
        c: { marking: 'DONE' as const },
        d: { marking: 'NEEDS_MARKING' as const },
    };
    it('finds the next learner after the current one', () => {
        expect(nextNeedsMarking(ids, 'b', marking)).toBe('d');
    });
    it('wraps to the start but never returns the current learner', () => {
        expect(nextNeedsMarking(ids, 'd', marking)).toBe('b');
        expect(nextNeedsMarking(['b'], 'b', marking)).toBeNull();
    });
    it('returns null when everyone is marked', () => {
        expect(nextNeedsMarking(ids, 'a', { ...marking, b: { marking: 'DONE' }, d: { marking: 'DONE' } })).toBeNull();
    });
    it('treats unknown ids as needing marking only when asked to', () => {
        expect(nextNeedsMarking(['x', 'y'], 'x', {})).toBeNull();
        expect(nextNeedsMarking(['x', 'y'], 'x', {}, true)).toBe('y');
    });
});

/** Acceptance 8: a 10-question handwritten copy, 6 typed, the rest not answered. */
describe('Quick marks batching', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
        qrow({ key: `s1:q${i + 1}`, question_number: i + 1, revision: i })
    );

    it('starts with empty boxes for unmarked answers', () => {
        const d = initialQuickDrafts(rows);
        expect(Object.keys(d)).toHaveLength(10);
        expect(d['s1:q1']).toEqual({ value: '', feedback: '', notAnswered: false });
    });

    it('locks objective answers (no box)', () => {
        const d = initialQuickDrafts([qrow({ key: 's1:mcq', question_type: 'MCQS', state: 'MARKED', marks: 2 })]);
        expect(d['s1:mcq']).toBeUndefined();
    });

    it('marks only EMPTY needs-marking boxes as not answered', () => {
        const initial = initialQuickDrafts(rows);
        let drafts = { ...initial };
        ['6', '7', '5', '8', '3', '9.5'].forEach((v, i) => {
            drafts[`s1:q${i + 1}`] = { ...drafts[`s1:q${i + 1}`]!, value: v };
        });
        drafts = markRestNotAnswered(drafts, rows);
        expect(drafts['s1:q1']!.notAnswered).toBe(false);
        expect(drafts['s1:q7']!.notAnswered).toBe(true);
        expect(drafts['s1:q10']!.notAnswered).toBe(true);

        const items = buildQuickMarksItems(drafts, initial, rows);
        expect(items).toHaveLength(10);
        expect(items.filter((i) => i.not_answered)).toHaveLength(4);
        expect(items[0]).toMatchObject({ section_id: 's1', question_id: 'q1', marks: 6, expected_revision: 0 });
        expect(items[5]).toMatchObject({ question_id: 'q6', marks: 9.5, expected_revision: 5 });
        expect(quickTotal(drafts, rows)).toBe(38.5);
    });

    it('sends nothing for untouched boxes and clamps typed values', () => {
        const marked = [qrow({ key: 's1:a', state: 'MARKED', marks: 4, revision: 3 }), qrow({ key: 's1:b' })];
        const initial = initialQuickDrafts(marked);
        expect(buildQuickMarksItems(initial, initial, marked)).toEqual([]);
        const drafts = { ...initial, 's1:b': { ...initial['s1:b']!, value: '12' } };
        expect(buildQuickMarksItems(drafts, initial, marked)).toEqual([
            { section_id: 's1', question_id: 'b', expected_revision: 0, marks: 10 },
        ]);
    });

    it('sends a feedback-only change with the current mark', () => {
        const marked = [qrow({ key: 's1:a', state: 'MARKED', marks: 4 })];
        const initial = initialQuickDrafts(marked);
        const drafts = { 's1:a': { ...initial['s1:a']!, feedback: 'Good' } };
        expect(buildQuickMarksItems(drafts, initial, marked)).toEqual([
            { section_id: 's1', question_id: 'a', expected_revision: 0, feedback: 'Good', marks: 4 },
        ]);
    });

    it('ignores rows that are not counted in the running total', () => {
        const r = [qrow({ key: 's1:a', state: 'MARKED', marks: 4 }), qrow({ key: 's1:b', state: 'MARKED', marks: 3, counted: false })];
        expect(quickTotal(initialQuickDrafts(r), r)).toBe(4);
    });
});

describe('staleKeysOf', () => {
    it('reads stale_keys or the single current row', () => {
        expect(staleKeysOf({ stale_keys: ['s1:a', 's1:b'] })).toEqual(['s1:a', 's1:b']);
        expect(staleKeysOf({ current: { key: 's1:c' } })).toEqual(['s1:c']);
        expect(staleKeysOf(undefined)).toEqual([]);
    });
});

describe('review fixes (2026-11-18)', () => {
    it('"Mark the rest as not answered" is for handwritten / scanned copies only', () => {
        expect(canMarkRestNotAnswered('HANDWRITTEN')).toBe(true);
        expect(canMarkRestNotAnswered('SCANNED')).toBe(true);
        expect(canMarkRestNotAnswered('ONLINE')).toBe(false);
        expect(canMarkRestNotAnswered('HOMEWORK')).toBe(false);
    });

    it('also offers it on a homework answer sheet: marked by hand, or answered with a file', () => {
        expect(canMarkRestNotAnswered('HOMEWORK', { evaluationType: 'MANUAL', responseFileId: null })).toBe(true);
        expect(canMarkRestNotAnswered('HOMEWORK', { evaluationType: 'AUTO', responseFileId: 'file-1' })).toBe(true);
        expect(canMarkRestNotAnswered('HOMEWORK', { evaluationType: 'AUTO', responseFileId: '  ' })).toBe(false);
        expect(canMarkRestNotAnswered('HOMEWORK', { evaluationType: 'AUTO', responseFileId: null })).toBe(false);
        expect(canMarkRestNotAnswered('ONLINE', { evaluationType: 'MANUAL', responseFileId: 'file-1' })).toBe(false);
    });

    it('never marks an answer the AI is checking, or one it failed on, as not answered', () => {
        const rows = [
            qrow({ key: 's1:q1' }),
            qrow({ key: 's1:q2', ai_checking: true }),
            qrow({ key: 's1:q3', ai_failed_reason: 'Page unreadable' }),
        ];
        const drafts = initialQuickDrafts(rows);
        expect(emptyRestCount(drafts, rows)).toBe(1);
        const out = markRestNotAnswered(drafts, rows);
        expect(out['s1:q1']!.notAnswered).toBe(true);
        expect(out['s1:q2']!.notAnswered).toBe(false);
        expect(out['s1:q3']!.notAnswered).toBe(false);
    });

    it('send-update tick defaults on only when the save leaves nothing to mark', () => {
        const rows = [qrow({ key: 's1:q1' }), qrow({ key: 's1:q2' }), qrow({ key: 's1:q3', state: 'MARKED' })];
        expect(notifyByDefault(rows, ['s1:q1'])).toBe(false);
        expect(notifyByDefault(rows, ['s1:q1', 's1:q2'])).toBe(true);
        expect(notifyByDefault([qrow({ key: 's1:q3', state: 'MARKED' })], ['s1:q3'])).toBe(true);
    });

    it('accept-AI sends the revision of every draft on screen', () => {
        const rows = [
            qrow({ key: 's1:q1', state: 'AI_DRAFT', revision: 4 }),
            qrow({ key: 's1:q2', state: 'MARKED', revision: 2 }),
            qrow({ key: 's1:q3', state: 'AI_DRAFT', revision: 1 }),
        ];
        expect(draftRevisions(rows)).toEqual({ 's1:q1': 4, 's1:q3': 1 });
    });
});

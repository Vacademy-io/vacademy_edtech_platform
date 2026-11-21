import { describe, expect, it } from 'vitest';
import {
    isKeywordSuggestion,
    markedByLabel,
    markingLabel,
    questionStateLabel,
    releasedWithUnmarked,
    resultLabel,
} from './labels';
import { attemptMarking, counts, qrow } from './test-fixtures';

describe('markingLabel (W1 Marking column)', () => {
    it('acceptance 1: one CBE needing marking reads "Needs marking (1)"', () => {
        expect(markingLabel('NEEDS_MARKING', counts({ needs_marking: 1 }))).toEqual({
            key: 'marking.needsMarking',
            params: { count: 1 },
            tone: 'warning',
        });
    });
    it('counts AI drafts for "Check AI marks (n)"', () => {
        expect(markingLabel('CHECK_AI', counts({ ai_draft: 2 })).params).toEqual({ count: 2 });
    });
    it('labels the other states', () => {
        expect(markingLabel('DONE', null).key).toBe('marking.done');
        expect(markingLabel('AI_CHECKING', null).key).toBe('marking.aiChecking');
        expect(markingLabel('TOTAL_ONLY', null).key).toBe('marking.totalOnly');
        expect(markingLabel('NOT_SUBMITTED', null).key).toBe('marking.notSubmitted');
    });
});

describe('resultLabel / released with unmarked', () => {
    it('maps the three result views', () => {
        expect(resultLabel('NOT_RELEASED').key).toBe('result.notReleased');
        expect(resultLabel('RELEASED').key).toBe('result.released');
        expect(resultLabel('RELEASED_CHANGED').key).toBe('result.releasedChanged');
    });
    it('shows the warning only on a released result with unmarked answers', () => {
        expect(releasedWithUnmarked(attemptMarking({ result: 'RELEASED', released_with_unmarked: 1 }))).toBe(1);
        expect(releasedWithUnmarked(attemptMarking({ result: 'NOT_RELEASED', released_with_unmarked: 1 }))).toBe(0);
        expect(releasedWithUnmarked(null)).toBe(0);
    });
});

describe('questionStateLabel', () => {
    it('derived states win over the stored one', () => {
        expect(questionStateLabel({ state: 'MARKED', ai_checking: true, ai_failed_reason: null }).key).toBe('state.aiChecking');
        expect(
            questionStateLabel({ state: 'NEEDS_MARKING', ai_checking: false, ai_failed_reason: 'Blank page' })
        ).toEqual({ key: 'state.aiFailed', params: { reason: 'Blank page' }, tone: 'danger' });
    });
    it('labels the four stored states', () => {
        const base = { ai_checking: false, ai_failed_reason: null };
        expect(questionStateLabel({ ...base, state: 'NOT_ANSWERED' }).key).toBe('state.notAnswered');
        expect(questionStateLabel({ ...base, state: 'NEEDS_MARKING' }).key).toBe('state.needsMarking');
        expect(questionStateLabel({ ...base, state: 'AI_DRAFT' }).key).toBe('state.aiDraft');
        expect(questionStateLabel({ ...base, state: 'MARKED' }).key).toBe('state.marked');
    });
});

describe('markedByLabel', () => {
    it('names the teacher, falling back when the name is unknown', () => {
        expect(markedByLabel('TEACHER', 'Riya', 'A teacher')).toEqual({ key: 'markedBy.teacher', params: { name: 'Riya' } });
        expect(markedByLabel('AI_REVIEWED', null, 'A teacher')).toEqual({
            key: 'markedBy.aiReviewed',
            params: { name: 'A teacher' },
        });
    });
    it('has no label for unmarked answers', () => {
        expect(markedByLabel('NONE', null, 'x')).toBeNull();
        expect(markedByLabel('ANSWER_KEY', null, 'x')?.key).toBe('markedBy.answerKey');
    });
});

describe('isKeywordSuggestion (keyword-scored long answer, needs marking)', () => {
    it('is a Needs-marking row the keyword match scored', () => {
        expect(isKeywordSuggestion(qrow({ key: 's1:q1', marked_by_kind: 'KEYWORD', marks: 2 }))).toBe(true);
    });
    it('is not a confirmed keyword mark, nor a plain unmarked answer', () => {
        expect(isKeywordSuggestion(qrow({ key: 's1:q1', state: 'MARKED', marked_by_kind: 'KEYWORD' }))).toBe(false);
        expect(isKeywordSuggestion(qrow({ key: 's1:q1', marked_by_kind: 'NONE' }))).toBe(false);
    });
    it('still reads as Needs marking on the state chip', () => {
        expect(questionStateLabel(qrow({ key: 's1:q1', marked_by_kind: 'KEYWORD' })).key).toBe('state.needsMarking');
    });
});

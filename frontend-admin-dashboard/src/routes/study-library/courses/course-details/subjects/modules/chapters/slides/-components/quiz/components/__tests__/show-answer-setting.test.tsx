/**
 * "Show answer after each question": the quiz settings toggle and what the save sends.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import QuizSettingsPanel, { QuizSettings } from '../QuizSettingsPanel';
import { createQuizSlidePayload } from '../../utils/api-helpers';
import { Slide } from '../../types';

const baseSettings: QuizSettings = {
    timeLimitEnabled: false,
    timeLimitMinutes: 30,
    marksPerQuestion: 1,
    negativeMarkingEnabled: false,
    negativeMarking: 0,
    partialMarking: false,
    passPercentageEnabled: false,
    passPercentage: 50,
    reAttemptCountEnabled: false,
    reAttemptCount: 3,
    showAnswerAfterEachQuestion: false,
};

const slide = (quizSlide: Record<string, unknown> | null) =>
    ({
        id: 'slide-1',
        source_id: 'src-1',
        source_type: 'QUIZ',
        title: 'Quiz',
        image_file_id: '',
        description: '',
        status: 'DRAFT',
        slide_order: 0,
        is_loaded: true,
        new_slide: false,
        quiz_slide: quizSlide,
    }) as unknown as Slide;

afterEach(cleanup);

describe('Show answer after each question — settings panel', () => {
    it('starts unticked and ticking it reports the flag on', () => {
        const onChange = vi.fn();
        render(
            <QuizSettingsPanel
                settings={baseSettings}
                onChange={onChange}
                onSave={() => {}}
                isSaving={false}
            />
        );
        const box = screen.getByLabelText('showAnswerAfterEachQuestion') as HTMLInputElement;
        expect(box.checked).toBe(false);
        fireEvent.click(box);
        expect(onChange).toHaveBeenCalledWith({
            ...baseSettings,
            showAnswerAfterEachQuestion: true,
        });
    });

    it('shows the stored value', () => {
        render(
            <QuizSettingsPanel
                settings={{ ...baseSettings, showAnswerAfterEachQuestion: true }}
                onChange={() => {}}
                onSave={() => {}}
                isSaving={false}
            />
        );
        expect(
            (screen.getByLabelText('showAnswerAfterEachQuestion') as HTMLInputElement).checked
        ).toBe(true);
    });
});

describe('Show answer after each question — save payload', () => {
    it('sends the value chosen in the panel', () => {
        const on = createQuizSlidePayload([], slide(null), { showAnswerAfterEachQuestion: true });
        expect(on.quiz_slide).toMatchObject({ show_answer_after_each_question: true });
        const off = createQuizSlidePayload([], slide({ show_answer_after_each_question: true }), {
            showAnswerAfterEachQuestion: false,
        });
        expect(off.quiz_slide).toMatchObject({ show_answer_after_each_question: false });
    });

    it('keeps what the slide has when the caller passes no settings (e.g. a rename)', () => {
        const kept = createQuizSlidePayload([], slide({ show_answer_after_each_question: true }));
        expect(kept.quiz_slide).toMatchObject({ show_answer_after_each_question: true });
    });

    it('sends null — "unchanged" — for a quiz that never had the setting', () => {
        const legacy = createQuizSlidePayload([], slide({ id: 'q', title: 'Quiz' }));
        expect(legacy.quiz_slide).toMatchObject({ show_answer_after_each_question: null });
    });
});

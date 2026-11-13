import { describe, expect, it } from 'vitest';
import {
    DEFAULT_REPORT_OPTIONS_FORM,
    reportOptionsFormFromWire,
    reportOptionsWireFromForm,
} from '@/types/assessments/report-options';

describe('report options', () => {
    it('reads a stored null as the institute default', () => {
        expect(reportOptionsFormFromWire(null)).toEqual(DEFAULT_REPORT_OPTIONS_FORM);
        expect(reportOptionsFormFromWire(undefined)).toEqual(DEFAULT_REPORT_OPTIONS_FORM);
        expect(reportOptionsFormFromWire([])).toEqual(DEFAULT_REPORT_OPTIONS_FORM);
    });

    it('reads stored options, missing keys shown', () => {
        expect(reportOptionsFormFromWire({ show_correct_answer: false })).toEqual({
            useInstituteDefault: false,
            showQuestionWise: true,
            showYourAnswer: true,
            showCorrectAnswer: false,
            showExplanation: true,
        });
    });

    it('saves null for the institute default so the backend clears its own value', () => {
        expect(reportOptionsWireFromForm(DEFAULT_REPORT_OPTIONS_FORM)).toBeNull();
        expect(reportOptionsWireFromForm(undefined)).toBeNull();
    });

    it('round-trips custom options', () => {
        const wire = {
            show_question_wise: true,
            show_your_answer: false,
            show_correct_answer: false,
            show_explanation: true,
        };
        expect(reportOptionsWireFromForm(reportOptionsFormFromWire(wire))).toEqual(wire);
    });
});

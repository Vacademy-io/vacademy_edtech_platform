import { describe, expect, it } from 'vitest';
import {
    DEFAULT_REPORT_OPTIONS_FORM,
    MAX_REPORT_STUDENT_FIELDS,
    cleanStudentFields,
    reportOptionsFormFromWire,
    reportOptionsWireFromForm,
    reportStudentFieldChoices,
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
            studentFields: [],
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

    it('reads student fields saved without switches as the institute default plus fields', () => {
        expect(reportOptionsFormFromWire({ student_fields: ['Student Roll Number', 'College'] })).toEqual({
            ...DEFAULT_REPORT_OPTIONS_FORM,
            studentFields: ['Student Roll Number', 'College'],
        });
    });

    it('sends only the fields while the switches follow the institute default', () => {
        expect(
            reportOptionsWireFromForm({
                ...DEFAULT_REPORT_OPTIONS_FORM,
                studentFields: [' College ', 'college', ''],
            })
        ).toEqual({ student_fields: ['College'] });
        expect(
            reportOptionsWireFromForm({ ...DEFAULT_REPORT_OPTIONS_FORM, studentFields: [] })
        ).toBeNull();
    });

    it('round-trips custom switches with fields', () => {
        const wire = {
            show_question_wise: true,
            show_your_answer: true,
            show_correct_answer: false,
            show_explanation: true,
            student_fields: ['Student Roll Number'],
        };
        expect(reportOptionsWireFromForm(reportOptionsFormFromWire(wire))).toEqual(wire);
    });

    it('treats a form saved before student fields existed as having none', () => {
        const old = { ...DEFAULT_REPORT_OPTIONS_FORM, useInstituteDefault: false } as Record<string, unknown>;
        delete old.studentFields;
        expect(reportOptionsWireFromForm(old as never)).toEqual({
            show_question_wise: true,
            show_your_answer: true,
            show_correct_answer: true,
            show_explanation: true,
        });
    });

    it('caps and cleans the field list', () => {
        const many = Array.from({ length: MAX_REPORT_STUDENT_FIELDS + 5 }, (_, i) => `Field ${i}`);
        expect(cleanStudentFields(many)).toHaveLength(MAX_REPORT_STUDENT_FIELDS);
        expect(cleanStudentFields('College')).toEqual([]);
        expect(cleanStudentFields([1, ' Roll No ', null])).toEqual(['Roll No']);
    });

    it('offers form fields first, then institute fields, without name and email', () => {
        expect(
            reportStudentFieldChoices({
                formFields: ['Full Name', 'Email', 'Student Roll Number', 'School/College'],
                instituteFields: ['Student Roll Number', 'Branch of Engineering', 'Phone Number'],
                selected: ['Old Field'],
            })
        ).toEqual([
            { name: 'Student Roll Number', onForm: true },
            { name: 'School/College', onForm: true },
            { name: 'Branch of Engineering', onForm: false },
            { name: 'Phone Number', onForm: false },
            { name: 'Old Field', onForm: false },
        ]);
        // Before the registration form is saved nothing can be called "not on the form".
        expect(
            reportStudentFieldChoices({
                formFields: [],
                instituteFields: ['Student Roll Number'],
                selected: [],
            })
        ).toEqual([{ name: 'Student Roll Number', onForm: null }]);
    });
});

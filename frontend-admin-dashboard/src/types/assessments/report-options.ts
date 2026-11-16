/**
 * Per-assessment report options (assessment_service V69, column `report_options`):
 * what a student's report shows about each question. Applies to every report the
 * student gets — the downloaded PDF (learner and admin download the same file),
 * the AI report, the release email attachment and the learner app's answer review.
 *
 * Wire: {"show_question_wise":bool,"show_your_answer":bool,"show_correct_answer":bool,
 * "show_explanation":bool}, or null = follow the institute's default report profile.
 */
export interface ReportOptionsForm {
    /** true = save null, so the institute default applies. */
    useInstituteDefault: boolean;
    showQuestionWise: boolean;
    showYourAnswer: boolean;
    showCorrectAnswer: boolean;
    showExplanation: boolean;
}

export type ReportOptionsWire = {
    show_question_wise: boolean;
    show_your_answer: boolean;
    show_correct_answer: boolean;
    show_explanation: boolean;
};

export const DEFAULT_REPORT_OPTIONS_FORM: ReportOptionsForm = {
    useInstituteDefault: true,
    showQuestionWise: true,
    showYourAnswer: true,
    showCorrectAnswer: true,
    showExplanation: true,
};

const flag = (value: unknown) => value !== false;

/** saved_data.report_options -> form. Null/garbage = institute default. */
export const reportOptionsFormFromWire = (wire: unknown): ReportOptionsForm => {
    if (!wire || typeof wire !== 'object' || Array.isArray(wire)) {
        return { ...DEFAULT_REPORT_OPTIONS_FORM };
    }
    const w = wire as Record<string, unknown>;
    return {
        useInstituteDefault: false,
        showQuestionWise: flag(w.show_question_wise),
        showYourAnswer: flag(w.show_your_answer),
        showCorrectAnswer: flag(w.show_correct_answer),
        showExplanation: flag(w.show_explanation),
    };
};

/**
 * Form -> `report_options` for the Step 1 save. Always a value (never undefined):
 * the backend keeps the stored options when the key is absent, so null is how
 * "Institute default" clears them.
 */
export const reportOptionsWireFromForm = (
    form: ReportOptionsForm | undefined
): ReportOptionsWire | null => {
    if (!form || form.useInstituteDefault) return null;
    return {
        show_question_wise: form.showQuestionWise,
        show_your_answer: form.showYourAnswer,
        show_correct_answer: form.showCorrectAnswer,
        show_explanation: form.showExplanation,
    };
};

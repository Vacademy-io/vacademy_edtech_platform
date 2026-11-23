/**
 * Per-assessment report options (assessment_service V69, column `report_options`):
 * what a student's report shows about each question. Applies to every report the
 * student gets — the downloaded PDF (learner and admin download the same file),
 * the AI report, the release email attachment and the learner app's answer review.
 *
 * Wire: {"show_question_wise":bool,"show_your_answer":bool,"show_correct_answer":bool,
 * "show_explanation":bool, "student_fields":["Student Roll Number", ...]}, or null = follow
 * the institute's default report profile.
 *
 * `student_fields` are registration answers printed under the student's name. They belong to
 * this assessment only (never the institute default). Sent without the four switches when the
 * switches follow the institute default.
 */
export interface ReportOptionsForm {
    /** true = save null, so the institute default applies. */
    useInstituteDefault: boolean;
    showQuestionWise: boolean;
    showYourAnswer: boolean;
    showCorrectAnswer: boolean;
    showExplanation: boolean;
    /** Registration field names printed under the student's name, for this assessment only. */
    studentFields: string[];
}

export type ReportOptionsWire = {
    show_question_wise?: boolean;
    show_your_answer?: boolean;
    show_correct_answer?: boolean;
    show_explanation?: boolean;
    student_fields?: string[];
};

/** Most fields a report can print (the backend refuses more). */
export const MAX_REPORT_STUDENT_FIELDS = 20;

const FLAG_KEYS = [
    'show_question_wise',
    'show_your_answer',
    'show_correct_answer',
    'show_explanation',
] as const;

/** Trimmed, blanks and repeats (ignoring case) dropped, order kept, capped. */
export const cleanStudentFields = (fields: unknown): string[] => {
    if (!Array.isArray(fields)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of fields) {
        if (typeof f !== 'string') continue;
        const name = f.trim();
        if (!name || name.length > 120 || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push(name);
    }
    return out.slice(0, MAX_REPORT_STUDENT_FIELDS);
};

export const DEFAULT_REPORT_OPTIONS_FORM: ReportOptionsForm = {
    useInstituteDefault: true,
    showQuestionWise: true,
    showYourAnswer: true,
    showCorrectAnswer: true,
    showExplanation: true,
    studentFields: [],
};

const flag = (value: unknown) => value !== false;

/**
 * saved_data.report_options -> form. Null/garbage = institute default. Only student_fields
 * (none of the four switches) = institute default switches plus those fields.
 */
export const reportOptionsFormFromWire = (wire: unknown): ReportOptionsForm => {
    if (!wire || typeof wire !== 'object' || Array.isArray(wire)) {
        return { ...DEFAULT_REPORT_OPTIONS_FORM, studentFields: [] };
    }
    const w = wire as Record<string, unknown>;
    const studentFields = cleanStudentFields(w.student_fields);
    if (!FLAG_KEYS.some((key) => key in w) && 'student_fields' in w) {
        return { ...DEFAULT_REPORT_OPTIONS_FORM, studentFields };
    }
    return {
        useInstituteDefault: false,
        showQuestionWise: flag(w.show_question_wise),
        showYourAnswer: flag(w.show_your_answer),
        showCorrectAnswer: flag(w.show_correct_answer),
        showExplanation: flag(w.show_explanation),
        studentFields,
    };
};

/**
 * Form -> `report_options` for the Step 1 save. Always a value (never undefined):
 * the backend keeps the stored options when the key is absent, so null is how
 * "Institute default" with no student fields clears them.
 */
export const reportOptionsWireFromForm = (
    form: ReportOptionsForm | undefined
): ReportOptionsWire | null => {
    if (!form) return null;
    const studentFields = cleanStudentFields(form.studentFields);
    const fields = studentFields.length ? { student_fields: studentFields } : {};
    if (form.useInstituteDefault) return studentFields.length ? fields : null;
    return {
        show_question_wise: form.showQuestionWise,
        show_your_answer: form.showYourAnswer,
        show_correct_answer: form.showCorrectAnswer,
        show_explanation: form.showExplanation,
        ...fields,
    };
};

const normFieldName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Same field, ignoring case, spaces and punctuation — the backend matches answers the same way. */
export const sameStudentField = (a: string, b: string) => normFieldName(a) === normFieldName(b);

// Already printed in the report header, so not offered.
const ALWAYS_SHOWN = new Set(['name', 'fullname', 'studentname', 'email', 'emailid', 'emailaddress']);

export interface ReportStudentFieldChoice {
    name: string;
    /** false = this test's registration form does not ask it (only known once the form is saved). */
    onForm: boolean | null;
}

/**
 * What the Step 1 picker offers: this test's registration form fields first (form order), then
 * the institute's own fields, then anything already saved that is in neither list. Name and
 * email are left out because every report prints them already.
 */
export const reportStudentFieldChoices = ({
    formFields,
    instituteFields,
    selected,
}: {
    formFields: string[];
    instituteFields: string[];
    selected: string[];
}): ReportStudentFieldChoice[] => {
    const formKnown = formFields.length > 0;
    const out: ReportStudentFieldChoice[] = [];
    const seen = new Set<string>();
    const add = (raw: string | null | undefined, onForm: boolean | null) => {
        const name = (raw ?? '').trim();
        const key = normFieldName(name);
        if (!key || seen.has(key) || ALWAYS_SHOWN.has(key)) return;
        seen.add(key);
        out.push({ name, onForm });
    };
    formFields.forEach((name) => add(name, true));
    instituteFields.forEach((name) => add(name, formKnown ? false : null));
    selected.forEach((name) => add(name, formKnown ? false : null));
    return out;
};

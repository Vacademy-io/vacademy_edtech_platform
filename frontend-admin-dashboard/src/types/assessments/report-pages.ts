/**
 * Step 1 "Report pages": pages added before and after a student's report (a scholarship
 * letter, a brochure, ...). Stored by assessment_service as this assessment's own report
 * profile (assessment_report_profile + assessment_report_profile_link); the wizard sends
 * `report_pages` with the Step 1 save:
 *
 *   {"mode":"DEFAULT"}                         institute default pages (if any)
 *   {"mode":"NONE"}                            no extra pages
 *   {"mode":"CUSTOM","profile_id":"...","config":{...}}   this test's own pages
 *
 * Saving pages that other tests share (or the institute default) makes a copy for this test,
 * so it never changes another test's report.
 */

export type ReportPageType = 'TEMPLATE' | 'PDF' | 'IMAGE';
export type ReportPagesMode = 'DEFAULT' | 'NONE' | 'CUSTOM';
export type ReportPageSide = 'before' | 'after';

export interface ReportPage {
    type: ReportPageType;
    name?: string;
    /** TEMPLATE: HTML with {{values}}. */
    html?: string;
    /** TEMPLATE written in the simple editor (others open as HTML only, to keep their design). */
    editor?: 'simple';
    /** PDF / IMAGE uploaded to file storage. */
    file_id?: string;
    /** PDF / IMAGE stored inline (older profiles). */
    data_uri?: string;
    [key: string]: unknown;
}

export interface ReportPagesConfig {
    before?: ReportPage[];
    after?: ReportPage[];
    /** Images for written pages: key -> data:image/... */
    assets?: Record<string, string>;
    variables?: Record<string, unknown>;
    result_date?: string;
    qr_url?: string;
    /** Other keys (report_options, qr_size, ...) are kept as they are. */
    [key: string]: unknown;
}

export interface ReportPagesForm {
    /** Filled from the server; nothing is sent until it is. */
    loaded: boolean;
    /** Changed in this session; only then does the Step 1 save send report_pages. */
    dirty: boolean;
    mode: ReportPagesMode;
    /** The profile the editor started from (this test's own, a shared one, or a copied one). */
    profileId: string | null;
    sharedWith: number;
    startedFromInstituteDefault: boolean;
    config: ReportPagesConfig;
}

export interface AssessmentReportPagesResponse {
    mode: ReportPagesMode;
    profile: { id: string; name: string; institute_default: boolean; config: ReportPagesConfig } | null;
    shared_with: number;
    institute_default: { id: string; name: string; pages: number } | null;
    sample_attempt_id: string | null;
}

export const MAX_REPORT_PAGES = 30;
export const MAX_REPORT_PAGE_ASSETS = 12;
/** Images placed on written pages are stored inline, so keep them small. */
export const MAX_REPORT_ASSET_BYTES = 600 * 1024;

export const EMPTY_REPORT_PAGES_FORM: ReportPagesForm = {
    loaded: false,
    dirty: false,
    mode: 'DEFAULT',
    profileId: null,
    sharedWith: 0,
    startedFromInstituteDefault: false,
    config: { before: [], after: [] },
};

export const reportPagesFormFromResponse = (res: AssessmentReportPagesResponse): ReportPagesForm => ({
    loaded: true,
    dirty: false,
    mode: res.mode === 'CUSTOM' || res.mode === 'NONE' ? res.mode : 'DEFAULT',
    profileId: res.profile?.id ?? null,
    sharedWith: res.shared_with ?? 0,
    startedFromInstituteDefault: res.profile?.institute_default ?? false,
    config: normaliseConfig(res.profile?.config),
});

export const normaliseConfig = (config: unknown): ReportPagesConfig => {
    const c = config && typeof config === 'object' && !Array.isArray(config) ? (config as ReportPagesConfig) : {};
    return {
        ...c,
        before: Array.isArray(c.before) ? c.before : [],
        after: Array.isArray(c.after) ? c.after : [],
    };
};

/**
 * Form -> `report_pages` for the Step 1 save, or undefined to leave the saved pages alone
 * (not loaded yet, or nothing changed).
 */
export const reportPagesWireFromForm = (form: ReportPagesForm | undefined) => {
    if (!form || !form.loaded || !form.dirty) return undefined;
    if (form.mode !== 'CUSTOM') return { mode: form.mode };
    return {
        mode: 'CUSTOM' as const,
        ...(form.profileId ? { profile_id: form.profileId } : {}),
        config: form.config,
    };
};

/** The request the preview endpoint takes: the pages exactly as they are on screen. */
export const reportPagesPreviewBody = (form: ReportPagesForm) =>
    form.mode === 'CUSTOM' ? { mode: 'CUSTOM', config: form.config } : { mode: form.mode };

export const pageCount = (config: ReportPagesConfig) =>
    (config.before?.length ?? 0) + (config.after?.length ?? 0);

/** Moves a page up (-1) or down (+1) inside its list. */
export const movePage = (pages: ReportPage[], index: number, direction: -1 | 1): ReportPage[] => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return pages;
    const next = [...pages];
    const [page] = next.splice(index, 1);
    next.splice(target, 0, page as ReportPage);
    return next;
};

// ── Scholarship rule (variables.scholarship_percent) ──

export type ScholarshipRule =
    | { kind: 'none' }
    | { kind: 'simple'; minPercent: number }
    /** Set up another way (e.g. several bands): shown as is and kept unless removed. */
    | { kind: 'custom' };

/**
 * The simple rule is "0% below N%, otherwise the student's own percentage", rounded down.
 */
export const readScholarshipRule = (config: ReportPagesConfig): ScholarshipRule => {
    const spec = (config.variables as Record<string, any> | undefined)?.scholarship_percent;
    if (!spec) return { kind: 'none' };
    const bands = Array.isArray(spec.bands) ? spec.bands : [];
    const basis = spec.basis ?? 'percentage';
    if (
        basis === 'percentage' &&
        bands.length === 2 &&
        bands[0]?.value === 0 &&
        bands[1]?.value === 'percentage' &&
        typeof bands[0]?.to === 'number' &&
        bands[1]?.from === bands[0]?.to
    ) {
        return { kind: 'simple', minPercent: bands[0].to };
    }
    return { kind: 'custom' };
};

export const writeScholarshipRule = (config: ReportPagesConfig, minPercent: number | null): ReportPagesConfig => {
    const variables = { ...((config.variables as Record<string, unknown> | undefined) ?? {}) };
    if (minPercent == null) {
        delete variables.scholarship_percent;
    } else {
        const min = Math.max(0, Math.min(100, Math.round(minPercent)));
        variables.scholarship_percent = {
            basis: 'percentage',
            round: 'DOWN',
            max: 100,
            bands: [
                { from: -1000, to: min, value: 0 },
                { from: min, to: 100, value: 'percentage' },
            ],
        };
    }
    return { ...config, variables };
};

// ── Values a written page can show ──

/** Same key the server builds for {{detail.*}}: "Student Roll Number" -> student_roll_number. */
export const detailKey = (label: string) =>
    label
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '');

/** "Principal's signature" -> principal_s_signature (the server allows [a-z0-9_]{1,40}). */
export const assetKeyFromName = (name: string, taken: string[] = []) => {
    const base = (name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'image').slice(0, 34);
    let key = base;
    let n = 2;
    while (taken.includes(key)) key = `${base}_${n++}`;
    return key;
};

export interface ReportPageValue {
    /** i18n key under reportOptions.pages.values, or a literal label. */
    labelKey?: string;
    label?: string;
    token: string;
}

export const BASE_REPORT_PAGE_VALUES: ReportPageValue[] = [
    { labelKey: 'studentName', token: '{{student_name}}' },
    { labelKey: 'firstName', token: '{{first_name}}' },
    { labelKey: 'assessmentName', token: '{{assessment_name}}' },
    { labelKey: 'instituteName', token: '{{institute_name}}' },
    { labelKey: 'score', token: '{{score}}' },
    { labelKey: 'maxScore', token: '{{max_score}}' },
    { labelKey: 'percentage', token: '{{percentage}}' },
    { labelKey: 'rank', token: '{{rank}}' },
    { labelKey: 'participants', token: '{{participants}}' },
    { labelKey: 'attempted', token: '{{attempted}}' },
    { labelKey: 'correct', token: '{{correct}}' },
    { labelKey: 'wrong', token: '{{wrong}}' },
    { labelKey: 'resultDate', token: '{{result_date}}' },
    { labelKey: 'sectionsTable', token: '{{{sections_table}}}' },
    { labelKey: 'instituteLogo', token: '{{{logo_img}}}' },
    { labelKey: 'studentDetails', token: '{{student_details}}' },
];

/** Every value a written page can show for this test's settings. */
export const reportPageValues = ({
    config,
    studentFields,
}: {
    config: ReportPagesConfig;
    studentFields: string[];
}): ReportPageValue[] => {
    const values = [...BASE_REPORT_PAGE_VALUES];
    if (readScholarshipRule(config).kind !== 'none') {
        values.push({ labelKey: 'scholarship', token: '{{scholarship_percent}}' });
    }
    if (config.qr_url) values.push({ labelKey: 'qrCode', token: '{{{qr_svg}}}' });
    studentFields.forEach((field) => {
        const key = detailKey(field);
        if (key) values.push({ label: field, token: `{{detail.${key}}}` });
    });
    Object.keys(config.assets ?? {}).forEach((key) => {
        values.push({ label: key, token: `{{{asset_img.${key}}}}` });
    });
    return values;
};

/** Puts a value at the end of the page's last paragraph (or after it). */
export const appendToken = (html: string, token: string) => {
    const trimmed = (html ?? '').trimEnd();
    if (trimmed.endsWith('</p>')) return `${trimmed.slice(0, -4)} ${token}</p>`;
    return `${trimmed}<p>${token}</p>`;
};

/** A plain letter to start from; every value in it comes from the student's result. */
export const STARTER_LETTER_HTML = [
    '<p>{{{logo_img}}}</p>',
    '<h2>{{assessment_name}} - Result</h2>',
    '<p>Date: {{result_date}}</p>',
    '<p>Dear {{student_name}},</p>',
    '<p>You scored <strong>{{score}} / {{max_score}}</strong> ({{percentage}}%) and ranked <strong>{{rank}}</strong> out of {{participants}} students.</p>',
    '<p>{{student_details}}</p>',
    '<p>{{{sections_table}}}</p>',
    '<p>Your detailed report follows on the next pages.</p>',
    '<p>Best wishes,<br>{{institute_name}}</p>',
].join('');

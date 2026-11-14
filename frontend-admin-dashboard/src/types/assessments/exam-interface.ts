/**
 * Per-assessment exam interface (assessment_service V68, column `exam_interface`).
 *
 * The learner app can draw the test screen like a known computer-based exam
 * (layout, buttons, question palette and saving rules). The admin picks it per
 * assessment in Step 1. NULL on the wire means today's standard screen.
 *
 * Wire shape (snake_case, stored as-is by the backend, unknown keys kept):
 *   { "v": 1, "preset": "<id>", "layout": "<variant>"?, "strict": true|false, ... }
 *
 * The backend accepts any preset/layout id matching ^[a-z0-9-]{1,40}$, so a
 * preset added later may reach this admin build before its option does. Such a
 * value is shown as "custom" and saved back unchanged, never silently dropped.
 */

export interface ExamInterfaceWire {
    v?: number;
    preset?: string;
    layout?: string;
    strict?: boolean;
    [key: string]: unknown;
}

export type ExamInterfaceOptionKey =
    | 'default'
    | 'jee-main-nta'
    | 'jee-main-tcs'
    | 'jee-advanced'
    | 'gate'
    | 'rrb-je';

export interface ExamInterfaceOption {
    key: ExamInterfaceOptionKey;
    /** Wire preset id. 'default' is never stored (it means NULL). */
    preset: string;
    /** Wire layout id, for presets that have more than one layout. */
    layout?: string;
    /** i18n key under `examInterface.options`. */
    labelKey: string;
}

/** The order here is the order of the picker. */
export const EXAM_INTERFACE_OPTIONS: ExamInterfaceOption[] = [
    { key: 'default', preset: 'default', labelKey: 'standard' },
    { key: 'jee-main-nta', preset: 'jee-main', layout: 'nta-mock', labelKey: 'jeeMainNta' },
    { key: 'jee-main-tcs', preset: 'jee-main', layout: 'tcs-console', labelKey: 'jeeMainTcs' },
    { key: 'jee-advanced', preset: 'jee-advanced', labelKey: 'jeeAdvanced' },
    { key: 'gate', preset: 'gate', labelKey: 'gate' },
    { key: 'rrb-je', preset: 'rrb-je', labelKey: 'rrbJe' },
];

/** Presets with more than one layout, and the layout used when none is stored. */
const DEFAULT_LAYOUT_BY_PRESET: Record<string, string> = {
    'jee-main': 'nta-mock',
};

/** Presets whose real exam screen has a built-in calculator. */
export const PRESETS_WITH_BUILT_IN_CALCULATOR = new Set(['gate']);

/** A stored value this build has no option for. */
export const EXAM_INTERFACE_CUSTOM_KEY = 'custom';

/** Form shape: what the Step 1 form holds. */
export interface ExamInterfaceForm {
    /** An ExamInterfaceOptionKey, or EXAM_INTERFACE_CUSTOM_KEY. */
    choice: string;
    /** Strict saving: an answer counts only after Save & Next. */
    strict: boolean;
    /**
     * On-screen calculator for presets whose real exam has one built in (GATE).
     * Stored as `tools.calculator`; on unless the admin turns it off (false).
     */
    calculator?: boolean;
    /** The object loaded from the server, kept so unknown keys survive a save. */
    stored: Record<string, unknown> | null;
}

export const DEFAULT_EXAM_INTERFACE_FORM: ExamInterfaceForm = {
    choice: 'default',
    strict: true,
    calculator: true,
    stored: null,
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asId = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Finds the picker option for a stored preset and layout, if this build has one. */
export const examInterfaceOptionFor = (
    preset: string | undefined,
    layout: string | undefined
): ExamInterfaceOption | undefined => {
    if (!preset || preset === 'default') {
        return EXAM_INTERFACE_OPTIONS[0];
    }
    const effectiveLayout = layout ?? DEFAULT_LAYOUT_BY_PRESET[preset];
    return EXAM_INTERFACE_OPTIONS.find(
        (option) => option.preset === preset && option.layout === effectiveLayout
    );
};

export const examInterfaceFormFromWire = (wire: unknown): ExamInterfaceForm => {
    if (!isPlainObject(wire)) {
        return { ...DEFAULT_EXAM_INTERFACE_FORM };
    }
    const preset = asId(wire.preset);
    const layout = asId(wire.layout);
    // Strict is the default; only an explicit false turns it off.
    const strict = wire.strict !== false;
    // Same for the built-in calculator.
    const calculator = !(isPlainObject(wire.tools) && wire.tools.calculator === false);
    if (!preset || preset === 'default') {
        return { ...DEFAULT_EXAM_INTERFACE_FORM, strict, calculator };
    }
    const option = examInterfaceOptionFor(preset, layout);
    return {
        choice: option ? option.key : EXAM_INTERFACE_CUSTOM_KEY,
        strict,
        calculator,
        stored: { ...wire },
    };
};

/**
 * Builds the `exam_interface` value for the Step 1 save. Always returns a value
 * (object or null) because the backend keeps the stored value when the key is
 * absent: null is how "Standard" clears it.
 *
 * `omrMode`: an OMR sheet exam is answered on paper, so it never has an exam
 * screen. It is saved as the standard screen.
 *
 * `manualEvaluation`: a teacher-checked paper (result type MANUAL) is answered
 * by uploading an answer sheet, which only the standard screen offers. It is
 * saved as the standard screen too.
 */
export const examInterfaceWireFromForm = (
    form: ExamInterfaceForm | null | undefined,
    {
        omrMode = false,
        manualEvaluation = false,
    }: { omrMode?: boolean; manualEvaluation?: boolean } = {}
): ExamInterfaceWire | null => {
    if (!form || omrMode || manualEvaluation || form.choice === 'default') {
        return null;
    }
    const stored = isPlainObject(form.stored) ? form.stored : {};
    if (form.choice === EXAM_INTERFACE_CUSTOM_KEY) {
        // A preset this build does not know: keep it exactly, only the switch changes.
        if (!asId(stored.preset)) return null;
        return { ...stored, v: typeof stored.v === 'number' ? stored.v : 1, strict: form.strict };
    }
    const option = EXAM_INTERFACE_OPTIONS.find((o) => o.key === form.choice);
    if (!option || option.preset === 'default') {
        return null;
    }
    const wire: ExamInterfaceWire = {
        ...stored,
        v: 1,
        preset: option.preset,
        strict: form.strict,
    };
    if (option.layout) {
        wire.layout = option.layout;
    } else {
        delete wire.layout;
    }
    if (PRESETS_WITH_BUILT_IN_CALCULATOR.has(option.preset)) {
        const storedTools = isPlainObject(stored.tools) ? stored.tools : {};
        wire.tools = { ...storedTools, calculator: form.calculator !== false };
    }
    return wire;
};

/** The stored preset id and layout, for the custom option's label. */
export const examInterfaceCustomLabel = (form: ExamInterfaceForm): string => {
    const stored = isPlainObject(form.stored) ? form.stored : {};
    const preset = asId(stored.preset) ?? '';
    const layout = asId(stored.layout);
    return layout ? `${preset} / ${layout}` : preset;
};

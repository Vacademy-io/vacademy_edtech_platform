/**
 * The reviewCollector block's form fields, as the editor edits them. Mirrors
 * the learner's normalizeFormFields (-utils/review-collector.ts): built-in
 * fields fill the review's own columns and appear at most once; stars and name
 * are always on the form and always required; custom fields are the admin's
 * own questions (answers stored with the review).
 */

export const BUILTIN_FIELD_KINDS = ['rating', 'reviewerName', 'reviewText', 'courseName', 'city', 'designation'] as const;
export const CUSTOM_FIELD_KINDS = ['text', 'textarea', 'select', 'number', 'email', 'phone'] as const;
export type ReviewFieldKind = (typeof BUILTIN_FIELD_KINDS)[number] | (typeof CUSTOM_FIELD_KINDS)[number];
export const LOCKED_FIELD_KINDS: readonly ReviewFieldKind[] = ['rating', 'reviewerName'];
export const MAX_CUSTOM_FIELDS = 10;

export interface ReviewFormField {
    id: string;
    kind: ReviewFieldKind;
    label?: string;
    placeholder?: string;
    required?: boolean;
    options?: string[];
    width?: 'full' | 'half';
}

/** Props the block carried before formFields; dropped once the list is saved. */
export const LEGACY_FIELD_PROPS = [
    'fields',
    'courseOptions',
    'nameLabel',
    'textLabel',
    'textPlaceholder',
    'cityLabel',
    'courseLabel',
    'designationLabel',
] as const;

export const isBuiltinKind = (k: ReviewFieldKind) => (BUILTIN_FIELD_KINDS as readonly string[]).includes(k);
export const isLockedKind = (k: ReviewFieldKind) => LOCKED_FIELD_KINDS.includes(k);
/** Kinds that can sit half-width next to another field. */
export const canBeHalf = (k: ReviewFieldKind) => k !== 'rating' && k !== 'reviewText' && k !== 'textarea';
export const hasOptions = (k: ReviewFieldKind) => k === 'select' || k === 'courseName';
export const hasPlaceholder = (k: ReviewFieldKind) => k !== 'rating';

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strList = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
type Mode = 'off' | 'optional' | 'required';
const mode = (v: unknown): Mode => (v === 'off' || v === 'required' ? v : 'optional');

/** The block's fields: formFields when saved, else built from the older per-field settings. */
export const readFormFields = (props: Record<string, any>): ReviewFormField[] => {
    if (Array.isArray(props.formFields) && props.formFields.length > 0) {
        return props.formFields.filter((f: any) => f && typeof f === 'object' && typeof f.kind === 'string');
    }
    const m = (props.fields || {}) as Record<string, unknown>;
    const text = mode(m.reviewText);
    const course = mode(m.course);
    const city = mode(m.city);
    const designation = mode(m.designation);
    const pair = course !== 'off' && city !== 'off';
    const out: ReviewFormField[] = [{ id: 'rating', kind: 'rating', required: true }];
    if (text !== 'off')
        out.push({ id: 'reviewText', kind: 'reviewText', label: str(props.textLabel), placeholder: str(props.textPlaceholder), required: text === 'required' });
    out.push({ id: 'reviewerName', kind: 'reviewerName', label: str(props.nameLabel), required: true });
    if (course !== 'off')
        out.push({ id: 'courseName', kind: 'courseName', label: str(props.courseLabel), required: course === 'required', options: strList(props.courseOptions), width: pair ? 'half' : 'full' });
    if (city !== 'off') out.push({ id: 'city', kind: 'city', label: str(props.cityLabel), required: city === 'required', width: pair ? 'half' : 'full' });
    if (designation !== 'off')
        out.push({ id: 'designation', kind: 'designation', label: str(props.designationLabel), required: designation === 'required' });
    return out;
};

/** Props with the list saved as formFields and the older per-field settings removed. */
export const withFormFields = (props: Record<string, any>, fields: ReviewFormField[]): Record<string, any> => {
    const next: Record<string, any> = { ...props, formFields: fields };
    LEGACY_FIELD_PROPS.forEach((k) => delete next[k]);
    return next;
};

const newId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Kinds the Add menu offers: built-ins not on the form yet, custom ones while under the cap. */
export const addableKinds = (fields: ReviewFormField[]) => {
    const present = new Set(fields.map((f) => f.kind));
    const custom = fields.filter((f) => !isBuiltinKind(f.kind)).length;
    return {
        builtin: BUILTIN_FIELD_KINDS.filter((k) => !present.has(k)),
        custom: custom >= MAX_CUSTOM_FIELDS ? [] : [...CUSTOM_FIELD_KINDS],
    };
};

export const addField = (fields: ReviewFormField[], kind: ReviewFieldKind): ReviewFormField[] => {
    if (isBuiltinKind(kind) && fields.some((f) => f.kind === kind)) return fields;
    const field: ReviewFormField = {
        id: isBuiltinKind(kind) ? kind : newId(),
        kind,
        label: '',
        required: isLockedKind(kind),
        width: 'full',
        ...(hasOptions(kind) ? { options: [] } : {}),
    };
    return [...fields, field];
};

export const moveField = (fields: ReviewFormField[], i: number, dir: -1 | 1): ReviewFormField[] => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return fields;
    const next = [...fields];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
};

/** Stars and name cannot be removed: a review needs both to become a testimonial. */
export const removeField = (fields: ReviewFormField[], i: number): ReviewFormField[] =>
    fields[i] && isLockedKind(fields[i]!.kind) ? fields : fields.filter((_, idx) => idx !== i);

export const patchField = (fields: ReviewFormField[], i: number, patch: Partial<ReviewFormField>): ReviewFormField[] => {
    const f = fields[i];
    if (!f) return fields;
    const merged: ReviewFormField = { ...f, ...patch };
    if (isLockedKind(merged.kind)) merged.required = true;
    if (!canBeHalf(merged.kind)) merged.width = 'full';
    const next = [...fields];
    next[i] = merged;
    return next;
};

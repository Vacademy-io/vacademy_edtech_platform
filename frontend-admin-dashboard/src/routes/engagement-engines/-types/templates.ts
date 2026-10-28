// Types for engine templates: "Generate with AI" options and engine email templates.
// API payload fields mirror the admin_core records (camelCase), like the rest of this route.

export type TemplateLanguage = 'en' | 'hi' | 'hinglish';

export type GenerateMode = 'NEW' | 'REGENERATE' | 'MORE_LIKE_THIS';

/** What the admin picks in the Generate dialog. */
export interface GenerateOptions {
    purpose?: string;
    count?: number;
    language?: TemplateLanguage;
    feedback?: string;
}

export type EmailMode = 'FREE_WRITE' | 'TEMPLATE_ONLY' | 'TEMPLATE_PLUS_AI_LINE';

export const EMAIL_MODES: EmailMode[] = ['FREE_WRITE', 'TEMPLATE_ONLY', 'TEMPLATE_PLUS_AI_LINE'];

export type EmailTemplateStatus = 'AI_PROPOSED' | 'USER_REVIEW' | 'APPROVED' | 'SUPERSEDED' | 'ARCHIVED';

export interface EmailTemplateIssue {
    level: 'BLOCK' | 'WARN';
    code: string;
    message: string;
}

export interface EmailTemplate {
    id: string;
    engineId: string;
    name: string;
    version: number;
    title?: string;
    purpose?: string;
    language: TemplateLanguage;
    subject: string;
    preheader?: string;
    bodyHtml: string;
    variableNames: string[];
    sampleValues: string[];
    variableSources: Record<string, string>;
    status: EmailTemplateStatus;
    rationale?: string;
    issues: EmailTemplateIssue[];
    createdAt?: string;
    updatedAt?: string;
    approvedAt?: string;
}

export interface EmailTemplateGenerateRequest extends GenerateOptions {
    basedOnId?: string;
    mode?: GenerateMode;
}

export interface EmailTemplateEditRequest {
    title?: string;
    purpose?: string;
    subject?: string;
    preheader?: string;
    bodyHtml?: string;
    variableNames?: string[];
    sampleValues?: string[];
    variableSources?: Record<string, string>;
}

export interface EmailTemplatePreview {
    subject: string;
    html: string;
    text: string;
    missingVariables: string[];
}

/** Kinds of variable source; the value after the kind is typed by the admin (see VariableSourceField). */
export type VariableSourceKind =
    | 'profile.name'
    | 'profile.firstName'
    | 'form'
    | 'research'
    | 'brief.link'
    | 'static'
    | 'ai';

export const VARIABLE_SOURCE_KINDS: VariableSourceKind[] = [
    'profile.firstName',
    'profile.name',
    'form',
    'research',
    'brief.link',
    'static',
    'ai',
];

/** Split a stored source ("form.course", "static:Team EE") into its kind and the typed part. */
export function splitSource(source: string | undefined): { kind: VariableSourceKind | ''; value: string } {
    if (!source) return { kind: '', value: '' };
    if (source === 'profile.name' || source === 'profile.firstName' || source === 'ai') {
        return { kind: source, value: '' };
    }
    if (source.startsWith('form.')) return { kind: 'form', value: source.slice(5) };
    if (source.startsWith('research.')) return { kind: 'research', value: source.slice(9) };
    if (source.startsWith('brief.link.')) return { kind: 'brief.link', value: source.slice(11) };
    if (source.startsWith('static:')) return { kind: 'static', value: source.slice(7) };
    return { kind: '', value: source };
}

/** The stored form of a kind + typed part; an incomplete one keeps its prefix ("form.") so the kind stays picked. */
export function joinSource(kind: VariableSourceKind | '', value: string): string {
    const v = value.trim();
    switch (kind) {
        case 'profile.name':
        case 'profile.firstName':
        case 'ai':
            return kind;
        case 'form':
        case 'research':
            return `${kind}.${value}`;
        case 'brief.link':
            return `brief.link.${v}`;
        case 'static':
            return `static:${value}`;
        default:
            return '';
    }
}

/** Mirrors the backend's accepted sources (TemplateVariableSources.SOURCE). */
export function isCompleteSource(source: string | undefined): boolean {
    if (!source) return false;
    return /^(profile\.name|profile\.firstName|ai|form\.[^\s].{0,79}|research\.[^\s].{0,79}|brief\.link\.[1-9]\d?|static:.{1,200})$/.test(
        source.trim()
    );
}

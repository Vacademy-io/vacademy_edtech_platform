/**
 * Shared shapes for the Create Announcement wizard.
 *
 * Audience rules are keyed objects rather than the index-keyed `Record<number, …>` maps the
 * previous single-page form used. Those maps were never re-indexed when a row was removed, so
 * deleting the first of three rows left the remaining rows reading the *deleted* row's tags,
 * filters and exclusions. A stable `key` per rule makes that class of bug impossible.
 */
import type { MediumType, ModeType, RecipientType } from '@/services/announcement';

export type AudienceRuleType = Extract<
    RecipientType,
    'ROLE' | 'PACKAGE_SESSION' | 'USER' | 'TAG' | 'AUDIENCE' | 'CUSTOM_FIELD_FILTER'
>;

export type FilterOperator = 'equals' | 'contains' | 'starts_with' | 'ends_with';

export interface FieldFilter {
    key: string;
    fieldId: string;
    fieldName: string;
    fieldType: string;
    filterValue: string | string[];
    operator?: FilterOperator;
}

export type ExclusionType = 'ROLE' | 'USER' | 'PACKAGE_SESSION' | 'TAG';

export interface RuleExclusion {
    key: string;
    exclusionType: ExclusionType;
    exclusionId: string;
    exclusionName?: string;
}

export interface AudienceRule {
    key: string;
    type: AudienceRuleType;
    /** ROLE */
    roleId: string;
    /** PACKAGE_SESSION — multi-select, so one rule can carry a whole course at once. */
    packageSessionIds: string[];
    /** Only meaningful for sub-org (`is_org_associated`) batches. */
    orgRole?: 'ADMIN' | 'LEARNER';
    /** USER — free-form ids/emails entered as chips. */
    userIds: string[];
    /** TAG */
    tagIds: string[];
    tagScope: 'ALL' | 'DEFAULT' | 'INSTITUTE';
    /** AUDIENCE (campaign) — multi-select, one recipient row per campaign. */
    campaignIds: string[];
    /** Names captured at pick/hydrate time, so rows stay labelled before the campaign list loads. */
    campaignNames: Record<string, string>;
    fieldFilters: FieldFilter[];
    exclusions: RuleExclusion[];
}

export interface BatchOption {
    id: string;
    label: string;
    packageName: string;
    levelName: string;
    sessionName: string;
    status?: string;
    isOrgAssociated: boolean;
}

export interface CustomFieldOption {
    id: string;
    name: string;
    type: string;
    options?: string[];
}

export type ScheduleType = 'IMMEDIATE' | 'ONE_TIME' | 'RECURRING';

export interface PushConfig {
    title: string;
    body: string;
}

export interface EmailConfig {
    /** '' = compose from the announcement content instead of a saved template. */
    templateId: string;
    /** Kept so the payload can carry the template *name* the backend logs against. */
    templateName: string;
    fromKey: string;
    /** Blank = reuse the announcement title. */
    subjectOverride: string;
}

/** Derived from WHATSAPP_VALUE_SOURCES so the two can never drift apart. */
export type WhatsAppValueSource =
    (typeof import('./-utils/constants').WHATSAPP_VALUE_SOURCES)[number]['value'];

export interface WhatsAppVariableBinding {
    source: WhatsAppValueSource;
    customValue: string;
}

export interface WhatsAppConfig {
    templateName: string;
    languageCode: string;
    headerUrl: string;
    /** Keyed by the template's variable name. */
    variables: Record<string, WhatsAppVariableBinding>;
}

export interface SectionDefinition {
    id: FormSectionId;
    title: string;
    caption: string;
}

export type FormSectionId = 'basics' | 'recipients' | 'placements' | 'delivery' | 'review';

/** Field-level errors keyed by a dotted path, e.g. `whatsapp.template` or `rule.<key>.batches`. */
export type FieldErrors = Record<string, string>;

export interface SectionValidation {
    /** Field errors produced by this step, keyed by path. */
    errors: FieldErrors;
    /** Human-readable blockers, shown in the step's error summary. */
    blockers: string[];
    /** Non-blocking advice — shown, but never stops the user. */
    warnings: string[];
}

export type ModeSettings = Record<string, unknown>;

export interface AnnouncementDraft {
    title: string;
    previewText: string;
    htmlContent: string;
    modes: ModeType[];
    modeSettings: Partial<Record<ModeType, ModeSettings>>;
    mediums: MediumType[];
    rules: AudienceRule[];
    scheduleType: ScheduleType;
    timezone: string;
    oneTimeStart: string;
    cronExpression: string;
}

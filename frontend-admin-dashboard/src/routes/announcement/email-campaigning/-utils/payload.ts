import type { TFunction } from 'i18next';
import type { CreateAnnouncementRequest } from '@/services/announcement';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import type { AudienceRule, CustomFieldOption, ExclusionType } from '../../create/-types';
import { expandRecipients } from '../../create/-utils/payload';
import { createRule } from '../../create/-hooks/useAnnouncementDraft';
import { senderKey } from './validation';
import type {
    BatchOption,
    EmailCampaignDraft,
    EmailPriority,
    EmailSectionId,
    FieldErrors,
    PrefilledCampaign,
    ScheduleType,
} from '../-types';
import { EMAIL_PRIORITIES } from '../-types';

export type EmailCampaignPayload = Omit<CreateAnnouncementRequest, 'instituteId'>;

export interface BuildPayloadInput {
    draft: EmailCampaignDraft;
    batchById: Record<string, BatchOption>;
    tagNameById: Record<string, string>;
    senders: EmailConfiguration[];
    createdBy: string;
    createdByName?: string;
    createdByRole: string;
}

/** `datetime-local` gives `YYYY-MM-DDTHH:mm`; the API wants seconds and no timezone shift. */
const withSeconds = (value: string) => (value.length === 16 ? `${value}:00` : value);

export function buildEmailCampaignPayload(input: BuildPayloadInput): EmailCampaignPayload {
    const { draft } = input;
    const sender = input.senders.find((s) => senderKey(s) === draft.fromKey);

    const scheduling: CreateAnnouncementRequest['scheduling'] =
        draft.scheduleType === 'IMMEDIATE'
            ? { scheduleType: 'IMMEDIATE', timezone: draft.timezone }
            : draft.scheduleType === 'ONE_TIME'
              ? {
                    scheduleType: 'ONE_TIME',
                    timezone: draft.timezone,
                    // Wall-clock literal on purpose: the backend reads it in `timezone`.
                    // `new Date(...).toISOString()` would shift it by the browser's offset.
                    startDate: draft.oneTimeStart ? withSeconds(draft.oneTimeStart) : undefined,
                }
              : {
                    scheduleType: 'RECURRING',
                    timezone: draft.timezone,
                    cronExpression: draft.cronExpression.trim() || undefined,
                };

    return {
        title: draft.title.trim(),
        content: { type: 'html', content: draft.htmlContent },
        createdBy: input.createdBy,
        createdByName: input.createdByName,
        createdByRole: input.createdByRole,
        timezone: draft.timezone,
        recipients: expandRecipients(draft.rules, input.batchById, input.tagNameById),
        modes: [
            {
                modeType: 'SYSTEM_ALERT',
                settings: {
                    priority: draft.priority,
                    // '' is not a date; leave the key out rather than send an empty string.
                    ...(draft.expiresAt ? { expiresAt: withSeconds(draft.expiresAt) } : {}),
                },
            },
        ],
        mediums: [
            {
                mediumType: 'EMAIL',
                config: {
                    subject: draft.subject.trim(),
                    emailType: sender?.type || 'UTILITY_EMAIL',
                    fromEmail: sender?.email,
                    fromName: sender?.name,
                    template: draft.templateName || undefined,
                    previewText: draft.previewText.trim() || undefined,
                },
            },
        ],
        scheduling,
    };
}

// ---------------------------------------------------------------------------- hydration

interface ApiRecipient {
    recipientType?: string;
    recipientId?: string;
    recipientName?: string | null;
}

interface ApiAnnouncement {
    title?: string;
    status?: string;
    content?: { content?: string | null } | null;
    modes?: Array<{ modeType?: string; settings?: Record<string, unknown> | null }>;
    mediums?: Array<{ mediumType?: string; config?: Record<string, unknown> | null }>;
    scheduling?: {
        scheduleType?: string;
        timezone?: string;
        startDate?: string;
        cronExpression?: string;
    } | null;
    recipients?: ApiRecipient[];
}

const parseJsonArray = (raw: string | null | undefined): unknown[] | null => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[')) return null;
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const EXCLUSION_TYPES: ExclusionType[] = ['ROLE', 'USER', 'PACKAGE_SESSION', 'TAG'];

/**
 * The backend stores a recipient's exclusions as a JSON array *in `recipientName`*
 * (`[{exclusionType, exclusionId}]`), so a name that parses as an array is exclusions, not a name.
 */
const readExclusions = (raw: string | null | undefined): AudienceRule['exclusions'] => {
    const parsed = parseJsonArray(raw);
    if (!parsed) return [];
    return parsed.flatMap((item, index) => {
        const entry = item as { exclusionType?: string; exclusionId?: string };
        const type = EXCLUSION_TYPES.find((candidate) => candidate === entry.exclusionType);
        if (!type || !entry.exclusionId) return [];
        return [
            {
                key: `hydrated-exclusion-${index}-${entry.exclusionId}`,
                exclusionType: type,
                exclusionId: entry.exclusionId,
                exclusionName: entry.exclusionId,
            },
        ];
    });
};

/**
 * CUSTOM_FIELD_FILTER rows keep their filters as the *request* shape
 * (`{customFieldId, fieldName, fieldValue, operator}`) serialised into `recipientName`.
 * The old page parsed them as the form shape (`fieldId`/`filterValue`) and silently dropped
 * every filter on edit — hence the explicit mapping here.
 */
const readFieldFilters = (
    raw: string | null | undefined,
    customFields: CustomFieldOption[]
): AudienceRule['fieldFilters'] => {
    const parsed = parseJsonArray(raw);
    if (!parsed) return [];
    return parsed.flatMap((item, index) => {
        const entry = item as {
            customFieldId?: string;
            fieldId?: string;
            fieldName?: string;
            fieldValue?: string | string[];
            filterValue?: string | string[];
            operator?: string;
        };
        const fieldId = entry.customFieldId || entry.fieldId || '';
        const value = entry.fieldValue ?? entry.filterValue ?? '';
        if (!fieldId) return [];
        const known = customFields.find((f) => f.id === fieldId);
        const fieldType = known?.type ?? (Array.isArray(value) ? 'dropdown' : 'text');
        const operator =
            entry.operator === 'equals' ||
            entry.operator === 'contains' ||
            entry.operator === 'starts_with' ||
            entry.operator === 'ends_with'
                ? entry.operator
                : undefined;
        return [
            {
                key: `hydrated-filter-${index}-${fieldId}`,
                fieldId,
                fieldName: entry.fieldName || known?.name || '',
                fieldType,
                filterValue: fieldType === 'dropdown' && !Array.isArray(value) ? [value] : value,
                operator: fieldType === 'text' ? operator ?? 'equals' : operator,
            },
        ];
    });
};

/**
 * Audience rules from stored recipient rows. Campaign rows without exclusions are folded into a
 * single multi-select rule (that is how the picker creates them); everything else is one rule per row.
 */
export function rulesFromRecipients(
    recipients: ApiRecipient[],
    customFields: CustomFieldOption[]
): AudienceRule[] {
    const rules = rulesFromRows(recipients, customFields);
    const plainCampaigns = rules.filter((r) => r.type === 'AUDIENCE' && r.exclusions.length === 0);
    if (plainCampaigns.length < 2) return rules;
    const [first, ...rest] = plainCampaigns;
    if (!first) return rules;
    const merged: AudienceRule = {
        ...first,
        campaignIds: plainCampaigns.flatMap((r) => r.campaignIds),
        campaignNames: Object.assign({}, ...plainCampaigns.map((r) => r.campaignNames)),
    };
    return rules.filter((r) => !rest.includes(r)).map((r) => (r === first ? merged : r));
}

function rulesFromRows(
    recipients: ApiRecipient[],
    customFields: CustomFieldOption[]
): AudienceRule[] {
    return recipients.flatMap((row) => {
        const type = row.recipientType;
        const id = row.recipientId ?? '';
        switch (type) {
            case 'ROLE':
                return id
                    ? [
                          createRule('ROLE', {
                              roleId: id,
                              exclusions: readExclusions(row.recipientName),
                          }),
                      ]
                    : [];
            case 'USER':
                return id
                    ? [
                          createRule('USER', {
                              userIds: [id],
                              exclusions: readExclusions(row.recipientName),
                          }),
                      ]
                    : [];
            case 'TAG':
                return id
                    ? [
                          createRule('TAG', {
                              tagIds: [id],
                              exclusions: readExclusions(row.recipientName),
                          }),
                      ]
                    : [];
            case 'PACKAGE_SESSION':
                return id
                    ? [
                          createRule('PACKAGE_SESSION', {
                              packageSessionIds: [id],
                              exclusions: readExclusions(row.recipientName),
                          }),
                      ]
                    : [];
            case 'PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES': {
                // Encoded as `<packageSessionId>:<ROLE>`.
                const [packageSessionId, role] = id.split(':');
                if (!packageSessionId) return [];
                return [
                    createRule('PACKAGE_SESSION', {
                        packageSessionIds: [packageSessionId],
                        orgRole: role === 'ADMIN' || role === 'LEARNER' ? role : undefined,
                        exclusions: readExclusions(row.recipientName),
                    }),
                ];
            }
            case 'AUDIENCE': {
                const exclusions = readExclusions(row.recipientName);
                // When exclusions are stored the name is gone; the picker restores it.
                const name = exclusions.length ? '' : row.recipientName ?? '';
                return id
                    ? [
                          createRule('AUDIENCE', {
                              campaignIds: [id],
                              campaignNames: name ? { [id]: name } : {},
                              exclusions,
                          }),
                      ]
                    : [];
            }
            case 'CUSTOM_FIELD_FILTER': {
                const fieldFilters = readFieldFilters(row.recipientName, customFields);
                return fieldFilters.length
                    ? [createRule('CUSTOM_FIELD_FILTER', { fieldFilters })]
                    : [];
            }
            default:
                return [];
        }
    });
}

const toLocalInput = (value: string | undefined | null): string =>
    typeof value === 'string' && value.length >= 16 ? value.slice(0, 16) : '';

const readPriority = (value: unknown): EmailPriority =>
    typeof value === 'string' && (EMAIL_PRIORITIES as string[]).includes(value)
        ? (value as EmailPriority)
        : 'MEDIUM';

/** Turn `GET /announcements/{id}` into draft values. Anything unrecognised is left at its default. */
export function hydrateCampaign(
    raw: unknown,
    customFields: CustomFieldOption[]
): PrefilledCampaign {
    const a = (raw ?? {}) as ApiAnnouncement;
    const draft: Partial<EmailCampaignDraft> = {};

    draft.title = a.title ?? '';
    draft.htmlContent = a.content?.content ?? '';

    const systemAlert = (a.modes ?? []).find((m) => m.modeType === 'SYSTEM_ALERT');
    if (systemAlert?.settings) {
        draft.priority = readPriority(systemAlert.settings.priority);
        draft.expiresAt = toLocalInput(systemAlert.settings.expiresAt as string | undefined);
    }

    const email = (a.mediums ?? []).find((m) => m.mediumType === 'EMAIL');
    const cfg = (email?.config ?? {}) as Record<string, unknown>;
    if (typeof cfg.previewText === 'string') draft.previewText = cfg.previewText;
    if (typeof cfg.fromEmail === 'string' && typeof cfg.fromName === 'string') {
        draft.fromKey = `${cfg.fromEmail}-${cfg.fromName}`;
    }
    if (typeof cfg.template === 'string') draft.templateName = cfg.template;
    // Subject was added after launch; older rows fall back to the title.
    draft.subject =
        typeof cfg.subject === 'string' && cfg.subject.trim() ? cfg.subject : a.title ?? '';

    if (a.scheduling) {
        const s = a.scheduling;
        if (
            s.scheduleType === 'IMMEDIATE' ||
            s.scheduleType === 'ONE_TIME' ||
            s.scheduleType === 'RECURRING'
        ) {
            draft.scheduleType = s.scheduleType as ScheduleType;
        }
        if (s.timezone) draft.timezone = s.timezone;
        draft.oneTimeStart = toLocalInput(s.startDate);
        if (s.cronExpression) draft.cronExpression = s.cronExpression;
    }

    draft.rules = rulesFromRecipients(a.recipients ?? [], customFields);

    return { draft, status: typeof a.status === 'string' ? a.status : null };
}

// ---------------------------------------------------------------------------- API errors

/** Which section a field path belongs to, so a server error can send the user there. */
export function sectionForFieldPath(path: string): EmailSectionId {
    if (path === 'content' || path.startsWith('content.')) return 'content';
    if (path.startsWith('rule.') || path.startsWith('recipients')) return 'audience';
    if (
        path.startsWith('schedule.') ||
        path.startsWith('scheduling') ||
        path.startsWith('mediums') ||
        path.startsWith('modes') ||
        path === 'fromKey' ||
        path === 'priority' ||
        path === 'expiresAt' ||
        path === 'timezone'
    ) {
        return 'settings';
    }
    return 'details';
}

export interface ApiFailure {
    fieldErrors: FieldErrors;
    message: string;
    section: EmailSectionId | null;
    /** True when the campaign can no longer be changed (locked status, send time passed). */
    locked: boolean;
}

const BACKEND_FIELD_MAP: Record<string, string> = {
    title: 'title',
    'content.content': 'content',
    'content.type': 'content',
    recipients: 'recipients',
    'scheduling.startDate': 'schedule.startDate',
    'scheduling.cronExpression': 'schedule.cronExpression',
    'scheduling.timezone': 'timezone',
};

/**
 * Turn an axios failure from `POST/PUT /announcements` into inline field errors plus one
 * sentence for the toast. The backend replies `{status, message, code, details}` where
 * `details` is a `field → message` map for bean-validation failures.
 */
export function interpretApiError(t: TFunction, err: unknown): ApiFailure {
    const typed = err as {
        code?: string;
        message?: string;
        response?: {
            status?: number;
            data?: { message?: string; code?: string; details?: unknown };
        };
    };
    const status = typed?.response?.status;
    const data = typed?.response?.data;
    const fieldErrors: FieldErrors = {};

    if (data?.details && typeof data.details === 'object' && !Array.isArray(data.details)) {
        Object.entries(data.details as Record<string, unknown>).forEach(([key, value]) => {
            if (typeof value !== 'string') return;
            const mapped =
                BACKEND_FIELD_MAP[key] ??
                (key.startsWith('recipients[')
                    ? 'recipients'
                    : key.startsWith('scheduling.')
                      ? `schedule.${key.slice('scheduling.'.length)}`
                      : key.startsWith('mediums[')
                        ? 'fromKey'
                        : key);
            fieldErrors[mapped] = value;
        });
    }

    const serverMessage = typeof data?.message === 'string' ? data.message.trim() : '';
    const locked =
        status === 400 &&
        /cannot be edited|no longer be edited|already passed/i.test(serverMessage);
    const paths = Object.keys(fieldErrors);
    const offline =
        !typed?.response &&
        (typed?.code === 'ERR_NETWORK' ||
            typed?.code === 'ECONNABORTED' ||
            /network error|timeout/i.test(typed?.message ?? ''));

    let message: string;
    if (paths.length) message = t('apiError.fixHighlighted', { count: paths.length });
    else if (locked) message = serverMessage;
    else if (status === 401 || status === 403) message = t('apiError.noPermission');
    else if (status === 404) message = t('apiError.notFound');
    else if (status === 413) message = t('apiError.tooLarge');
    else if (status && status >= 500) message = serverMessage || t('apiError.serverError');
    else if (status && serverMessage) message = serverMessage;
    else if (offline) message = t('apiError.network');
    else message = typed?.message || t('apiError.generic');

    return {
        fieldErrors,
        message,
        section: paths.length && paths[0] ? sectionForFieldPath(paths[0]) : null,
        locked,
    };
}

/** Short human text for a failed lookup (tags, senders, …) — server message first, then fallback. */
export function errorText(err: unknown, fallback: string): string {
    const typed = err as { response?: { data?: { message?: string } }; message?: string };
    return typed?.response?.data?.message || typed?.message || fallback;
}

import type { TFunction } from 'i18next';
import type {
    CreateAnnouncementRequest,
    CustomFieldFilter,
    Exclusion,
    MediumType,
    ModeType,
} from '@/services/announcement';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import { WHATSAPP_VALUE_SOURCES } from './constants';
import { whatsAppHeaderKind, whatsAppVariableNames } from './validation';
import type {
    AudienceRule,
    BatchOption,
    EmailConfig,
    FieldErrors,
    ModeSettings,
    PushConfig,
    ScheduleType,
    WhatsAppConfig,
    FormSectionId,
} from '../-types';

type Recipients = CreateAnnouncementRequest['recipients'];

const cleanFilters = (rule: AudienceRule): CustomFieldFilter[] | undefined => {
    const valid = rule.fieldFilters
        .filter(
            (f) =>
                f.fieldId &&
                (Array.isArray(f.filterValue) ? f.filterValue.length > 0 : !!f.filterValue)
        )
        .map((f) => ({
            customFieldId: f.fieldId,
            fieldName: f.fieldName,
            fieldValue: f.filterValue,
            operator: f.operator,
        }));
    return valid.length ? valid : undefined;
};

const cleanExclusions = (rule: AudienceRule): Exclusion[] | undefined => {
    const valid = rule.exclusions
        .filter((e) => e.exclusionId.trim() !== '')
        .map((e) => ({ exclusionType: e.exclusionType, exclusionId: e.exclusionId }));
    return valid.length ? valid : undefined;
};

/**
 * Flatten the wizard's audience rules into the flat recipient list the API takes.
 * A single batch rule can carry many package sessions, so one row here can become many entries.
 */
export function expandRecipients(
    rules: AudienceRule[],
    batchById: Record<string, BatchOption>,
    tagNameById: Record<string, string>
): Recipients {
    const out: Recipients = [];

    rules.forEach((rule, index) => {
        const customFieldFilters = cleanFilters(rule);
        const exclusions = cleanExclusions(rule);
        const shared = { customFieldFilters, exclusions };

        switch (rule.type) {
            case 'ROLE':
                if (rule.roleId)
                    out.push({ recipientType: 'ROLE', recipientId: rule.roleId, ...shared });
                break;

            case 'PACKAGE_SESSION':
                rule.packageSessionIds.forEach((id) => {
                    const batch = batchById[id];
                    // Sub-org batches address a role inside the batch, encoded as `<id>:<ROLE>`.
                    if (batch?.isOrgAssociated && rule.orgRole) {
                        out.push({
                            recipientType: 'PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES',
                            recipientId: `${id}:${rule.orgRole}`,
                            recipientName: `${batch.label} (${rule.orgRole})`,
                            ...shared,
                        });
                        return;
                    }
                    out.push({
                        recipientType: 'PACKAGE_SESSION',
                        recipientId: id,
                        recipientName: batch?.label,
                        ...shared,
                    });
                });
                break;

            case 'USER':
                rule.userIds.forEach((id) => {
                    out.push({ recipientType: 'USER', recipientId: id, ...shared });
                });
                break;

            case 'TAG':
                rule.tagIds.forEach((tagId) => {
                    out.push({
                        recipientType: 'TAG',
                        recipientId: tagId,
                        recipientName: tagNameById[tagId],
                        ...shared,
                    });
                });
                break;

            case 'AUDIENCE':
                rule.campaignIds.forEach((id) => {
                    out.push({
                        recipientType: 'AUDIENCE',
                        recipientId: id,
                        recipientName: rule.campaignNames[id] || undefined,
                        ...shared,
                    });
                });
                break;

            case 'CUSTOM_FIELD_FILTER':
                if (customFieldFilters)
                    out.push({
                        recipientType: 'CUSTOM_FIELD_FILTER',
                        recipientId: `custom-filter-${index}`,
                        customFieldFilters,
                        exclusions,
                    });
                break;

            default:
                break;
        }
    });

    return out;
}

/**
 * WhatsApp variable values.
 *
 * The notification service substitutes `{{title}}`, `{{content}}`, `{{created_by}}` and
 * `{{user_name}}` inside each value at send time, so a bound variable is sent as its token and a
 * custom one as literal text.
 */
export function buildWhatsAppValues(
    config: WhatsAppConfig,
    template: WhatsAppTemplateDTO | null
): Record<string, string> {
    const values: Record<string, string> = {};
    whatsAppVariableNames(template).forEach((name) => {
        const binding = config.variables[name];
        if (!binding) return;
        if (binding.source === 'CUSTOM') {
            values[name] = binding.customValue;
            return;
        }
        const token = WHATSAPP_VALUE_SOURCES.find((s) => s.value === binding.source)?.token;
        if (token) values[name] = token;
    });
    return values;
}

export interface BuildPayloadInput {
    title: string;
    htmlContent: string;
    previewText: string;
    createdBy: string;
    createdByName?: string;
    createdByRole: string;
    rules: AudienceRule[];
    batchById: Record<string, BatchOption>;
    tagNameById: Record<string, string>;
    modes: ModeType[];
    modeSettings: Partial<Record<ModeType, ModeSettings>>;
    mediums: MediumType[];
    push: PushConfig;
    email: EmailConfig;
    emailSenders: EmailConfiguration[];
    whatsapp: WhatsAppConfig;
    selectedWaTemplate: WhatsAppTemplateDTO | null;
    scheduleType: ScheduleType;
    timezone: string;
    oneTimeStart: string;
    cronExpression: string;
}

/** `datetime-local` gives `YYYY-MM-DDTHH:mm`; the API wants seconds and no timezone shift. */
const withSeconds = (value: string) => (value.length === 16 ? `${value}:00` : value);

export function buildCreatePayload(
    input: BuildPayloadInput
): Omit<CreateAnnouncementRequest, 'instituteId'> {
    const modes = input.modes.map((mode) => {
        const settings: ModeSettings = { ...(input.modeSettings[mode] ?? {}) };
        // The backend parses this as a LocalDateTime, and '' is not one.
        if (mode === 'APP_OVERLAY' && !settings.showUntil) delete settings.showUntil;
        return { modeType: mode, settings };
    });

    const mediums = input.mediums.map((medium) => {
        if (medium === 'EMAIL') {
            const sender = input.emailSenders.find(
                (c) => `${c.email}-${c.name}` === input.email.fromKey
            );
            return {
                mediumType: medium,
                config: {
                    subject: input.email.subjectOverride.trim() || input.title,
                    emailType: sender?.type || 'UTILITY_EMAIL',
                    fromEmail: sender?.email,
                    fromName: sender?.name,
                    template: input.email.templateName || undefined,
                    previewText: input.previewText || undefined,
                },
            };
        }

        if (medium === 'WHATSAPP') {
            const headerKind = whatsAppHeaderKind(input.selectedWaTemplate);
            // snake_case on purpose: AnnouncementDeliveryService reads `template_name`,
            // `dynamic_values`, `language_code`, `header_type` and `header_url` off this map.
            // Sending camelCase here is why WhatsApp announcements silently never went out.
            return {
                mediumType: medium,
                config: {
                    template_name: input.whatsapp.templateName,
                    language_code: input.whatsapp.languageCode || 'en',
                    dynamic_values: buildWhatsAppValues(input.whatsapp, input.selectedWaTemplate),
                    ...(headerKind
                        ? {
                              header_type: headerKind,
                              header_url: input.whatsapp.headerUrl.trim(),
                          }
                        : {}),
                },
            };
        }

        return {
            mediumType: medium,
            config: { title: input.push.title, body: input.push.body },
        };
    });

    const scheduling: CreateAnnouncementRequest['scheduling'] =
        input.scheduleType === 'IMMEDIATE'
            ? { scheduleType: 'IMMEDIATE', timezone: input.timezone }
            : input.scheduleType === 'ONE_TIME'
              ? {
                    scheduleType: 'ONE_TIME',
                    timezone: input.timezone,
                    // Send the picked wall-clock literal so the backend reads it in the chosen
                    // timezone; new Date(…).toISOString() would shift it by the browser's offset.
                    startDate: input.oneTimeStart ? withSeconds(input.oneTimeStart) : undefined,
                }
              : {
                    scheduleType: 'RECURRING',
                    timezone: input.timezone,
                    cronExpression: input.cronExpression || undefined,
                };

    return {
        title: input.title,
        content: { type: 'html', content: input.htmlContent },
        createdBy: input.createdBy,
        createdByName: input.createdByName,
        createdByRole: input.createdByRole,
        timezone: input.timezone,
        recipients: expandRecipients(input.rules, input.batchById, input.tagNameById),
        modes,
        mediums,
        scheduling,
    };
}

/** Where a given field path lives, so a server error can send the user to the right section. */
export function sectionForFieldPath(path: string): FormSectionId {
    if (path.startsWith('schedule.') || path.startsWith('scheduling.')) return 'delivery';
    if (path.startsWith('push.') || path.startsWith('email.') || path.startsWith('whatsapp.'))
        return 'delivery';
    if (path.startsWith('mediums')) return 'delivery';
    if (path.startsWith('modes')) return 'placements';
    if (path.startsWith('rule.') || path.startsWith('recipients')) return 'recipients';
    return 'basics';
}

export interface ApiFailure {
    fieldErrors: FieldErrors;
    message: string;
    /** First section containing a field error, so the page can scroll there. */
    section: FormSectionId | null;
}

/** Turn an axios failure into inline field errors plus one sentence for the toast. */
export function interpretApiError(t: TFunction, err: unknown): ApiFailure {
    const typed = err as {
        response?: {
            status?: number;
            data?: { details?: Record<string, string>; message?: string };
        };
        message?: string;
    };
    const details = typed?.response?.data?.details;
    const fieldErrors: FieldErrors = {};

    if (details && typeof details === 'object') {
        Object.entries(details).forEach(([key, message]) => {
            if (key.startsWith('scheduling.')) {
                fieldErrors[`schedule.${key.split('.').slice(1).join('.')}`] = message;
            } else if (key.startsWith('content.')) {
                fieldErrors.content = message;
            } else if (key.startsWith('mediums')) {
                fieldErrors['mediums'] = message;
            } else {
                fieldErrors[key] = message;
            }
        });
    }

    const paths = Object.keys(fieldErrors);
    const status = typed?.response?.status;
    const message =
        typed?.response?.data?.message ||
        (paths.length ? t('error.fixFieldsBeforeCreate') : '') ||
        (status === 401 || status === 403 ? t('error.noPermission') : '') ||
        (status && status >= 500 ? t('error.serviceUnavailable') : '') ||
        typed?.message ||
        t('error.genericCreateFailure');

    return {
        fieldErrors,
        message,
        section: paths.length && paths[0] ? sectionForFieldPath(paths[0]) : null,
    };
}

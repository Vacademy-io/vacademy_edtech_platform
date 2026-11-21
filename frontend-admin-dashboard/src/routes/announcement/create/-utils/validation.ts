import type { TFunction } from 'i18next';
import type { MediumType, ModeType } from '@/services/announcement';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import type {
    AudienceRule,
    BatchOption,
    EmailConfig,
    FieldErrors,
    ModeSettings,
    PushConfig,
    ScheduleType,
    SectionValidation,
    WhatsAppConfig,
    FormSectionId,
} from '../-types';

const empty = (): SectionValidation => ({ errors: {}, blockers: [], warnings: [] });

const add = (v: SectionValidation, path: string, message: string) => {
    v.errors[path] = message;
    v.blockers.push(message);
};

export interface ValidationInput {
    title: string;
    htmlContent: string;
    contentText: string;
    previewText: string;
    rules: AudienceRule[];
    batchById: Record<string, BatchOption>;
    modes: ModeType[];
    modeSettings: Partial<Record<ModeType, ModeSettings>>;
    mediums: MediumType[];
    push: PushConfig;
    email: EmailConfig;
    whatsapp: WhatsAppConfig;
    selectedWaTemplate: WhatsAppTemplateDTO | null;
    hasEmailSenders: boolean;
    scheduleType: ScheduleType;
    oneTimeStart: string;
    cronExpression: string;
}

/** The template's variable names, from its declared names or its `{{…}}` placeholders. */
export function whatsAppVariableNames(template: WhatsAppTemplateDTO | null): string[] {
    if (!template) return [];
    if (template.bodyVariableNames?.length) return template.bodyVariableNames;
    const matches = (template.bodyText ?? '').match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
}

/** Media headers must carry a URL — Meta rejects the whole send without one. */
export function whatsAppHeaderKind(
    template: WhatsAppTemplateDTO | null
): 'image' | 'video' | 'document' | null {
    const raw = template?.headerType?.toUpperCase();
    if (raw === 'IMAGE') return 'image';
    if (raw === 'VIDEO') return 'video';
    if (raw === 'DOCUMENT') return 'document';
    return null;
}

/** Content that carries no words can still be a real announcement — a poster, a table, an embed. */
const hasNonTextContent = (html: string) =>
    /<(img|video|iframe|table|hr|embed|picture)\b/i.test(html);

function validateBasics(t: TFunction, input: ValidationInput): SectionValidation {
    const v = empty();
    if (!input.title.trim()) add(v, 'title', t('basics.title.required'));
    // Matches the backend's @Size(max = 500) so the user is stopped here rather than by a 400.
    else if (input.title.trim().length > 500) add(v, 'title', t('basics.title.tooLong'));
    if (!input.contentText.trim() && !hasNonTextContent(input.htmlContent))
        add(v, 'content', t('basics.content.required'));
    if (!input.previewText.trim()) {
        v.warnings.push(t('basics.previewText.missingWarning'));
    }
    return v;
}

/**
 * Exported on its own because the email-campaign page shares the audience builder and needs the
 * same rules without the rest of the announcement input.
 */
export function validateRecipients(
    t: TFunction,
    input: Pick<ValidationInput, 'rules' | 'batchById'>
): SectionValidation {
    const v = empty();
    if (input.rules.length === 0) {
        add(v, 'recipients', t('recipients.noAudience'));
        return v;
    }

    input.rules.forEach((rule, index) => {
        const label = t('recipients.audienceLabel', { index: index + 1 });
        const path = `rule.${rule.key}`;
        switch (rule.type) {
            case 'ROLE':
                if (!rule.roleId)
                    add(v, `${path}.role`, t('recipients.role.required', { label }));
                break;
            case 'PACKAGE_SESSION': {
                if (rule.packageSessionIds.length === 0) {
                    add(v, `${path}.batches`, t('recipients.batches.required', { label }));
                    break;
                }
                const needsRole = rule.packageSessionIds.some(
                    (id) => input.batchById[id]?.isOrgAssociated
                );
                if (needsRole && !rule.orgRole) {
                    add(v, `${path}.orgRole`, t('recipients.orgRole.required', { label }));
                }
                break;
            }
            case 'USER':
                if (rule.userIds.length === 0)
                    add(v, `${path}.users`, t('recipients.users.required', { label }));
                break;
            case 'TAG':
                if (rule.tagIds.length === 0)
                    add(v, `${path}.tags`, t('recipients.tags.required', { label }));
                break;
            case 'AUDIENCE':
                if (rule.campaignIds.length === 0)
                    add(v, `${path}.campaign`, t('recipients.campaign.required', { label }));
                break;
            case 'CUSTOM_FIELD_FILTER': {
                const complete = rule.fieldFilters.filter(
                    (f) =>
                        f.fieldId &&
                        (Array.isArray(f.filterValue) ? f.filterValue.length > 0 : !!f.filterValue)
                );
                if (complete.length === 0)
                    add(v, `${path}.filters`, t('recipients.filters.required', { label }));
                break;
            }
            default:
                break;
        }

        const halfFilledFilter = rule.fieldFilters.some(
            (f) =>
                (f.fieldId &&
                    (Array.isArray(f.filterValue) ? !f.filterValue.length : !f.filterValue)) ||
                (!f.fieldId &&
                    (Array.isArray(f.filterValue) ? f.filterValue.length : f.filterValue))
        );
        if (halfFilledFilter && rule.type !== 'CUSTOM_FIELD_FILTER') {
            v.warnings.push(t('recipients.incompleteFilterWarning', { label }));
        }
        if (rule.exclusions.some((e) => !e.exclusionId)) {
            v.warnings.push(t('recipients.emptyExclusionWarning', { label }));
        }
    });

    return v;
}

function validateModeSettings(
    t: TFunction,
    mode: ModeType,
    settings: ModeSettings,
    v: SectionValidation
): void {
    const path = `modes.${mode}`;
    switch (mode) {
        case 'SYSTEM_ALERT':
            if (!settings.priority) add(v, `${path}.priority`, t('placements.systemAlert.priority'));
            break;
        case 'DASHBOARD_PIN': {
            const start = (settings.pinStartTime as string) || '';
            const end = (settings.pinEndTime as string) || '';
            if (!settings.position)
                add(v, `${path}.position`, t('placements.dashboardPin.position'));
            if (!start) add(v, `${path}.pinStartTime`, t('placements.dashboardPin.startRequired'));
            if (!end) add(v, `${path}.pinEndTime`, t('placements.dashboardPin.endRequired'));
            if (start && end && new Date(start) >= new Date(end))
                add(v, `${path}.pinEndTime`, t('placements.dashboardPin.endAfterStart'));
            break;
        }
        case 'APP_OVERLAY': {
            const showUntil = (settings.showUntil as string) || '';
            if (showUntil) {
                const parsed = new Date(showUntil);
                if (Number.isNaN(parsed.getTime()))
                    add(v, `${path}.showUntil`, t('placements.appOverlay.invalidDate'));
                else if (parsed.getTime() <= Date.now())
                    add(v, `${path}.showUntil`, t('placements.appOverlay.mustBeFuture'));
            }
            const priority = Number(settings.priority ?? 1);
            if (!Number.isInteger(priority) || priority < 1 || priority > 10)
                add(v, `${path}.priority`, t('placements.appOverlay.priorityRange'));
            break;
        }
        case 'RESOURCES':
            if (!settings.folderName)
                add(v, `${path}.folderName`, t('placements.resources.folderNameRequired'));
            break;
        case 'COMMUNITY':
            if (!settings.communityType)
                add(v, `${path}.communityType`, t('placements.community.typeRequired'));
            break;
        case 'TASKS': {
            const slides = (settings.slideIds as string[] | undefined) ?? [];
            const goLive = (settings.goLiveDateTime as string) || '';
            const deadline = (settings.deadlineDateTime as string) || '';
            if (!settings.taskTitle)
                add(v, `${path}.taskTitle`, t('placements.tasks.titleRequired'));
            if (!slides.length) add(v, `${path}.slideIds`, t('placements.tasks.slidesRequired'));
            if (!goLive) add(v, `${path}.goLiveDateTime`, t('placements.tasks.goLiveRequired'));
            if (!deadline) add(v, `${path}.deadlineDateTime`, t('placements.tasks.deadlineRequired'));
            if (goLive && deadline && new Date(goLive) >= new Date(deadline))
                add(v, `${path}.deadlineDateTime`, t('placements.tasks.deadlineAfterGoLive'));
            break;
        }
        default:
            break;
    }
}

function validatePlacements(t: TFunction, input: ValidationInput): SectionValidation {
    const v = empty();
    if (input.modes.length === 0) {
        add(v, 'modes', t('placements.noneChosen'));
        return v;
    }
    input.modes.forEach((mode) =>
        validateModeSettings(t, mode, input.modeSettings[mode] ?? {}, v)
    );
    return v;
}

function validateDelivery(t: TFunction, input: ValidationInput): SectionValidation {
    const v = empty();

    if (input.mediums.length === 0) {
        v.warnings.push(t('delivery.noChannelWarning'));
    }

    if (input.mediums.includes('PUSH_NOTIFICATION')) {
        if (!input.push.title.trim()) add(v, 'push.title', t('delivery.push.titleRequired'));
        if (!input.push.body.trim()) add(v, 'push.body', t('delivery.push.bodyRequired'));
        if (input.push.title.length > 50) v.warnings.push(t('delivery.push.titleTruncated'));
        if (input.push.body.length > 150) v.warnings.push(t('delivery.push.bodyTruncated'));
    }

    if (input.mediums.includes('EMAIL')) {
        if (!input.hasEmailSenders) {
            add(v, 'email.from', t('delivery.email.noVerifiedSender'));
        } else if (!input.email.fromKey) {
            add(v, 'email.from', t('delivery.email.chooseSender'));
        }
    }

    if (input.mediums.includes('WHATSAPP')) {
        if (!input.whatsapp.templateName) {
            add(v, 'whatsapp.template', t('delivery.whatsapp.chooseTemplate'));
        } else if (!input.selectedWaTemplate) {
            add(v, 'whatsapp.template', t('delivery.whatsapp.templateNoLongerApproved'));
        } else {
            if (whatsAppHeaderKind(input.selectedWaTemplate) && !input.whatsapp.headerUrl.trim()) {
                add(v, 'whatsapp.headerUrl', t('delivery.whatsapp.mediaUrlRequired'));
            }
            whatsAppVariableNames(input.selectedWaTemplate).forEach((name) => {
                const binding = input.whatsapp.variables[name];
                if (!binding) {
                    add(
                        v,
                        `whatsapp.var.${name}`,
                        t('delivery.whatsapp.variableRequired', { name })
                    );
                } else if (binding.source === 'CUSTOM' && !binding.customValue.trim()) {
                    add(
                        v,
                        `whatsapp.var.${name}`,
                        t('delivery.whatsapp.variableCustomRequired', { name })
                    );
                }
            });
        }
    }

    if (input.scheduleType === 'ONE_TIME') {
        if (!input.oneTimeStart) {
            add(v, 'schedule.startDate', t('delivery.schedule.pickDateTime'));
        } else if (new Date(input.oneTimeStart).getTime() <= Date.now()) {
            v.warnings.push(t('delivery.schedule.pastTimeWarning'));
        }
    }
    if (input.scheduleType === 'RECURRING' && !input.cronExpression.trim()) {
        add(v, 'schedule.cronExpression', t('delivery.schedule.cronRequired'));
    }

    return v;
}

export function validateSection(
    step: FormSectionId,
    t: TFunction,
    input: ValidationInput
): SectionValidation {
    switch (step) {
        case 'basics':
            return validateBasics(t, input);
        case 'recipients':
            return validateRecipients(t, input);
        case 'placements':
            return validatePlacements(t, input);
        case 'delivery':
            return validateDelivery(t, input);
        case 'review': {
            const merged = empty();
            (['basics', 'recipients', 'placements', 'delivery'] as FormSectionId[]).forEach((s) => {
                const result = validateSection(s, t, input);
                Object.assign(merged.errors, result.errors);
                merged.blockers.push(...result.blockers);
                merged.warnings.push(...result.warnings);
            });
            return merged;
        }
        default:
            return empty();
    }
}

export function validateAll(
    t: TFunction,
    input: ValidationInput
): Record<FormSectionId, SectionValidation> {
    return {
        basics: validateSection('basics', t, input),
        recipients: validateSection('recipients', t, input),
        placements: validateSection('placements', t, input),
        delivery: validateSection('delivery', t, input),
        review: { errors: {}, blockers: [], warnings: [] },
    };
}

export function mergeErrors(map: Record<FormSectionId, SectionValidation>): FieldErrors {
    return Object.values(map).reduce<FieldErrors>(
        (acc, step) => Object.assign(acc, step.errors),
        {}
    );
}

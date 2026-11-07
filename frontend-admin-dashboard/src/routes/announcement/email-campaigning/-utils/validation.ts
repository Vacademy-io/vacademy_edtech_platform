import type { TFunction } from 'i18next';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import { validateRecipients } from '../../create/-utils/validation';
import type {
    BatchOption,
    EmailCampaignDraft,
    EmailSectionId,
    FieldErrors,
    SectionValidation,
} from '../-types';
import { EMAIL_SECTIONS } from '../-types';

/** Matches the backend's `@Size(max = 500)` on title, so the user is stopped here, not by a 400. */
export const TITLE_MAX = 500;
/** Inboxes truncate subjects well before this; the hard cap is only a sanity limit. */
export const SUBJECT_MAX = 255;
export const SUBJECT_SOFT_MAX = 78;
export const PREVIEW_SOFT_MAX = 150;

const empty = (): SectionValidation => ({ errors: {}, blockers: [], warnings: [] });

const add = (v: SectionValidation, path: string, message: string) => {
    v.errors[path] = message;
    v.blockers.push(message);
};

export const stripHtml = (html: string): string =>
    (html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/** An email that is only an image or a table is still a real email. */
const hasNonTextContent = (html: string) =>
    /<(img|video|iframe|table|hr|embed|picture)\b/i.test(html);

/**
 * Quartz cron: 6 or 7 whitespace-separated fields, and exactly one of day-of-month /
 * day-of-week must be `?`. A bad expression reaches Quartz as an unchecked exception and
 * surfaces as a 500, so it has to be caught here.
 */
export function isValidQuartzCron(expression: string): boolean {
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 6 || parts.length > 7) return false;
    if (!parts.every((p) => /^[-0-9A-Za-z*?,/#L]+$/.test(p))) return false;
    const dayOfMonth = parts[3] ?? '';
    const dayOfWeek = parts[5] ?? '';
    return (dayOfMonth === '?') !== (dayOfWeek === '?');
}

/** `datetime-local` gives a wall-clock literal; treat it as local time for the comparison. */
const isFuture = (local: string) => {
    const parsed = new Date(local);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
};

const isValidDate = (local: string) => !Number.isNaN(new Date(local).getTime());

export interface EmailValidationInput {
    draft: EmailCampaignDraft;
    batchById: Record<string, BatchOption>;
    senders: EmailConfiguration[];
    sendersLoaded: boolean;
}

export const senderKey = (sender: EmailConfiguration) => `${sender.email}-${sender.name}`;

function validateDetails(t: TFunction, { draft }: EmailValidationInput): SectionValidation {
    const v = empty();
    const title = draft.title.trim();
    const subject = draft.subject.trim();

    if (!title) add(v, 'title', t('validation.title.required'));
    else if (title.length > TITLE_MAX) add(v, 'title', t('validation.title.tooLong'));

    if (!subject) add(v, 'subject', t('validation.subject.required'));
    else if (subject.length > SUBJECT_MAX) add(v, 'subject', t('validation.subject.tooLong'));
    else if (subject.length > SUBJECT_SOFT_MAX)
        v.warnings.push(t('validation.subject.truncatedWarning'));

    if (!draft.previewText.trim()) v.warnings.push(t('validation.previewText.missingWarning'));
    else if (draft.previewText.length > PREVIEW_SOFT_MAX)
        v.warnings.push(t('validation.previewText.truncatedWarning'));

    return v;
}

function validateContent(t: TFunction, { draft }: EmailValidationInput): SectionValidation {
    const v = empty();
    if (!stripHtml(draft.htmlContent) && !hasNonTextContent(draft.htmlContent)) {
        add(v, 'content', t('validation.content.required'));
    }
    return v;
}

function validateSettings(t: TFunction, input: EmailValidationInput): SectionValidation {
    const v = empty();
    const { draft, senders, sendersLoaded } = input;

    if (sendersLoaded && senders.length === 0) {
        add(v, 'fromKey', t('validation.sender.noneConfigured'));
    } else if (!draft.fromKey) {
        add(v, 'fromKey', t('validation.sender.required'));
    } else if (sendersLoaded && !senders.some((s) => senderKey(s) === draft.fromKey)) {
        // Happens when editing a campaign whose sender was deleted since it was scheduled.
        add(v, 'fromKey', t('validation.sender.noLongerAvailable'));
    }

    if (!draft.priority) add(v, 'priority', t('validation.priority.required'));

    if (draft.expiresAt) {
        if (!isValidDate(draft.expiresAt)) add(v, 'expiresAt', t('validation.expiresAt.invalid'));
        else if (!isFuture(draft.expiresAt))
            add(v, 'expiresAt', t('validation.expiresAt.mustBeFuture'));
    }

    if (draft.scheduleType === 'ONE_TIME') {
        if (!draft.oneTimeStart) add(v, 'schedule.startDate', t('validation.schedule.pickTime'));
        else if (!isValidDate(draft.oneTimeStart))
            add(v, 'schedule.startDate', t('validation.schedule.invalidTime'));
        else if (!isFuture(draft.oneTimeStart))
            add(v, 'schedule.startDate', t('validation.schedule.mustBeFuture'));
    }

    if (draft.scheduleType === 'RECURRING') {
        const cron = draft.cronExpression.trim();
        if (!cron) add(v, 'schedule.cronExpression', t('validation.schedule.cronRequired'));
        else if (!isValidQuartzCron(cron))
            add(v, 'schedule.cronExpression', t('validation.schedule.cronInvalid'));
    }

    if (
        draft.expiresAt &&
        draft.scheduleType === 'ONE_TIME' &&
        draft.oneTimeStart &&
        isValidDate(draft.expiresAt) &&
        isValidDate(draft.oneTimeStart) &&
        new Date(draft.expiresAt).getTime() <= new Date(draft.oneTimeStart).getTime()
    ) {
        add(v, 'expiresAt', t('validation.expiresAt.beforeSend'));
    }

    return v;
}

/**
 * @param t            bound to `announcementEmailCampaigningIndex`
 * @param tRecipients  bound to `announcementValidation` (shared audience messages)
 */
export function validateEmailCampaign(
    t: TFunction,
    tRecipients: TFunction,
    input: EmailValidationInput
): Record<EmailSectionId, SectionValidation> {
    const audience = validateRecipients(tRecipients, {
        rules: input.draft.rules,
        batchById: input.batchById,
    });
    // The old email page sent a plain PACKAGE_SESSION for a sub-organisation batch when no role was
    // picked (everyone in the batch). Keep that possible here: advise, don't block.
    Object.keys(audience.errors)
        .filter((path) => path.endsWith('.orgRole'))
        .forEach((path) => {
            const message = audience.errors[path];
            delete audience.errors[path];
            audience.blockers = audience.blockers.filter((b) => b !== message);
            if (message) audience.warnings.push(message);
        });

    return {
        details: validateDetails(t, input),
        content: validateContent(t, input),
        audience,
        settings: validateSettings(t, input),
    };
}

export function mergeErrors(map: Record<EmailSectionId, SectionValidation>): FieldErrors {
    return EMAIL_SECTIONS.reduce<FieldErrors>(
        (acc, section) => Object.assign(acc, map[section].errors),
        {}
    );
}

export function collectBlockers(map: Record<EmailSectionId, SectionValidation>): string[] {
    return EMAIL_SECTIONS.flatMap((section) => map[section].blockers);
}

export function collectWarnings(map: Record<EmailSectionId, SectionValidation>): string[] {
    return EMAIL_SECTIONS.flatMap((section) => map[section].warnings);
}

export function firstInvalidSection(
    map: Record<EmailSectionId, SectionValidation>
): EmailSectionId | null {
    return EMAIL_SECTIONS.find((section) => map[section].blockers.length > 0) ?? null;
}

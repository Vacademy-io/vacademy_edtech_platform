/**
 * Shapes for the Email Campaigning page.
 *
 * The audience model (`AudienceRule` & friends) is shared with the Create Announcement page so
 * both screens use the same audience builder, validation and payload expansion.
 */
import type { AudienceRule, BatchOption, FieldErrors, SectionValidation } from '../create/-types';

export type { AudienceRule, BatchOption, FieldErrors, SectionValidation };

export type EmailPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export const EMAIL_PRIORITIES: EmailPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

export type ScheduleType = 'IMMEDIATE' | 'ONE_TIME' | 'RECURRING';

/** Page sections, in display order. Used for grouping errors and scroll targets — not a wizard. */
export type EmailSectionId = 'details' | 'content' | 'audience' | 'settings';
export const EMAIL_SECTIONS: EmailSectionId[] = ['details', 'content', 'audience', 'settings'];

/** Everything the user can edit, without any of the loaded lookups. */
export interface EmailCampaignDraft {
    title: string;
    subject: string;
    previewText: string;
    htmlContent: string;
    templateId: string;
    templateName: string;
    /** `${email}-${name}` of the chosen sender configuration. */
    fromKey: string;
    priority: EmailPriority;
    /** `datetime-local` literal or ''. */
    expiresAt: string;
    rules: AudienceRule[];
    scheduleType: ScheduleType;
    timezone: string;
    oneTimeStart: string;
    cronExpression: string;
}

/** Statuses the backend refuses to update (see AnnouncementService.updateAnnouncement). */
export const LOCKED_STATUSES = ['ACTIVE', 'INACTIVE', 'EXPIRED', 'REJECTED'] as const;

export interface PrefilledCampaign {
    draft: Partial<EmailCampaignDraft>;
    status: string | null;
}

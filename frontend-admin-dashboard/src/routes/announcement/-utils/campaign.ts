/**
 * Helpers shared by the schedule, history and email-campaign screens for the campaign actions
 * (edit, duplicate, recipient preview).
 */

/** Parts of a campaign the admin can carry over when duplicating it. */
export type DuplicatePart = 'recipients' | 'content' | 'settings';
export const DUPLICATE_PARTS: DuplicatePart[] = ['recipients', 'content', 'settings'];

/** `?keep=recipients,content` → the parts to copy. Missing means "everything". */
export function parseKeep(raw: string | undefined): DuplicatePart[] {
    if (raw === undefined) return [...DUPLICATE_PARTS];
    return raw
        .split(',')
        .map((part) => part.trim())
        .filter((part): part is DuplicatePart => (DUPLICATE_PARTS as string[]).includes(part));
}

/**
 * The Email Campaigning page can only round-trip announcements it would itself create: a
 * SYSTEM_ALERT mode plus the EMAIL medium. Saving anything else through it would silently drop
 * the other channels (its payload always sends exactly those two), so edit / duplicate is
 * offered only for these.
 */
export function isEmailCampaign(modeTypes: string[], mediumTypes: string[]): boolean {
    return (
        mediumTypes.length === 1 &&
        mediumTypes[0] === 'EMAIL' &&
        modeTypes.every((mode) => mode === 'SYSTEM_ALERT')
    );
}

/** Not yet delivered — a recipient preview of it shows who it is going to reach. */
export function isUndelivered(status: string | undefined): boolean {
    return !status || ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED'].includes(status);
}

/**
 * Mirrors the backend's update guard: not delivered yet, and the one-time send time (if any) is
 * still ahead. The server re-checks, so this only decides whether to offer Edit.
 */
export function isEditableBeforeSend(status: string | undefined, startDate?: string): boolean {
    if (!isUndelivered(status)) return false;
    if (!startDate) return true;
    const startMs = Date.parse(startDate);
    return Number.isNaN(startMs) || startMs > Date.now();
}

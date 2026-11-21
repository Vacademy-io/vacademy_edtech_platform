/**
 * Batch vs Individual selection on the assessment Submissions tab.
 *
 * The participants step records how the assessment was handed out
 * (pre_batch_registrations / pre_user_registrations). When only one mode has
 * learners the toggle is hidden, so the tab must START on that mode: snapping
 * to it after mount raced the mount fetch, and the empty Batch response could
 * land last and overwrite the Individual list (e.g. an API exam, whose
 * candidates are individual registrations only).
 */
export type SubmissionsSelectionMode = 'batch' | 'individual';

export const registrationSourceForMode = (mode: SubmissionsSelectionMode) =>
    mode === 'individual' ? 'ADMIN_PRE_REGISTRATION' : 'BATCH_PREVIEW_REGISTRATION';

/**
 * Mode the tab opens on. Individual only when the data positively says there
 * are no batch registrations but there are individual ones; anything else
 * (both, neither, unknown) keeps today's Batch default.
 */
export function initialSelectionMode(
    hasBatchRegistrations: boolean,
    hasIndividualRegistrations: boolean
): SubmissionsSelectionMode {
    return !hasBatchRegistrations && hasIndividualRegistrations ? 'individual' : 'batch';
}

/**
 * The mode to snap to when the current one positively has no learners and the
 * other one does, or null to stay. Never flips when both are empty (there is
 * nothing to show either way), so a fresh mount never triggers a second fetch.
 */
export function selectionModeCorrection(
    current: SubmissionsSelectionMode,
    hasBatchRegistrations: boolean,
    hasIndividualRegistrations: boolean
): SubmissionsSelectionMode | null {
    if (current === 'batch' && !hasBatchRegistrations && hasIndividualRegistrations) {
        return 'individual';
    }
    if (current === 'individual' && !hasIndividualRegistrations && hasBatchRegistrations) {
        return 'batch';
    }
    return null;
}

/**
 * Last-request-wins guard for the participants table. Several paths load it
 * (the mount fetch and the list mutation); a response may only replace the
 * table if no newer request was started after it.
 */
export function createLatestRequestGuard() {
    let latest = 0;
    return {
        begin: (): number => ++latest,
        isLatest: (token: number): boolean => token === latest,
    };
}

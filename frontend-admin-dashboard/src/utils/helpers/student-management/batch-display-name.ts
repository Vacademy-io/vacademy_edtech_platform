import type { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';

/**
 * Names that mean "this batch was never named", not a real title. An institute
 * migrated in bulk gets one of these on every session.
 */
const PLACEHOLDER_NAMES = new Set(['default', 'general']);

/**
 * The batch's OWN name, or '' when it has none worth showing.
 *
 * Callers compose their label as `getBatchOwnName(batch) || <their own fallback>`
 * so each screen keeps the wording it already had for institutes that never name
 * their batches, and only gains the real name where one exists.
 */
export const getBatchOwnName = (batch: BatchForSessionType | undefined): string => {
    const ownName = batch?.name?.trim() ?? '';
    return PLACEHOLDER_NAMES.has(ownName.toLowerCase()) ? '' : ownName;
};

/**
 * What to call a batch on screen: its own name, else level + course.
 *
 * Falling back to level + course unconditionally — which is what every caller
 * used to do — gives an institute whose levels are all named "default" the SAME
 * title for every batch of a course, with nothing to tell them apart, while
 * package_session.name held the real name all along.
 *
 * This mirrors the batchName CASE in
 * PackageSessionRepository.findBatchDetailsWithLatestInviteCode, so the Manage
 * Batches card and the learner list agree on one title per batch.
 */
export const getBatchDisplayName = (batch: BatchForSessionType | undefined): string => {
    if (!batch) return '';
    return (
        getBatchOwnName(batch) ||
        `${batch.level.level_name} ${batch.package_dto.package_name}`.trim()
    );
};

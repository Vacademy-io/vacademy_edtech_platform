import i18n from '@/i18n';
import type { AssignmentResult } from '../-types/mentorship-types';

const NAMESPACE = 'mentorshipAssignmentResult';

/**
 * Human summary of an assignment run. Every selected student must be accounted
 * for: assigned, skipped (already paired with that mentor), or blocked because the
 * mentor is at their mentee limit. Capacity is the newest of the three and the one
 * an admin can act on, so it always names the fix.
 *
 * Called from AssignMenteesDialog/BulkAssignDialog outside this batch, so it
 * reads strings from the i18n singleton rather than a threaded `t`.
 */
export function assignmentResultMessage(
    result: AssignmentResult,
    /** MANUAL wording says "already assigned"; round-robin says "skipped". */
    variant: 'manual' | 'bulk' = 'manual'
): string {
    const assigned = result.assigned ?? 0;
    const skipped = result.skipped ?? 0;
    const capacityFull = result.capacity_full ?? 0;

    const parts: string[] = [i18n.t('assigned', { ns: NAMESPACE, count: assigned })];
    if (skipped > 0) {
        parts.push(
            variant === 'manual'
                ? i18n.t('alreadyAssigned', { ns: NAMESPACE, count: skipped })
                : i18n.t('skipped', { ns: NAMESPACE, count: skipped })
        );
    }
    if (capacityFull > 0) {
        parts.push(
            variant === 'manual'
                ? i18n.t('leftOutManual', { ns: NAMESPACE, count: capacityFull })
                : i18n.t('leftOutBulk', { ns: NAMESPACE, count: capacityFull })
        );
    }
    return parts.join(', ');
}

/**
 * True when the run couldn't place everyone. The caller shows a warning toast
 * instead of a success one — "Assigned 0" is not a success.
 */
export function assignmentNeedsAttention(result: AssignmentResult): boolean {
    return (result.capacity_full ?? 0) > 0 || (result.assigned ?? 0) === 0;
}

import { StudentFilterRequest } from '@/types/student-table-types';

/**
 * Translates the UI's single-select learner-type pill into the payload shape the
 * backend actually reads.
 *
 * `StudentListFilter` (admin_core_service) exposes `types: List<String>` and
 * `type_ids`, and `InstituteStudentRepository` filters on `ssigm.type IN (:types)`.
 * It has no `type` field at all — so the singular `type` this UI used to send was
 * silently dropped by Jackson, and the Abandoned-Cart tab ended up narrowing only
 * by `destination_package_session_ids`. In production that returned 4,396 rows of
 * which just 693 were genuine abandoned carts; the rest were unrelated types,
 * stale DELETED carts and PAYMENT_FAILED rows.
 *
 * Applied at every call that posts a StudentFilterRequest (list + CSV export) so
 * the two can never disagree. The internal `type` field is kept as the UI's own
 * state so the filter pills and URL sync are untouched.
 */
export const normalizeStudentFilters = (filters: StudentFilterRequest): StudentFilterRequest => {
    const { type, ...rest } = filters;

    // Respect an explicit `types` array if a caller already set one.
    if (rest.types?.length) {
        return rest;
    }
    if (!type) {
        return rest;
    }
    return { ...rest, types: [type] };
};

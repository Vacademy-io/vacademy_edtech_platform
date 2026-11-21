/** Shown in place of a counsellor's name when only their id is known. */
export const UNNAMED_COUNSELLOR_LABEL = 'Assigned';

export interface CounsellorFields {
    assigned_counselor_id?: string | null;
    assigned_counselor_name?: string | null;
}

/**
 * Who owns this lead, as the UI should label it.
 *
 * The counsellor's name is a denormalised copy that admin_core writes onto the lead
 * profile at assignment time: admin_core cannot see auth_service's users table, so
 * that column is the only place inside its own database where a staff member's name
 * is recorded, and there is nothing to fall back to at read time.
 *
 * That makes a missing name a real possibility on a lead that is genuinely assigned.
 * Branching on the name alone then reads "no owner" and offers an Assign button —
 * which is worse than a vague label, because taking that offer rotates the lead away
 * from the counsellor already working it. The id is authoritative for *whether* the
 * lead is owned, so it decides; the name only decides what we can call them.
 *
 * @returns the counsellor's name, {@link UNNAMED_COUNSELLOR_LABEL} when only the id
 *          is known, or null when the lead really is unassigned.
 */
export function counsellorDisplayName(profile?: CounsellorFields | null): string | null {
    const name = profile?.assigned_counselor_name?.trim();
    if (name) return name;
    const id = profile?.assigned_counselor_id?.trim();
    if (id) return UNNAMED_COUNSELLOR_LABEL;
    return null;
}

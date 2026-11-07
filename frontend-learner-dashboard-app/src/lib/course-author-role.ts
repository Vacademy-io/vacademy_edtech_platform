/**
 * Per-course author role ("Author", "Instructor", "Acharya" …).
 *
 * The admin picks it for each author in Add Course; admin-core returns it as
 * `role_label` on every course instructor list (course-init, catalogue,
 * learner courses). It is the admin's own word, so it is shown as typed and
 * never translated. Absent = the institute's Teacher term, as before.
 */

/** The role on one instructor record, trimmed; undefined when none is set. */
export const authorRole = (
    inst: { role_label?: string | null } | null | undefined,
): string | undefined => inst?.role_label?.trim() || undefined;

/**
 * The word for a course's author list: the role every listed author shares
 * (one "Acharya" heading for two Acharyas), else `fallback`.
 */
export const sharedAuthorRole = (
    roles: ReadonlyArray<string | null | undefined>,
    fallback: string,
): string => {
    const set = roles.map((r) => r?.trim() || "");
    if (set.length === 0 || set.some((r) => !r)) return fallback;
    return new Set(set).size === 1 ? set[0] : fallback;
};

/** The role to print next to one author: only when the heading does not already say it. */
export const authorRoleTag = (
    role: string | null | undefined,
    heading: string,
): string | undefined => {
    const r = role?.trim();
    return r && r !== heading ? r : undefined;
};

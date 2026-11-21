/**
 * Which of the viewer's roles the dashboard header names, and how.
 *
 * The admin dashboard is a staff surface, so the learner roles are never the answer — a
 * user who is ADMIN and also enrolled as a STUDENT in the same institute used to see
 * "STUDENT" here because it happened to come first in the token.
 */
const NON_STAFF_ROLES = new Set(['STUDENT', 'LEARNER']);

/** ADMIN when held; otherwise the first staff role; null when there is none. */
export const pickDashboardRole = (roles: readonly string[]): string | null => {
    const staff = roles.filter((r) => r && !NON_STAFF_ROLES.has(r.trim().toUpperCase()));
    if (staff.some((r) => r.trim().toUpperCase() === 'ADMIN')) return 'ADMIN';
    return staff[0]?.trim() || null;
};

/** "COUNSELLOR" / "front_desk" → "Counsellor" / "Front Desk". */
export const titleCaseRole = (role: string): string =>
    role
        .trim()
        .toLowerCase()
        .split(/[\s_]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

/**
 * Display label for the viewer's dashboard role. `knownLabels` maps backend role enums to
 * terminology-aware labels (so an institute that renamed "Teacher" to "Faculty" sees
 * Faculty); any other (custom) role is title-cased rather than shown as a raw enum.
 */
export const resolveDashboardRoleLabel = (
    roles: readonly string[],
    knownLabels: Record<string, () => string>
): string | null => {
    const role = pickDashboardRole(roles);
    if (!role) return null;
    const known = knownLabels[role.toUpperCase()];
    return known ? known() : titleCaseRole(role);
};

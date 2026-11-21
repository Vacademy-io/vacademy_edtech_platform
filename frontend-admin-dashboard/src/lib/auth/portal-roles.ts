/**
 * Who may sign in to a white-label portal.
 *
 * A domain-routing row's `role` is a comma-separated list. Its LEARNER / ADMIN /
 * TEACHER entry says which portal the host is; every other entry is a role that
 * may log in there, ticked in Settings → White Label ("ADMIN,COUNSELLOR,TEACHER"
 * is an admin portal that also lets counsellors and teachers in).
 *
 * ADMIN is always admitted to a staff portal, so an institute admin can never
 * untick themselves out of their own portal.
 */

export type PortalType = 'LEARNER' | 'ADMIN' | 'TEACHER';

export const PORTAL_TYPES: readonly PortalType[] = ['LEARNER', 'ADMIN', 'TEACHER'];

/** Roles that mean "learner"; they never open a staff portal. */
const LEARNER_ROLE_NAMES = new Set(['LEARNER', 'STUDENT']);

/** Case- and spacing-insensitive form of a role name, as the server stores it. */
export const normalizeRoleName = (role: string): string =>
    role.trim().replace(/\s+/g, ' ').toUpperCase();

/** The distinct role names in a routing row's comma-separated `role`. */
export const parsePortalRoles = (role: string | null | undefined): string[] => {
    if (!role) return [];
    return [...new Set(role.split(',').map(normalizeRoleName).filter(Boolean))];
};

/** Which portal a row is: LEARNER, else ADMIN, else TEACHER; null for custom roles only. */
export const getPortalType = (role: string | null | undefined): PortalType | null => {
    const names = parsePortalRoles(role);
    return PORTAL_TYPES.find((p) => names.includes(p)) ?? null;
};

/**
 * The roles a portal admits, or null when it has no staff gate: no routing row,
 * or a learner row (an admin host that fell back to its domain's learner `*`
 * row is not a configured admin portal, and was never gated).
 */
export const getPortalAllowedRoles = (role: string | null | undefined): string[] | null => {
    if (getPortalType(role) === 'LEARNER') return null;
    const staff = parsePortalRoles(role).filter((r) => !LEARNER_ROLE_NAMES.has(r));
    if (staff.length === 0) return null;
    return staff.includes('ADMIN') ? staff : ['ADMIN', ...staff];
};

/**
 * The roles the admin app's login gate admits for this session's branding row,
 * or null for no gate.
 *
 * A native build that brands from one fixed row (the Vacademy Admin app, which
 * every institute's staff sign in to) is not that row's portal, so ticking roles
 * on the row in White Label must not decide who can use the app. It keeps the
 * rule it always had: only a row that is exactly `ADMIN` gates.
 */
export const getLoginGateRoles = (
    role: string | null | undefined,
    brandedByFixedFlavor: boolean
): string[] | null => {
    if (brandedByFixedFlavor) return role === 'ADMIN' ? ['ADMIN'] : null;
    return getPortalAllowedRoles(role);
};

/**
 * True when a user holding `userRoles` may sign in to a portal admitting
 * `allowed` (null = no gate).
 *
 * Role names compare case-insensitively, because the server stores the list
 * upper-cased while a custom role keeps the case it was created with
 * ("Operations"). The legacy `Admin` role (a 2024 row, not the real `ADMIN`)
 * keeps exactly the access it had before role lists were enforced: refused by
 * an ADMIN-only portal — which always compared case-sensitively — and let in
 * everywhere else, where no list used to be checked.
 */
export const portalAdmitsRoles = (allowed: string[] | null, userRoles: string[]): boolean => {
    if (!allowed) return true;
    const adminOnly = allowed.length === 1 && allowed[0] === 'ADMIN';
    const held = new Set(
        userRoles
            .filter((r) => !adminOnly || r === 'ADMIN' || normalizeRoleName(r) !== 'ADMIN')
            .map(normalizeRoleName)
    );
    return allowed.some((r) => held.has(r));
};

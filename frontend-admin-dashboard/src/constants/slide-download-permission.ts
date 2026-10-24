/**
 * Shared types, keys, defaults and resolver for the per-role, per-slide-type
 * download-permission setting (stored under
 * `institutes.setting_json → setting.SLIDE_DOWNLOAD_PERMISSION_SETTING.data`).
 *
 * Used by the admin Settings tab (to configure). The learner app keeps an
 * equivalent copy and is where the setting is enforced (it is the
 * content-consumption surface the admin is configuring "for the learner and
 * other roles' ends"). The admin authoring tool's own download buttons are
 * intentionally NOT gated by this setting.
 *
 * Enforcement is best-effort, client-side: it hides our own download controls.
 * It does NOT prevent a determined user from fetching a public/signed file URL.
 */

export const SLIDE_DOWNLOAD_PERMISSION_SETTING_KEY = 'SLIDE_DOWNLOAD_PERMISSION_SETTING';

/** Canonical role keys used as stored map keys / grid columns. */
export const ADMIN_ROLE_KEY = 'ADMIN';
export const TEACHER_ROLE_KEY = 'TEACHER';
export const LEARNER_ROLE_KEY = 'LEARNER';

/**
 * Token role-name aliases → canonical key. The platform's learner role is
 * emitted as "STUDENT" in access tokens, but we present/store it as "LEARNER".
 */
const ROLE_ALIASES: Record<string, string> = {
    STUDENT: LEARNER_ROLE_KEY,
};

/** Normalize a raw role name (token or custom) to its canonical stored key. */
export const normalizeRoleKey = (role: string | null | undefined): string => {
    const upper = (role ?? '').toUpperCase().trim();
    return ROLE_ALIASES[upper] ?? upper;
};

/**
 * Known roles, most privileged first. Access resolves against the single
 * highest-precedence role a user holds.
 */
export const ROLE_PRECEDENCE: string[] = [ADMIN_ROLE_KEY, TEACHER_ROLE_KEY, LEARNER_ROLE_KEY];

/**
 * Collapse the roles a user holds down to the ONE that decides their access.
 *
 * Users routinely hold more than one role — on this platform an admin or a
 * teacher is very often also enrolled as a STUDENT (→ LEARNER). Combining the
 * roles instead of ranking them made the LEARNER row veto everything, so an
 * admin's own ADMIN column had no effect on their access. Highest role wins:
 * ADMIN beats TEACHER beats LEARNER.
 *
 * Returns null when the user holds none of the three known roles (custom roles
 * only), in which case callers keep the previous combine-all behavior so a
 * custom role's configured value is still honored.
 */
export const effectiveRoleKey = (roleNames: string[] | null | undefined): string | null => {
    const held = new Set((roleNames ?? []).map(normalizeRoleKey).filter(Boolean));
    return ROLE_PRECEDENCE.find((role) => held.has(role)) ?? null;
};

export interface SlideTypeOption {
    /** Stored key (also the enforcement key the slide components pass in). */
    key: string;
    /** Human label shown as the grid row header. */
    label: string;
}

/**
 * The slide types exposed as rows — limited to those that have a real,
 * client-side-controllable download in the learner app (our own button or an
 * HTML5 control we render). Other types either render read-only (plain
 * documents, presentations), only "open" externally (Jupyter/Scratch), or have
 * no download control at all (audio), so a toggle would be a no-op. DOCUMENT is
 * split into sub-types because each has a different download mechanism.
 */
export const SLIDE_TYPE_OPTIONS: SlideTypeOption[] = [
    { key: 'DOCUMENT_PDF', label: 'PDF — Download' },
    { key: 'DOCUMENT_PDF_PRINT', label: 'PDF — Print' },
    { key: 'DOCUMENT_CODE', label: 'Code' },
    { key: 'ASSIGNMENT', label: 'Assignment' },
    { key: 'VIDEO', label: 'Video' },
    { key: 'DOCUMENT_DOC', label: 'Document (Docs)' },
    { key: 'AUDIO', label: 'Audio' },
    { key: 'IMAGE', label: 'Images (in Docs)' },
];

/**
 * Default download ability when the setting is absent / a cell is unconfigured.
 * Defaults are chosen to preserve today's behavior so existing institutes are
 * unchanged, and are role-aware because the same role's current behavior
 * differs between the authoring app and the learner app:
 *
 *  - ADMIN_DEFAULT_DOWNLOAD mirrors what an admin can download today.
 *  - LEARNER_DEFAULT_DOWNLOAD mirrors what a learner / other consuming role can
 *    download in the learner app today (e.g. the PDF toolbar already hides
 *    Download, so PDF defaults to false there).
 */
export const ADMIN_DEFAULT_DOWNLOAD: Record<string, boolean> = {
    DOCUMENT_PDF: true,
    DOCUMENT_PDF_PRINT: true,
    // Docs, Audio and Image downloads are off for every role until Content Protection
    // switches them on (no screen offered them before the learner Download button).
    DOCUMENT_DOC: false,
    DOCUMENT_PRESENTATION: true,
    DOCUMENT_CODE: true,
    DOCUMENT_JUPYTER: true,
    DOCUMENT_SCRATCH: true,
    VIDEO: false,
    AUDIO: false,
    IMAGE: false,
    ASSIGNMENT: true,
    QUESTION: true,
};

export const LEARNER_DEFAULT_DOWNLOAD: Record<string, boolean> = {
    DOCUMENT_PDF: false,
    DOCUMENT_PDF_PRINT: false,
    DOCUMENT_DOC: false,
    DOCUMENT_PRESENTATION: false,
    DOCUMENT_CODE: true,
    DOCUMENT_JUPYTER: false,
    DOCUMENT_SCRATCH: false,
    VIDEO: false,
    AUDIO: false,
    IMAGE: false,
    ASSIGNMENT: true,
    QUESTION: true,
};

/** Default download ability for a (role, slide-type) when unconfigured. */
export const defaultDownloadFor = (roleKey: string, typeKey: string): boolean => {
    if (normalizeRoleKey(roleKey) === ADMIN_ROLE_KEY) {
        return ADMIN_DEFAULT_DOWNLOAD[typeKey] ?? true;
    }
    return LEARNER_DEFAULT_DOWNLOAD[typeKey] ?? true;
};

export interface SlideDownloadRoleMap {
    [roleKey: string]: boolean;
}

export interface SlideDownloadSlideTypeConfig {
    roles: SlideDownloadRoleMap;
}

export interface SlideDownloadPermissionData {
    version: number;
    slideTypes: Record<string, SlideDownloadSlideTypeConfig>;
}

export const EMPTY_SLIDE_DOWNLOAD_DATA: SlideDownloadPermissionData = {
    version: 1,
    slideTypes: {},
};

/**
 * Decide whether the current user may download a given slide type (learner app).
 *
 * Highest role wins (ADMIN > TEACHER > LEARNER): the permission is read from
 * the single most privileged role the user holds, so an admin or teacher who is
 * also enrolled as a student is resolved by their staff row, not the LEARNER
 * one. A role's effective flag is its stored value, or the role-aware default
 * when unconfigured. Users holding only custom roles keep the deny-wins combine
 * so their configured values are still honored. With no roles at all, falls
 * back to the learner default (i.e. today's learner behavior).
 *
 * @param data       parsed setting data (or null when unset)
 * @param typeKey    one of SLIDE_TYPE_OPTIONS[].key
 * @param roleNames  the user's raw role names (e.g. ["STUDENT"]); normalized here
 */
export const canDownloadSlideType = (
    data: SlideDownloadPermissionData | null | undefined,
    typeKey: string,
    roleNames: string[] | null | undefined
): boolean => {
    const canonicalRoles = (roleNames ?? []).map(normalizeRoleKey).filter(Boolean);
    if (canonicalRoles.length === 0) {
        return LEARNER_DEFAULT_DOWNLOAD[typeKey] ?? true;
    }
    const roleMap = data?.slideTypes?.[typeKey]?.roles;
    const effectiveRole = effectiveRoleKey(canonicalRoles);
    if (effectiveRole) {
        return roleMap?.[effectiveRole] ?? defaultDownloadFor(effectiveRole, typeKey);
    }
    return canonicalRoles.every(
        (role) => roleMap?.[role] ?? defaultDownloadFor(role, typeKey)
    );
};

/**
 * Decide whether the current user may download/print in the ADMIN authoring app.
 *
 * Default-allow, deny-on-explicit-false: in the authoring app everyone can
 * download today, so we only block a user when their role is EXPLICITLY turned
 * off for that type. Highest role wins (ADMIN > TEACHER > LEARNER), so an admin
 * who is also enrolled as a student is judged on the ADMIN cell. This preserves
 * admins' (and unconfigured roles') existing access while letting an admin
 * block, say, teachers.
 */
export const canRoleDownloadInAdmin = (
    data: SlideDownloadPermissionData | null | undefined,
    typeKey: string,
    roleNames: string[] | null | undefined
): boolean => {
    const canonicalRoles = (roleNames ?? []).map(normalizeRoleKey).filter(Boolean);
    if (canonicalRoles.length === 0) return true;
    const roleMap = data?.slideTypes?.[typeKey]?.roles;
    if (!roleMap) return true;
    const effectiveRole = effectiveRoleKey(canonicalRoles);
    if (effectiveRole) return roleMap[effectiveRole] !== false;
    return canonicalRoles.every((role) => roleMap[role] !== false);
};

/**
 * Resolve PDF *print* permission in the admin app. If print is not explicitly
 * configured for the user's role, it INHERITS the PDF *download* permission
 * ("can't download ⇒ can't print" by default). This also covers institutes that
 * saved a download restriction before the separate Print toggle existed. Once an
 * admin explicitly toggles Print for the role, that value takes over.
 */
export const canRolePrintPdfInAdmin = (
    data: SlideDownloadPermissionData | null | undefined,
    roleNames: string[] | null | undefined
): boolean => {
    const roles = (roleNames ?? []).map(normalizeRoleKey).filter(Boolean);
    const printMap = data?.slideTypes?.['DOCUMENT_PDF_PRINT']?.roles;
    // Only the role that actually decides access counts as "explicitly
    // configured" — otherwise a LEARNER print cell would hijack an admin.
    const effectiveRole = effectiveRoleKey(roles);
    const decidingRoles = effectiveRole ? [effectiveRole] : roles;
    const hasExplicitPrint =
        !!printMap && decidingRoles.some((role) => typeof printMap[role] === 'boolean');
    return canRoleDownloadInAdmin(
        data,
        hasExplicitPrint ? 'DOCUMENT_PDF_PRINT' : 'DOCUMENT_PDF',
        roleNames
    );
};

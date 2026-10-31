/**
 * Per-role, per-slide-type download-permission setting — learner-app copy.
 *
 * Mirrors the admin app's `@/constants/slide-download-permission`. The admin
 * Settings tab writes this blob (stored under
 * `institutes.setting_json → setting.SLIDE_DOWNLOAD_PERMISSION_SETTING.data`);
 * the learner app reads it to decide whether to render each slide's download
 * control. Enforcement is best-effort, client-side — it hides our own controls,
 * it does NOT prevent fetching a public/signed file URL.
 */

export const SLIDE_DOWNLOAD_PERMISSION_SETTING_KEY = "SLIDE_DOWNLOAD_PERMISSION_SETTING";

export const ADMIN_ROLE_KEY = "ADMIN";
export const TEACHER_ROLE_KEY = "TEACHER";
export const LEARNER_ROLE_KEY = "LEARNER";

// The platform's learner role is emitted as "STUDENT" in access tokens but is
// stored/presented as "LEARNER".
const ROLE_ALIASES: Record<string, string> = {
  STUDENT: LEARNER_ROLE_KEY,
};

export const normalizeRoleKey = (role: string | null | undefined): string => {
  const upper = (role ?? "").toUpperCase().trim();
  return ROLE_ALIASES[upper] ?? upper;
};

/** Known roles, most privileged first. */
export const ROLE_PRECEDENCE: string[] = [ADMIN_ROLE_KEY, TEACHER_ROLE_KEY, LEARNER_ROLE_KEY];

/**
 * Collapse the roles a user holds down to the ONE that decides their access.
 *
 * Admins and teachers on this platform are very often also enrolled as a
 * STUDENT (→ LEARNER). Combining roles let that LEARNER row veto everything, so
 * the ADMIN/TEACHER columns had no effect on staff. Highest role wins: ADMIN >
 * TEACHER > LEARNER. Returns null for users holding only custom roles, where
 * callers keep the previous combine-all behavior.
 */
export const effectiveRoleKey = (roleNames: string[] | null | undefined): string | null => {
  const held = new Set((roleNames ?? []).map(normalizeRoleKey).filter(Boolean));
  return ROLE_PRECEDENCE.find((role) => held.has(role)) ?? null;
};

/** Slide-type keys the learner components pass into the resolver. */
export const SlideDownloadTypeKey = {
  DOCUMENT_PDF: "DOCUMENT_PDF",
  DOCUMENT_PDF_PRINT: "DOCUMENT_PDF_PRINT",
  DOCUMENT_DOC: "DOCUMENT_DOC",
  DOCUMENT_PRESENTATION: "DOCUMENT_PRESENTATION",
  DOCUMENT_CODE: "DOCUMENT_CODE",
  DOCUMENT_JUPYTER: "DOCUMENT_JUPYTER",
  DOCUMENT_SCRATCH: "DOCUMENT_SCRATCH",
  VIDEO: "VIDEO",
  AUDIO: "AUDIO",
  IMAGE: "IMAGE",
  ASSIGNMENT: "ASSIGNMENT",
  QUESTION: "QUESTION",
} as const;

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

// Mirrors what a learner / other consuming role can download in the learner app
// today, so an absent setting keeps current behavior (e.g. the PDF toolbar
// already hides Download/Print → false).
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

/**
 * Decide whether the current user may download a given slide type.
 * Highest role wins (ADMIN > TEACHER > LEARNER): the permission comes from the
 * single most privileged role held, so staff who are also enrolled as students
 * are resolved by their staff row. Unconfigured cells use the role-aware
 * default. Users holding only custom roles keep the deny-wins combine. With no
 * roles at all, falls back to the learner default.
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
 * Resolve PDF *print* permission. If print is not explicitly configured for the
 * user's role, it INHERITS the PDF *download* permission ("can't download ⇒
 * can't print" by default). Once print is explicitly configured, it takes over.
 */
export const canPrintPdfSlide = (
  data: SlideDownloadPermissionData | null | undefined,
  roleNames: string[] | null | undefined
): boolean => {
  const roles = (roleNames ?? []).map(normalizeRoleKey).filter(Boolean);
  const printMap = data?.slideTypes?.["DOCUMENT_PDF_PRINT"]?.roles;
  // Only the role that actually decides access counts as "explicitly
  // configured" — otherwise a LEARNER print cell would hijack an admin.
  const effectiveRole = effectiveRoleKey(roles);
  const decidingRoles = effectiveRole ? [effectiveRole] : roles;
  const hasExplicitPrint =
    !!printMap && decidingRoles.some((role) => typeof printMap[role] === "boolean");
  return canDownloadSlideType(
    data,
    hasExplicitPrint ? "DOCUMENT_PDF_PRINT" : "DOCUMENT_PDF",
    roleNames
  );
};

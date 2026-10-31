import axios from "axios";
import {
  ENROLLMENT_INVITE_URL,
  GET_PRODUCT_PAGE_BY_CODE,
  urlCourseDetails,
} from "@/constants/urls";

/**
 * A course's VERSIONS for the public course page — one per package session
 * (a level of a session: "Hindi", "English", "Beginner Hindi"…), each with the
 * invite and price a visitor would enrol through.
 *
 * course-init, which the page already loads, lists the course's package
 * sessions but carries no invite and no price, so the page could only ever
 * show the one version its URL named. The versions come from:
 *
 *   - the public catalogue search (open v2 search, `package_ids: [courseId]`)
 *     for an ordinary visit — the same rows, invites and prices the Courses
 *     page cards are built from. Older backends ignore `package_ids` and send
 *     the whole catalogue, so rows are ALSO filtered here by package id;
 *   - the product page's own mappings when the visit came from a product page
 *     (`?productPageCode=`), so such a visit keeps that page's invite and price.
 *
 * Duration and authors are merged in from course-init (matched by session +
 * level), the way the page has always read them.
 */

/** One language/level version of a course. */
export interface CourseLevel {
  packageSessionId: string;
  levelId: string | null;
  levelName: string | null;
  sessionId: string | null;
  sessionName: string | null;
  /** The invite enrolment goes through; null = the version cannot be enrolled in here. */
  enrollInviteId: string | null;
  price: number | null;
  elevatedPrice: number | null;
  currency: string | null;
  /** Server-computed invite availability (AVAILABLE / EXPIRED / NOT_STARTED / INACTIVE). */
  availability: string | null;
  availableSlots: number | null;
  /** Total read time of this version's content (course-init, else the search row). */
  durationMinutes: number | null;
  /** This version's faculty as UserDTOs (course-init, else the search row). */
  instructors: unknown[] | null;
  /** Where the version came from. */
  source: "catalogue" | "productPage";
}

/* ── raw shapes (snake_case, as the open APIs send them) ─────────────── */

/** One open v2 search row (PackageDetailV2DTO). `id` is the package id. */
export interface CatalogueSearchRow {
  id?: string | null;
  package_id?: string | null;
  package_session_id?: string | null;
  level_id?: string | null;
  level_name?: string | null;
  session_id?: string | null;
  session_name?: string | null;
  enroll_invite_id?: string | null;
  min_plan_actual_price?: number | null;
  min_plan_elevated_price?: number | null;
  currency?: string | null;
  enroll_invite_availability?: string | null;
  available_slots?: number | null;
  read_time_in_minutes?: number | null;
  instructors?: unknown[] | null;
}

/** One product page mapping (ProductPageInviteMappingResponse). */
export interface ProductPageMappingRow {
  package_id?: string | null;
  package_session_id?: string | null;
  enroll_invite_id?: string | null;
  level_name?: string | null;
  session_name?: string | null;
  status?: string | null;
  display_order?: number | null;
  payment_plan?: {
    actual_price?: number | null;
    elevated_price?: number | null;
    currency?: string | null;
  } | null;
}

/** The parts of the course-init response the merge reads. */
export interface CourseInitLike {
  sessions?: Array<{
    session_dto?: { id?: string | null; session_name?: string | null } | null;
    level_with_details?: Array<{
      id?: string | null;
      name?: string | null;
      read_time_in_minutes?: number | null;
      instructors?: unknown[] | null;
    }> | null;
  }> | null;
  package_sessions?: Array<{
    id?: string | null;
    level?: { id?: string | null; level_name?: string | null } | null;
    session?: { id?: string | null; session_name?: string | null } | null;
  }> | null;
}

export interface OpenInvitePaymentPlan {
  id?: string;
  name?: string;
  actual_price?: number | null;
  elevated_price?: number | null;
  currency?: string | null;
  tag?: string | null;
}

export interface OpenInvitePaymentEntry {
  package_session_id?: string | null;
  enroll_invite_id?: string | null;
  status?: string | null;
  payment_option?: { id?: string; payment_plans?: OpenInvitePaymentPlan[] | null } | null;
}

/** The open enroll-invite response (only what the course page reads). */
export interface OpenEnrollInvite {
  id?: string;
  name?: string;
  availability_status?: string | null;
  setting_json?: string | null;
  package_session_to_payment_options?: OpenInvitePaymentEntry[] | null;
}

/* ── pure mapping ─────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isActive = (status: unknown) => !status || String(status).toUpperCase() === "ACTIVE";

/**
 * Catalogue search rows → this course's versions. Rows of other courses are
 * dropped (a backend that ignores `package_ids` returns every course), and a
 * package session listed twice keeps its first row.
 */
export const mapCatalogueRows = (rows: unknown, courseId: string): CourseLevel[] => {
  if (!Array.isArray(rows) || !courseId) return [];
  const seen = new Set<string>();
  const out: CourseLevel[] = [];
  for (const raw of rows as CatalogueSearchRow[]) {
    if (!raw || typeof raw !== "object") continue;
    const packageId = str(raw.package_id) ?? str(raw.id);
    const psId = str(raw.package_session_id);
    if (packageId !== courseId || !psId || seen.has(psId)) continue;
    seen.add(psId);
    out.push({
      packageSessionId: psId,
      levelId: str(raw.level_id),
      levelName: str(raw.level_name),
      sessionId: str(raw.session_id),
      sessionName: str(raw.session_name),
      enrollInviteId: str(raw.enroll_invite_id),
      price: num(raw.min_plan_actual_price),
      elevatedPrice: num(raw.min_plan_elevated_price),
      currency: str(raw.currency),
      availability: str(raw.enroll_invite_availability),
      availableSlots: num(raw.available_slots),
      durationMinutes: num(raw.read_time_in_minutes),
      instructors: Array.isArray(raw.instructors) ? raw.instructors : null,
      source: "catalogue",
    });
  }
  return out;
};

/**
 * A product page's mappings → this course's versions, in the page's own
 * order. Inactive mappings are skipped; when a package session is mapped more
 * than once (several plans), the first in display order wins — the same one
 * the product page lists first.
 */
export const mapProductPageMappings = (mappings: unknown, courseId: string): CourseLevel[] => {
  if (!Array.isArray(mappings) || !courseId) return [];
  const ordered = (mappings as ProductPageMappingRow[])
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m && typeof m === "object" && isActive(m.status) && str(m.package_id) === courseId)
    .sort((a, b) => (num(a.m.display_order) ?? 0) - (num(b.m.display_order) ?? 0) || a.index - b.index);
  const seen = new Set<string>();
  const out: CourseLevel[] = [];
  for (const { m } of ordered) {
    const psId = str(m.package_session_id);
    if (!psId || seen.has(psId)) continue;
    seen.add(psId);
    out.push({
      packageSessionId: psId,
      levelId: null,
      levelName: str(m.level_name),
      sessionId: null,
      sessionName: str(m.session_name),
      enrollInviteId: str(m.enroll_invite_id),
      price: num(m.payment_plan?.actual_price),
      elevatedPrice: num(m.payment_plan?.elevated_price),
      currency: str(m.payment_plan?.currency),
      availability: null,
      availableSlots: null,
      durationMinutes: null,
      instructors: null,
      source: "productPage",
    });
  }
  return out;
};

/**
 * Fills each version's level/session ids from course-init's package_sessions
 * and its duration + authors from the matching sessions[].level_with_details
 * entry. Values the version already carries are only overridden by
 * course-init's authors and read time, which is what the page has always shown.
 */
export const mergeCourseInit = (levels: CourseLevel[], init: CourseInitLike | null | undefined): CourseLevel[] => {
  if (!init) return levels;
  const packageSessions = Array.isArray(init.package_sessions) ? init.package_sessions : [];
  const sessions = Array.isArray(init.sessions) ? init.sessions : [];
  return levels.map((level) => {
    const ps = packageSessions.find((p) => p?.id === level.packageSessionId);
    const levelId = level.levelId ?? str(ps?.level?.id);
    const sessionId = level.sessionId ?? str(ps?.session?.id);
    const session = sessionId ? sessions.find((s) => s?.session_dto?.id === sessionId) : undefined;
    const details =
      levelId && Array.isArray(session?.level_with_details)
        ? session!.level_with_details!.find((l) => l?.id === levelId)
        : undefined;
    const initInstructors = Array.isArray(details?.instructors) ? details!.instructors! : null;
    return {
      ...level,
      levelId,
      sessionId,
      levelName: level.levelName ?? str(ps?.level?.level_name) ?? str(details?.name),
      sessionName: level.sessionName ?? str(ps?.session?.session_name) ?? str(session?.session_dto?.session_name),
      durationMinutes: num(details?.read_time_in_minutes) ?? level.durationMinutes,
      // course-init's authors, else the row's; a version course-init knows
      // with no faculty at all ends up with [] (known: none), not null.
      instructors: initInstructors?.length
        ? initInstructors
        : level.instructors?.length
          ? level.instructors
          : (initInstructors ?? level.instructors),
    };
  });
};

/**
 * The invite's payment entry for one package session. An invite can sell
 * several package sessions (one Hindi + English invite); taking entry [0]
 * could enrol the visitor in the wrong version. Falls back to [0] when the
 * package session is not listed, which is exactly the previous behaviour.
 */
export const invitePaymentEntryFor = <E extends { package_session_id?: string | null; status?: string | null }>(
  invite: { package_session_to_payment_options?: E[] | null } | null | undefined,
  packageSessionId: string | null | undefined,
): E | undefined => {
  const entries = invite?.package_session_to_payment_options;
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  if (packageSessionId) {
    const matches = entries.filter((e) => e && e.package_session_id === packageSessionId);
    const match = matches.find((e) => isActive(e.status)) ?? matches[0];
    if (match) return match;
  }
  return entries[0];
};

/** Package sessions an invite sells — resolves "?enrollInviteId's level" for a non-default invite. */
export const invitePackageSessionIds = (invite: OpenEnrollInvite | null | undefined): string[] =>
  (invite?.package_session_to_payment_options ?? [])
    .map((e) => str(e?.package_session_id))
    .filter((id): id is string => !!id);

/* ── network (short in-memory cache: a version switch must not refetch) ── */

const CACHE_TTL_MS = 60_000;
/** A visitor browsing course after course never holds more than this many entries. */
const CACHE_MAX_ENTRIES = 40;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Stores an entry, dropping expired ones and, past the cap, the oldest. */
const store = (key: string, value: Promise<unknown>) => {
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now - entry.at >= CACHE_TTL_MS) cache.delete(k);
  }
  cache.delete(key); // re-inserted last: Map order is insertion order
  cache.set(key, { at: now, value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw err;
  });
  store(key, value);
  return value;
};

/** Number of cached entries (tests). */
export const courseLevelsCacheSize = () => cache.size;

const inviteKey = (instituteId: string, inviteId: string) => `invite:${instituteId}:${inviteId}`;
const productPageKey = (instituteId: string, code: string) => `product-page:${instituteId}:${code}`;

/** The open enroll-invite (price plans, availability, setting_json). */
export const getOpenEnrollInvite = (instituteId: string, enrollInviteId: string): Promise<OpenEnrollInvite> =>
  cached(inviteKey(instituteId, enrollInviteId), async () => {
    const res = await axios.get(`${ENROLLMENT_INVITE_URL}/${instituteId}/${enrollInviteId}`, {
      headers: { "Content-Type": "application/json" },
    });
    return (res.data ?? {}) as OpenEnrollInvite;
  });

/** Records an invite the page already fetched, so the version layer reuses it. */
export const primeOpenEnrollInvite = (instituteId: string, enrollInviteId: string, data: unknown) => {
  if (!instituteId || !enrollInviteId || !data) return;
  store(inviteKey(instituteId, enrollInviteId), Promise.resolve(data));
};

/** Records a product page (by code) the page already fetched. */
export const primeProductPage = (instituteId: string, code: string, data: unknown) => {
  if (!instituteId || !code || !data) return;
  store(productPageKey(instituteId, code), Promise.resolve(data));
};

/**
 * The course's rows from the open catalogue search. Only the mapped versions
 * are cached: a backend that ignores `package_ids` answers with the whole
 * catalogue, which is not worth keeping per course.
 */
export const fetchCatalogueCourseLevels = (instituteId: string, courseId: string): Promise<CourseLevel[]> =>
  cached(`catalogue:${instituteId}:${courseId}`, async () => {
    const res = await axios.post(
      urlCourseDetails,
      {
        status: [],
        level_ids: [],
        faculty_ids: [],
        search_by_name: "",
        tag: [],
        min_percentage_completed: 0,
        max_percentage_completed: 0,
        // Honoured by newer backends; older ones return every course, which
        // mapCatalogueRows filters down to this one.
        package_ids: [courseId],
      },
      {
        params: { instituteId, page: 0, size: 1000, sort: "createdAt,desc" },
        headers: { "Content-Type": "application/json" },
      },
    );
    const data = (res as { data?: unknown }).data as { content?: unknown } | unknown[] | undefined;
    const rows = Array.isArray(data) ? data : (data as { content?: unknown } | undefined)?.content;
    return mapCatalogueRows(rows, courseId);
  });

/** The course's versions as a product page sells them. */
export const fetchProductPageCourseLevels = async (
  instituteId: string,
  productPageCode: string,
  courseId: string,
): Promise<CourseLevel[]> => {
  const page = await cached(productPageKey(instituteId, productPageCode), async () => {
    const res = await axios.get(GET_PRODUCT_PAGE_BY_CODE(productPageCode, instituteId));
    return res.data as unknown;
  });
  return mapProductPageMappings((page as { mappings?: unknown } | null)?.mappings, courseId);
};

/**
 * Every version of the course (merge with course-init via mergeCourseInit). A
 * product page visit reads that page's mappings; anything else reads the
 * public catalogue.
 */
export const fetchCourseLevels = async (opts: {
  instituteId: string;
  courseId: string;
  productPageCode?: string | null;
}): Promise<CourseLevel[]> =>
  opts.productPageCode
    ? fetchProductPageCourseLevels(opts.instituteId, opts.productPageCode, opts.courseId)
    : fetchCatalogueCourseLevels(opts.instituteId, opts.courseId);

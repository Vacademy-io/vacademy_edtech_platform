/**
 * What a course opens when a visitor clicks "View course".
 *
 * By default every course card opens the shared course details page at
 * `/<tag>/<courseId>` (CourseDetailsPage), which renders the same layout for
 * every course off the package record: a marketing highlights accordion, then
 * the syllabus, then a price/enrol sidebar. Institutes do not all sell the same
 * way, so a catalogue can pick a different view per course:
 *
 *   globalSettings.coursePages = {
 *     enabled: true,
 *     courses: {
 *       "<package id>":         { mode: "PAGE", route: "toddler" },
 *       "<package session id>": { mode: "OUTLINE" }
 *     }
 *   }
 *
 * - DETAILS — the standard details page. The default, and what any course
 *   left out of `courses` keeps, so turning the setting on changes nothing
 *   until a course is given a mode. Its course structure renders as tiles,
 *   which is the platform default; OUTLINE below is how a course opts out.
 * - PAGE    — a page authored in the catalogue editor replaces the details
 *   page entirely. Reached at `/<tag>/<route>`, which the `$tagName/$courseId`
 *   route already serves as a CourseSubPage whenever the segment is not an id.
 *   That dual purpose is what makes this work without a new route.
 * - OUTLINE — the details page, syllabus first: the highlights accordion is
 *   dropped and the course structure leads, drawn as a plain folder-row tree
 *   rather than the default tiles. Still the same URL, so pricing, enrolment
 *   and the site header/footer are untouched.
 * - TILES   — the same syllabus-first page, keeping the default artwork cards.
 *
 * Keys are matched course id (the package id) FIRST, then packageSessionId —
 * so an institute that sells one course at several levels can give a single
 * level its own view while the rest fall through.
 */

export type CourseViewMode = "DETAILS" | "PAGE" | "OUTLINE" | "TILES";

export interface CoursePageSetting {
    mode?: CourseViewMode;
    /** Catalogue page route. Only meaningful for `PAGE`. */
    route?: string;
}

export interface CoursePagesSettings {
    enabled?: boolean;
    courses?: Record<string, CoursePageSetting>;
    /**
     * Shape shipped before modes existed: course id → page route, always
     * meaning PAGE. Still read so a catalogue saved against that version does
     * not silently lose its mapping.
     */
    map?: Record<string, string>;
}

/** What the course's entry points should open. `PAGE` is the only mode that
 *  changes the URL; the other two stay on the details route. */
export type CourseView =
    | { mode: "DETAILS" }
    | { mode: "OUTLINE" }
    | { mode: "TILES" }
    | { mode: "PAGE"; route: string };

const DETAILS: CourseView = { mode: "DETAILS" };

/** Course/package ids are UUIDs or plain numbers — the same test
 *  `$tagName/$courseId/index.tsx` uses to choose details-page vs subpage. A
 *  "route" shaped like an id would bounce straight back into the details page
 *  and loop, so it is rejected here. */
const ID_SHAPED =
    /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const normalizeRoute = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    // Admins paste anything: "/toddler", "toddler/", even a full site URL.
    let route = raw.trim();
    if (!route) return null;
    if (/^https?:\/\//i.test(route)) {
        // A pasted page URL is `/<tag>/<route>`, and the caller prefixes the
        // tag itself — keeping the whole pathname would double it into
        // /new-landing-page/new-landing-page/toddler. Catalogue routes are a
        // single segment, so the last one is the route.
        try {
            const segments = new URL(route).pathname.split("/").filter(Boolean);
            route = segments[segments.length - 1] ?? "";
        } catch {
            return null;
        }
    }
    route = route.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!route) return null;
    if (ID_SHAPED.test(route)) return null;
    return route;
};

/**
 * The view this course should open. Always returns something renderable:
 * anything unconfigured, malformed, or self-referential falls back to the
 * standard details page rather than to a broken URL.
 *
 * `courseId` is the catalogue card's `course.id` (the package id).
 */
export const resolveCourseView = (
    globalSettings: unknown,
    course: { courseId?: string | null; packageSessionId?: string | null },
): CourseView => {
    const settings = (globalSettings as { coursePages?: CoursePagesSettings } | null | undefined)
        ?.coursePages;
    if (!settings?.enabled) return DETAILS;

    const byCourse = settings.courses;
    const legacy = settings.map;

    for (const key of [course.courseId, course.packageSessionId]) {
        if (!key) continue;

        const setting =
            byCourse && typeof byCourse === "object" ? byCourse[key] : undefined;
        const legacyRoute =
            legacy && typeof legacy === "object" ? legacy[key] : undefined;

        // An entry with no mode but a route is the pre-modes shape, which
        // always meant PAGE.
        const mode: CourseViewMode | undefined =
            setting?.mode ?? (setting?.route || legacyRoute ? "PAGE" : undefined);
        if (!mode) continue;

        if (mode === "OUTLINE") return { mode: "OUTLINE" };
        if (mode === "TILES") return { mode: "TILES" };
        if (mode === "DETAILS") return DETAILS;

        const route = normalizeRoute(setting?.route ?? legacyRoute);
        // A page that points back at the course's own id is the details page
        // again — treat a mapping that cannot resolve as "not configured"
        // rather than sending the visitor somewhere broken.
        if (route && route !== course.courseId && route !== course.packageSessionId) {
            return { mode: "PAGE", route };
        }
        return DETAILS;
    }
    return DETAILS;
};

/** Convenience for callers that only care whether the course leaves the
 *  details route: the page route, or null to stay put. */
export const resolveCoursePageRoute = (
    globalSettings: unknown,
    course: { courseId?: string | null; packageSessionId?: string | null },
): string | null => {
    const view = resolveCourseView(globalSettings, course);
    return view.mode === "PAGE" ? view.route : null;
};

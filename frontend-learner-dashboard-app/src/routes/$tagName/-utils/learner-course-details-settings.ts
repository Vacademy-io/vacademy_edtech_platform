/**
 * How an institute lays out a course page for its LOGGED-IN learners, read
 * from Settings -> Student Display Settings (`courseDetails`) and served
 * publicly by `/admin-core-service/open/institute/setting/v1/student-display`.
 *
 * The logged-out course page reads the same record so a visitor and an
 * enrolled learner see the course the same way. Only the fields that decide
 * the structure layout are modelled here; the payload carries much more.
 */
export interface LearnerCourseDetailsSettings {
    tabs?: Array<{ id?: string; order?: number; visible?: boolean }>;
    defaultTab?: string;
    /**
     * "contentOnly" means the learner's course page IS the content card grid —
     * no tab bar, no outline. See the enrolled-side CONTENT_ONLY_CARD_GRID.
     */
    enrolledLayout?: string;
    showInstructors?: boolean;
    /** object-fit for the content cards' artwork. */
    contentCardImageFit?: string;
    /**
     * "ebook" renders the public course page as a single-file product (cover,
     * folder, price, buy actions) instead of the course layout. Absent = course.
     */
    layout?: string;
}

/**
 * Which structure rendering the public page should use to match this
 * institute's logged-in learners.
 *
 * `contentOnly` is decisive: that layout has no outline at all, so a public
 * outline would contradict it outright. Otherwise the opening tab decides,
 * and a defaultTab pointing at a hidden tab is ignored in favour of the first
 * visible one — the learner's own page would do the same rather than open a
 * tab that is not there.
 *
 * Falls back to "outline" whenever the settings are missing, unreadable, or
 * silent, which is what this page has always shown.
 */
export const resolveLearnerStructureVariant = (
    settings: LearnerCourseDetailsSettings | null | undefined,
): "outline" | "tiles" => {
    if (!settings) return "outline";
    if (settings.enrolledLayout === "contentOnly") return "tiles";

    const visible = (settings.tabs ?? []).filter((tab) => tab?.visible !== false);
    const isVisible = (id: string) => visible.some((tab) => tab?.id === id);

    const opening =
        settings.defaultTab && isVisible(settings.defaultTab)
            ? settings.defaultTab
            : [...visible].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))[0]?.id;

    return opening === "CONTENT_STRUCTURE" ? "tiles" : "outline";
};

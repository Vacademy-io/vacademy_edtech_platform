/**
 * The Fun skin takes the play skins' default navigation: the bottom bar on phones
 * when the institute left navigation on "auto". Any placement the institute chose is
 * kept as it is. Shared by the layout (which draws the bar) and the top bar (which
 * then leaves out its sidebar button on the Fun home).
 */
export function funAddsBottomBar(
  isFunTheme: boolean,
  layout: { showBottomBar: boolean; placement: string; device: string },
): boolean {
  return isFunTheme && !layout.showBottomBar && layout.placement === "auto" && layout.device === "mobile";
}

/**
 * The lesson viewer (the course "slides" route) draws its own Fun bar at the foot of
 * a phone screen, with Previous and Next, as on the boards. The bottom bar the Fun
 * skin adds would sit over it, so it is left out there. A bar the institute chose
 * itself is not affected.
 */
export function funLessonOwnsFoot(pathname: string): boolean {
  return /\/chapters\/slides\/?$/.test(pathname);
}

/**
 * A Fun bar label: the bar's short name when it has one (`short`, for a title the
 * bar knows), else the title whole. The classic bar cuts other titles after five
 * code units, which can split a Devanagari or Arabic letter; the Fun bar lets CSS
 * end a long title with an ellipsis instead.
 */
export function funBarLabel(title: string, short: string | null | undefined): string {
  return short || title;
}

/**
 * The Fun pages that draw their own header at the top of the screen, as on the
 * boards (A-Learn, A-Course, A-CourseLaptop, A-Lesson, A-Quiz): the course list,
 * the course page and the lesson viewer. Every other route keeps the app's top bar.
 */
export type FunHeaderPage = "learn" | "course" | "lesson";
export function funHeaderPageOf(pathname: string): FunHeaderPage | null {
  const path = pathname.replace(/\/+$/, "");
  if (/\/study-library\/courses\/course-details\/subjects\/modules\/chapters\/slides$/.test(path)) return "lesson";
  if (/\/study-library\/courses\/course-details$/.test(path)) return "course";
  if (/\/study-library\/courses$/.test(path)) return "learn";
  return null;
}

/**
 * Whether the app's top bar steps aside for a Fun page's own header. The lesson
 * viewer always has its own way out (its bar's close, or the quiz's), except on the
 * feedback screen, which has no bar. The course list and the course page give the
 * bar up only while the app's navigation is on screen elsewhere (the bottom bar on
 * a phone, the sidebar, rail or bar on a laptop), so a learner is never left
 * without it.
 */
export function funHidesAppBar(
  isFunTheme: boolean,
  pathname: string,
  screen: { navElsewhere: boolean; lessonBarShown: boolean },
): boolean {
  if (!isFunTheme) return false;
  const page = funHeaderPageOf(pathname);
  if (page === "lesson") return screen.lessonBarShown;
  if (page === "learn" || page === "course") return screen.navElsewhere;
  return false;
}

/**
 * The classic dashboard widgets the Fun home leaves out. Design A's home is the
 * greeting row, the hero, the Today cards and the course tiles (boards Main, A-New,
 * A-Empty, A-Done, A-HideProgress, A-LiveNow, A-Hindi, A-BigText, A-Laptop); none of
 * these widgets is on it.
 *
 * Saved widget settings are not touched: every other skin still reads them, the Fun
 * cards still honour the ones they stand for (todayTasks, upcomingLiveClasses,
 * evaluationStat, enrolledCourses, continueLearning, gamification), and taking an id
 * off this list brings that classic widget back on the Fun home. The list is one
 * place to change once the owner confirms it.
 */
export const FUN_HOME_LEAVES_OUT: ReadonlySet<string> = new Set([
  // Drawn by the Fun cards instead.
  "todayTasks", // the goal card opens the same task runner
  "upcomingLiveClasses", // the live card above the hero and the class Today card
  "statsRow", // the tests Today card and the course tiles
  "gamification", // the streak pill and the goal ring
  // Not on Design A.
  "learningAnalytics",
  "myMembership",
  "myBooks",
  "myOrders",
  "thisWeekAttendance",
  "myMentors",
  "getApp",
  // The Explore Memberships / Explore Books buttons stay (as on main): they are the
  // way to buy more, so leaving them out is for the owner to decide.
]);

/** False for a classic widget the Fun home leaves out. */
export function funHomeKeeps(widgetId: string): boolean {
  return !FUN_HOME_LEAVES_OUT.has(widgetId);
}

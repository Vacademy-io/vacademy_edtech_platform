import { describe, expect, it } from "vitest";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";
import { FUN_HOME_LEAVES_OUT, funHomeKeeps } from "./home-widgets";

describe("funHomeKeeps", () => {
  it("keeps the widgets the Fun home draws in its own way", () => {
    for (const id of ["continueLearning", "enrolledCourses", "custom", "gettingStarted"]) {
      expect(funHomeKeeps(id)).toBe(true);
    }
  });

  it("leaves out the widgets Design A has no place for", () => {
    for (const id of [
      "todayTasks",
      "upcomingLiveClasses",
      "statsRow",
      "gamification",
      "learningAnalytics",
      "myMembership",
      "myBooks",
      "myOrders",
      "thisWeekAttendance",
      "myMentors",
      "getApp",
    ]) {
      expect(funHomeKeeps(id)).toBe(false);
    }
  });

  it("keeps the Explore Memberships / Explore Books buttons, as main does", () => {
    expect(funHomeKeeps("exploreMemberships")).toBe(true);
    expect(funHomeKeeps("exploreBooks")).toBe(true);
  });

  it("names only real widget ids (plus the stats row the page builds)", () => {
    const known = new Set<string>([
      ...DEFAULT_STUDENT_DISPLAY_SETTINGS.dashboard.widgets.map((w) => w.id),
      "statsRow",
    ]);
    for (const id of FUN_HOME_LEAVES_OUT) expect(known.has(id)).toBe(true);
  });
});

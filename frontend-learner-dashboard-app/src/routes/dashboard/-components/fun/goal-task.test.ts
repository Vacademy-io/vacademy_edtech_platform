// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EngagementFeed, EngagementItem } from "@/services/engagement";

// The Today module's view model is pure; its component side is not under test here.
vi.mock("@/components/chatbot/moments/TutorBuddyLine", () => ({ TutorBuddyLine: () => null }));

const { goalTaskOf } = await import("./goal-task");

const task = (id: string, over: Partial<EngagementItem> = {}): EngagementItem =>
  ({
    id,
    slotId: `slot-${id}`,
    planId: "plan",
    packageSessionId: "ps",
    itemType: "SLIDE",
    title: `Task ${id}`,
    version: 1,
    sortOrder: 1,
    isRequired: false,
    completionPoints: 5,
    correctPoints: 0,
    state: "OPEN",
    ...over,
  }) as EngagementItem;

const feed = (over: Partial<EngagementFeed> = {}): EngagementFeed =>
  ({
    items: [],
    catchUp: [],
    doneToday: [],
    upcoming: [],
    revealed: [],
    scheduledToday: 3,
    completedToday: 1,
    capApplied: false,
    ...over,
  }) as EngagementFeed;

describe("goalTaskOf", () => {
  it("opens the first open must-do, with the open tasks as the queue", () => {
    const got = goalTaskOf(feed({ items: [task("a"), task("b", { isRequired: true }), task("c")] }));
    expect(got?.item.id).toBe("b");
    expect(got?.queue).toEqual(["b", "a", "c"]);
  });

  it("skips finished tasks", () => {
    const got = goalTaskOf(feed({ items: [task("a", { attemptStatus: "COMPLETED" }), task("b")] }));
    expect(got?.item.id).toBe("b");
  });

  it("falls back to a catch-up once today's tasks are done", () => {
    const got = goalTaskOf(feed({ items: [], catchUp: [task("old", { state: "CATCH_UP" })], completedToday: 3 }));
    expect(got?.item.id).toBe("old");
    expect(got?.queue).toContain("old");
  });

  it("is null when nothing is open, or there is no feed", () => {
    expect(goalTaskOf(feed({ completedToday: 3 }))).toBeNull();
    expect(goalTaskOf(null)).toBeNull();
  });
});

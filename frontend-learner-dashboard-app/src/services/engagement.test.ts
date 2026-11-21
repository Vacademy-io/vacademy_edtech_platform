import { describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import type { TFunction } from "i18next";

vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test", GET_SERVER_TIME: "https://api.test/time" }));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/constants/helper", () => ({ getInstituteId: async () => "inst-1" }));
vi.mock("@/stores/play-gamification-store", () => ({
  usePlayGamificationStore: { getState: () => ({ applyEngagementResult: () => {} }) },
}));

const {
  normalizeEngagementFeed,
  isEmptyEngagementFeed,
  parseFlashcards,
  engagementErrorMessage,
  engagementReasonCode,
  engagementReasonAction,
  engagementOutcome,
} = await import("./engagement");
type EngagementItem = import("./engagement").EngagementItem;

function item(id: string, over: Partial<EngagementItem> = {}): EngagementItem {
  return {
    id,
    slotId: "s",
    planId: "p",
    packageSessionId: "ps",
    itemType: "READING_HTML",
    title: id,
    version: 1,
    sortOrder: 0,
    isRequired: false,
    completionPoints: 10,
    correctPoints: 0,
    state: "OPEN",
    ...over,
  };
}

/** Echoes the key (and defaultValue) so tests can see which branch was taken. */
const t = ((key: string, opts?: { defaultValue?: string }) =>
  `${key}|${opts?.defaultValue ?? ""}`) as unknown as TFunction;

function axiosError(status: number, data: unknown): AxiosError {
  const response = {
    status,
    data,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError("fail", "ERR_BAD_REQUEST", undefined, undefined, response);
}

describe("normalizeEngagementFeed", () => {
  it("derives the new fields from an old-contract body", () => {
    const feed = normalizeEngagementFeed({
      items: [item("a"), item("b"), item("late", { state: "CATCH_UP", closesAt: "2026-09-26T10:00:00Z" })],
      upcoming: [],
      totalToday: 5,
      completedToday: 3,
      capApplied: true,
      revealed: [
        item("q", { itemType: "QUESTION_OF_DAY" }),
        item("r"),
        item("poll", { itemType: "POLL" }),
        item("g", { itemType: "GAME" }),
      ],
      streakDays: 2,
    });
    expect(feed.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(feed.catchUp.map((i) => i.id)).toEqual(["late"]);
    expect(feed.scheduledToday).toBe(5); // completedToday + today's items
    expect(feed.doneToday).toEqual([]);
    expect(feed.hiddenByCap).toBeNull();
    expect(feed.catchUpClosesAt).toBe("2026-09-26T10:00:00Z");
    // Questions and polls keep their reveal; readings and games never belong here.
    expect(feed.revealed.map((i) => i.id)).toEqual(["q", "poll"]);
    expect(feed.streakDays).toBe(2);
  });

  it("uses the server's fields when present and keeps catch-up out of items", () => {
    const late = item("late", { state: "CATCH_UP" });
    const feed = normalizeEngagementFeed({
      items: [item("a"), late],
      catchUp: [late],
      doneToday: [item("d", { attemptStatus: "COMPLETED" })],
      scheduledToday: 9,
      completedToday: 1,
      hiddenByCap: 4,
      catchUpClosesAt: "2026-09-26T12:00:00Z",
    });
    expect(feed.items.map((i) => i.id)).toEqual(["a"]);
    expect(feed.catchUp.map((i) => i.id)).toEqual(["late"]);
    expect(feed.scheduledToday).toBe(9);
    expect(feed.hiddenByCap).toBe(4);
    expect(feed.doneToday).toHaveLength(1);
  });

  it("keeps catch-up rows inside items for the legacy card", () => {
    const feed = normalizeEngagementFeed(
      { items: [item("a"), item("late", { state: "CATCH_UP" })], completedToday: 0 },
      { legacyItems: true }
    );
    expect(feed.items.map((i) => i.id)).toEqual(["a", "late"]);
  });

  it("treats a body with nothing in it as no plan", () => {
    expect(isEmptyEngagementFeed(normalizeEngagementFeed({}))).toBe(true);
    expect(isEmptyEngagementFeed(normalizeEngagementFeed(null))).toBe(true);
    expect(isEmptyEngagementFeed(normalizeEngagementFeed({ upcoming: [item("u")] }))).toBe(false);
  });
});

describe("parseFlashcards", () => {
  it("reads a v1 deck, skipping broken cards, keeping text verbatim", () => {
    const deck = parseFlashcards(
      item("f", {
        itemType: "FLASHCARDS",
        payloadJson: JSON.stringify({
          schema: "flashcards/v1",
          cards: [
            { id: "c_1", front: "2 < x > 1", back: "<b>x</b>", hint: "" },
            { id: "c_2", front: "Front", back: "Back", hint: "Hint" },
            { id: "", front: "no id", back: "x" },
            { id: "c_3", front: "no back" },
            null,
          ],
          settings: { shuffle: false },
        }),
      })
    );
    expect(deck?.cards).toEqual([
      { id: "c_1", front: "2 < x > 1", back: "<b>x</b>" },
      { id: "c_2", front: "Front", back: "Back", hint: "Hint" },
    ]);
    expect(deck?.shuffle).toBe(false);
  });

  it("defaults shuffle to true and returns null when there is nothing to study", () => {
    const one = { cards: [{ id: "a", front: "f", back: "b" }] };
    expect(parseFlashcards(item("f", { payloadJson: JSON.stringify(one) }))?.shuffle).toBe(true);
    expect(parseFlashcards(item("f", { payloadJson: JSON.stringify({ cards: [] }) }))).toBeNull();
    expect(parseFlashcards(item("f", { payloadJson: "{not json" }))).toBeNull();
    expect(parseFlashcards(item("f"))).toBeNull();
  });
});

describe("engagementErrorMessage", () => {
  it("maps a known reasonCode to its key, with the server text as the fallback", () => {
    const err = axiosError(400, { ex: "Open the lesson first", reasonCode: "LESSON_NOT_FINISHED" });
    expect(engagementReasonCode(err)).toBe("LESSON_NOT_FINISHED");
    expect(engagementErrorMessage(err, t)).toEqual({
      message: "errors.LESSON_NOT_FINISHED|Open the lesson first",
      reasonCode: "LESSON_NOT_FINISHED",
    });
  });

  it("shows the server's ex when there is no known code", () => {
    const err = axiosError(400, { ex: "Some server reason", reasonCode: "SOMETHING_NEW" });
    expect(engagementErrorMessage(err, t)).toEqual({ message: "Some server reason" });
  });

  it("falls back to the generic line for non-HTTP errors", () => {
    expect(engagementErrorMessage(new TypeError("x"), t).message).toMatch(/^errors\.generic\|/);
  });

  it("says what to do after each refusal", () => {
    expect(engagementReasonAction("TASK_CLOSED")).toBe("close");
    expect(engagementReasonAction("FLASHCARDS_STALE")).toBe("reload");
    expect(engagementReasonAction("READ_GATE")).toBe("stay");
    expect(engagementReasonAction(undefined)).toBe("stay");
  });
});

describe("engagementOutcome", () => {
  const base = {
    attemptId: "a",
    status: "COMPLETED",
    pointsAwarded: 10,
    isLate: false,
    isVerified: true,
    isRevealed: false,
  };
  it("classifies results", () => {
    expect(engagementOutcome({ ...base, isCorrect: true })).toBe("correct");
    expect(engagementOutcome({ ...base, isCorrect: false })).toBe("wrong");
    expect(engagementOutcome({ ...base, resultPending: true, isCorrect: null })).toBe("pending");
    expect(engagementOutcome({ ...base })).toBe("done");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import en from "@/locales/en/libraryCommonB.json";
import fr from "@/locales/fr/libraryCommonB.json";
import hi from "@/locales/hi/libraryCommonB.json";
import ar from "@/locales/ar/libraryCommonB.json";
import {
  clearQuizSession,
  quizAttemptEnd,
  quizDescriptionText,
  quizNeedsStart,
  quizSecondsLeft,
  readOwnQuizSession,
  readQuizSession,
  writeQuizSession,
  type QuizSession,
} from "./quiz-session";

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
};

const session: QuizSession = {
  userId: "u1",
  attemptId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
  startedAt: 1000,
  spentMs: 5000,
  answers: { q1: "a" },
  current: 2,
};

describe("quiz session storage", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("returns what was saved, per slide", () => {
    writeQuizSession("s1", session, storage);
    expect(readQuizSession("s1", storage)).toEqual(session);
    expect(readQuizSession("s2", storage)).toBeNull();
  });

  it("is gone once cleared", () => {
    writeQuizSession("s1", session, storage);
    clearQuizSession("s1", storage);
    expect(readQuizSession("s1", storage)).toBeNull();
  });

  it("treats a damaged record as no session", () => {
    storage.map.set("quiz_session_s1", "{not json");
    expect(readQuizSession("s1", storage)).toBeNull();
    storage.map.set("quiz_session_s1", JSON.stringify({ answers: {} }));
    expect(readQuizSession("s1", storage)).toBeNull();
  });

  it("fills in missing fields without losing the start time", () => {
    storage.map.set("quiz_session_s1", JSON.stringify({ startedAt: 5, current: -1 }));
    expect(readQuizSession("s1", storage)).toMatchObject({
      userId: null,
      startedAt: 5,
      spentMs: 0,
      answers: {},
      current: 0,
    });
  });

  it("gives a record without a usable attempt id a new one", () => {
    storage.map.set("quiz_session_s1", JSON.stringify({ startedAt: 5, attemptId: "not-a-uuid" }));
    expect(readQuizSession("s1", storage)?.attemptId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the attempt id across reads", () => {
    writeQuizSession("s1", session, storage);
    expect(readQuizSession("s1", storage)?.attemptId).toBe(session.attemptId);
  });

  it("finds the attempt only for the learner it belongs to", () => {
    writeQuizSession("s1", session, storage);
    expect(readOwnQuizSession("s1", "u1", storage)?.startedAt).toBe(1000);
    expect(readOwnQuizSession("s1", "u2", storage)).toBeNull();
    writeQuizSession("s1", { ...session, userId: null }, storage);
    expect(readOwnQuizSession("s1", "u2", storage)?.startedAt).toBe(1000);
  });

  it("does not throw when storage is unavailable", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readQuizSession("s1", blocked)).toBeNull();
    expect(() => writeQuizSession("s1", session, blocked)).not.toThrow();
    expect(() => clearQuizSession("s1", blocked)).not.toThrow();
  });
});

describe("quizSecondsLeft", () => {
  const start = 1_000_000;

  it("counts from when Start was pressed, not from when the quiz was reopened", () => {
    expect(quizSecondsLeft(start, 600, start)).toBe(600);
    expect(quizSecondsLeft(start, 600, start + 120_000)).toBe(480);
  });

  it("keeps counting while the learner is away and stops at zero", () => {
    expect(quizSecondsLeft(start, 600, start + 3_600_000)).toBe(0);
  });

  it("never exceeds the limit if the device clock moves backwards", () => {
    expect(quizSecondsLeft(start, 600, start - 3_600_000)).toBe(600);
  });
});

describe("quizAttemptEnd", () => {
  const start = 1_000_000;

  it("is the time of submission while the clock is running", () => {
    expect(quizAttemptEnd(start, 600, start + 120_000)).toBe(start + 120_000);
  });

  it("stops at the limit for an attempt submitted later than that", () => {
    expect(quizAttemptEnd(start, 600, start + 3 * 86_400_000)).toBe(start + 600_000);
  });

  it("is the time of submission when there is no clock", () => {
    expect(quizAttemptEnd(start, 0, start + 3 * 86_400_000)).toBe(start + 3 * 86_400_000);
  });
});

describe("quizNeedsStart", () => {
  it("asks for a start when there is a clock or a cap", () => {
    expect(quizNeedsStart(10, null)).toBe(true);
    expect(quizNeedsStart(null, 2)).toBe(true);
    expect(quizNeedsStart(10, 2)).toBe(true);
  });

  it("opens directly when there is neither", () => {
    expect(quizNeedsStart(null, null)).toBe(false);
    expect(quizNeedsStart(undefined, undefined)).toBe(false);
    expect(quizNeedsStart(0, null)).toBe(false);
  });
});

describe("quizDescriptionText", () => {
  it("keeps prose and strips markup", () => {
    expect(quizDescriptionText("<p>Checks the  water cycle.</p>")).toBe("Checks the water cycle.");
  });

  it("rejects payloads and empties", () => {
    expect(quizDescriptionText('{ "questions": [] }')).toBeNull();
    expect(quizDescriptionText("[1,2]")).toBeNull();
    expect(quizDescriptionText("null")).toBeNull();
    expect(quizDescriptionText("<p> </p>")).toBeNull();
    expect(quizDescriptionText(undefined)).toBeNull();
  });
});

describe("start screen marks text", () => {
  const catalogs: Array<[string, { quizViewer: { start: object } }]> = [
    ["en", en],
    ["fr", fr],
    ["hi", hi],
    ["ar", ar],
  ];
  it.each(catalogs)("has every plural form %s uses", (locale: string, catalog: { quizViewer: { start: object } }) => {
    const start = catalog.quizViewer.start as Record<string, string>;
    const missing = new Intl.PluralRules(locale)
      .resolvedOptions()
      .pluralCategories.filter((form) => !start[`negativeValue_${form}`]);
    expect(missing).toEqual([]);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = new Map<string, string>();
// Simulates a full localStorage: any write beyond `quota` total chars throws
// the same DOMException the browser does.
let quota = Infinity;
const usedChars = () =>
  [...kv.entries()].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
const kvStore = {
  get: async ({ key }: { key: string }) => ({ value: kv.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => {
    const existing = kv.get(key);
    const next = usedChars() - (existing ? key.length + existing.length : 0) + key.length + value.length;
    if (next > quota) throw new DOMException("quota", "QuotaExceededError");
    kv.set(key, value);
  },
  remove: async ({ key }: { key: string }) => {
    kv.delete(key);
  },
  keys: async () => ({ keys: [...kv.keys()] }),
};
vi.mock("@capacitor/storage", () => ({ Storage: kvStore }));

const { useAssessmentStore, removePersistedAssessmentState } = await import("./assessment-store");

const ASSESSMENT_ID = "a-1";
const ATTEMPT_ID = "att-1";
const CURRENT_KEY = `ASSESSMENT_STATE_${ASSESSMENT_ID}_${ATTEMPT_ID}`;

const startAttempt = () => {
  useAssessmentStore.setState({
    assessment: { attempt_id: ATTEMPT_ID } as never,
    answers: { q1: ["o1"] },
  });
};

beforeEach(() => {
  kv.clear();
  quota = Infinity;
  kv.set("InstructionID_and_AboutID", JSON.stringify({ assessment_id: ASSESSMENT_ID }));
  useAssessmentStore.getState().resetAssessment();
});

describe("saveState", () => {
  it("clears earlier attempts' snapshots and retries when storage is full", async () => {
    const oldSnapshot = "x".repeat(500);
    kv.set("ASSESSMENT_STATE_old-a_old-att", oldSnapshot);
    kv.set("ASSESSMENT_STATE_legacy-att", oldSnapshot);
    kv.set("token", "keep-me");
    quota = usedChars() + 100;
    startAttempt();

    await expect(useAssessmentStore.getState().saveState()).resolves.toBeUndefined();

    expect(kv.has(CURRENT_KEY)).toBe(true);
    expect(kv.has("ASSESSMENT_STATE_old-a_old-att")).toBe(false);
    expect(kv.has("ASSESSMENT_STATE_legacy-att")).toBe(false);
    expect(kv.get("token")).toBe("keep-me");
  });

  it("does not reject when storage is still full after the purge", async () => {
    quota = usedChars();
    startAttempt();

    await expect(useAssessmentStore.getState().saveState()).resolves.toBeUndefined();
    expect(kv.has(CURRENT_KEY)).toBe(false);
  });
});

describe("removePersistedAssessmentState", () => {
  it("removes both the current and the legacy key for a submitted attempt", async () => {
    kv.set(CURRENT_KEY, "{}");
    kv.set(`ASSESSMENT_STATE_${ATTEMPT_ID}`, "{}");
    kv.set("ASSESSMENT_STATE_a-2_att-2", "{}");

    await removePersistedAssessmentState(ATTEMPT_ID);

    expect(kv.has(CURRENT_KEY)).toBe(false);
    expect(kv.has(`ASSESSMENT_STATE_${ATTEMPT_ID}`)).toBe(false);
    expect(kv.has("ASSESSMENT_STATE_a-2_att-2")).toBe(true);
  });
});

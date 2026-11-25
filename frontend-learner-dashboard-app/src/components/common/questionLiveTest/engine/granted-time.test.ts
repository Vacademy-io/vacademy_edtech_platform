// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/storage", () => ({
  Storage: {
    get: async () => ({ value: null }),
    set: async () => undefined,
    remove: async () => undefined,
    keys: async () => ({ keys: [] }),
  },
}));
vi.mock("@sentry/react", () => ({ addBreadcrumb: () => undefined }));
const { useAssessmentStore } = await import("@/stores/assessment-store");
const { applyGrantedTime, resetAppliedGrants } = await import("./granted-time");

const question = (id: string) => ({
  question_id: id,
  question_type: "MCQS",
  question_duration: 0,
});

const paper = (distribution: "ASSESSMENT" | "SECTION") =>
  ({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: false,
    distribution_duration: distribution,
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: null,
    section_dtos: [
      { id: "s1", duration: 30, question_preview_dto_list: [question("q1")] },
      { id: "s2", duration: 30, question_preview_dto_list: [question("q2")] },
    ],
  }) as never;

const store = () => useAssessmentStore.getState();

beforeEach(() => {
  store().resetAssessment();
  resetAppliedGrants();
});

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);
const minutes = (m: number) => m * 60 * 1000;
// Attempt started 5 minutes ago on a 60-minute limit.
const started = { startMs: NOW - minutes(5), startMaxMinutes: 60 };

describe("applyGrantedTime", () => {
  it("adds the granted minutes to the running clock and raises the duration", () => {
    store().setAssessment(paper("ASSESSMENT"));
    store().setEntireTestTimer(55 * 60);

    expect(applyGrantedTime(75, "EXAM", started, NOW)).toEqual({ addedMinutes: 15 });

    expect(store().entireTestTimer).toBe(55 * 60 + 15 * 60);
    // The visibility re-sync counts down from the duration, so it must carry the grant.
    expect(store().assessment?.duration).toBe(75);
  });

  it("applies a grant once: the next save with the same max time adds nothing", () => {
    store().setAssessment(paper("ASSESSMENT"));
    store().setEntireTestTimer(55 * 60);

    applyGrantedTime(70, "EXAM", started, NOW);
    // Even if the caller could not move the saved end time on, the grant is not repeated.
    expect(applyGrantedTime(70, "EXAM", started, NOW)).toEqual({ addedMinutes: 0 });
    // And with the end time moved on, as the caller does.
    expect(applyGrantedTime(70, "EXAM", { ...started, startMaxMinutes: 70 }, NOW)).toEqual({ addedMinutes: 0 });

    expect(store().entireTestTimer).toBe(65 * 60);
  });

  it("does not add the grant twice when the clock was restored with it already applied", () => {
    // Reload after a grant whose end time was not saved: the paper says 60, the clock holds +10.
    store().setAssessment(paper("ASSESSMENT"));
    store().setEntireTestTimer(65 * 60);

    applyGrantedTime(70, "EXAM", started, NOW);

    expect(store().entireTestTimer).toBe(65 * 60);
    expect(store().assessment?.duration).toBe(70);
  });

  it("never stretches the clock to a limit the attempt merely started with", () => {
    // A preview attempt made before the admin shortened the test: the attempt says 180, the
    // paper says 60. The clock keeps the 60 it shows, as before.
    store().setAssessment(paper("ASSESSMENT"));
    store().setEntireTestTimer(55 * 60);
    const stale = { startMs: NOW - minutes(5), startMaxMinutes: 180 };

    expect(applyGrantedTime(180, "EXAM", stale, NOW)).toEqual({ addedMinutes: 0 });
    expect(store().entireTestTimer).toBe(55 * 60);
    expect(store().assessment?.duration).toBe(60);

    // A real grant on top of it still adds just the granted minutes.
    expect(applyGrantedTime(190, "EXAM", stale, NOW)).toEqual({ addedMinutes: 10 });
    expect(store().entireTestTimer).toBe(65 * 60);
    expect(store().assessment?.duration).toBe(70);
  });

  it("still adds the grant when the start time is unknown", () => {
    store().setAssessment(paper("ASSESSMENT"));
    store().setEntireTestTimer(600);

    expect(applyGrantedTime(70, "EXAM", null, NOW)).toEqual({ addedMinutes: 10 });
    expect(store().entireTestTimer).toBe(600 + 10 * 60);
  });

  it("also lengthens the open section on a section-timed paper", () => {
    store().setAssessment(paper("SECTION"));
    const before = store().sectionTimers[0]!.timeLeft;

    applyGrantedTime(65, "EXAM", started, NOW);

    expect(store().sectionTimers[0]!.timeLeft).toBe(before + 5 * 60 * 1000);
    expect(store().sectionTimers[1]!.timeLeft).toBe(30 * 60 * 1000);
  });

  it("does nothing once the attempt is submitted, or for practice", () => {
    store().setAssessment(paper("ASSESSMENT"));
    store().setEntireTestTimer(300);

    expect(applyGrantedTime(90, "PRACTICE", started, NOW).addedMinutes).toBe(0);
    store().submitAssessment();
    expect(applyGrantedTime(90, "EXAM", started, NOW).addedMinutes).toBe(0);

    expect(store().assessment?.duration).toBe(60);
  });
});

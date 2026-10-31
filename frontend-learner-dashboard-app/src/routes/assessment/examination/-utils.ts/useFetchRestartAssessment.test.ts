// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = new Map<string, string>();
const kvStore = {
  get: async ({ key }: { key: string }) => ({ value: kv.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => {
    kv.set(key, value);
  },
  remove: async ({ key }: { key: string }) => {
    kv.delete(key);
  },
};
vi.mock("@capacitor/storage", () => ({ Storage: kvStore }));
vi.mock("@capacitor/preferences", () => ({ Preferences: kvStore }));

const post = vi.fn();
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { post } }));

const { restartAssessment } = await import("./useFetchRestartAssessment");
const { useAssessmentStore } = await import("@/stores/assessment-store");

const ASSESSMENT_ID = "a-1";
const ATTEMPT_ID = "att-1";

// Shape of the real restart response (AssessmentRestartResponse): the preview
// has no duration / mode / section-switch flag and the attempt arrives as the
// raw `attempt_data_json` string.
const restartResponse = (timeLeftSeconds: number, attemptData: unknown) => {
  const now = Date.now();
  return {
    start_assessment_response: {
      start_time: new Date(now).toISOString(),
      end_time: new Date(now + 20 * 60 * 1000).toISOString(),
      attempt_id: ATTEMPT_ID,
    },
    preview_response: {
      attempt_id: ATTEMPT_ID,
      preview_total_time: 0,
      section_dtos: [
        {
          id: "s1",
          question_preview_dto_list: [
            { question_id: "q1", question_type: "MCQS" },
            { question_id: "q2", question_type: "MCQS" },
          ],
        },
        {
          id: "s2",
          question_preview_dto_list: [{ question_id: "q3", question_type: "MCQS" }],
        },
      ],
    },
    attempt_data_json: attemptData === undefined ? null : JSON.stringify(attemptData),
    update_status_response: {
      duration: [{ id: ASSESSMENT_ID, type: "ASSESSMENT", new_max_time_in_seconds: timeLeftSeconds }],
      announcements: [],
      control: [],
    },
  };
};

const savedAttempt = {
  attemptId: ATTEMPT_ID,
  clientLastSync: new Date().toISOString(),
  assessment: {
    assessmentId: ASSESSMENT_ID,
    entireTestDurationLeftInSeconds: 900,
    timeElapsedInSeconds: 300,
    status: "LIVE",
    tabSwitchCount: 1,
  },
  sections: [
    {
      sectionId: "s1",
      sectionDurationLeftInSeconds: 0,
      timeElapsedInSeconds: 0,
      questions: [
        {
          questionId: "q1",
          questionDurationLeftInSeconds: 0,
          timeTakenInSeconds: 30,
          isMarkedForReview: false,
          isVisited: true,
          responseData: { type: "MCQS", optionIds: ["opt-b"] },
        },
      ],
    },
  ],
};

describe("restartAssessment (Resume)", () => {
  beforeEach(() => {
    kv.clear();
    post.mockReset();
    // A cold start: the app was killed, so the in-memory store is empty.
    useAssessmentStore.setState({ entireTestTimer: 0, answers: {}, assessment: null } as never);
    kv.set(
      "InstructionID_and_AboutID",
      JSON.stringify({
        assessment_id: ASSESSMENT_ID,
        duration: 20,
        distribution_duration: "ASSESSMENT",
        can_switch_section: true,
      })
    );
  });

  it("restores the server's time left and the saved answers instead of a zero timer", async () => {
    post.mockResolvedValue({ data: restartResponse(840, savedAttempt) });

    expect(await restartAssessment(ASSESSMENT_ID, ATTEMPT_ID)).toBe(true);

    const state = useAssessmentStore.getState();
    expect(state.entireTestTimer).toBe(840);
    expect(state.answers.q1).toEqual(["opt-b"]);
    // Warnings already taken carry over, so Resume is not a way to reset them.
    expect(state.tabSwitchCount).toBe(1);
    expect(state.assessment?.duration).toBe(20);
    expect(state.assessment?.can_switch_section).toBe(true);
    // Left unset on purpose: the restored per-section/question timers don't
    // match what the SECTION/QUESTION tickers read.
    expect(state.assessment?.distribution_duration).toBeUndefined();
  });

  it("keeps the visibility reconcile consistent with the server's time left", async () => {
    post.mockResolvedValue({ data: restartResponse(840, savedAttempt) });
    await restartAssessment(ASSESSMENT_ID, ATTEMPT_ID);

    const { start_time } = JSON.parse(kv.get("server_start_end_time")!);
    const elapsed = (Date.now() - new Date(start_time).getTime()) / 1000;
    expect(Math.round(20 * 60 - elapsed)).toBe(840);
  });

  it("never restores a missing tab-switch count as NaN", async () => {
    const { tabSwitchCount: _omit, ...assessmentWithoutCount } = savedAttempt.assessment;
    void _omit;
    post.mockResolvedValue({
      data: restartResponse(840, { ...savedAttempt, assessment: assessmentWithoutCount }),
    });
    await restartAssessment(ASSESSMENT_ID, ATTEMPT_ID);
    expect(useAssessmentStore.getState().tabSwitchCount).toBe(0);
  });

  it("gives the server's time left even with no saved attempt data", async () => {
    post.mockResolvedValue({ data: restartResponse(600, undefined) });

    expect(await restartAssessment(ASSESSMENT_ID, ATTEMPT_ID)).toBe(true);
    expect(useAssessmentStore.getState().entireTestTimer).toBe(600);
  });
});

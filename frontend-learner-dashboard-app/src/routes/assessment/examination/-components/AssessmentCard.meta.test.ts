import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assessmentTypes, type Assessment } from "@/types/assessment";
import { AssessmentCard } from "./AssessmentCard";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));
vi.mock("../-utils.ts/useFetchRestartAssessment", () => ({ restartAssessment: () => undefined }));
vi.mock("../-utils.ts/useFetchAssessment", () => ({
  fetchPreviewData: () => undefined,
  storeAssessmentInfo: () => undefined,
}));
vi.mock("@/constants/helper", () => ({ formatDuration: () => "duration" }));
vi.mock("@/services/student-report-routing", () => ({ openStudentReport: () => undefined }));

const SENTINEL_END = "9999-12-31T23:59:59.999+00:00";

function renderCard(overrides: Partial<Assessment>) {
  const assessmentInfo = {
    assessment_id: "a",
    name: "Test",
    play_mode: "MOCK",
    duration: 60,
    bound_start_time: "2020-01-01T00:00:00.000+00:00",
    bound_end_time: SENTINEL_END,
    recent_attempt_status: null,
    assessment_attempts: 100000,
    user_attempts: null,
    created_attempts: 0,
    ...overrides,
  } as Assessment;
  return renderToStaticMarkup(
    createElement(AssessmentCard, {
      assessmentInfo,
      assessmentType: assessmentTypes.LIVE,
      assessment_types: "ASSESSMENT",
    }),
  );
}

describe("AssessmentCard meta line", () => {
  it("reads the sentinel limit and end date as no limit", () => {
    const html = renderCard({ created_attempts: 3, recent_attempt_status: "ENDED" });
    expect(html).toContain("card.meta.unlimitedAttempts");
    expect(html).toContain("card.meta.noExpiry");
    expect(html).not.toContain("card.meta.attemptsUsed");
    expect(html).not.toContain("card.meta.validTill");
  });

  it("gives the allowance before a first attempt and the count after one", () => {
    expect(renderCard({ play_mode: "EXAM", assessment_attempts: 2 })).toContain(
      "card.meta.attemptsAllowed",
    );
    expect(
      renderCard({
        play_mode: "EXAM",
        assessment_attempts: 2,
        created_attempts: 1,
        recent_attempt_status: "ENDED",
      }),
    ).toContain("card.meta.attemptsUsed");
  });
});

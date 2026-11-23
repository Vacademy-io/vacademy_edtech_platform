import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/axiosInstance", () => ({ default: { post: vi.fn() } }));
vi.mock("@/constants/urls", () => ({ STUDENT_REPORT_URL: "/report/list" }));

import { opensResultOnSubmit, waitForReleasedResult } from "./instant-result";

describe("opensResultOnSubmit", () => {
  it("opens the result for an auto-marked test released on submission", () => {
    expect(
      opensResultOnSubmit({ evaluationType: "AUTO", playMode: "EXAM", resultType: "AUTO_AFTER_SUBMISSION" }),
    ).toBe(true);
  });

  it("keeps the old flow for every other case", () => {
    expect(
      opensResultOnSubmit({ evaluationType: "MANUAL", playMode: "EXAM", resultType: "AUTO_AFTER_SUBMISSION" }),
    ).toBe(false);
    expect(
      opensResultOnSubmit({ evaluationType: "AUTO", playMode: "SURVEY", resultType: "AUTO_AFTER_SUBMISSION" }),
    ).toBe(false);
    for (const resultType of ["AUTO_AFTER_ASSESSMENT_END", "MANUAL", "NO_AUTO_RELEASE", ""]) {
      expect(opensResultOnSubmit({ evaluationType: "AUTO", playMode: "EXAM", resultType })).toBe(false);
    }
  });
});

describe("waitForReleasedResult", () => {
  const fast = { instituteId: "inst", timeoutMs: 50, intervalMs: 1 };

  it("resolves true once the attempt shows up as released", async () => {
    const fetchReports = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ attempt_id: "a1", report_release_status: null }])
      .mockResolvedValue([{ attempt_id: "a1", report_release_status: "RELEASED" }]);
    await expect(waitForReleasedResult({ ...fast, attemptId: "a1", fetchReports })).resolves.toBe(true);
    expect(fetchReports).toHaveBeenCalledTimes(3);
  });

  it("ignores other attempts and gives up at the deadline", async () => {
    const fetchReports = vi.fn().mockResolvedValue([{ attempt_id: "old", report_release_status: "RELEASED" }]);
    await expect(waitForReleasedResult({ ...fast, attemptId: "a1", fetchReports })).resolves.toBe(false);
  });

  it("retries a failed read instead of throwing", async () => {
    const fetchReports = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue([{ attempt_id: "a1", report_release_status: "RELEASED" }]);
    await expect(waitForReleasedResult({ ...fast, attemptId: "a1", fetchReports })).resolves.toBe(true);
  });
});

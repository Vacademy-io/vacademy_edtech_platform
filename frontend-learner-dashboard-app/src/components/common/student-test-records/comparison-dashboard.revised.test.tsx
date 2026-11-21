// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The report page's header reads `result_revised_at` from the report-detail response
// (StudentReportOverallDetailDto). Stub the API and the heavy children; keep the header real.
let detail: Record<string, unknown> = {};
vi.mock("@/lib/auth/axiosInstance", () => {
  const client = Object.assign(async () => ({ data: {} }), {
    get: async () => ({ data: detail }),
    post: async () => ({ data: {} }),
  });
  return { default: client };
});
vi.mock("@/constants/urls", () => ({
  STUDENT_REPORT_DETAIL_URL: "/report-detail",
  GET_QUESTIONS_OF_SECTIONS: "/questions",
  GET_ASSESSMENT_DETAILS: "/assessment",
  LEARNER_OPTION_DISTRIBUTION_URL: "/distribution",
  EXPORT_ASSESSMENT_REPORT: "/export",
}));
vi.mock("@/constants/helper", () => ({ formatDuration: () => "" }));
vi.mock("@/services/upload_file", () => ({ getFileDetail: async () => null }));
vi.mock("./pdf-download-button", () => ({ PdfDownloadButton: () => null }));
vi.mock("./evaluated-report-dialog", () => ({ EvaluatedReportDialog: () => null }));
vi.mock("./annotated-copy-dialog", () => ({ AnnotatedCopyDialog: () => null }));
vi.mock("./marks-distribution-chart", () => ({ MarksDistributionChart: () => null }));
vi.mock("./section-comparison-table", () => ({ SectionComparisonTable: () => null }));
vi.mock("./performance-band", () => ({ PerformanceBand: () => null }));
vi.mock("./question-response-renderer", () => ({
  renderStudentResponse: () => null,
  renderCorrectAnswer: () => null,
}));
// Any illustration the page asks for renders as nothing.
vi.mock("@/assets/play-illustrations", () => ({
  playIllustrations: new Proxy({}, { get: () => () => null }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const { ComparisonDashboard } = await import("./comparison-dashboard");

const hosts: { host: HTMLElement; unmount: () => Promise<void> }[] = [];
async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ComparisonDashboard
        data={{ student_marks: 9, total_marks: 12, total_participants: 1 }}
        assessmentName="FR Mock 1"
        assessmentId="a-1"
        attemptId="t-1"
        instituteId="inst-1"
        evaluationType="AUTO"
      />,
    ),
  );
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  hosts.push({
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  });
  return host;
}

afterEach(async () => {
  for (const h of hosts.splice(0)) await h.unmount();
});

describe("Report page header: Revised tag (W11)", () => {
  it("shows the tag beside the title when the detail carries result_revised_at", async () => {
    detail = { all_sections: {}, result_revised_at: "2026-11-18T10:30:00.000+00:00" };
    const host = await mount();
    const title = host.querySelector("h1");
    expect(title?.textContent).toBe("FR Mock 1");
    const tag = title?.parentElement?.querySelector('[data-testid="revised-tag"]');
    expect(tag?.textContent).toContain("revisedTag");
  });

  it("shows nothing extra when the result was never changed after release", async () => {
    detail = { all_sections: {}, result_revised_at: null };
    const host = await mount();
    expect(host.querySelector("h1")?.textContent).toBe("FR Mock 1");
    expect(host.querySelector('[data-testid="revised-tag"]')).toBeNull();
  });
});

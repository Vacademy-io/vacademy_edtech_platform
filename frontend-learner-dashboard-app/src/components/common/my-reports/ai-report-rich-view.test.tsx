// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// recharts' ResponsiveContainer measures itself; jsdom has no ResizeObserver.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// A plain responder rather than vi.fn(): a spy re-throws a rejected promise it returns even
// when the component catches it, which would fail the fallback test for the wrong reason.
const calls: { url?: string }[] = [];
let respond: () => Promise<unknown> = async () => ({ data: {} });
vi.mock("@/lib/auth/axiosInstance", () => ({
  default: (config: { url?: string }) => {
    calls.push(config);
    return respond();
  },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: JSON.stringify({ id: "inst-1" }) }) },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/constants/urls", () => ({ AI_REPORT_WEB_DATA: "/ai-data", EXPORT_AI_REPORT: "/ai-pdf" }));
vi.mock("@/components/core/dashboard-loader", () => ({ DashboardLoader: () => <div data-testid="loader" /> }));

const { AiReportRichView } = await import("./ai-report-rich-view");

function report(extra: Record<string, unknown> = {}) {
  const questions = Array.from({ length: 8 }, (_, i) => ({
    question_id: `q${i}`, section_id: i < 4 ? "s1" : "s2", section_index: i < 4 ? 0 : 1,
    section_name: i < 4 ? "Physics" : "Maths", number: (i % 4) + 1, max: 2,
    marks: i % 3 === 0 ? -0.5 : 2, outcome: i % 3 === 0 ? "WRONG" : "CORRECT", time_seconds: 15 + i,
    class_correct_percent: 70, class_average_time_seconds: 20, short_text: `Sample ${i}`, type: "MCQ (Single)",
    text: `Sample question ${i}`, your_answer: "Option A", correct_answer: i % 3 === 0 ? "Option B" : null,
    feedback: null, criteria: [], explanation: "Because.",
  }));
  return {
    institute_name: "Sample", assessment_name: "Unit Test", student_name: "Riya Verma", enrollment_number: "ENR-1",
    attempt_date: 1_790_000_000_000, headline: "Top quarter of 20 students", subline: "Full marks in Maths.",
    score: 10.5, max_score: 16, time_taken_seconds: 400, duration_limit_minutes: 20, has_class: true, rank: 4,
    participants: 20, percentile: 80, class_average: 9.2, class_highest: 15, class_average_time_seconds: 380,
    class_scores: [2, 5, 8, 9, 10, 10.5, 12, 15], marking_note: null, hide_question_wise: false,
    hide_your_answer: false, hide_correct_answer: false, hide_explanation: false,
    sections: [
      { id: "s1", name: "Physics", index: 0, max: 8, score: 4.5, class_average: 4, time_seconds: 200, class_average_time_seconds: 180, class_top: 8 },
      { id: "s2", name: "Maths", index: 1, max: 8, score: 6, class_average: 5, time_seconds: 200, class_average_time_seconds: 200, class_top: 8 },
    ],
    questions,
    history: [],
    potential: null,
    ai: {
      performance_analysis: "Riya, **maths** is strong.",
      misconception_analysis: [{ question_summary: "Lens sign", misconception: "Sign convention mixed up.", remediation: "Draw it." }],
      flashcards: [{ front: "Lens formula?", back: "1/f = 1/v - 1/u" }],
    },
    ...extra,
  };
}

async function mount(props: { assessmentId: string; attemptId?: string }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AiReportRichView
        assessmentId={props.assessmentId}
        attemptId={props.attemptId}
        assessmentName="Unit Test"
        fallback={<div data-testid="fallback">old view</div>}
      />,
    ),
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("AiReportRichView", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the report as cards with the PDF's numbers, AI text and questions", async () => {
    respond = async () => ({ data: report() });
    const { host, unmount } = await mount({ assessmentId: "a1", attemptId: "t1" });
    const text = host.textContent ?? "";
    expect(calls[0]?.url).toBe("/ai-data");
    expect(host.querySelector('[data-testid="fallback"]')).toBeNull();
    expect(text).toContain("Top quarter of 20 students");
    expect(text).toContain("10.5");
    expect(text).toContain("aiReportDetails.rich.sections.title");
    expect(text).toContain("aiReportDetails.rich.answers.title");
    expect(text).toContain("aiReportDetails.rich.qbq.title");
    expect(text).toContain("Sample question 0");
    expect(text).toContain("Option B");
    expect(text).toContain("Sign convention mixed up.");
    expect(text).toContain("Lens formula?");
    // The misconception has no answers (hidden by the report options): no empty labels.
    expect(text).not.toContain("aiReportDetails.misconceptions.yourAnswer");
    await unmount();
  });

  it("leaves out question-wise sections when the report options hide them", async () => {
    respond = async () => ({ data: report({ hide_question_wise: true }) });
    const { host, unmount } = await mount({ assessmentId: "a2" });
    const text = host.textContent ?? "";
    expect(text).toContain("aiReportDetails.rich.hero.kicker");
    expect(text).not.toContain("aiReportDetails.rich.answers.title");
    expect(text).not.toContain("aiReportDetails.rich.qbq.title");
    await unmount();
  });

  it("handles subjective papers: no times, answers being checked, a 0% weakness", async () => {
    const base = report();
    const questions = base.questions.map((q, i) => ({
      ...q, time_seconds: null, outcome: i < 2 ? "PENDING" : q.outcome, marks: i < 2 ? 0 : q.marks,
    }));
    respond = async () => ({
      data: { ...base, questions, sections: base.sections.map((s) => ({ ...s, time_seconds: 0 })),
        ai: { ...base.ai, weaknesses: { "Cell organelles": 0 } } },
    });
    const { host, unmount } = await mount({ assessmentId: "a5" });
    const text = host.textContent ?? "";
    expect(text).toContain("aiReportDetails.rich.answers.captionNoTime");
    expect(text).not.toContain("aiReportDetails.rich.answers.caption ");
    expect(text).toContain("aiReportDetails.rich.hero.pending");
    expect(text).toContain("Cell organelles");
    // No times: no speed chart, no time-by-section chart.
    expect(text).not.toContain("aiReportDetails.rich.speed.title");
    expect(text).not.toContain("aiReportDetails.rich.time.title");
    await unmount();
  });

  it("falls back to the summary view when the server cannot build the report", async () => {
    respond = () => Promise.reject(new Error("502"));
    const { host, unmount } = await mount({ assessmentId: "a3" });
    expect(host.querySelector('[data-testid="fallback"]')).not.toBeNull();
    await unmount();
  });

  it("asks the server once per attempt, even across remounts", async () => {
    respond = async () => ({ data: report() });
    const first = await mount({ assessmentId: "a4", attemptId: "t4" });
    await first.unmount();
    const second = await mount({ assessmentId: "a4", attemptId: "t4" });
    expect(calls.filter((c) => c.url === "/ai-data")).toHaveLength(1);
    await second.unmount();
  });
});

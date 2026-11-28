// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuizInstantFeedbackPanel } from "./quiz-instant-feedback-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key.replace("quizViewer.instantFeedback.", "") }),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const draw = (props: Parameters<typeof QuizInstantFeedbackPanel>[0]) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<QuizInstantFeedbackPanel {...props} />));
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("QuizInstantFeedbackPanel", () => {
  it("says correct and shows the explanation, not the answer again", () => {
    const el = draw({ verdict: "correct", answerHtml: ["<p>A</p>"], answerKind: "key", explanationHtml: "<p>Why</p>" });
    expect(el.textContent).toContain("correct");
    expect(el.textContent).not.toContain("correctAnswer");
    expect(el.textContent).toContain("explanation");
    expect(el.textContent).toContain("Why");
    expect(el.querySelector('[role="status"]')).not.toBeNull();
  });

  it("says incorrect and lists every correct answer", () => {
    const el = draw({ verdict: "incorrect", answerHtml: ["One", "Two"], answerKind: "key", explanationHtml: null });
    expect(el.textContent).toContain("incorrect");
    expect(el.textContent).toContain("correctAnswers");
    expect(el.textContent).toContain("One");
    expect(el.textContent).toContain("Two");
    expect(el.textContent).not.toContain("explanation");
  });

  it("offers the model answer for a written answer", () => {
    const el = draw({ verdict: "compare", answerHtml: ["<p>Model</p>"], answerKind: "model", explanationHtml: null });
    expect(el.textContent).toContain("compare");
    expect(el.textContent).toContain("modelAnswer");
    expect(el.textContent).toContain("Model");
  });

  it("says there is no key when there is nothing to show", () => {
    const el = draw({ verdict: "compare", answerHtml: [], answerKind: "model", explanationHtml: null });
    expect(el.textContent).toContain("noKey");
  });
});

// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({ useTranslation: (ns: string) => ({ t: (key: string) => `${ns}:${key}` }) }));
vi.mock("./use-quiz-place", () => ({
  useQuizPlace: () => ({ courseId: "", colourClass: "", courseName: null, chapterName: null, courseTerm: "Course", toCourse: () => {} }),
}));
// The Fun font stylesheet is the skin hook's business, not this test's.
vi.mock("@/hooks/use-fun-theme", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void) => {
    const o = new MutationObserver(cb);
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  };
  return {
    useFunTheme: () =>
      useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("ui-fun"), () => false),
  };
});

const { QuizStartCard, QuizTimeUpCard } = await import("../quiz-start-card");

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.documentElement.className = "";
});

const start = (
  <QuizStartCard
    title="Chapter check-in"
    description="<p>Five questions on lenses.</p>"
    questionCount={5}
    timeLimitMinutes={10}
    maxAttempts={3}
    usedAttempts={1}
    attemptsPending={false}
    passPercentage={60}
    negativeMarking={0}
    canStart
    onStart={() => {}}
  />
);

describe("the quiz cards follow the skin", () => {
  it("keeps the standard start card for every other skin", async () => {
    for (const skin of ["", "ui-vibrant", "ui-corporate", "ui-play", "ui-cleaner-play"]) {
      document.documentElement.className = skin;
      const el = await render(start);
      expect(el.querySelector(".fun-quiz")).toBeNull();
      expect(el.querySelector("dl")).not.toBeNull();
      await act(async () => root?.unmount());
      host?.remove();
    }
  });

  it("draws the Fun start card under ui-fun, with the same facts", async () => {
    document.documentElement.className = "ui-fun";
    const el = await render(start);
    expect(el.querySelector(".fun-quiz-start")).not.toBeNull();
    expect(el.querySelectorAll(".fun-quiz-start__fact").length).toBe(4);
    expect(el.querySelector(".fun-quiz-start__about")!.textContent).toBe("Five questions on lenses.");
    expect(el.querySelector(".fun-quiz-start__go")!.textContent).toBe("libraryCommonB:quizViewer.start.startAttemptButton");
  });

  it("switches the time-up card with the skin", async () => {
    const el = await render(<QuizTimeUpCard failed onRetry={() => {}} />);
    expect(el.querySelector(".fun-quiz")).toBeNull();
    await act(async () => {
      document.documentElement.className = "ui-fun";
    });
    expect(el.querySelector(".fun-quiz-state")).not.toBeNull();
    expect(el.querySelector('[role="status"]')!.textContent).toBe("libraryCommonB:quizViewer.start.timeUpFailedBody");
  });
});

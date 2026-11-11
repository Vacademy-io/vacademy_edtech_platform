// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keys come back with their values, so a test can read what was asked for.
vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      `${ns}:${key}${opts ? JSON.stringify(Object.fromEntries(Object.entries(opts).filter(([k]) => k !== "defaultValue"))) : ""}`,
  }),
}));
const back = vi.fn();
vi.mock("./use-quiz-place", () => ({
  useQuizPlace: () => ({
    courseId: "pkg-physics",
    colourClass: "fun-course-3",
    courseName: "Physics",
    chapterName: "Lenses and mirrors",
    courseTerm: "Course",
    toCourse: back,
  }),
}));
vi.mock("@/components/chatbot/moments/WhyWrongButton", () => ({
  WhyWrongButton: ({ className }: { className?: string }) => <button type="button" className={className} data-tutor="1">tutor</button>,
}));
vi.mock("@/components/chatbot/moments/SelectionAskPill", () => ({
  SelectionAskZone: ({ className, children }: { className?: string; children: ReactNode }) => <div className={className}>{children}</div>,
}));
vi.mock("@/components/chatbot/moments/tutor-moments", () => ({ readWhyWrongPart: () => "" }));
vi.mock("@/services/upload_file", () => ({ getPublicUrl: async () => "https://files.example.invalid/a.pdf" }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({ getTerminology: (_k: string, d: string) => d }));

const { FunQuizResult } = await import("./FunQuizResult");
const { FunQuizQuestion, FunQuizTimer } = await import("./FunQuizQuestion");
const { LessonNextContext } = await import("../lesson-next-context");
const { LessonScreenContext } = await import("../lesson-screen-context");
type ResultProps = Parameters<typeof FunQuizResult>[0];
type QuestionProps = Parameters<typeof FunQuizQuestion>[0];

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
  back.mockClear();
});

const row = (n: number, status: "correct" | "wrong" | "partial" | "skipped", extra: object = {}) => ({
  id: `q${n}`,
  number: n,
  questionHtml: `<p>Question ${n} text</p>`,
  status,
  marks: { earned: status === "correct" ? 1 : status === "partial" ? 0.5 : 0, max: 1 },
  partialShare: status === "partial" ? 0.5 : 0,
  yourAnswer: status === "skipped" ? [] : [{ letter: "C", html: "Option c" }],
  correctAnswer: [{ letter: "A", html: "Option a" }],
  explanationHtml: "<p>Worked explanation.</p>",
  feedback: null,
  ...extra,
});

const base: ResultProps = {
  title: "Chapter check-in",
  score: { earned: 3, totalMarks: 5, correct: 3, partial: 0, wrong: 2, skipped: 0 },
  passed: true,
  passPercentage: 50,
  attemptNumber: 1,
  maxAttempts: 3,
  canReattempt: true,
  onRestart: () => {},
  rows: [row(1, "correct"), row(2, "wrong"), row(3, "correct"), row(4, "wrong"), row(5, "correct")],
  showCorrectAnswers: true,
  pastAttempts: [],
  onSelectAttempt: () => {},
  viewingPast: false,
  viewingPastHasData: true,
  onBackToLatest: () => {},
};

const text = (el: Element | null | undefined) => (el?.textContent ?? "").trim();
const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll("button"));

describe("FunQuizResult", () => {
  it("shows the marks, the verdict and the pass mark when the quiz has one", async () => {
    const el = await render(<FunQuizResult {...base} />);
    expect(el.querySelector(".fun-quiz")!.className).toContain("fun-course-3");
    expect(text(el.querySelector(".fun-quiz-result__headline"))).toBe("funQuiz:result.passed");
    const marks = text(el.querySelector(".fun-quiz-result__marks"));
    expect(marks).toContain('result.marks{"count":5,"earned":"3","total":"5"}');
    expect(marks).toContain("result.passMark");
    expect(el.querySelector("svg.fun-quiz-ring")!.getAttribute("aria-label")).toContain('"percent":60');
    expect(text(el.querySelector(".fun-quiz-ring__text"))).toBe("60%");
    expect(el.querySelector(".fun-quiz-ring__tick")).toBeNull();
    expect(el.querySelector(".fun-quiz-result__sprinkles")).not.toBeNull();
    expect(text(el.querySelector(".fun-quiz-result__where"))).toBe("Chapter check-in · Lenses and mirrors");
  });

  it("uses a neutral headline and no verdict without a pass mark", async () => {
    const el = await render(<FunQuizResult {...base} passed={null} passPercentage={null} />);
    expect(text(el.querySelector(".fun-quiz-result__headline"))).toBe("funQuiz:result.done");
    expect(text(el.querySelector(".fun-quiz-result__marks"))).not.toContain("passMark");
    expect(el.querySelector(".fun-quiz-result__sprinkles")).toBeNull();
    expect(el.querySelector(".fun-quiz-result__card")!.getAttribute("data-verdict")).toBe("none");
  });

  it("marks the pass mark on the ring and makes Try again the main button when not passed", async () => {
    const onRestart = vi.fn();
    const el = await render(
      <FunQuizResult
        {...base}
        passed={false}
        passPercentage={60}
        score={{ earned: 1, totalMarks: 5, correct: 1, partial: 0, wrong: 4, skipped: 0 }}
        onRestart={onRestart}
      />,
    );
    expect(text(el.querySelector(".fun-quiz-result__headline"))).toBe("funQuiz:result.notPassed");
    expect(el.querySelector(".fun-quiz-ring__tick")!.getAttribute("d")).toBe("M42.8 116.9 L32.3 131.4");
    expect(text(el.querySelector(".fun-quiz-result__attempt-chip"))).toContain('result.triesLeft{"count":2}');
    const primary = el.querySelector(".fun-quiz-result__primary")!;
    expect(text(primary)).toContain("result.tryAgain");
    expect(text(primary)).toContain('result.attemptOf{"number":2,"total":3}');
    await act(async () => (primary as HTMLButtonElement).click());
    expect(onRestart).toHaveBeenCalledTimes(1);
    const secondary = el.querySelector(".fun-quiz-result__secondary")!;
    expect(text(secondary)).toContain('result.backToCourse{"course":"course"}');
    await act(async () => (secondary as HTMLButtonElement).click());
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("hides Try again once attempts have run out", async () => {
    const el = await render(<FunQuizResult {...base} passed={false} passPercentage={60} attemptNumber={3} canReattempt={false} />);
    expect(buttons(el).some((b) => text(b).includes("result.tryAgain"))).toBe(false);
    expect(el.querySelector(".fun-quiz-result__secondary")).toBeNull();
    expect(text(el.querySelector(".fun-quiz-result__attempt-chip"))).toContain("result.noTriesLeft");
  });

  it("offers the viewer's Next while the viewer has one open", async () => {
    const onNext = vi.fn();
    const el = await render(
      <LessonNextContext.Provider value={onNext}>
        <FunQuizResult {...base} />
      </LessonNextContext.Provider>,
    );
    const primary = el.querySelector(".fun-quiz-result__primary") as HTMLButtonElement;
    expect(text(primary)).toBe("funQuiz:result.next");
    await act(async () => primary.click());
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(text(el.querySelector(".fun-quiz-result__secondary"))).toBe("funQuiz:result.tryAgain");
  });

  it("goes back to the course without a viewer Next, and closes to the course", async () => {
    const el = await render(
      <LessonNextContext.Provider value={null}>
        <FunQuizResult {...base} />
      </LessonNextContext.Provider>,
    );
    const primary = el.querySelector(".fun-quiz-result__primary") as HTMLButtonElement;
    expect(text(primary)).toBe('funQuiz:result.backToCourse{"course":"course"}');
    await act(async () => primary.click());
    expect(back).toHaveBeenCalledTimes(1);
    const close = el.querySelector(".fun-quiz-result__head .fun-quiz__close") as HTMLButtonElement;
    expect(close.getAttribute("aria-label")).toBe("funQuiz:closeQuiz");
    await act(async () => close.click());
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("adds partial and skipped tiles only when there are any", async () => {
    let el = await render(<FunQuizResult {...base} />);
    expect(Array.from(el.querySelectorAll(".fun-quiz-result__tile")).map((t) => t.getAttribute("data-kind"))).toEqual([
      "correct",
      "wrong",
      "attempt",
    ]);
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(
      <FunQuizResult {...base} score={{ earned: 3, totalMarks: 5, correct: 2, partial: 2, wrong: 0, skipped: 1 }} />,
    );
    expect(Array.from(el.querySelectorAll(".fun-quiz-result__tile")).map((t) => t.getAttribute("data-kind"))).toEqual([
      "correct",
      "wrong",
      "partial",
      "skipped",
      "attempt",
    ]);
    // Each label is asked for with its count, so a language can agree with it.
    expect(Array.from(el.querySelectorAll(".fun-quiz-result__tile-label")).slice(0, 4).map(text)).toEqual([
      'funQuiz:result.tileCorrect{"count":2}',
      'funQuiz:result.tileWrong{"count":0}',
      'funQuiz:result.tilePartial{"count":2}',
      'funQuiz:result.tileSkipped{"count":1}',
    ]);
  });

  it("opens See why on a wrong row with the answers, the explanation and the tutor", async () => {
    const el = await render(<FunQuizResult {...base} />);
    const rows = Array.from(el.querySelectorAll("li.fun-quiz-row"));
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["correct", "wrong", "correct", "wrong", "correct"]);
    expect(rows[0]!.querySelector(".fun-quiz-row__why")).toBeNull();
    const why = rows[1]!.querySelector(".fun-quiz-row__why") as HTMLButtonElement;
    expect(why.getAttribute("aria-expanded")).toBe("false");
    await act(async () => why.click());
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(rows[1]!.hasAttribute("data-why-wrong-scope")).toBe(true);
    expect(text(rows[1]!.querySelector('[data-why-wrong="yours"]'))).toBe("COption c");
    expect(text(rows[1]!.querySelector('[data-why-wrong="correct"]'))).toBe("AOption a");
    expect(text(rows[1]!.querySelector(".fun-quiz-why__explain"))).toContain("Worked explanation.");
    expect(rows[1]!.querySelector("[data-tutor]")).not.toBeNull();
  });

  it("never offers See why while the quiz hides its answers", async () => {
    const el = await render(<FunQuizResult {...base} showCorrectAnswers={false} />);
    expect(el.querySelector(".fun-quiz-row__why")).toBeNull();
    expect(el.querySelectorAll("li.fun-quiz-row").length).toBe(5);
  });

  it("shows a teacher's note under its row and lists past attempts", async () => {
    const onSelect = vi.fn();
    const el = await render(
      <FunQuizResult
        {...base}
        rows={[row(1, "correct", { feedback: { text: "Good method.", fileId: "" } })]}
        pastAttempts={[
          { id: "att1", number: 2, score: { earned: 4, total: 5, pct: 80 }, notes: 1, endTime: "2026-11-02T10:10:00Z", active: true },
          { id: "att0", number: 1, score: { earned: 1, total: 5, pct: 20 }, notes: 0, endTime: "2026-11-01T10:10:00Z", active: false },
        ]}
        onSelectAttempt={onSelect}
      />,
    );
    expect(text(el.querySelector(".fun-quiz-note__text"))).toBe("Good method.");
    const toggle = el.querySelector(".fun-quiz-result__past-toggle") as HTMLButtonElement;
    await act(async () => toggle.click());
    const pastRows = Array.from(el.querySelectorAll(".fun-quiz-result__past-row")) as HTMLButtonElement[];
    expect(pastRows.length).toBe(2);
    expect(pastRows[0]!.getAttribute("aria-current")).toBe("true");
    await act(async () => pastRows[1]!.click());
    expect(onSelect).toHaveBeenCalledWith("att0");
  });

  it("says when an earlier attempt is on screen and goes back to the latest", async () => {
    const onBack = vi.fn();
    const el = await render(
      <FunQuizResult
        {...base}
        attemptNumber={2}
        viewingPast
        onBackToLatest={onBack}
        pastAttempts={[
          { id: "att1", number: 2, score: null, notes: 0, endTime: null, active: false },
          { id: "att0", number: 1, score: null, notes: 0, endTime: null, active: true },
        ]}
      />,
    );
    expect(text(el.querySelector(".fun-quiz-result__headline"))).toBe("funQuiz:result.pastPassed");
    expect(text(el.querySelector(".fun-quiz-result__tile[data-kind='attempt']"))).toContain('"number":1');
    const btn = buttons(el).find((b) => text(b) === "funQuiz:result.backToLatest")!;
    await act(async () => btn.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

const qbase: QuestionProps = {
  title: "Chapter check-in",
  current: 2,
  total: 5,
  questionId: "q2",
  questionType: "MCQS",
  questionHtml: "<p>Where does the image form?</p>",
  marks: 1,
  options: ["a", "b", "c", "d"].map((x) => ({ id: `q2${x}`, html: `Option ${x}` })),
  answer: undefined,
  incorrectNotice: false,
  answered: false,
  submitting: false,
  onSelect: () => {},
  onToggle: () => {},
  onText: () => {},
  onNumeric: () => {},
  onPrev: () => {},
  onNext: () => {},
};

describe("one top-level heading per screen", () => {
  it("is the headline on the result and the question on the question screen", async () => {
    let el = await render(<FunQuizResult {...base} />);
    expect(el.querySelectorAll("h1")).toHaveLength(1);
    expect(el.querySelector("h1")!.className).toBe("fun-quiz-result__headline");
    expect(el.querySelectorAll("h2.fun-quiz-result__headline")).toHaveLength(0);
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(<FunQuizQuestion {...qbase} />);
    const tops = el.querySelectorAll('h1, [role="heading"][aria-level="1"]');
    expect(tops).toHaveLength(1);
    expect(tops[0]!.classList.contains("fun-quiz__question")).toBe(true);
  });
});

describe("FunQuizQuestion", () => {
  it("draws pick-one options as a radio group and holds Next until answered", async () => {
    const onSelect = vi.fn();
    const el = await render(<FunQuizQuestion {...qbase} onSelect={onSelect} />);
    expect(el.querySelector('[role="radiogroup"]')).not.toBeNull();
    const radios = Array.from(el.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
    expect(radios.map((r) => text(r.querySelector(".fun-quiz__letter")))).toEqual(["A", "B", "C", "D"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    expect((el.querySelector(".fun-quiz__next") as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector(".fun-quiz__prev") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => radios[1]!.click());
    expect(onSelect).toHaveBeenCalledWith("q2b");
    // Arrow keys move and choose, as a radio group does.
    await act(async () => radios[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith("q2c");
    expect(document.activeElement).toBe(radios[2]);
    await act(async () => radios[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith("q2d");
    expect(el.textContent).not.toMatch(/review/i);
    expect(el.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("3");
    expect(el.querySelector(".fun-quiz__bar-fill")!.getAttribute("width")).toBe("60%");
    expect(text(el.querySelector(".fun-quiz__eyebrow"))).toBe("Physics · Lenses and mirrors");
    expect(text(el.querySelector(".fun-quiz__marks"))).toContain('marks{"count":1,"value":"1"}');
  });

  it("marks the chosen option and enables Next once answered", async () => {
    const el = await render(<FunQuizQuestion {...qbase} answer="q2c" answered />);
    const radios = Array.from(el.querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false"]);
    expect(radios.map((r) => (r as HTMLButtonElement).tabIndex)).toEqual([-1, -1, 0, -1]);
    expect((el.querySelector(".fun-quiz__next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("draws checkboxes and says select all that apply on a multiple-answer question", async () => {
    const onToggle = vi.fn();
    const el = await render(<FunQuizQuestion {...qbase} questionType="MCQM" answer={["q2a"]} answered onToggle={onToggle} />);
    expect(el.querySelector('[role="group"]')).not.toBeNull();
    const boxes = Array.from(el.querySelectorAll('[role="checkbox"]')) as HTMLButtonElement[];
    expect(boxes.length).toBe(4);
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
    expect(el.querySelectorAll(".fun-quiz__check").length).toBe(4);
    expect(text(el.querySelector(".fun-quiz__note"))).toBe("funQuiz:selectAll");
    await act(async () => boxes[3]!.click());
    expect(onToggle).toHaveBeenCalledWith("q2d");
  });

  it("gives numeric, one-word and long answers their own inputs, with the number error", async () => {
    const onNumeric = vi.fn();
    let el = await render(<FunQuizQuestion {...qbase} questionType="NUMERIC" numericError="Please enter a valid number" onNumeric={onNumeric} />);
    const input = el.querySelector("input.fun-quiz__input") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(text(el.querySelector('[role="alert"]'))).toBe("Please enter a valid number");
    expect(el.querySelector('[role="radio"]')).toBeNull();
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(<FunQuizQuestion {...qbase} questionType="LONG_ANSWER" />);
    expect(el.querySelector("textarea.fun-quiz__input--long")).not.toBeNull();
  });

  it("shows the passage, shortened with Show more when it is long, and the last question finishes", async () => {
    const long = `<p>${"Light bends as it passes through a lens. ".repeat(10)}</p>`;
    const el = await render(<FunQuizQuestion {...qbase} current={4} passageHtml={long} answered answer="q2a" />);
    expect(text(el.querySelector(".fun-quiz__passage-text")).endsWith("…")).toBe(true);
    const more = el.querySelector(".fun-quiz__link") as HTMLButtonElement;
    await act(async () => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(text(el.querySelector(".fun-quiz__next"))).toBe("libraryCommonB:quizViewer.buttons.finish");
  });

  it("says so when a wrong answer must be fixed before moving on", async () => {
    const el = await render(<FunQuizQuestion {...qbase} answer="q2c" answered incorrectNotice />);
    expect(el.querySelector(".fun-quiz__wrong")!.getAttribute("role")).toBe("alert");
    expect(text(el.querySelector(".fun-quiz__wrong"))).toBe("libraryCommonB:quizViewer.incorrectTryAgain");
  });

  it("shows the timer only when the quiz gives one", async () => {
    let el = await render(<FunQuizQuestion {...qbase} />);
    expect(el.querySelector('[role="timer"]')).toBeNull();
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(<FunQuizQuestion {...qbase} timer={<FunQuizTimer secondsLeft={522} warning={false} />} />);
    const timer = el.querySelector('.fun-quiz__timer [role="timer"]')!;
    expect(text(timer)).toBe("8:42");
    const label = timer.getAttribute("aria-label")!;
    expect(label.startsWith("funQuiz:timer.label")).toBe(true);
    expect(label).toContain("timer.join");
    expect(label).toMatch(/timer\.minutes\{[^}]*8\}/);
    expect(label).toMatch(/timer\.seconds\{[^}]*42\}/);
  });

  it("names the time left in words, minutes or seconds alone when the other is zero", async () => {
    let el = await render(<FunQuizTimer secondsLeft={120} warning />);
    let timer = el.querySelector('[role="timer"]')!;
    expect(text(timer)).toBe("2:00");
    expect(timer.getAttribute("aria-label")).toContain("timer.minutes");
    expect(timer.getAttribute("aria-label")).not.toContain("timer.seconds");
    expect(timer.getAttribute("data-warning")).toBe("true");
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(<FunQuizTimer secondsLeft={9} warning />);
    timer = el.querySelector('[role="timer"]')!;
    expect(text(timer)).toBe("0:09");
    expect(timer.getAttribute("aria-label")).toMatch(/timer\.seconds\{[^}]*9\}/);
    expect(timer.getAttribute("aria-label")).not.toContain("timer.minutes");
  });

  it("puts a close control before the heading that goes to the course", async () => {
    const el = await render(<FunQuizQuestion {...qbase} />);
    const head = el.querySelector(".fun-quiz__head")!;
    const close = head.firstElementChild as HTMLButtonElement;
    expect(close.className).toBe("fun-quiz__close");
    expect(close.getAttribute("aria-label")).toBe("funQuiz:closeQuiz");
    await act(async () => close.click());
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("the lesson viewer's bars", () => {
  // The viewer keeps a count of mounted screens that bring their own header and
  // buttons, and leaves its own bars out while the count is above zero.
  function Viewer({ children, onCount }: { children: ReactNode; onCount: (n: number) => void }) {
    const [count, setCount] = useState(0);
    useEffect(() => {
      onCount(count);
    }, [count, onCount]);
    return <LessonScreenContext.Provider value={setCount}>{children}</LessonScreenContext.Provider>;
  }

  it("step aside while the question or the result is on screen, and come back after", async () => {
    const counts: number[] = [];
    const onCount = (n: number) => counts.push(n);
    await render(
      <Viewer onCount={onCount}>
        <FunQuizQuestion {...qbase} />
      </Viewer>,
    );
    expect(counts.at(-1)).toBe(1);
    // Question to result in one commit: the count never drops to zero in between.
    await act(async () =>
      root!.render(
        <Viewer onCount={onCount}>
          <FunQuizResult {...base} />
        </Viewer>,
      ),
    );
    expect(counts.at(-1)).toBe(1);
    expect(counts.slice(1)).not.toContain(0);
    await act(async () => root!.render(<Viewer onCount={onCount}>{null}</Viewer>));
    expect(counts.at(-1)).toBe(0);
  });

  it("are left alone outside the viewer", async () => {
    const el = await render(<FunQuizQuestion {...qbase} />);
    expect(el.querySelector(".fun-quiz__nav")).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keys come back with their options so the tests can read what was asked for.
vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      `${ns}:${key}${opts ? JSON.stringify(Object.fromEntries(Object.entries(opts).filter(([k]) => k !== "defaultValue"))) : ""}`,
  }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_key: string, fallback: string) => fallback,
  getTerminologyPlural: (_key: string, fallback: string) => `${fallback}s`,
}));

const { FunSlideRow, FunChapterHead, FunLevelHead } = await import("./FunOutline");
const { FunLessonBottomBar } = await import("./FunLesson");
const { LockedBadge } = await import("@/components/drip-conditions/LockedBadge");

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
  document.documentElement.classList.remove("ui-fun");
});

const row = (over: Partial<Parameters<typeof FunSlideRow>[0]> = {}) => (
  <FunSlideRow
    title="Mirror formula"
    index={3}
    state="notStarted"
    kind="video"
    current={false}
    locked={false}
    clickable
    onOpen={() => {}}
    meta="8 min"
    {...over}
  />
);

describe("FunSlideRow", () => {
  it("draws each state's mark", async () => {
    const el = await render(
      <>
        {row({ state: "done" })}
        {row({ state: "inProgress" })}
        {row({ state: "notStarted" })}
        {row({ state: "notStarted", kind: "quiz" })}
        {row({ state: "notStarted", locked: true, clickable: false })}
      </>,
    );
    const marks = Array.from(el.querySelectorAll(".fun-mark")).map((m) => m.className.replace("fun-mark ", ""));
    expect(marks).toEqual(["fun-mark--done", "fun-mark--half", "fun-mark--number", "fun-mark--test", "fun-mark--locked"]);
    expect(el.querySelectorAll(".fun-mark--number")[0]!.textContent).toBe("3");
  });

  it("marks the current row, says Continue, and never draws a finished slide as current in the outline", async () => {
    const el = await render(
      <>
        {row({ current: true, state: "inProgress" })}
        {row({ current: true, state: "done" })}
      </>,
    );
    const rows = Array.from(el.querySelectorAll(".fun-row"));
    expect(rows[0]!.getAttribute("data-fun-row-state")).toBe("current");
    expect(rows[0]!.querySelector(".fun-row__continue")!.textContent).toBe("funCourse:course.continue");
    expect(rows[1]!.getAttribute("data-fun-row-state")).toBe("done");
  });

  it("in the viewer list the open slide is filled even when done, without a Continue label", async () => {
    const el = await render(row({ current: true, state: "done", activeStyle: true }));
    const r = el.querySelector(".fun-row")!;
    expect(r.getAttribute("data-fun-row-state")).toBe("current");
    expect(r.querySelector(".fun-row__continue")).toBeNull();
  });

  it("opens on click, Enter and Space only when clickable", async () => {
    const onOpen = vi.fn();
    const el = await render(
      <>
        {row({ onOpen })}
        {row({ onOpen, clickable: false })}
      </>,
    );
    const [open, shut] = Array.from(el.querySelectorAll<HTMLElement>(".fun-row"));
    expect(open!.getAttribute("role")).toBe("button");
    expect(open!.tabIndex).toBe(0);
    await act(async () => open!.click());
    await act(async () => open!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => open!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    await act(async () => open!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(shut!.getAttribute("role")).toBeNull();
    await act(async () => shut!.click());
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("writes the unlock message inline and tags quizzes", async () => {
    const el = await render(
      <>
        {row({ locked: true, clickable: false, unlockMessage: "Opens on Friday" })}
        {row({ kind: "quiz", meta: "" })}
      </>,
    );
    expect(el.querySelector(".fun-row__lock")!.textContent).toBe("Opens on Friday");
    expect(el.querySelector(".fun-row__tag")!.textContent).toBe("funCourse:course.quizTag");
  });
});

describe("FunChapterHead", () => {
  it("says X of Y once loaded, else the server state", async () => {
    const el = await render(
      <>
        <FunChapterHead index={3} name="Lenses" open locked={false} doneCount={{ done: 2, total: 5 }} percent={40} />
        <FunChapterHead index={4} name="Instruments" open={false} locked={false} doneCount={null} percent={0} />
        <FunChapterHead index={5} name="Atoms" open={false} locked={false} doneCount={null} percent={62} />
        <FunChapterHead index={6} name="Waves" open={false} locked={false} doneCount={null} percent={100} />
      </>,
    );
    const subs = Array.from(el.querySelectorAll(".fun-ch__sub")).map((s) => s.textContent);
    expect(subs[0]).toBe('funCourse:course.doneOf{"done":2,"total":5,"slides":"slides"}');
    expect(subs[1]).toBe("funCommon:notStarted");
    expect(subs[2]).toBe('funCommon:percentDone{"percent":62}');
    expect(subs[3]).toBe("funCommon:done");
    expect(el.querySelectorAll(".fun-ch__badge")[0]!.textContent).toBe("3");
  });

  it("a locked chapter shows the padlock, the unlock message and no chevron", async () => {
    const el = await render(
      <FunChapterHead index={4} name="Instruments" open={false} locked unlockMessage="Finish Lenses first" doneCount={null} percent={0} />,
    );
    expect(el.querySelector(".fun-ch__badge--locked svg")).not.toBeNull();
    expect(el.querySelector(".fun-ch__sub")!.textContent).toBe("Finish Lenses first");
    expect(el.querySelector(".fun-chevron")).toBeNull();
  });
});

describe("FunLevelHead", () => {
  it("shows a done summary, a percent bar or not started", async () => {
    const el = await render(
      <>
        <FunLevelHead level="module" index={1} name="Electricity" open={false} locked={false} percent={100} childCount={2} childTerm="chapters" />
        <FunLevelHead level="module" index={2} name="Optics" open locked={false} percent={45} childCount={2} childTerm="chapters" />
        <FunLevelHead level="subject" index={3} name="Modern" open={false} locked={false} percent={0} childCount={1} childTerm="modules" />
      </>,
    );
    expect(el.querySelector(".fun-lv__done")!.textContent).toBe('funCourse:course.levelDone{"count":2,"term":"chapters"}');
    expect(el.querySelector('.fun-lv__progress [role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("45");
    expect(el.querySelector(".fun-lv__muted")!.textContent).toBe("funCommon:notStarted");
    expect(el.querySelectorAll(".fun-lv__eyebrow")[2]!.textContent).toBe('funCourse:course.levelEyebrow{"level":"Subject","index":3}');
  });
});

describe("FunLessonBottomBar", () => {
  it("passes the viewer's edge and lock rules through as disabled buttons", async () => {
    const el = await render(
      <FunLessonBottomBar upNext="Refraction" canGoPrev={false} canGoNext onPrev={() => {}} onNext={() => {}} />,
    );
    const [prev, next] = Array.from(el.querySelectorAll("button"));
    expect(prev!.disabled).toBe(true);
    expect(next!.disabled).toBe(false);
    expect(el.querySelector(".fun-lesson-bottom__next")!.textContent).toBe('funCourse:lesson.upNext{"title":"Refraction"}');
  });
});

describe("LockedBadge", () => {
  it("under ui-fun writes the unlock message out instead of hiding it in a tooltip", async () => {
    document.documentElement.classList.add("ui-fun");
    const el = await render(<LockedBadge size="sm" unlockMessage="Opens on Friday" />);
    expect(el.querySelector(".fun-locked__msg")!.textContent).toBe("Opens on Friday");
  });
  it("keeps the badge for every other skin", async () => {
    const el = await render(<LockedBadge size="sm" unlockMessage="Opens on Friday" />);
    expect(el.querySelector(".fun-locked")).toBeNull();
    expect(el.textContent).toContain("courseComponentsExtra:dripConditions.common.locked");
  });
});

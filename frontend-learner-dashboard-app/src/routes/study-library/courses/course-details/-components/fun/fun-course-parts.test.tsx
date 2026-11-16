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

// The institute's "hide progress" answer, set per test (null = not read yet).
const hideProgressAnswer = vi.hoisted(() => ({ value: false as boolean | null }));
vi.mock("@/hooks/use-hide-progress", () => ({ useHideProgress: () => hideProgressAnswer.value }));

const { FunSlideRow, FunChapterHead, FunLevelHead } = await import("./FunOutline");
const { FunLessonBottomBar, FunLessonTopBar, FunViewerTopBar } = await import("./FunLesson");
const { FunCourseError } = await import("./FunCourseError");
const { FunPickUpCard } = await import("./FunPickUpCard");
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

  it("uses the singular slide term for a chapter of one", async () => {
    const el = await render(
      <FunChapterHead index={1} name="Charges" open locked={false} doneCount={{ done: 1, total: 1 }} percent={100} />,
    );
    expect(el.querySelector(".fun-ch__sub")!.textContent).toBe('funCourse:course.doneOf{"done":1,"total":1,"slides":"slide"}');
  });

  it("a locked chapter shows the padlock, the unlock message and no chevron", async () => {
    const el = await render(
      <FunChapterHead index={4} name="Instruments" open={false} locked unlockMessage="Finish Lenses first" doneCount={null} percent={0} />,
    );
    expect(el.querySelector(".fun-ch__badge--locked svg")).not.toBeNull();
    expect(el.querySelector(".fun-ch__sub")!.textContent).toBe("Finish Lenses first");
    expect(el.querySelector(".fun-chevron")).toBeNull();
  });

  it("prints no progress while the institute hides it: the slide count once loaded, else nothing", async () => {
    const el = await render(
      <>
        <FunChapterHead index={3} name="Lenses" open locked={false} doneCount={{ done: 2, total: 5 }} percent={40} hideProgress slideCount={5} />
        <FunChapterHead index={4} name="Atoms" open={false} locked={false} doneCount={null} percent={62} hideProgress slideCount={null} />
        <FunChapterHead index={5} name="Waves" open={false} locked={false} doneCount={null} percent={100} hideProgress slideCount={1} />
      </>,
    );
    const heads = Array.from(el.querySelectorAll(".fun-ch__text"));
    expect(heads[0]!.querySelector(".fun-ch__sub")!.textContent).toBe('funCourse:course.countChip{"count":5,"term":"slides"}');
    expect(heads[1]!.querySelector(".fun-ch__sub")).toBeNull();
    expect(heads[2]!.querySelector(".fun-ch__sub")!.textContent).toBe('funCourse:course.countChip{"count":1,"term":"slide"}');
    expect(el.querySelector(".fun-ch__sub--done")).toBeNull();
    expect(el.textContent).not.toMatch(/doneOf|percentDone|funCommon:done|notStarted/);
  });
});

describe("FunLevelHead", () => {
  it("prints the size instead of progress while the institute hides it", async () => {
    const el = await render(
      <>
        <FunLevelHead level="module" index={1} name="Electricity" open={false} locked={false} percent={100} childCount={2} childTerm="chapters" hideProgress />
        <FunLevelHead level="module" index={2} name="Optics" open locked={false} percent={45} childCount={1} childTerm="chapters" hideProgress />
      </>,
    );
    expect(el.querySelector(".fun-lv__done")).toBeNull();
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(Array.from(el.querySelectorAll(".fun-lv__muted")).map((m) => m.textContent)).toEqual([
      'funCourse:course.countChip{"count":2,"term":"chapters"}',
      'funCourse:course.countChip{"count":1,"term":"chapter"}',
    ]);
  });

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
  it("names a drip-locked next slide as locked", async () => {
    const el = await render(
      <FunLessonBottomBar upNext="Refraction" upNextLocked canGoPrev canGoNext={false} onPrev={() => {}} onNext={() => {}} />,
    );
    const line = el.querySelector(".fun-lesson-bottom__next")!;
    expect(line.classList.contains("fun-lesson-bottom__next--locked")).toBe(true);
    expect(line.textContent).toBe('funCourse:lesson.upNextLocked{"title":"Refraction"}');
    expect(line.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("FunViewerTopBar", () => {
  const bar = () => (
    <FunViewerTopBar
      courseId="pkg-1"
      heading="Spherical mirrors"
      index={2}
      total={5}
      chapterPercent={48}
      canGoPrev
      canGoNext
      onPrev={() => {}}
      onNext={() => {}}
      showNav="wide"
    />
  );
  afterEach(() => {
    hideProgressAnswer.value = false;
  });
  it("shows the chapter's progress when the institute shows progress", async () => {
    hideProgressAnswer.value = false;
    const el = await render(bar());
    expect(el.querySelector(".fun-lesson-top__bar")).not.toBeNull();
  });
  it("draws no percent or bar while progress is hidden or not read yet", async () => {
    for (const value of [true, null]) {
      hideProgressAnswer.value = value;
      const el = await render(bar());
      expect(el.querySelector(".fun-lesson-top__progress")).toBeNull();
      expect(el.textContent).not.toContain("48");
      await act(async () => root?.unmount());
      host?.remove();
      root = null;
    }
  });
});

describe("FunLessonTopBar", () => {
  it("shows the position as text and gives screen readers the labelled version", async () => {
    const el = await render(
      <FunLessonTopBar
        courseId="pkg-1"
        heading="Spherical mirrors"
        index={2}
        total={5}
        chapterPercent={40}
        canGoPrev
        canGoNext
        onPrev={() => {}}
        onNext={() => {}}
        showNav="wide"
      />,
    );
    // The lesson's one h1 is its title (A-Lesson): the app's top bar is not drawn here.
    expect(el.querySelectorAll("h1")).toHaveLength(1);
    expect(el.querySelector("h1")!.textContent).toBe("Spherical mirrors");
    const position = el.querySelector(".fun-lesson-top__position")!;
    expect(position.getAttribute("aria-label")).toBeNull();
    expect(position.querySelector('[aria-hidden="true"]')!.textContent).toBe('funCourse:lesson.position{"index":2,"total":5}');
    expect(position.querySelector(".sr-only")!.textContent).toBe('funCourse:lesson.positionLabel{"slide":"Slide","index":2,"total":5}');
    // The percent sign comes from the locale, not the code.
    expect(el.querySelector(".fun-lesson-top__label")!.textContent).toBe(
      'funCourse:lesson.chapterProgress{"chapter":"Chapter"} · funCommon:percent{"percent":40}',
    );
    // No way out or outline unless the viewer hands them in.
    expect(el.querySelector(".fun-lesson-top__close")).toBeNull();
    expect(el.querySelector(".fun-lesson-top__titlebtn")).toBeNull();
  });
  it("carries its own close and opens the outline from the title", async () => {
    const onClose = vi.fn();
    const onToggleOutline = vi.fn();
    const el = await render(
      <FunLessonTopBar
        courseId="pkg-1"
        heading="Spherical mirrors"
        index={2}
        total={5}
        chapterPercent={null}
        canGoPrev
        canGoNext
        onPrev={() => {}}
        onNext={() => {}}
        showNav="wide"
        onClose={onClose}
        onToggleOutline={onToggleOutline}
      />,
    );
    const close = el.querySelector<HTMLButtonElement>(".fun-lesson-top__close")!;
    expect(close.getAttribute("aria-label")).toBe('funCourse:lesson.close{"slide":"slide"}');
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    const title = el.querySelector<HTMLButtonElement>(".fun-lesson-top__title > button")!;
    expect(title.querySelector(".fun-lesson-top__titletext")!.textContent).toBe("Spherical mirrors");
    // The heading reads the title only; what the button opens is its description.
    expect(el.querySelector(".fun-lesson-top__title")!.textContent).toBe("Spherical mirrors");
    const hint = el.querySelector(`[id="${title.getAttribute("aria-describedby")}"]`)!;
    expect(hint.textContent).toBe('funCourse:lesson.outline{"chapter":"Chapter"}');
    title.click();
    expect(onToggleOutline).toHaveBeenCalledTimes(1);
  });
});

describe("FunPickUpCard", () => {
  const base = {
    slideId: "sl-2",
    title: "Mirror formula",
    chapterName: "Lenses and mirrors",
    typeLabel: "Video",
    fromResume: true,
  };
  it("draws nothing when the outline has no current slide", async () => {
    const el = await render(<FunPickUpCard current={null} />);
    expect(el.querySelector(".fun-pickup")).toBeNull();
  });
  it("names the outline's current slide and opens it through the outline's handler", async () => {
    const open = vi.fn();
    const el = await render(<FunPickUpCard current={{ ...base, open }} />);
    expect(el.querySelector(".fun-pickup")!.getAttribute("data-fun-pickup")).toBe("sl-2");
    expect(el.querySelector(".fun-pickup__eyebrow")!.textContent).toBe("funCourse:course.pickUpEyebrow");
    expect(el.querySelector(".fun-pickup__title")!.textContent).toBe("Mirror formula");
    expect(el.querySelector(".fun-pickup__meta")!.textContent).toBe("Lenses and mirrors · Video");
    await act(async () => el.querySelector("button")!.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("does not call the first unfinished slide a resume point", async () => {
    const el = await render(<FunPickUpCard current={{ ...base, fromResume: false, typeLabel: "", open: () => {} }} />);
    expect(el.querySelector(".fun-pickup__eyebrow")!.textContent).toBe("funCourse:course.nextUpEyebrow");
    expect(el.querySelector(".fun-pickup__meta")!.textContent).toBe("Lenses and mirrors");
  });
});

describe("FunCourseError", () => {
  it("keeps the default page's copy and its way back", async () => {
    const onBack = vi.fn();
    const el = await render(<FunCourseError onBack={onBack} />);
    expect(el.querySelector('[role="alert"] h2')!.textContent).toBe("courseDetailsC:errorPage.title");
    const back = el.querySelector("button")!;
    expect(back.textContent).toBe("courseDetailsC:common.goBack");
    await act(async () => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
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

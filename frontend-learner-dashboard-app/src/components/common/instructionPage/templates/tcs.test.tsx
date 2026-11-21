// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assessment } from "@/types/assessment";
import { DEFAULT_EXAM_EXPERIENCE } from "@/types/assessment-experience";
import type { ResolvedExamTheme } from "@/types/exam-theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keys come back as text, so the assertions read which sentence was chosen.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    ready: true,
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0 ? `${key}${JSON.stringify(options)}` : key,
  }),
}));

const isolation = vi.fn();
vi.mock("@/components/common/questionLiveTest/themes/use-exam-skin-isolation", () => ({
  useExamSkinIsolation: (id: string) => isolation(id),
}));

vi.mock("@/components/common/questionLiveTest/widgets/use-console-data", () => ({
  useInstituteBrand: () => ({ name: "Sample Institute", logoUrl: "" }),
  useCandidate: () => ({ name: "Asha Rao", photoUrl: "" }),
}));

vi.mock("@/components/common/questionLiveTest/question-html-content", () => ({
  QuestionHtmlContent: ({ html, className }: { html: string; className?: string }) => (
    <div className={className} data-html={html} />
  ),
}));

vi.mock("@/components/common/simple-pdf-viewer", () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-pdf={pdfUrl} />,
}));

vi.mock("@/stores/live-test-store", () => ({
  useLiveTestStore: (select: (s: { immersiveActive: boolean }) => unknown) =>
    select({ immersiveActive: false }),
}));

vi.mock("@/utils/safe-area", () => ({
  topSafeAreaInset: () => "0px",
  bottomSafeAreaInset: () => "0px",
}));

const leave = vi.fn();
vi.mock("../AssessmentNavbar", () => ({ useLeaveBrief: () => leave }));

// The shared start flow: record what the template asks of it.
const startClick = vi.fn();
const startProps: { confirm?: boolean; disabled?: boolean }[] = [];
vi.mock("../StartAssessment", () => ({
  default: (props: {
    disabled?: boolean;
    confirm?: boolean;
    renderTrigger?: (p: {
      onClick: () => void;
      disabled: boolean;
      isLoading: boolean;
      defaultLabel: string;
    }) => ReactNode;
  }) => {
    startProps.push({ confirm: props.confirm, disabled: props.disabled });
    return (
      <>
        {props.renderTrigger?.({
          onClick: startClick,
          disabled: Boolean(props.disabled),
          isLoading: false,
          defaultLabel: "start",
        })}
      </>
    );
  },
}));

const { TcsInstructionTemplate } = await import("./tcs");
const { resolveExamTheme } = await import("@/components/common/questionLiveTest/themes");
const { consoleButtonsFor } = await import(
  "@/components/common/questionLiveTest/layouts/console-chrome"
);

const ASSESSMENT = {
  assessment_id: "a1",
  name: "Sample Mock 1",
  play_mode: "EXAM",
  duration: 180,
  preview_time: 0,
  can_switch_section: true,
  assessment_attempts: 2,
  created_attempts: 0,
} as unknown as Assessment;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

type Props = Partial<Parameters<typeof TcsInstructionTemplate>[0]> & { theme: ResolvedExamTheme };

function render(props: Props) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(
      <TcsInstructionTemplate
        assessmentInfo={ASSESSMENT}
        instructionsHtml=""
        examExperience={DEFAULT_EXAM_EXPERIENCE}
        agreed={false}
        onAgreedChange={() => undefined}
        canStart={false}
        {...props}
      />,
    ),
  );
}

const text = () => host!.textContent ?? "";
const button = (label: string) =>
  Array.from(host!.querySelectorAll("button")).find((b) => b.textContent === label);
const click = (el: Element | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
};

const G = "examThemes.tcs.general";
const B = "examThemes.tcs.brief";

beforeEach(() => {
  isolation.mockClear();
  startClick.mockClear();
  leave.mockClear();
  startProps.length = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("TcsInstructionTemplate, page 1", () => {
  it("draws the strict rules, the real chip shapes, the notices and the theme root", () => {
    const theme = resolveExamTheme({ v: 1, preset: "gate", strict: true });
    render({ theme });

    const rootEl = host!.querySelector(".tcs-brief") as HTMLElement;
    expect(rootEl.dataset.examTheme).toBe("gate");
    expect(rootEl.dataset.examThemeFamily).toBe("tcs");
    expect(isolation).toHaveBeenCalledWith("gate");
    // GATE draws the white banner with the institute's name, never an exam body's mark.
    expect(host!.querySelector(".tcs-banner--white")?.textContent).toContain("Sample Institute");

    const chips = Array.from(host!.querySelectorAll(".tcs-general__symbols .tcs-chip")).map(
      (c) => (c as HTMLElement).dataset.status,
    );
    expect(chips).toEqual(["not-visited", "not-answered", "answered", "marked", "answered-marked"]);
    expect(host!.querySelector(".tcs-chip--answered-marked .tcs-chip__tick")).not.toBeNull();

    expect(text()).toContain(`${G}.clockDuration{"count":180}`);
    expect(text()).toContain(`${G}.clockSubmitLocked`);
    expect(text()).toContain(`${G}.answerPickStrict`);
    expect(text()).toContain(`${G}.saveNextStrict`);
    expect(text()).toContain(`${G}.moveNoSave`);
    expect(text()).toContain(`${G}.numericStrict{"label":"examThemes.tcs.questionTypes.nat"}`);
    expect(text()).toContain(`${G}.roughPaper`);
    expect(text()).toContain(`${G}.disclaimer`);
    // Page 1 has no declaration and no start button.
    expect(host!.querySelector(".tcs-brief__declaration")).toBeNull();
    expect(host!.querySelector("[data-testid=tcs-ready]")).toBeNull();
    // The candidate column shows the learner's initial and name.
    expect(host!.querySelector(".tcs-brief__side .tcs-candidate__name")?.textContent).toBe(
      "Asha Rao",
    );
  });

  it("uses the auto-save wording and no Submit lock when practice-friendly", () => {
    const theme = resolveExamTheme({ v: 1, preset: "gate", strict: false });
    render({ theme });
    expect(text()).toContain(`${G}.answerPickPractice`);
    expect(text()).toContain(`${G}.saveNextPractice`);
    expect(text()).toContain(`${G}.numericPractice`);
    expect(text()).toContain(`${G}.clockSubmitEarly`);
    expect(text()).not.toContain(`${G}.clockSubmitLocked`);
    expect(text()).not.toContain(`${G}.moveNoSave`);
    expect(text()).not.toContain(`${G}.changeAnswer`);
  });

  it("labels numerical questions Numerical outside GATE and allows early Submit on JEE Advanced", () => {
    const theme = resolveExamTheme({ v: 1, preset: "jee-advanced", strict: true });
    render({ theme });
    expect(text()).toContain(`"label":"examThemes.tcs.questionTypes.numerical"`);
    expect(text()).toContain(`${G}.clockSubmitEarly`);
    expect(host!.querySelector(".tcs-banner--blue")).not.toBeNull();
  });

  it("says there is no time limit for an untimed play mode", () => {
    const theme = resolveExamTheme({ v: 1, preset: "rrb-je", strict: true });
    render({ theme, assessmentInfo: { ...ASSESSMENT, play_mode: "PRACTICE" } });
    expect(text()).toContain(`${G}.clockUntimed`);
    expect(text()).not.toContain(`${G}.clockSubmitLocked`);
    expect(text()).not.toContain(`${G}.clockEnd`);
  });

  it("mentions the calculator only when the console has the slot and the institute enables it", () => {
    const withCalculator = {
      ...DEFAULT_EXAM_EXPERIENCE,
      calculator: { ...DEFAULT_EXAM_EXPERIENCE.calculator, enabled: true },
    };
    render({ theme: resolveExamTheme({ v: 1, preset: "gate" }), examExperience: withCalculator });
    expect(text()).toContain(`${G}.calculator`);
    render({
      theme: resolveExamTheme({ v: 1, preset: "jee-advanced" }),
      examExperience: withCalculator,
    });
    expect(text()).not.toContain(`${G}.calculator`);
  });

  it("names the buttons of the layout it describes", () => {
    const theme = resolveExamTheme({ v: 1, preset: "jee-main", layout: "nta-mock" });
    render({ theme });
    const buttons = new Set([...consoleButtonsFor(theme).left, ...consoleButtonsFor(theme).right]);
    expect(text().includes(`${G}.saveMarkReview`)).toBe(buttons.has("save-mark-review"));
    expect(text().includes(`${G}.moveBackNext`)).toBe(buttons.has("back") && buttons.has("next"));
  });

  it("leaves the brief from page 1", () => {
    render({ theme: resolveExamTheme({ v: 1, preset: "gate" }) });
    click(button(`${B}.leave`));
    expect(leave).toHaveBeenCalledTimes(1);
  });
});

describe("TcsInstructionTemplate, page 2", () => {
  it("shows the test facts, the institute's instructions and attachments, and the declaration", () => {
    const onAgreedChange = vi.fn();
    render({
      theme: resolveExamTheme({ v: 1, preset: "gate" }),
      instructionsHtml:
        '<p>Bring your ID.</p><p><a data-attachment="true" href="https://cdn.example.com/paper.pdf">paper.pdf</a></p>',
      onAgreedChange,
    });
    click(button(`${B}.next`));

    expect(host!.querySelector(".tcs-brief__title")?.textContent).toBe(`${B}.aboutTitle`);
    expect(text()).toContain("Sample Mock 1");
    expect(text()).toContain(`${B}.duration{"count":180}`);
    expect(text()).toContain(`${B}.sectionSwitchYes`);
    expect(text()).toContain(`${B}.attempt{"used":1,"max":2}`);
    const institute = host!.querySelector(".tcs-brief__institute") as HTMLElement;
    expect(institute.dataset.html).toContain("Bring your ID.");
    expect(institute.dataset.html).not.toContain("paper.pdf");
    expect(host!.querySelector(".tcs-brief__attachments a")?.getAttribute("href")).toBe(
      "https://cdn.example.com/paper.pdf",
    );
    expect(host!.querySelector("[data-pdf]")).not.toBeNull();

    const box = host!.querySelector(".tcs-brief__declaration input") as HTMLInputElement;
    click(box);
    expect(onAgreedChange).toHaveBeenCalledWith(true);
  });

  it("keeps I am ready to begin off until the page allows the start, then starts without a second confirmation", () => {
    const theme = resolveExamTheme({ v: 1, preset: "jee-advanced" });
    render({ theme });
    click(button(`${B}.next`));
    let ready = host!.querySelector("[data-testid=tcs-ready]") as HTMLButtonElement;
    expect(ready.textContent).toBe(`${B}.ready`);
    expect(ready.disabled).toBe(true);
    expect(text()).toContain(`${B}.tickToBegin`);
    expect(startProps.at(-1)).toEqual({ confirm: false, disabled: true });

    render({ theme, agreed: true, canStart: true });
    ready = host!.querySelector("[data-testid=tcs-ready]") as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    expect(text()).not.toContain(`${B}.tickToBegin`);
    click(ready);
    expect(startClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the proctoring check-in mounted on both pages and shows it on page 2 only", () => {
    render({
      theme: resolveExamTheme({ v: 1, preset: "gate" }),
      proctorCheckIn: <div data-testid="check-in" />,
    });
    const wrapper = () => host!.querySelector(".tcs-brief__proctor") as HTMLElement;
    expect(host!.querySelector("[data-testid=check-in]")).not.toBeNull();
    expect(wrapper().hidden).toBe(true);
    click(button(`${B}.next`));
    expect(wrapper().hidden).toBe(false);
    click(button(`${B}.previous`));
    expect(wrapper().hidden).toBe(true);
  });

  it("says when the institute added no instructions", () => {
    render({ theme: resolveExamTheme({ v: 1, preset: "gate" }) });
    click(button(`${B}.next`));
    expect(text()).toContain(`${B}.noTestInstructions`);
  });
});

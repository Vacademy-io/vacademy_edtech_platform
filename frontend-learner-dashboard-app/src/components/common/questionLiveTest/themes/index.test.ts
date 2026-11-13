import { beforeEach, describe, expect, it, vi } from "vitest";

const addBreadcrumb = vi.fn();
vi.mock("@sentry/react", () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
}));

const {
  DEFAULT_EXAM_THEME,
  EXAM_PRESETS,
  buildExamTheme,
  effectiveAnswerCommit,
  renderedLayoutKind,
  resolveExamTheme,
} = await import("./index");

beforeEach(() => addBreadcrumb.mockClear());

describe("resolveExamTheme", () => {
  it.each([null, undefined, "jee-main", 3, [], {}, { preset: "" }, { preset: "default" }])(
    "falls back to the default screen for %j",
    (value) => {
      expect(resolveExamTheme(value)).toBe(DEFAULT_EXAM_THEME);
    },
  );

  it("default theme describes today's screen", () => {
    expect(DEFAULT_EXAM_THEME).toMatchObject({
      id: "default",
      family: "default",
      layout: { kind: "default", variant: "default" },
      policy: {
        answerCommit: "auto",
        markSemantics: "toggle",
        earlySubmit: "allowed",
        previousButton: true,
      },
      strict: true,
    });
  });

  it("an unknown preset falls back to default with one breadcrumb", () => {
    expect(resolveExamTheme({ v: 1, preset: "future-exam" })).toBe(DEFAULT_EXAM_THEME);
    expect(resolveExamTheme({ v: 1, preset: "future-exam" })).toBe(DEFAULT_EXAM_THEME);
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb.mock.calls[0][0]).toMatchObject({ category: "exam-theme" });
  });

  it("jee-main defaults to the NTA mock layout and accepts the TCS console", () => {
    const nta = resolveExamTheme({ v: 1, preset: "jee-main" });
    expect(nta.layout).toEqual({ kind: "console", variant: "nta-mock" });
    expect(nta.availableLayouts).toEqual(["nta-mock", "tcs-console"]);
    expect(nta.palette).toMatchObject({ columns: 8, numbering: "two-digit" });
    expect(nta.policy.previousButton).toBe(true);
    expect(nta.options.numbering).toBe("(1)");

    const tcs = resolveExamTheme({ v: 1, preset: "jee-main", layout: "tcs-console" });
    expect(tcs.layout).toEqual({ kind: "console", variant: "tcs-console" });
    expect(tcs.palette).toMatchObject({ columns: 4, numbering: "plain" });
    expect(tcs.policy.previousButton).toBe(false);
    expect(tcs.options.numbering).toBe("(1)");
  });

  it("an unknown layout uses the preset's default layout", () => {
    const theme = resolveExamTheme({ v: 1, preset: "jee-main", layout: "nope" });
    expect(theme.layout.variant).toBe("nta-mock");
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it("strict is on unless it is exactly false", () => {
    expect(resolveExamTheme({ preset: "gate" }).strict).toBe(true);
    expect(resolveExamTheme({ preset: "gate", strict: "no" }).strict).toBe(true);
    expect(resolveExamTheme({ preset: "gate", strict: false }).strict).toBe(false);
  });

  it("keeps unknown keys out of the way and resolves each object once", () => {
    const value = { v: 2, preset: "rrb-je", breaks: [], future: { x: 1 } };
    expect(resolveExamTheme(value)).toBe(resolveExamTheme(value));
    expect(resolveExamTheme(value).id).toBe("rrb-je");
  });
});

describe("preset policies", () => {
  const tcsPresets = ["jee-main", "jee-advanced", "gate", "rrb-je"] as const;

  it.each(tcsPresets)("%s: strict saves only on Save & Next", (id) => {
    const theme = buildExamTheme(id);
    expect(theme.family).toBe("tcs");
    expect(theme.policy.answerCommit).toBe("explicit");
    expect(theme.policy.markSemantics).toBe("set-and-next");
  });

  it.each(tcsPresets)("%s: practice-friendly saves at once and allows Submit", (id) => {
    const theme = buildExamTheme(id, undefined, false);
    expect(theme.policy.answerCommit).toBe("auto");
    expect(theme.policy.earlySubmit).toBe("allowed");
  });

  it.each([
    ["gate", "disabled-until-end"],
    ["rrb-je", "disabled-until-end"],
    ["jee-main", "allowed"],
    ["jee-advanced", "allowed"],
  ] as const)("%s strict: early submit %s", (id, expected) => {
    expect(buildExamTheme(id).policy.earlySubmit).toBe(expected);
  });

  it("every registered preset builds", () => {
    for (const id of Object.keys(EXAM_PRESETS)) {
      expect(buildExamTheme(id as keyof typeof EXAM_PRESETS).id).toBe(id);
    }
  });
});

describe("effectiveAnswerCommit", () => {
  it("stays auto while the console layout is not built", () => {
    const theme = resolveExamTheme({ preset: "jee-advanced", strict: true });
    expect(theme.policy.answerCommit).toBe("explicit");
    expect(renderedLayoutKind(theme)).toBe("default");
    expect(effectiveAnswerCommit(theme)).toBe("auto");
  });

  it("is auto for the default theme", () => {
    expect(effectiveAnswerCommit(DEFAULT_EXAM_THEME)).toBe("auto");
  });
});

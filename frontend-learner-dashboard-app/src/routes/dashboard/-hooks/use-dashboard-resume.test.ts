// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSlidesByChapterId } from "@/hooks/study-library/use-slides";
import { clearResumeForCourse } from "@/services/resume-thread";
import { fetchModulesWithChapters } from "@/services/study-library/getModulesWithChapters";
import { fetchEnrolmentLookup } from "@/services/user-enrollment-status";
import { fetchEnrollmentAnchor, readInstituteDripSettings } from "@/services/drip-schedule";
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";
import type { ResumeTarget } from "../-lib/resume-target";
import type { DashboardSlide } from "../-types/dashboard-data-types";
import { RESUME_WAIT_MS, useDashboardResume } from "./use-dashboard-resume";

vi.hoisted(() => {
  // The persisted drip store reads this as it is created.
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
    },
  });
});

const device = vi.hoisted(() => ({
  scope: { owner: "u", instituteId: "i" },
  entry: {
    instituteId: "i",
    courseId: "c1",
    subjectId: "sub1",
    moduleId: "mod1",
    chapterId: "ch1",
    slideId: "s1",
    sessionId: "ps1",
    slideTitle: "Title when visited",
    updatedAt: Date.now(),
  },
  entries: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/study-library/use-slides", () => ({ fetchSlidesByChapterId: vi.fn() }));
vi.mock("@/services/study-library/getModulesWithChapters", () => ({
  fetchModulesWithChapters: vi.fn(),
}));
vi.mock("@/services/user-enrollment-status", () => ({ fetchEnrolmentLookup: vi.fn() }));
vi.mock("@/services/drip-schedule", () => ({
  readInstituteDripSettings: vi.fn(),
  fetchEnrollmentAnchor: vi.fn(),
}));
vi.mock("@/services/resume-thread", () => ({
  clearResumeForCourse: vi.fn(),
  listResumes: () => device.entries,
  RESUME_ROUTE: "/lesson",
  resumeSearchParams: () => ({}),
  useResumeScope: () => device.scope,
}));

type Answer = { target: ResumeTarget | null; resolving: boolean; unanswered: boolean };
type Props = { serverSlides?: DashboardSlide[]; serverLoading?: boolean; enabled?: boolean };

const ROW = {
  slide_id: "s1",
  slide_title: "Listed title",
  package_id: "c1",
  package_session_id: "ps1",
  subject_id: "sub1",
  module_id: "mod1",
  chapter_id: "ch1",
  source_type: "DOCUMENT",
} as DashboardSlide;

const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

function visit(client: QueryClient, first: Props) {
  const seen: Answer[] = [];
  const Probe = (props: Props) => {
    seen.push(
      useDashboardResume({
        serverSlides: props.serverSlides,
        serverLoading: props.serverLoading ?? false,
        enabled: props.enabled,
        openServerSlide: () => {},
        track: () => {},
      }),
    );
    return null;
  };
  const root: Root = createRoot(document.createElement("div"));
  const draw = (props: Props) =>
    act(async () =>
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Probe, props)),
      ),
    );
  return {
    seen,
    draw,
    start: () => draw(first),
    leave: () => act(async () => root.unmount()),
    now: () => seen[seen.length - 1]!,
  };
}

describe("useDashboardResume", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    client = new QueryClient();
    device.entries = [];
    vi.mocked(clearResumeForCourse).mockReset();
    vi.mocked(fetchEnrolmentLookup).mockReset().mockResolvedValue({
      courses: [{ id: "c1", package_session_id: "ps1", package_name: "Course" }],
      complete: true,
    } as never);
    vi.mocked(fetchModulesWithChapters)
      .mockReset()
      .mockResolvedValue([{ module: { id: "mod1" }, chapters: [{ id: "ch1" }] }] as never);
    vi.mocked(fetchSlidesByChapterId)
      .mockReset()
      .mockResolvedValue([{ id: "s1", title: "Live title" }] as never);
    vi.mocked(readInstituteDripSettings)
      .mockReset()
      .mockResolvedValue({ enabled: false, applyConfiguredRules: false, conditions: [] });
    vi.mocked(fetchEnrollmentAnchor)
      .mockReset()
      .mockResolvedValue({ enrollmentDate: null, sessionStartDate: null });
    useDripConditionStore.getState().clearAll();
    useDripConditionStore.getState().setIsDrippingEnable(false);
  });

  afterEach(() => {
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the checks on a lesson opened moments ago, even with that lesson cached", () => {
    device.entries = [device.entry];
    client.setQueryData(["slides", device.entry.chapterId], [{ id: "s1", title: "Cached" }]);
    let first: Answer | undefined;
    const Probe = () => {
      first = useDashboardResume({
        serverSlides: [],
        serverLoading: false,
        openServerSlide: () => {},
        track: () => {},
      });
      return null;
    };
    renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));

    expect(first).toEqual({ target: null, resolving: true, unanswered: false });
  });

  it("stops holding the slot when the dashboard request never answers", async () => {
    const page = visit(client, { serverLoading: true });
    await page.start();
    await flush(RESUME_WAIT_MS - 1);
    expect(page.now().resolving).toBe(true);

    await flush(1);
    expect(page.now()).toEqual({ target: null, resolving: false, unanswered: true });
    await page.leave();
  });

  it("keeps the page as it is when rows come after the wait, and spends no request on them", async () => {
    const page = visit(client, { serverLoading: true });
    await page.start();
    await flush(RESUME_WAIT_MS);
    const settled = page.seen.length;

    await page.draw({ serverLoading: false, serverSlides: [ROW] });
    await flush(RESUME_WAIT_MS);

    for (const answer of page.seen.slice(settled)) {
      expect(answer).toEqual({ target: null, resolving: false, unanswered: true });
    }
    expect(fetchEnrolmentLookup).not.toHaveBeenCalled();
    await page.leave();
  });

  it("offers on the next visit what the last one had to go without", async () => {
    const late = visit(client, { serverLoading: true });
    await late.start();
    await flush(RESUME_WAIT_MS);
    await late.draw({ serverLoading: false, serverSlides: [ROW] });
    await late.leave();

    const next = visit(client, { serverLoading: false, serverSlides: [ROW] });
    await next.start();
    await flush();
    expect(next.now().target?.slideId).toBe("s1");
    await next.leave();
  });

  it("offers a lesson when rows and checks answer inside the wait, and keeps it past the wait", async () => {
    const page = visit(client, { serverLoading: true });
    await page.start();
    await flush(RESUME_WAIT_MS - 1000);

    await page.draw({ serverLoading: false, serverSlides: [ROW] });
    await flush();
    expect(page.now().target?.slideTitle).toBe("Live title");
    expect(page.now().resolving).toBe(false);

    await flush(RESUME_WAIT_MS * 2);
    expect(page.now().target?.slideTitle).toBe("Live title");
    await page.leave();
  });

  it("counts rows and their checks against one wait, and drops an answer later than that", async () => {
    let answer: (value: never) => void = () => {};
    vi.mocked(fetchEnrolmentLookup).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }) as never,
    );
    const page = visit(client, { serverLoading: true });
    await page.start();
    await flush(RESUME_WAIT_MS - 100);
    await page.draw({ serverLoading: false, serverSlides: [ROW] });
    expect(page.now().resolving).toBe(true);

    await flush(100);
    expect(page.now()).toEqual({ target: null, resolving: false, unanswered: true });

    answer({
      courses: [{ id: "c1", package_session_id: "ps1", package_name: "Course" }],
      complete: true,
    } as never);
    await flush(1000);
    expect(page.now()).toEqual({ target: null, resolving: false, unanswered: true });
    await page.leave();
  });

  it("keeps a device answer while the dashboard request hangs past the wait", async () => {
    device.entries = [device.entry];
    const page = visit(client, { serverLoading: true });
    await page.start();
    await flush();
    expect(page.now().target?.slideTitle).toBe("Live title");

    await flush(RESUME_WAIT_MS * 2);
    expect(page.now().target?.slideTitle).toBe("Live title");
    await page.leave();
  });

  it("forgets nothing and stops holding when a device check never answers", async () => {
    device.entries = [device.entry];
    vi.mocked(fetchEnrolmentLookup).mockReturnValue(new Promise(() => {}) as never);
    const page = visit(client, { serverLoading: false });
    await page.start();
    await flush(RESUME_WAIT_MS);

    expect(page.now()).toEqual({ target: null, resolving: false, unanswered: true });
    expect(clearResumeForCourse).not.toHaveBeenCalled();
    await page.leave();
  });

  it("asks nothing and holds nothing when the page would not show the answer", async () => {
    device.entries = [device.entry];
    const page = visit(client, { serverLoading: true, serverSlides: [ROW], enabled: false });
    await page.start();
    await flush(RESUME_WAIT_MS);

    expect(page.seen.every((a) => !a.resolving && !a.target)).toBe(true);
    expect(fetchEnrolmentLookup).not.toHaveBeenCalled();
    expect(fetchModulesWithChapters).not.toHaveBeenCalled();
    expect(fetchSlidesByChapterId).not.toHaveBeenCalled();
    await page.leave();
  });

  it("never leaves a pending query on the lesson's key for the lesson to join", async () => {
    device.entries = [device.entry];
    vi.mocked(fetchSlidesByChapterId).mockReturnValue(new Promise(() => {}) as never);
    const page = visit(client, { serverLoading: false });
    await page.start();
    await flush(10);

    expect(client.getQueryState(["slides", device.entry.chapterId])).toBeUndefined();
    await flush(RESUME_WAIT_MS);
    expect(client.getQueryState(["slides", device.entry.chapterId])).toBeUndefined();
    await page.leave();
  });

  it("drops a stalled request when the wait ends, and asks again on the next visit", async () => {
    device.entries = [device.entry];
    vi.mocked(fetchSlidesByChapterId).mockReturnValueOnce(new Promise(() => {}) as never);
    const first = visit(client, { serverLoading: false });
    await first.start();
    await flush(RESUME_WAIT_MS);

    const signal = vi.mocked(fetchSlidesByChapterId).mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(first.now().target).toBeNull();
    await first.leave();

    const next = visit(client, { serverLoading: false });
    await next.start();
    await flush();
    expect(next.now().target?.slideTitle).toBe("Live title");
    expect(fetchSlidesByChapterId).toHaveBeenCalledTimes(2);
    await next.leave();
  });

  it("leaves a finished check's list for the lesson, sparing it the request", async () => {
    device.entries = [device.entry];
    const page = visit(client, { serverLoading: false });
    await page.start();
    await flush();

    expect(client.getQueryData(["slides", device.entry.chapterId])).toEqual([
      { id: "s1", title: "Live title" },
    ]);
    await page.leave();
  });

  it("sends no request for a list the lesson already holds", async () => {
    device.entries = [device.entry];
    client.setQueryData(["slides", device.entry.chapterId], [{ id: "s1", title: "Held" }]);
    const page = visit(client, { serverLoading: false });
    await page.start();
    await flush();

    expect(page.now().target?.slideTitle).toBe("Held");
    expect(fetchSlidesByChapterId).not.toHaveBeenCalled();
    await page.leave();
  });

  it("asks again when the list the lesson holds has been invalidated", async () => {
    device.entries = [device.entry];
    client.setQueryData(["slides", device.entry.chapterId], [{ id: "s1", title: "Held" }]);
    await client.invalidateQueries({ queryKey: ["slides", device.entry.chapterId] });
    const page = visit(client, { serverLoading: false });
    await page.start();
    await flush();

    expect(page.now().target?.slideTitle).toBe("Live title");
    await page.leave();
  });

  it("keeps a partial enrolment list out of the next visit's answer", async () => {
    device.entries = [device.entry];
    vi.mocked(fetchEnrolmentLookup).mockResolvedValueOnce({ courses: [], complete: false } as never);
    const first = visit(client, { serverLoading: false });
    await first.start();
    await flush();
    expect(first.now().target).toBeNull();
    await first.leave();
    client.removeQueries({ queryKey: ["resume-check"] });

    const next = visit(client, { serverLoading: false });
    await next.start();
    await flush();
    expect(next.now().target?.slideId).toBe("s1");
    expect(fetchEnrolmentLookup).toHaveBeenCalledTimes(2);
    await next.leave();
  });

  describe("unanswered", () => {
    it("is false for a clean nothing that came quickly: the slot closes", async () => {
      const page = visit(client, { serverLoading: false, serverSlides: [] });
      await page.start();
      await flush();
      expect(page.now()).toEqual({ target: null, resolving: false, unanswered: false });
      await page.leave();
    });

    it("is true for a clean nothing after the slot has stood for a second", async () => {
      const page = visit(client, { serverLoading: true });
      await page.start();
      await flush(1200);
      await page.draw({ serverLoading: false, serverSlides: [] });
      await flush();
      expect(page.now()).toEqual({ target: null, resolving: false, unanswered: true });
      await page.leave();
    });

    it("is true when a check fails, however quickly", async () => {
      device.entries = [device.entry];
      vi.mocked(fetchEnrolmentLookup).mockRejectedValue(new Error("down"));
      const page = visit(client, { serverLoading: false });
      await page.start();
      await flush();
      expect(page.now()).toEqual({ target: null, resolving: false, unanswered: true });
      await page.leave();
    });

    it("is false while the page would not show the answer", async () => {
      const page = visit(client, { serverLoading: true, enabled: false });
      await page.start();
      await flush(RESUME_WAIT_MS * 2);
      expect(page.now()).toEqual({ target: null, resolving: false, unanswered: false });
      await page.leave();
    });

    it("is false once a lesson is offered", async () => {
      const page = visit(client, { serverLoading: true });
      await page.start();
      await flush(1500);
      await page.draw({ serverLoading: false, serverSlides: [ROW] });
      await flush();
      expect(page.now().target?.slideId).toBe("s1");
      expect(page.now().unanswered).toBe(false);
      await page.leave();
    });
  });

  describe("drip", () => {
    const FUTURE = { type: "date_based", params: { unlock_date: "2099-01-01T00:00:00.000Z" } };
    const config = (rule: unknown, target = "slide") =>
      ({ target, behavior: "lock", is_enabled: true, rules: [rule] }) as never;
    const configured = (level: string, id: string, rule: unknown, opts = {}) => ({
      enabled: true,
      applyConfiguredRules: false,
      conditions: [{ id: "x", level, level_id: id, drip_condition: [config(rule, level)] }],
      ...opts,
    });

    it("offers nothing for a lesson the cached settings close, and keeps the entry", async () => {
      device.entries = [device.entry];
      vi.mocked(readInstituteDripSettings).mockResolvedValue(configured("slide", "s1", FUTURE) as never);
      const page = visit(client, { serverLoading: false, serverSlides: [] });
      await page.start();
      await flush();
      expect(page.now().target).toBeNull();
      expect(clearResumeForCourse).not.toHaveBeenCalled();
      await page.leave();
    });

    it("offers nothing under a rule from a course-wide target", async () => {
      vi.mocked(readInstituteDripSettings).mockResolvedValue(configured("package", "c1", FUTURE, {
        conditions: [
          { id: "x", level: "package", level_id: "c1", drip_condition: [config(FUTURE, "slide")] },
        ],
      }) as never);
      const page = visit(client, { serverLoading: false, serverSlides: [ROW] });
      await page.start();
      await flush();
      expect(page.now().target).toBeNull();
      await page.leave();
    });

    it("does not apply configured rules while the institute switch is off", async () => {
      vi.mocked(readInstituteDripSettings).mockResolvedValue(
        configured("slide", "s1", FUTURE, { enabled: false }) as never,
      );
      const page = visit(client, { serverLoading: false, serverSlides: [ROW] });
      await page.start();
      await flush();
      expect(page.now().target?.slideId).toBe("s1");
      await page.leave();
    });

    it("does not apply a progress rule the institute has not opted into", async () => {
      vi.mocked(fetchSlidesByChapterId).mockResolvedValue([
        { id: "s0", percentage_completed: 0 },
        { id: "s1", title: "Live title" },
      ] as never);
      const sequential = { type: "sequential", params: { requires_previous: true, threshold: 100 } };
      vi.mocked(readInstituteDripSettings).mockResolvedValue(configured("slide", "s1", sequential) as never);
      const dormant = visit(client, { serverLoading: false, serverSlides: [ROW] });
      await dormant.start();
      await flush();
      expect(dormant.now().target?.slideId).toBe("s1");
      await dormant.leave();

      client.clear();
      vi.mocked(readInstituteDripSettings).mockResolvedValue(
        configured("slide", "s1", sequential, { applyConfiguredRules: true }) as never,
      );
      const enforced = visit(client, { serverLoading: false, serverSlides: [ROW] });
      await enforced.start();
      await flush();
      expect(enforced.now().target).toBeNull();
      await enforced.leave();
    });

    it("reads the course-wide condition and the switch of the older path from the store", async () => {
      useDripConditionStore.getState().setDripCondition("c1", JSON.stringify(config(FUTURE)));
      const off = visit(client, { serverLoading: false, serverSlides: [ROW] });
      await off.start();
      await flush();
      expect(off.now().target?.slideId).toBe("s1");
      await off.leave();

      client.clear();
      useDripConditionStore.getState().setIsDrippingEnable(true);
      const on = visit(client, { serverLoading: false, serverSlides: [ROW] });
      await on.start();
      await flush();
      expect(on.now().target).toBeNull();
      await on.leave();
    });

    describe("day-wise rules", () => {
      const DAY_FIVE = { type: "relative_date", params: { unlock_on_day: 5 } };
      const today = () => new Date().toISOString();

      it("sends nothing extra when no rule counts days", async () => {
        const page = visit(client, { serverLoading: false, serverSlides: [ROW] });
        await page.start();
        await flush();
        expect(fetchEnrollmentAnchor).not.toHaveBeenCalled();
        await page.leave();
      });

      it("looks up day 1 once and then remembers it", async () => {
        vi.mocked(readInstituteDripSettings).mockResolvedValue(configured("slide", "s1", DAY_FIVE) as never);
        vi.mocked(fetchEnrollmentAnchor).mockResolvedValue({ enrollmentDate: today(), sessionStartDate: null });
        const page = visit(client, { serverLoading: false, serverSlides: [ROW] });
        await page.start();
        await flush();
        expect(page.now().target).toBeNull();
        expect(useDripConditionStore.getState().enrollmentDates.ps1).toBeTruthy();
        await page.leave();

        client.clear();
        vi.mocked(fetchEnrollmentAnchor).mockClear();
        const next = visit(client, { serverLoading: false, serverSlides: [ROW] });
        await next.start();
        await flush();
        expect(next.now().target).toBeNull();
        expect(fetchEnrollmentAnchor).not.toHaveBeenCalled();
        await next.leave();
      });

      it("always asks for the batch's start when a rule counts from it", async () => {
        useDripConditionStore.getState().setEnrollmentDate("ps1", today());
        vi.mocked(readInstituteDripSettings).mockResolvedValue(
          configured("slide", "s1", {
            type: "relative_date",
            params: { unlock_on_day: 5, anchor: "session_start" },
          }) as never,
        );
        vi.mocked(fetchEnrollmentAnchor).mockResolvedValue({ enrollmentDate: today(), sessionStartDate: today() });
        const page = visit(client, { serverLoading: false, serverSlides: [ROW] });
        await page.start();
        await flush();
        expect(fetchEnrollmentAnchor).toHaveBeenCalledTimes(1);
        expect(page.now().target).toBeNull();
        await page.leave();
      });

      it("offers the lesson when day 1 cannot be found: a schedule that cannot be read is not a wall", async () => {
        vi.mocked(readInstituteDripSettings).mockResolvedValue(configured("slide", "s1", DAY_FIVE) as never);
        const page = visit(client, { serverLoading: false, serverSlides: [ROW] });
        await page.start();
        await flush();
        expect(page.now().target?.slideId).toBe("s1");
        await page.leave();
      });
    });
  });

  it("starts asking once the page would show the answer", async () => {
    const page = visit(client, { serverLoading: false, serverSlides: [ROW], enabled: false });
    await page.start();
    await flush();
    await page.draw({ serverLoading: false, serverSlides: [ROW], enabled: true });
    await flush();

    expect(page.now().target?.slideId).toBe("s1");
    await page.leave();
  });
});

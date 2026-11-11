// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({
    t: (key: string, opts?: Record<string, unknown>) => `${ns}:${key}${opts ? JSON.stringify(opts) : ""}`,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}));

// The course's batch list, as the course page asks for it (CourseBatchDTO shape).
const batchesByCourse: Record<string, unknown[]> = {};
const fetchBatchesForCourse = vi.fn(async (courseId: string) => batchesByCourse[courseId] ?? []);
vi.mock("@/services/courseBatches", () => ({ fetchBatchesForCourse }));

const { FunLearnList } = await import("./FunLearnList");

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  return host;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  fetchBatchesForCourse.mockClear();
});

type Row = Parameters<typeof FunLearnList>[0]["courses"][number];
const course = (over: Partial<Row>): Row =>
  ({
    id: "pkg-1",
    package_name: "Physics",
    course_preview_image_media_id: "",
    percentage_completed: 0,
    package_session_id: "ps-1",
    level_name: "Class 12",
    session_name: "2026-27",
    ...over,
  }) as Row;

const rows = (el: HTMLElement) => [...el.querySelectorAll(".fun-learn-row")].map((r) => r.textContent ?? "");

describe("FunLearnList rows", () => {
  it("print one rounded percent that the words and the tick both read", async () => {
    const el = await render(
      <FunLearnList
        selectedTab="ALL"
        hideProgress={false}
        courses={[
          course({ id: "a", package_name: "A", percentage_completed: 0.3 }),
          course({ id: "b", package_name: "B", percentage_completed: 99.6 }),
          course({ id: "c", package_name: "C", percentage_completed: 100 }),
          course({ id: "d", package_name: "D", percentage_completed: 44.5 }),
        ]}
      />,
    );
    const [a, b, c, d] = rows(el);
    expect(a).toContain('funCommon:percentDone{"percent":1}');
    // 99.6% rounds to 100, which the home tiles call finished: the same here.
    expect(b).toContain("funCommon:review");
    expect(b).not.toContain("percentDone");
    expect(c).toContain("funCommon:review");
    expect(c).not.toContain("percentDone");
    expect(d).toContain('funCommon:percentDone{"percent":45}');
    const ticks = [...el.querySelectorAll(".fun-learn-row")].map((r) => !!r.querySelector(".fun-tick"));
    expect(ticks).toEqual([false, true, true, false]);
  });

  it("reads 99% done just below the point where home calls a course finished", async () => {
    const el = await render(<FunLearnList selectedTab="PROGRESS" hideProgress={false} courses={[course({ percentage_completed: 99.4 })]} />);
    expect(rows(el)[0]).toContain('funCommon:percentDone{"percent":99}');
    expect(el.querySelector(".fun-tick")).toBeNull();
  });

  it("says Not started for a course with no progress on the learner's own tabs, nothing on All", async () => {
    for (const tab of ["PROGRESS", "COMPLETED"]) {
      const el = await render(<FunLearnList selectedTab={tab} hideProgress={false} courses={[course({ percentage_completed: 0 })]} />);
      expect(rows(el)[0]).toContain("funCommon:notStarted");
      await act(async () => root?.unmount());
      host?.remove();
    }
    // All lists the institute's catalogue: a 0% course there may be one the learner never joined.
    const el = await render(<FunLearnList selectedTab="ALL" hideProgress={false} courses={[course({ percentage_completed: 0 })]} />);
    expect(rows(el)[0]).not.toContain("funCommon:notStarted");
    expect(el.querySelector(".fun-progress")).toBeNull();
  });

  it("names the session of two batches of one course from the course's batch list", async () => {
    batchesByCourse["pkg-aiml"] = [
      { id: "ps-a", package_dto: { id: "pkg-aiml", package_name: "Ai/ML" }, level: { id: "l", level_name: "Class 12" }, session: { id: "s1", session_name: "2025-26" }, package_session_name: null },
      { id: "ps-b", package_dto: { id: "pkg-aiml", package_name: "Ai/ML" }, level: { id: "l", level_name: "Class 12" }, session: { id: "s2", session_name: "2026-27" }, package_session_name: null },
    ];
    // The search list's real shape: no session or batch name.
    const real = (ps: string, pct: number) =>
      course({ id: "pkg-aiml", package_name: "Ai/ML", package_session_id: ps, level_name: "Class 12", session_name: undefined, percentage_completed: pct });
    const el = await render(
      <FunLearnList selectedTab="PROGRESS" hideProgress={false} courses={[real("ps-a", 47), real("ps-b", 0), course({ id: "pkg-chem", package_name: "Chemistry", session_name: undefined })]} />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const metas = [...el.querySelectorAll(".fun-learn-row__meta")].map((m) => m.textContent);
    // The session is what differs, so it comes first: a narrow row that cuts the line still shows it.
    expect(metas).toEqual(["2025-26 · Class 12", "2026-27 · Class 12", "Class 12"]);
    // Asked once, for the shared name only.
    expect(fetchBatchesForCourse.mock.calls.map((call: unknown[]) => call[0])).toEqual(["pkg-aiml"]);
  });

  it("names the batch when one course shows up twice", async () => {
    const el = await render(
      <FunLearnList
        selectedTab="PROGRESS"
        hideProgress={false}
        courses={[
          course({ id: "x", package_name: "AI/ML", level_name: "default", session_name: "default", package_session_name: "Weekend batch", percentage_completed: 47 }),
          course({ id: "x", package_name: "AI/ML", level_name: "default", session_name: "default", package_session_name: "Evening batch" }),
        ]}
      />,
    );
    const metas = [...el.querySelectorAll(".fun-learn-row__meta")].map((m) => m.textContent);
    expect(metas).toEqual(["Weekend batch", "Evening batch"]);
  });

  it("shows no percent or label when the institute hides progress", async () => {
    const el = await render(<FunLearnList selectedTab="ALL" hideProgress courses={[course({ percentage_completed: 30 }), course({ id: "z", percentage_completed: 0 })]} />);
    for (const r of rows(el)) {
      expect(r).not.toContain("percentDone");
      expect(r).not.toContain("notStarted");
    }
  });
});

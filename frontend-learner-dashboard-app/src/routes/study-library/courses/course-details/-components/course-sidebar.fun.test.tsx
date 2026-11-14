// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_key: string, fallback: string) => fallback,
  getTerminologyPlural: (_key: string, fallback: string) => `${fallback}s`,
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("./course-details-ratings-page", () => ({ CourseDetailsRatingsComponent: () => null }));

const { CourseSidebar } = await import("./course-sidebar");

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
});

type Props = ComponentProps<typeof CourseSidebar>;
const props = (over: Partial<Props> = {}): Props => ({
  hasRightSidebar: true,
  levelOptions: [{ _id: "l", value: "lvl-12", label: "Class 12" }],
  selectedLevel: "lvl-12",
  slideCountQuery: { isLoading: false, error: null, data: [{ slide_count: 4, total_read_time_minutes: 120, source_type: "VIDEO" }] },
  overviewVisible: true,
  processedSlideCounts: [],
  moduleStats: { totalModules: 0, totalChapters: 0 },
  currentSubjects: [],
  courseStructure: 2,
  instructorsCount: 0,
  selectedTab: "PROGRESS",
  selectedSession: "s1",
  enrolledSessions: [],
  courseId: "pkg-1",
  packageSessionIdForCurrentLevel: null,
  onEnrollmentClick: () => {},
  onRatingsLoadingChange: () => {},
  ...over,
});

const rowTexts = (el: HTMLElement) =>
  [...el.querySelectorAll(".justify-between")].map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim());

describe("CourseSidebar overview rows", () => {
  it("keeps the author row with a dash in other skins", async () => {
    const el = await render(<CourseSidebar {...props()} />);
    expect(rowTexts(el)).toContain("sidebar.author—");
  });

  it("leaves out a row with nothing to say under Fun, and its divider", async () => {
    const el = await render(<CourseSidebar {...props({ hideEmptyRows: true })} />);
    const texts = rowTexts(el);
    expect(texts.some((t) => t.startsWith("sidebar.author"))).toBe(false);
    expect(texts.some((t) => t.includes("Class 12"))).toBe(true);
    expect(texts.some((t) => t.startsWith("sidebar.courseTime"))).toBe(true);
    // level then time: one divider between them, none dangling
    expect(el.querySelectorAll('[data-orientation="horizontal"], .bg-border.h-px').length).toBe(1);
  });

  it("shows the author under Fun when there is one", async () => {
    const el = await render(<CourseSidebar {...props({ hideEmptyRows: true, primaryInstructorName: "R. Rao" })} />);
    expect(rowTexts(el)).toContain("sidebar.authorR. Rao");
  });

  it("drops an empty course time and a blank level under Fun, and the card when nothing is left", async () => {
    const el = await render(
      <CourseSidebar
        {...props({
          hideEmptyRows: true,
          levelOptions: [{ _id: "l", value: "lvl-12", label: " " }],
          slideCountQuery: { isLoading: false, error: null, data: [] },
        })}
      />,
    );
    expect(rowTexts(el)).toEqual([]);
    expect(el.textContent).not.toContain("sidebar.overview");
  });
});

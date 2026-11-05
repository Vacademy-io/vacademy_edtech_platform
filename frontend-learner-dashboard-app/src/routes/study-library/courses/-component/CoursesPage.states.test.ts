import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestStatus } from "@/lib/list-status";
import type { CoursePackageResponse } from "@/types/course-catalog/course-catalog-list";
import CoursesPage from "./CoursesPage";

vi.mock("./FilterPanel.tsx", () => ({ default: () => null }));
vi.mock("./SearchAndSortBar.tsx", () => ({ default: () => null }));
vi.mock("./CourseCards.tsx", () => ({ default: () => "course-card" }));
vi.mock("./Pagination.tsx", () => ({ default: () => null }));
vi.mock("@/components/common/layout-container/sidebar/utils.ts", () => ({
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/services/student-display-settings", () => ({
  getStudentDisplaySettings: () => Promise.resolve(null),
}));

function render(status: RequestStatus | undefined, content: unknown[] = []) {
  const noop = () => undefined;
  const props: ComponentProps<typeof CoursesPage> = {
    courseData: { content } as unknown as CoursePackageResponse,
    searchTerm: "",
    onSearchChange: noop,
    sortOption: "Newest",
    onSortChange: noop,
    selectedLevels: [],
    setSelectedLevels: noop,
    selectedSessions: [],
    setSelectedSessions: noop,
    selectedTags: [],
    setSelectedTags: noop,
    selectedInstructors: [],
    setSelectedInstructors: noop,
    clearAllFilters: noop,
    onApplyFilters: noop,
    handlePageChange: noop,
    selectedTab: "PROGRESS",
    status,
    onRetry: noop,
  };
  return renderToStaticMarkup(createElement(CoursesPage, props));
}

const LOADING = "animate-pulse";
const EMPTY = "catalog.emptyProgress.title";
const ERROR = 'role="alert"';
const ITEMS = "course-card";

describe("CoursesPage", () => {
  it.each([
    ["before any request", undefined],
    ["while a request runs", "loading"],
  ] as const)("shows the skeleton %s, not an empty message", (_label: string, status: RequestStatus | undefined) => {
    const html = render(status);
    expect(html).toContain(LOADING);
    expect(html).not.toContain(EMPTY);
  });

  it("shows the error with a retry after a failed request, not an empty message", () => {
    const html = render("error");
    expect(html).toContain(ERROR);
    expect(html).toContain("<button");
    expect(html).not.toContain(EMPTY);
    expect(html).not.toContain(LOADING);
  });

  it("shows an empty message only after a successful answer with no items", () => {
    const html = render("success");
    expect(html).toContain(EMPTY);
    expect(html).not.toContain(ERROR);
  });

  it("shows the items after a successful answer with items", () => {
    const html = render("success", [{ id: "a" }]);
    expect(html).toContain(ITEMS);
    expect(html).not.toContain(EMPTY);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When the public course list scrolls itself. Chrome stops recording LCP at the
 * first scroll, so opening must not scroll, while moving between pages of the
 * list must. The real list, pagination and store; only the panels around them
 * are stubbed.
 */

vi.mock("./FilterPanel.tsx", () => ({ default: () => null }));
vi.mock("./SearchAndSortBar.tsx", () => ({ default: () => null }));
vi.mock("./CourseCards.tsx", () => ({ default: () => null }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
    getTerminologyPlural: () => "Courses",
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CoursesPage from "./CoursesPage";
import { useCatalogStore } from "../-store/catalogStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const courses = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
        id: `course-${i}`,
        package_name: `Course ${i}`,
        thumbnail_file_id: "",
        level_name: "Level",
    }));

describe("public course list scrolling", () => {
    let root: Root;
    let host: HTMLDivElement;
    let scrollIntoView: ReturnType<typeof vi.fn>;

    const setCourses = (count: number) =>
        act(() => useCatalogStore.getState().setCourseData(courses(count)));

    const open = () =>
        act(() => {
            root.render(
                React.createElement(CoursesPage, {
                    searchTerm: "",
                    onSearchChange: noop,
                    sortOption: "Newest",
                    onSortChange: noop,
                    selectedLevels: [],
                    setSelectedLevels: noop,
                    selectedTags: [],
                    setSelectedTags: noop,
                    selectedInstructors: [],
                    setSelectedInstructors: noop,
                    clearAllFilters: noop,
                    onApplyFilters: noop,
                    instituteId: "institute",
                })
            );
        });

    const tapPage = (page: number) => {
        const button = Array.from(host.querySelectorAll("button")).find(
            (b) => b.textContent === String(page)
        );
        if (!button) throw new Error(`no button for page ${page}`);
        act(() => button.click());
    };

    beforeEach(() => {
        scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
        useCatalogStore.getState().setCourseData([]);
        host = document.body.appendChild(document.createElement("div"));
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("does not scroll when the screen opens", () => {
        open();
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("does not scroll when the first results arrive", () => {
        open();
        setCourses(25);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("does not scroll when it opens on results already held from an earlier visit", () => {
        useCatalogStore.getState().setCourseData(courses(25));
        open();
        setCourses(25);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("scrolls to the list once per page change", () => {
        open();
        setCourses(25);
        tapPage(2);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
        tapPage(3);
        expect(scrollIntoView).toHaveBeenCalledTimes(2);
        tapPage(1);
        expect(scrollIntoView).toHaveBeenCalledTimes(3);
    });

    it("does not scroll on a tap on the page already showing", () => {
        open();
        setCourses(25);
        tapPage(1);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("scrolls when new results send the list from a later page back to the first", () => {
        open();
        setCourses(25);
        tapPage(2);
        scrollIntoView.mockClear();
        setCourses(12);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("stays put when new results arrive on the first page", () => {
        open();
        setCourses(25);
        setCourses(12);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });
});

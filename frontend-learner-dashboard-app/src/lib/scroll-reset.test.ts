import { afterEach, describe, expect, it, vi } from "vitest";
import { installScrollReset, shouldResetScroll } from "./scroll-reset";
import type { ScrollResetInput } from "./scroll-reset";

const input = (over: Partial<ScrollResetInput> = {}): ScrollResetInput => ({
    fromPathname: "/dashboard",
    toPathname: "/study-library/courses",
    toHash: "",
    routeIds: ["__root__", "/study-library/courses/"],
    ...over,
});

describe("shouldResetScroll", () => {
    it("resets when a different pathname opens", () => {
        expect(shouldResetScroll(input())).toBe(true);
    });

    it("leaves a search-param update alone", () => {
        expect(
            shouldResetScroll(input({ fromPathname: "/study-library/courses" }))
        ).toBe(false);
    });

    it("leaves the first load alone", () => {
        expect(shouldResetScroll(input({ fromPathname: undefined }))).toBe(false);
    });

    it("leaves a hash target to the browser", () => {
        expect(shouldResetScroll(input({ toHash: "section" }))).toBe(false);
    });

    it.each([
        "/$tagName/",
        "/$tagName/$pageSlug",
        "/assessment/examination/$assessmentId/",
        "/assessment/examination/$assessmentId/LearnerLiveTest",
        "/assessment/examination/$assessmentId/assessmentPreview",
        "/study-library/courses/course-details/subjects/modules/chapters/slides/",
    ])("does not run for the self-scrolling screen %s", (id: string) => {
        expect(shouldResetScroll(input({ routeIds: ["__root__", id] }))).toBe(false);
    });

    it("still runs for the assessment list and for screens around a lesson", () => {
        expect(
            shouldResetScroll(input({ routeIds: ["__root__", "/assessment/examination/"] }))
        ).toBe(true);
        expect(
            shouldResetScroll(
                input({ routeIds: ["__root__", "/study-library/courses/course-details/"] })
            )
        ).toBe(true);
    });
});

describe("installScrollReset", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const setup = () => {
        const scrollTo = vi.fn();
        vi.stubGlobal("window", { scrollTo });
        let onRouteMount: (e: {
            fromLocation?: { pathname: string };
            toLocation: { pathname: string; hash: string };
        }) => void = () => {};
        const router = {
            state: { matches: [{ routeId: "__root__" }, { routeId: "/chat/" }] },
            subscribe: (_: "onBeforeRouteMount", l: typeof onRouteMount) => {
                onRouteMount = l;
                return () => {};
            },
        };
        installScrollReset(router);
        const go = (from: string | undefined, to: string) => {
            onRouteMount({
                fromLocation: from === undefined ? undefined : { pathname: from },
                toLocation: { pathname: to, hash: "" },
            });
        };
        return { scrollTo, go };
    };

    it("scrolls instantly to the top when a different pathname opens", () => {
        const { scrollTo, go } = setup();
        go("/dashboard", "/chat");
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
    });

    it("does not touch the scroll position on a search-param update", () => {
        const { scrollTo, go } = setup();
        go("/chat", "/chat");
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it("does not touch the scroll position when the first screen opens", () => {
        const { scrollTo, go } = setup();
        go(undefined, "/chat");
        expect(scrollTo).not.toHaveBeenCalled();
    });
});

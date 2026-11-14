import { describe, expect, it, vi } from "vitest";
import { findRootPage, hasRootRoute, servedAtRootIn } from "./catalogue-root-page";
import { resolveHeaderAuthLinks } from "./catalogue-cta";
import { findCatalogueListingRoute } from "./catalogue-page-routes";

// catalogue-page-routes' hooks fetch through these; the pure functions never do.
vi.mock("@/services/domain-routing", () => ({
  getCachedRootCatalogueTag: () => null,
}));
vi.mock("../-services/course-catalogue-service", () => ({
  CourseCatalogueService: { getCourseCatalogueByTagMemo: vi.fn() },
}));

const header = (label: string) => ({
  type: "header",
  props: { authLinks: [{ label, route: label.toLowerCase() }] },
});

// The old home page kept its id but moved to "library"; a new page is at the root.
const movedHome = [
  { id: "home", route: "library", components: [header("Library"), { type: "bookCatalogue", enabled: true }] },
  { id: "landing", route: "homepage", components: [header("Landing")] },
];

describe("findRootPage", () => {
  it("prefers a page routed at the root over one with id 'home'", () => {
    expect(findRootPage(movedHome)?.id).toBe("landing");
  });

  it("falls back to id 'home' only when no page has a root route", () => {
    expect(findRootPage([{ id: "about", route: "about" }, { id: "home", route: "start" }])?.id).toBe("home");
  });

  it("accepts every root route and finds nothing in an empty list", () => {
    expect(findRootPage([{ id: "a", route: "/" }])?.id).toBe("a");
    expect(findRootPage([{ id: "a", route: "" }])?.id).toBe("a");
    expect(findRootPage([{ id: "a", route: "about" }])).toBeUndefined();
    expect(findRootPage(null)).toBeUndefined();
    expect(findRootPage([null, undefined])).toBeUndefined();
  });

  it("matches routes exactly, as before", () => {
    expect(hasRootRoute({ route: "homepage" })).toBe(true);
    expect(hasRootRoute({ route: "home" })).toBe(false);
    expect(hasRootRoute({ route: null })).toBe(false);
  });

  it("servedAtRootIn judges each page against the whole list", () => {
    const atRoot = servedAtRootIn(movedHome);
    expect(atRoot(movedHome[0])).toBe(false);
    expect(atRoot(movedHome[1])).toBe(true);
    expect(atRoot(null)).toBe(false);
  });
});

describe("one home page for the header and the catalogue link", () => {
  it("both read the page actually served at the root", () => {
    expect(resolveHeaderAuthLinks({ pages: movedHome })[0]?.label).toBe("Landing");
    expect(findCatalogueListingRoute(movedHome)).toBe("library");
  });
});

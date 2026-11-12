import { describe, expect, it, vi } from "vitest";
import { RouteMatcher } from "../-services/route-matcher";
import { catalogueListingPath, catalogueTagOfLandingPath, findCatalogueListingRoute } from "./catalogue-page-routes";

// Classic (tagged) host: pages live under "/<tag>/…".
vi.mock("@/services/domain-routing", () => ({
  getCachedRootCatalogueTag: () => null,
}));
// The hook in the same module fetches through this; the pure functions never do.
vi.mock("../-services/course-catalogue-service", () => ({
  CourseCatalogueService: { getCourseCatalogueByTagMemo: vi.fn() },
}));

const catalogue = (enabled: unknown = true) => ({ type: "bookCatalogue", enabled });

// ReadOnRent after the swap: Home (buy/rent + plans) at the root, books on "library".
const swappedPages = [
  { id: "library", route: "library", components: [catalogue()] },
  { id: "details", route: "books-details", components: [{ type: "bookDetails", enabled: true }] },
  { id: "cart", route: "cart", components: [{ type: "cartComponent", enabled: true }] },
  {
    id: "home",
    route: "homepage",
    aliases: ["buy-rent"],
    components: [{ type: "buyRentSection", enabled: true }, { type: "membershipPlans", enabled: true }],
  },
];

// ReadOnRent before the swap (and every site whose catalogue is its home page).
const classicPages = [
  { id: "home", route: "homepage", components: [catalogue()] },
  { id: "plan", route: "buy-rent", components: [{ type: "buyRentSection", enabled: true }] },
];

describe("findCatalogueListingRoute", () => {
  it("finds the page that hosts the catalogue when it is not the home page", () => {
    expect(findCatalogueListingRoute(swappedPages)).toBe("library");
  });

  it("returns the root when the home page hosts the catalogue", () => {
    expect(findCatalogueListingRoute(classicPages)).toBe("");
  });

  it("returns the root when no page hosts one, or there are no pages", () => {
    expect(findCatalogueListingRoute([{ id: "about", route: "about", components: [] }])).toBe("");
    expect(findCatalogueListingRoute(null)).toBe("");
    expect(findCatalogueListingRoute(undefined)).toBe("");
  });

  it("ignores a disabled catalogue section", () => {
    const pages = [
      { id: "home", route: "homepage", components: [{ type: "buyRentSection", enabled: true }] },
      { id: "old", route: "old-books", components: [catalogue(false)] },
      { id: "library", route: "/library/", components: [catalogue("true")] },
    ];
    expect(findCatalogueListingRoute(pages)).toBe("library");
  });

  it("does not take a former home page that kept id 'home' but moved to 'library' for the root", () => {
    const pages = [
      { id: "home", route: "library", components: [catalogue()] },
      { id: "landing", route: "homepage", components: [{ type: "buyRentSection", enabled: true }] },
    ];
    expect(findCatalogueListingRoute(pages)).toBe("library");
  });

  it("falls back to id 'home' as the root only when no page has a root route", () => {
    const pages = [
      { id: "home", route: "books", components: [catalogue()] },
      { id: "about", route: "about", components: [] },
    ];
    expect(findCatalogueListingRoute(pages)).toBe("");
  });

  it("treats '/' and '' routes as the root too", () => {
    expect(findCatalogueListingRoute([{ id: "main", route: "/", components: [catalogue()] }])).toBe("");
    expect(findCatalogueListingRoute([{ id: "main", route: "", components: [catalogue()] }])).toBe("");
  });

  it("builds the tagged path", () => {
    expect(catalogueListingPath("collections", swappedPages)).toBe(
      RouteMatcher.pagePath("collections", "library"),
    );
    expect(catalogueListingPath("collections", classicPages)).toBe(
      RouteMatcher.pagePath("collections", ""),
    );
  });
});

describe("RouteMatcher.findPageByAlias", () => {
  it("sends the old address of a renamed page to that page", () => {
    expect(RouteMatcher.findPageByAlias("buy-rent", swappedPages)?.id).toBe("home");
    expect(RouteMatcher.findPageByAlias("/Buy-Rent/", swappedPages)?.id).toBe("home");
  });

  it("never overrides a page that still has that route", () => {
    expect(RouteMatcher.findPageByAlias("buy-rent", classicPages)).toBeUndefined();
  });

  it("finds nothing for unknown slugs or pages without aliases", () => {
    expect(RouteMatcher.findPageByAlias("nowhere", swappedPages)).toBeUndefined();
    expect(RouteMatcher.findPageByAlias("", swappedPages)).toBeUndefined();
    expect(RouteMatcher.findPageByAlias("buy-rent", [])).toBeUndefined();
  });

  it("is what findMatchingPage falls back to for an old link", () => {
    expect(RouteMatcher.findMatchingPage("buy-rent", swappedPages as never)?.id).toBe("home");
  });
});

describe("catalogueTagOfLandingPath (login page \"Explore\" button)", () => {
  it("takes the first segment of a classic landing path", () => {
    expect(catalogueTagOfLandingPath("/collections", null)).toBe("collections");
    expect(catalogueTagOfLandingPath("/collections/buy-rent?x=1", null)).toBe("collections");
  });

  it("prefers the host's root-mounted catalogue", () => {
    expect(catalogueTagOfLandingPath("/about", "new")).toBe("new");
  });

  it("returns nothing for an empty path", () => {
    expect(catalogueTagOfLandingPath("", null)).toBe("");
    expect(catalogueTagOfLandingPath("/", null)).toBe("");
  });
});

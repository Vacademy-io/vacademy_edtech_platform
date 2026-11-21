import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteMatcher } from "./route-matcher";
import { registerAppRoutePaths } from "@/services/reserved-app-routes";

// Root-mounted host: catalogue "new" answers on "/" (the7cs.co.in setup).
let rootTag: string | null = "new";
vi.mock("@/services/domain-routing", () => ({
  getCachedRootCatalogueTag: () => rootTag,
}));

/**
 * A catalogue page named like one of the app's own routes can never be served
 * at "/<page>" on a root-mounted host — the static app route wins. The 7Cs
 * footer's "Privacy Policy" (page route `privacy-policy`) opened Vacademy's
 * privacy policy for exactly this reason.
 */
describe("RouteMatcher.pagePath on a root-mounted host", () => {
  beforeEach(() => {
    rootTag = "new";
    // Shape of Object.keys(router.routesByPath)
    registerAppRoutePaths(["/", "/privacy-policy/", "/courses/", "/login", "/$tagName/", "/$tagName/$pageSlug/"]);
  });

  it("drops the tag for ordinary pages", () => {
    expect(RouteMatcher.pagePath("new", "about")).toBe("/about");
    expect(RouteMatcher.pagePath("new", "home")).toBe("/");
    expect(RouteMatcher.pagePath("new", "/books/")).toBe("/books");
  });

  it("keeps the tag for a page the app would shadow", () => {
    expect(RouteMatcher.pagePath("new", "privacy-policy")).toBe("/new/privacy-policy");
    expect(RouteMatcher.pagePath("new", "courses")).toBe("/new/courses");
    expect(RouteMatcher.pagePath("new", "Login")).toBe("/new/Login");
    expect(RouteMatcher.isReservedRootPage("new", "privacy-policy")).toBe(true);
  });

  it("does not treat a route param as a reserved name", () => {
    expect(RouteMatcher.pagePath("new", "tagName")).toBe("/tagName");
  });

  it("leaves classic (non-root) catalogues untouched", () => {
    expect(RouteMatcher.pagePath("other", "privacy-policy")).toBe("/other/privacy-policy");
    expect(RouteMatcher.isReservedRootPage("other", "privacy-policy")).toBe(false);
    rootTag = null;
    expect(RouteMatcher.pagePath("new", "privacy-policy")).toBe("/new/privacy-policy");
    expect(RouteMatcher.isReservedRootPage("new", "privacy-policy")).toBe(false);
  });

  it("is a no-op until routes are registered", () => {
    registerAppRoutePaths([]);
    expect(RouteMatcher.pagePath("new", "privacy-policy")).toBe("/privacy-policy");
  });
});

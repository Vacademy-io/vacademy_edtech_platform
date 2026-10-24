import { describe, expect, it } from "vitest";
import { collectSidebarNavRoutes, isNavRouteActive } from "./active-route";

// Brahm Varchas sidebar: "All Courses" → /study-library, "My Live Class" →
// /study-library/live-class. Both used to light up on the live-class page.
const routes = ["/dashboard", "/study-library", "/study-library/live-class"];

describe("isNavRouteActive", () => {
  it("lets the more specific entry own its page", () => {
    const p = "/study-library/live-class";
    expect(isNavRouteActive(p, "/study-library/live-class", routes)).toBe(true);
    expect(isNavRouteActive(p, "/study-library", routes)).toBe(false);
    expect(isNavRouteActive(p, "/dashboard", routes)).toBe(false);
  });

  it("keeps the shorter entry lit on its own nested pages", () => {
    const p = "/study-library/courses/course-details";
    expect(isNavRouteActive(p, "/study-library", routes)).toBe(true);
  });

  it("keeps the more specific entry lit on pages nested under it", () => {
    const p = "/study-library/live-class/waiting-room";
    expect(isNavRouteActive(p, "/study-library/live-class", routes)).toBe(true);
    expect(isNavRouteActive(p, "/study-library", routes)).toBe(false);
  });

  it("matches exactly like before when no other entry matches", () => {
    expect(isNavRouteActive("/dashboard", "/dashboard", routes)).toBe(true);
    expect(isNavRouteActive("/dashboard", undefined, routes)).toBe(false);
    expect(isNavRouteActive("/dashboard", "/dashboard", [])).toBe(true);
  });

  it("stops a route-less entry ('/') lighting up on every page", () => {
    expect(isNavRouteActive("/dashboard", "/", ["/", ...routes])).toBe(false);
  });

  it("leaves two entries with the same route both lit, as before", () => {
    expect(isNavRouteActive("/x", "/x", ["/x", "/x"])).toBe(true);
  });
});

describe("collectSidebarNavRoutes", () => {
  const items = [
    { to: "/study-library" },
    {
      to: "/",
      subItems: [
        { subItemLink: "/study-library/live-class" },
        { subItemLink: "/learning-centre/attendance" },
      ],
    },
  ];

  it("counts a sub-item only when it is exactly the current page", () => {
    expect(collectSidebarNavRoutes(items, "/study-library/live-class")).toEqual([
      "/study-library",
      "/study-library/live-class",
    ]);
    // Deeper than the sub-item: the group isn't lit, so it can't claim the page.
    expect(
      collectSidebarNavRoutes(items, "/study-library/live-class/embed")
    ).toEqual(["/study-library"]);
  });
});

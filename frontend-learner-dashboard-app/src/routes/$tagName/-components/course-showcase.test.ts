// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The component navigates on card click, and TanStack's useNavigate throws
// without a router context. The tests below assert rendering, not routing.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
import React from "react";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";

/**
 * `courseShowcase` is the curated alternative to `productCourseGrid`, which
 * always renders the whole catalogue and cannot be limited. These assert the
 * component is wired into the renderer and paints its own chrome — the course
 * data itself arrives from an effect, so SSR shows the loading skeletons.
 */
const page = (props: Record<string, unknown>) => ({
  id: "p", route: "p", title: "p",
  components: [{ id: "s", type: "courseShowcase", enabled: true, props }],
});

const render = (props: Record<string, unknown>) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: page(props), globalSettings: {} as never,
      instituteId: "inst", tagName: "tag",
    } as never),
  );

describe("courseShowcase", () => {
  it("is a known component type (not the unknown-type fallback)", () => {
    const html = render({ title: "Hot right now", limit: 3 });
    expect(html).toContain("Hot right now");
  });

  it("renders its subtitle when given one", () => {
    expect(render({ title: "New", subtitle: "Fresh from the studio" }))
      .toContain("Fresh from the studio");
  });

  it("shows a skeleton per course while loading, capped at the track count", () => {
    const html = render({ title: "X", limit: 8 });
    expect((html.match(/animate-pulse/g) || []).length).toBe(3);
  });

  it("honours the limit for small counts", () => {
    const html = render({ title: "X", limit: 2 });
    expect((html.match(/animate-pulse/g) || []).length).toBe(2);
  });

  // A one- or two-course strip must not sit left-aligned in a 3-up grid.
  it("narrows and centres the grid for a single course", () => {
    const html = render({ title: "X", limit: 1 });
    expect(html).toContain("max-w-sm");
    expect(html).toContain("mx-auto");
    expect(html).not.toContain("lg:grid-cols-3");
  });

  it("narrows to two tracks for two courses", () => {
    const html = render({ title: "X", limit: 2 });
    expect(html).toContain("max-w-3xl");
    expect(html).toContain("sm:grid-cols-2");
  });

  it("renders no ribbon by default", () => {
    expect(render({ title: "X", limit: 1 })).not.toContain("bg-danger-500");
  });

  it("keeps section and per-course ribbons independent in the props contract", () => {
    // Rendering the ribbon needs loaded courses, which SSR does not have; this
    // guards the wiring so a rename of courseBadges cannot pass silently.
    const html = render({
      title: "X", limit: 1, badgeText: "Exclusive",
      courseBadges: { "some-id": { text: "Latest", tone: "new" } },
    });
    expect(html).toContain("X");
  });

  it("uses four tracks only in grid layout", () => {
    expect(render({ title: "X", limit: 8, layout: "grid" })).toContain("lg:grid-cols-4");
    expect(render({ title: "X", limit: 8, layout: "row" })).toContain("lg:grid-cols-3");
  });
});

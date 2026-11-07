import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === "string" ? fallback : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("@/constants/urls", () => ({ BASE_URL: "" }));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ tagName: "knowledge-streams" }),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ latestLocation: { search: {} } }),
  useLocation: () => ({ pathname: "/knowledge-streams/courses", searchStr: "" }),
}));

const { Breadcrumb, visibleBreadcrumbItems } = await import("./Breadcrumb");

const html = (props: React.ComponentProps<typeof Breadcrumb>) => renderToStaticMarkup(React.createElement(Breadcrumb, props));

describe("Breadcrumb", () => {
  it("renders a nav landmark with an ordered trail; earlier items link, the last is the current page", () => {
    const out = html({ items: [{ label: "Home", route: "homepage" }, { label: "Courses", route: "courses" }] });
    expect(out).toContain('<nav aria-label="Breadcrumb"');
    expect(out).toContain("<ol");
    expect(out).toMatch(/<a href="[^"]*knowledge-streams[^"]*"[^>]*>Home<\/a>/);
    // The current page is text, never a link, even when it has a route.
    expect(out).toContain('<span aria-current="page" class="text-catalogue-text-secondary">Courses</span>');
    expect(out).not.toMatch(/>Courses<\/a>/);
    // One separator between two items, hidden from assistive tech.
    expect(out.match(/aria-hidden="true">\/</g)).toHaveLength(1);
  });

  it("takes custom classes, separator and label", () => {
    const out = html({
      items: [{ label: "Home", route: "/" }, { label: "Paths" }],
      className: "text-palette-muted",
      separator: "›",
      ariaLabel: "पथ",
      currentClassName: "font-bold",
    });
    expect(out).toContain('aria-label="पथ"');
    expect(out).toContain("text-palette-muted");
    expect(out).toContain(">›<");
    expect(out).toContain("text-catalogue-text-secondary font-bold");
  });

  it("renders nothing for an empty or label-less trail", () => {
    expect(html({ items: [] })).toBe("");
    expect(html({ items: undefined })).toBe("");
    expect(html({ items: [{ label: "  " }] })).toBe("");
    expect(visibleBreadcrumbItems([{ label: " A ", route: " " }, null as never])).toEqual([{ label: "A", route: undefined }]);
  });
});

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
  useRouter: () => ({ latestLocation: { search: {} }, history: { push: () => {}, replace: () => {} } }),
  useLocation: () => ({ pathname: "/knowledge-streams/learning-paths", searchStr: "" }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));

const { HeroSectionComponent } = await import("./HeroSectionComponent");
const { resolveMediaWidth, resolveAspectRatio } = await import("./HeroEditorial");

const EDITORIAL = {
  variant: "editorial",
  layout: "split",
  backgroundColor: "#FDF6E8", // design-lint-ignore: test fixture colour
  mediaWidth: 500,
  outlineColor: "#A08A5C", // design-lint-ignore: test fixture colour
  breadcrumb: [{ label: "Home", route: "/" }, { label: "Learning Paths" }],
  eyebrow: { text: "Learning paths", style: "rule" },
  left: {
    title: "Not sure where to start?",
    titleAccent: "Follow a path.",
    description: "<p>A learning path is a set of courses in the right order.</p>",
    checklist: ["Courses in the right order", "Step 1 free on most paths", "English & हिन्दी"],
    // Ignored by the editorial hero (as by the default one for a landing hero).
    tags: ["Old tag"],
    buttons: [
      { text: "Find my path", action: "navigate", target: "#paths", variant: "primary" },
      { text: "Browse all courses", action: "navigate", target: "/courses", variant: "secondary" },
    ],
  },
  right: { image: "https://cdn.example/paths_hero.png", alt: "An example learning path" },
  styles: { roundedEdges: false, textAlign: "left" },
};

const html = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(HeroSectionComponent, props as never));
const text = (out: string) =>
  out
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

describe("heroSection variant 'editorial'", () => {
  it("renders breadcrumb, ruled eyebrow, two-tone title, lead, check bullets, buttons and unframed media", () => {
    const out = html(EDITORIAL);
    expect(out).toContain('data-hero-variant="editorial"');
    expect(text(out)).toEqual([
      "Home",
      "/",
      "Learning Paths",
      "Learning paths",
      "Not sure where to start?",
      "Follow a path.",
      "A learning path is a set of courses in the right order.",
      "Courses in the right order",
      "Step 1 free on most paths",
      "English &amp; हिन्दी",
      "Find my path",
      "Browse all courses",
    ]);
    // Breadcrumb: Home links, the current page is text.
    expect(out).toMatch(/<a [^>]*href="[^"]*knowledge-streams[^"]*"[^>]*>Home<\/a>/);
    expect(out).toContain('aria-current="page" class="text-palette-muted">Learning Paths</span>');
    // Ruled eyebrow (24×1 accent rule), accent second title line on its own line.
    expect(out).toContain('<span aria-hidden="true" class="h-px w-6 shrink-0 bg-palette-accent"></span>');
    expect(out).toContain('<span class="block text-palette-accent">Follow a path.</span>');
    expect(out.match(/<h1/g)).toHaveLength(1);
    // Three bullets with filled check icons.
    expect(out.match(/<li class="flex items-center gap-2 text-sm font-bold text-palette-text">/g)).toHaveLength(3);
    // Primary + outline buttons.
    expect(out).toMatch(/class="[^"]*bg-palette-primary text-white[^"]*">Find my path</);
    expect(out).toMatch(/class="[^"]*--hero-outline[^"]*bg-catalogue-bg-elevated[^"]*">Browse all courses</);
    // Unframed media: no shadow, no max-h-96, no rounding.
    expect(out).toContain('<img src="https://cdn.example/paths_hero.png" alt="An example learning path"');
    expect(out).not.toContain("shadow-md");
    expect(out).not.toContain("max-h-96");
    expect(out).not.toContain("Old tag");
  });

  it("sets the band colour, the media width and the outline colour on the section", () => {
    const out = html(EDITORIAL);
    expect(out).toMatch(/<section data-hero-variant="editorial" class="[^"]*" style="background-color:#FDF6E8;--hero-media-w:500px;--hero-outline:[^"]+">/); // design-lint-ignore: test fixture colour
    expect(out).toContain("catalogue-shell");
    // Without a band colour the palette cream paints it; without an outline colour no var is set.
    const plain = html({ ...EDITORIAL, backgroundColor: undefined, outlineColor: undefined });
    expect(plain).toMatch(/<section data-hero-variant="editorial" class="[^"]*bg-palette-cream" style="--hero-media-w:500px">/);
  });

  it("scrolls to an in-page anchor, else navigates; opens audience forms", async () => {
    const { runHeroButtonAction } = await import("./HeroEditorial");
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn((id: string) => (id === "paths" ? { scrollIntoView } : null));
    const dispatchEvent = vi.fn();
    vi.stubGlobal("document", { getElementById });
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class {
        constructor(
          public type: string,
          public init: { detail: unknown },
        ) {}
      },
    );
    try {
      const navigate = vi.fn();
      runHeroButtonAction({ text: "Find my path", action: "navigate", target: "#paths" }, navigate);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      expect(navigate).not.toHaveBeenCalled();
      runHeroButtonAction({ text: "Missing", action: "navigate", target: "#nope" }, navigate);
      runHeroButtonAction({ text: "Browse", action: "navigate", target: "/courses" }, navigate);
      expect(navigate.mock.calls).toEqual([["#nope"], ["/courses"]]);
      runHeroButtonAction({ text: "Talk to us", action: "openForm", audienceId: " aud-1 " }, navigate);
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0]![0]).toMatchObject({
        type: "openAudienceForm",
        init: { detail: { audienceId: "aud-1", title: "Talk to us" } },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reserves the media box from an authored aspect ratio (no layout shift); the LCP image loads first", () => {
    expect(resolveAspectRatio("1660/1460")).toBe("1660 / 1460");
    expect(resolveAspectRatio(" 4 / 3 ")).toBe("4 / 3");
    expect(resolveAspectRatio(1.5)).toBe("1.5 / 1");
    for (const bad of [undefined, "", "abc", "1/0", 0, -1, "1/2/3", 100]) expect(resolveAspectRatio(bad)).toBeNull();
    const out = html({ ...EDITORIAL, right: { ...EDITORIAL.right, aspectRatio: "1660/1460" } });
    expect(out).toMatch(/<div class="[^"]*max-w-\[var\(--hero-media-w\)\][^"]*" style="aspect-ratio:1660 \/ 1460" data-hero-media=""><img /);
    expect(out).toContain('fetchPriority="high"');
    // Without one: the image alone, as before.
    expect(html(EDITORIAL)).not.toContain("data-hero-media");
  });

  it("clamps the media width", () => {
    expect(resolveMediaWidth(undefined)).toBe(500);
    expect(resolveMediaWidth(420)).toBe(420);
    expect(resolveMediaWidth("640")).toBe(640);
    expect(resolveMediaWidth(10)).toBe(500);
    expect(resolveMediaWidth(5000)).toBe(500);
  });

  it("leaves a hero without the variant on the default markup", () => {
    const { variant: _variant, ...rest } = EDITORIAL;
    void _variant;
    const out = html(rest);
    expect(out).not.toContain("data-hero-variant");
    expect(out).toContain("catalogue-hero-surface");
    expect(out).not.toContain("Follow a path.");
    expect(out).not.toContain("Courses in the right order");
    expect(html({ ...rest, variant: "default" })).toBe(out);
  });
});

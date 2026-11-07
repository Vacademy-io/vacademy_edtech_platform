/**
 * The registry's minimal examples for the self-contained section looks render
 * the opt-in markup through the real components (the same harness as
 * hero-editorial.render.test.ts): heroSection "editorial", ctaBanner "band"
 * (dark, light lg, app), stepsProcess "cards" and footer "brand" (with the
 * newsletter). Data-bound patterns (courseCatalog, learningPath) and the
 * header (router, cart and mega-menu data) are checked through their config
 * resolvers in design-patterns.test.ts, because rendering them needs live data.
 */
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
  useParams: () => ({ tagName: "site" }),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ latestLocation: { search: {} }, history: { push: () => {}, replace: () => {} } }),
  useLocation: () => ({ pathname: "/site/learning-paths", searchStr: "" }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));

const { findDesignPattern } = await import("./design-patterns");
const { HeroSectionComponent } = await import("../-components/components/HeroSectionComponent");
const { CtaBand } = await import("../-components/components/promo/CtaBand");
const { StepsCards } = await import("../-components/components/promo/StepsCards");
const { FooterBrand } = await import("../-components/components/footer/FooterBrand");

const minimal = (id: string) => findDesignPattern(id)!.minimal as Record<string, unknown>;
/** Text as renderToStaticMarkup escapes it (placeholders are "<…>"). */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const html = (component: React.ComponentType<never>, props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(component, props as never));

describe("registry minimal examples render the opt-in look", () => {
  it("hero.editorial renders the two-tone title, checklist and button", () => {
    const props = minimal("hero.editorial");
    const left = props.left as { titleAccent: string; checklist: string[]; buttons: Array<{ text: string }> };
    const out = html(HeroSectionComponent as never, props);
    expect(out).toContain(esc(left.titleAccent));
    for (const item of left.checklist) expect(out).toContain(esc(item));
    expect(out).toContain(esc(left.buttons[0]!.text));
  });

  it.each([
    ["cta.band", "md"],
    ["cta.band.light", "lg"],
    ["cta.band.app", "app"],
  ])("%s renders the %s band with its buttons", (id: string, kind: string) => {
    const props = minimal(id);
    const out = html(CtaBand as never, props);
    expect(out).toContain(`data-cta-band="${kind}"`);
    for (const key of ["button", "secondaryButton"]) {
      const b = props[key] as { text?: string } | undefined;
      if (b?.text) expect(out).toContain(esc(b.text));
    }
  });

  it("steps.cards renders the numbered cards", () => {
    const props = minimal("steps.cards");
    const out = html(StepsCards as never, props);
    expect(out).toContain("data-steps-cards");
    for (const step of props.steps as Array<{ title: string }>) expect(out).toContain(esc(step.title));
  });

  it.each(["footer.brand", "footer.newsletter"])("%s renders the brand footer", (id: string) => {
    const props = minimal(id);
    const out = html(FooterBrand as never, props);
    expect(out).toContain('data-footer-variant="brand"');
    const newsletter = props.newsletter as { heading?: string } | undefined;
    if (newsletter?.heading) expect(out).toContain(esc(newsletter.heading));
    const left = props.leftSection as { tagline?: string } | undefined;
    if (left?.tagline) expect(out).toContain(esc(left.tagline));
  });
});

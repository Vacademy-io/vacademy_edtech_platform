import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Proof that the learning-paths opt-ins (learningPath listLayout "featured",
 * heroSection variant "editorial") leave every other site byte-identical:
 * the default learningPath (cards list, single path) and heroSection
 * (split + image, placeholder, centered, badge/plain eyebrows, buttons,
 * carousel) render exactly the markup in __golden__/paths-*.html, which was
 * generated from the code BEFORE those opt-ins existed (bv/foundation).
 * Never regenerate these files to make a failure pass: a failure means a
 * default changed. (UPDATE_PATHS_GOLDEN=1 writes them, for the base only.)
 */

vi.mock("@/constants/urls", () => ({
  BASE_URL: "",
  GET_PRODUCT_PAGE_BY_CODE: (code: string, id: string) => `/by-code?code=${code}&instituteId=${id}`,
  VALIDATE_PRODUCT_PAGE_COUPON: "",
  PRODUCT_PAGE_FORM_SUBMIT: "",
  PRODUCT_PAGE_ENROLL: "",
  PRODUCT_PAGE_CPO_ENROLL: "",
  PEYMENT_LOG_STATUS_URL: "",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) =>
      typeof opts === "string"
        ? opts
        : opts?.defaultValue
          ? String(opts.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k] ?? ""))
          : key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children?: React.ReactNode; className?: string }) =>
    React.createElement("a", { href: to.replace(/\$(\w+)/g, (_, k: string) => params?.[k] ?? ""), className }, children),
  useLocation: () => ({ pathname: "/learning-paths", searchStr: "" }),
  useRouter: () => ({ history: { push: () => {}, replace: () => {} }, latestLocation: { search: {} } }),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));

const { LearningPathComponent } = await import("./LearningPathComponent");
const { HeroSectionComponent } = await import("./HeroSectionComponent");

const INSTITUTE = "inst-1";
const LIBRARY = "lib-1";

const client = () => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c.setQueryData(["FOLDER_LIBRARY_PUBLIC", INSTITUTE, LIBRARY], {
    library: { id: LIBRARY, name: "Library" },
    roots: [
      {
        id: "f1",
        node_type: "FOLDER",
        title: "Shiksha",
        slug: "shiksha",
        children: [
          { id: "a", node_type: "PRODUCT_PAGE", product_page_code: "PA", title: "Path a", description: "About a", image_url: "https://x/a.jpg", children: [] },
          {
            id: "b",
            node_type: "PRODUCT_PAGE",
            product_page_code: "PB",
            title: "Path b",
            subtitle: "Second",
            tagline: "Pitch",
            cta_label: "Begin",
            accent_color: "#f59e0b", // design-lint-ignore: test fixture colour
            children: [],
          },
        ],
      },
    ],
  });
  c.setQueryData(["PRODUCT_PAGE_BY_CODE", "PA", INSTITUTE], {
    code: "PA",
    name: "Path a",
    mappings: [
      { package_session_id: "ps1", package_id: "c1", package_name: "Course one", level_name: "English", status: "ACTIVE", display_order: 0, payment_plan: { actual_price: 0, currency: "INR" } },
      { package_session_id: "ps2", package_id: "c1", package_name: "Course one", level_name: "Hindi", status: "ACTIVE", display_order: 1, payment_plan: { actual_price: 100, currency: "INR" } },
      { package_session_id: "ps3", package_id: "c2", package_name: "Course two", level_name: "default", status: "ACTIVE", display_order: 2, payment_plan: { actual_price: 250, elevated_price: 400, currency: "INR" } },
    ],
  });
  return c;
};

const renderPath = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: client() },
      React.createElement(LearningPathComponent, { instituteId: INSTITUTE, tagName: "site", ...props }),
    ),
  );
const renderHero = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(HeroSectionComponent, props as never));

const CASES: Record<string, () => string> = {
  "paths-list-cards": () =>
    renderPath({ mode: "list", libraryId: LIBRARY, title: "Paths", subtitle: "Pick one", viewPathLabel: "View path", backgroundColor: "#fff8ee" }), // design-lint-ignore: test fixture colour
  "paths-single": () =>
    renderPath({ productPageCode: "PA", title: "Path a", globalSettings: { courseLanguages: { enabled: true } } }),
  "paths-hero-split-image": () =>
    renderHero({
      layout: "split",
      backgroundColor: "#FBF3E4", // design-lint-ignore: test fixture colour
      eyebrow: { text: "Learning paths", style: "text" },
      left: {
        title: "Not sure where to start? Follow a path.",
        description: "<p>A learning path is a set of courses.</p>",
        tags: ["Courses in the right order"],
        buttons: [
          { text: "Find my path", action: "navigate", target: "#paths", variant: "primary" },
          { text: "Browse all courses", action: "navigate", target: "/courses", variant: "secondary" },
        ],
      },
      right: { image: "https://cdn.example/hero.png", alt: "Illustration" },
      styles: { padding: "40px", roundedEdges: true, textAlign: "left" },
      statChips: [{ value: "20+", label: "Courses" }],
    }),
  "paths-hero-placeholder-centered": () =>
    renderHero({
      layout: "centered",
      eyebrow: { text: "Cohort 4", style: "badge" },
      trust: { rating: 4.5, text: "Loved" },
      left: { title: "Hello", description: "World", button: { text: "Go", action: "navigate", target: "/x", enabled: true } },
      styles: { textAlign: "center" },
    }),
  "paths-hero-carousel-plain": () =>
    renderHero({
      layout: "split",
      eyebrow: { text: "Plain", style: "plain" },
      left: { title: "Carousel" },
      right: { images: [{ image: "https://x/1.png", alt: "1" }, { image: "https://x/2.png", alt: "2" }] },
    }),
};

const goldenPath = (name: string) => new URL(`./__golden__/${name}.html`, import.meta.url);

describe("learning paths opt-ins: defaults render exactly as before", () => {
  for (const [name, renderCase] of Object.entries(CASES)) {
    it(name, () => {
      const html = renderCase();
      if (process.env.UPDATE_PATHS_GOLDEN === "1") {
        fs.mkdirSync(new URL("./__golden__/", import.meta.url), { recursive: true });
        fs.writeFileSync(goldenPath(name), html);
      }
      expect(html.length).toBeGreaterThan(100);
      expect(html).toBe(fs.readFileSync(goldenPath(name), "utf8"));
    });
  }
});

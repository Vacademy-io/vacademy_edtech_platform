import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LearningPathFeaturedOptions } from "./LearningPathFeatured";

// ─── environment stubs (node, no router / browser) ──────────────────────────
vi.mock("@/constants/urls", () => ({
  BASE_URL: "",
  GET_PRODUCT_PAGE_BY_CODE: (code: string, id: string) => `/by-code?code=${code}&instituteId=${id}`,
  VALIDATE_PRODUCT_PAGE_COUPON: "",
  PRODUCT_PAGE_FORM_SUBMIT: "",
  PRODUCT_PAGE_ENROLL: "",
  PRODUCT_PAGE_CPO_ENROLL: "",
  PEYMENT_LOG_STATUS_URL: "",
}));

const interpolate = (text: string, vars: Record<string, unknown> = {}) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) =>
      typeof opts === "string" ? opts : opts?.defaultValue ? interpolate(String(opts.defaultValue), opts) : key,
    i18n: { language: "en" },
  }),
}));

const routerState = vi.hoisted(() => ({ searchStr: "" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    children?: React.ReactNode;
    className?: string;
  }) => {
    const path = to.replace(/\$(\w+)/g, (_, k: string) => params?.[k] ?? "");
    const qs = new URLSearchParams(
      Object.entries(search || {}).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    return React.createElement("a", { href: qs ? `${path}?${qs}` : path, className }, children);
  },
  useLocation: () => ({ pathname: "/learning-paths", searchStr: routerState.searchStr }),
  useRouter: () => ({ history: { push: () => {}, replace: () => {} } }),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));

const { LearningPathComponent } = await import("./LearningPathComponent");
const { CatalogueLocaleProvider } = await import("../../-utils/catalogue-locale");
const { localizeComponentProps } = await import("../../-utils/catalogue-site-language");
const { LearningPathFeaturedSkeleton, withSharedPathOptions } = await import("./LearningPathFeatured");

// ─── fixtures (shaped like the knowledge-streams library) ───────────────────
const INSTITUTE = "inst-1";
const LIBRARY = "lib-1";

const folder = (id: string, slug: string, subtitle: string, children: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  node_type: "FOLDER",
  title: `T-${slug}`,
  slug,
  subtitle,
  image_url: `https://cdn.example/${slug}.png`,
  children,
  ...extra,
});
const page = (id: string, code: string, title: string) => ({
  id,
  node_type: "PRODUCT_PAGE",
  product_page_code: code,
  title,
  description: `About ${title}`,
  image_url: `https://cdn.example/${code}.jpg`,
  children: [],
});

const TREE = {
  library: { id: LIBRARY, name: "Knowledge Streams" },
  roots: [
    folder("s-swasthya", "swasthya", "Health | Ayurveda", [folder("c-raj", "rajaswala", "Rajaswala"), page("p1", "forbvy", "A woman's life stages")], {
      accent_color: "#6f7a4d", // design-lint-ignore: test fixture colour
    }),
    folder("s-dharma", "dharma", "Virtue | Civilisation"),
    folder("s-bharat", "bharat", "Orbiting Bharat", [page("p2", "92ogt2", "India of temples")]),
    folder("s-shastra", "shastra", "Scriptures | Texts", [page("p3", "u5rgwb", "First steps in Scriptures")]),
    folder("s-shiksha", "shiksha", "Education", [page("p4", "ks61g1", "Gurukul Education")]),
  ],
};

let seq = 0;
const row = (pkg: string, name: string, level: string, price: number, tags: string) => ({
  id: `m-${pkg}`,
  package_session_id: `ps-${pkg}`,
  package_id: pkg,
  package_name: name,
  level_name: level,
  session_name: "default",
  status: "ACTIVE",
  display_order: seq++,
  enroll_invite_id: `inv-${pkg}`,
  payment_plan: { actual_price: price, elevated_price: price, currency: "INR" },
  tags,
});
const PAGES: Record<string, unknown> = {
  forbvy: {
    code: "forbvy",
    name: "A woman's life stages",
    mappings: [
      row("raj", "Rajaswala Paricharya", "default", 1001, "english,swasthya,rajaswala,format-elearning"),
      row("garbha", "Vedic Garbha Vigyan", "default", 251, "english,swasthya,format-ebook"),
      row("parent", "Vedic Parenting - eBook", "default", 251, "english,dharma,format-ebook"),
    ],
  },
  "92ogt2": {
    code: "92ogt2",
    name: "India of temples",
    mappings: [
      row("martand", "Martand", "Short Film", 0, "english,bharat,mandir"),
      row("jyesht", "ज्येष्ठेश्वर", "Short Film", 0, "hindi,bharat,mandir"),
      row("maikal", "मैकलसुता", "Article/Essay", 0, "hindi,bharat,mandir"),
    ],
  },
  u5rgwb: {
    code: "u5rgwb",
    name: "First steps in Scriptures",
    mappings: [
      row("gita", "Gita film", "Short Film", 0, "english,shastra"),
      row("rishi", "Rishi Intelligence", "default", 121, "english,shastra,format-ebook"),
      row("raghu", "Raghuveer Gadyam", "default", 1500, "english,shastra"),
    ],
  },
  ks61g1: {
    code: "ks61g1",
    name: "Gurukul Education",
    mappings: [
      row("gk-hi", "गुरुकुल शिक्षा", "default", 151, "hindi,shiksha,format-ebook"),
      row("gk-en", "True Gurukul Shiksha", "default", 151, "english,shiksha,format-ebook"),
    ],
  },
};

const GLOBAL = {
  courseLanguages: {
    enabled: true,
    languages: [
      { code: "en", label: "English", chip: "EN", match: ["english", "en"] },
      { code: "hi", label: "Hindi", chip: "हिं", match: ["hindi", "hi"] },
    ],
  },
  courseFormats: {
    elearning: { label: "Interactive, self-paced E-learning" },
    ebook: { label: "E-books", levels: ["eBook"] },
    animation: { label: "Short film / Animation", levels: ["Short Film"] },
    article: { label: "Articles-essays", levels: ["Article/Essay"] },
  },
};

const FEATURED_PROPS = {
  mode: "list",
  libraryId: LIBRARY,
  listLayout: "featured",
  title: "What do you want to achieve?",
  allGoalsLabel: "All paths",
  goals: [
    { key: "child", label: "Raise my child", tags: ["dharma"] },
    { key: "health", label: "Care for my health", tags: ["swasthya"] },
    { key: "temples", label: "Discover India of temples", tags: ["bharat"] },
    { key: "crafts", label: "Learn a craft", tags: ["kala"] },
  ],
  featured: { code: "forbvy", badge: "Most popular path" },
  pathExtras: [
    { code: "forbvy", stepLabels: ["Rajaswala", "Garbha Vigyan", "Parenting"] },
    { code: "ks61g1", mergeSteps: [[1, 2]], comingSoon: [{ title: "Sanskrit Language teaching", audienceId: "aud-1" }] },
  ],
  formatLabels: { elearning: "E-Learning", ebook: "E-book", animation: "Animation", article: "Articles - essays" },
  moreNote: "New paths are added as courses launch",
  outlineColor: "#a08a5c", // design-lint-ignore: test fixture colour
};

const render = (
  props: Record<string, unknown>,
  opts: {
    search?: string;
    i18n?: Record<string, unknown>;
    libraryLoading?: boolean;
    pagesLoading?: string[];
    tree?: unknown;
  } = {},
) => {
  routerState.searchStr = opts.search || "";
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A query with no cached data is still loading on the first (server) render.
    if (!opts.libraryLoading) client.setQueryData(["FOLDER_LIBRARY_PUBLIC", INSTITUTE, LIBRARY], opts.tree ?? TREE);
    for (const [code, data] of Object.entries(PAGES)) {
      if (!opts.pagesLoading?.includes(code)) client.setQueryData(["PRODUCT_PAGE_BY_CODE", code, INSTITUTE], data);
    }
    const section = React.createElement(LearningPathComponent, {
      instituteId: INSTITUTE,
      tagName: "site",
      globalSettings: GLOBAL,
      ...props,
    });
    return renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        opts.i18n
          ? React.createElement(CatalogueLocaleProvider, { settings: opts.i18n, scope: "site", persist: false, children: section })
          : section,
      ),
    );
  } finally {
    routerState.searchStr = "";
  }
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** The markup of the grid card (li > article) holding `title`. */
const cardOf = (html: string, title: string) => {
  const at = html.indexOf(`>${title}<`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<li", html.lastIndexOf("<article", at)), html.indexOf("</article>", at));
};
const featuredOf = (html: string) => {
  const at = html.indexOf('aria-label="Featured learning path"');
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</article>", at));
};

describe("learningPath list layout 'featured'", () => {
  it("renders goal chips with the path count, hiding goals that match no path", () => {
    const html = render(FEATURED_PROPS);
    const lines = text(html);
    expect(lines).toContain("What do you want to achieve?");
    expect(lines).toContain("All paths · 4");
    expect(lines).toContain("Raise my child");
    expect(lines).toContain("Care for my health");
    expect(lines).toContain("Discover India of temples");
    expect(lines).not.toContain("Learn a craft");
    expect(html).toContain('role="group" aria-label="What do you want to achieve?"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>All paths · 4</);
  });

  it("features the authored path: badge, stream meta, stepper with short labels and prices, total", () => {
    const card = featuredOf(render(FEATURED_PROPS));
    const lines = text(card);
    expect(lines).toContain("Most popular path");
    expect(lines).toContain("A woman&#x27;s life stages");
    // Streams from the steps' tags, in step order; languages; step count.
    expect(lines).toContain("Health | Ayurveda + Virtue | Civilisation  ·  3 steps  ·  English");
    expect(card).toContain('src="https://cdn.example/swasthya.png"');
    expect(card).toContain("background-color:#6f7a4d"); // design-lint-ignore: test fixture colour
    // Stepper: short labels, prices only.
    const labels = ["Rajaswala", "Garbha Vigyan", "Parenting"].map((l) => lines.indexOf(l));
    expect(labels.every((i) => i > -1)).toBe(true);
    expect(labels).toEqual([...labels].sort((a, b) => a - b));
    expect(lines).toContain("₹1,001");
    expect(lines.filter((l) => l === "₹251")).toHaveLength(2);
    expect(lines).toContain("₹1,503");
    expect(lines).toContain("Total of all three steps, bought individually.");
    // No free step: no "Start free step", and "View path" is the primary button.
    expect(card).not.toContain("Start free step");
    expect(card).toMatch(/<button type="button" aria-label="View path — A woman&#x27;s life stages" class="[^"]*bg-palette-primary/);
  });

  it("lists every other path as a card with numbered steps, format · price, pills and totals", () => {
    const html = render(FEATURED_PROPS);
    // The featured path is not repeated in the grid.
    expect(html.split(">A woman&#x27;s life stages<")).toHaveLength(2);
    expect(text(html)).toContain("More learning paths");
    expect(text(html)).toContain("New paths are added as courses launch");

    const temples = text(cardOf(html, "India of temples"));
    expect(temples).toContain("All steps free");
    expect(temples).toContain("Orbiting Bharat  ·  3 steps  ·  Hindi &amp; English");
    expect(temples).toContain("Animation · Free");
    expect(temples).toContain("Articles - essays · Free");
    expect(temples.slice(-3)).toEqual(["Free", "Every step is free", "View path"]);

    const scriptures = text(cardOf(html, "First steps in Scriptures"));
    expect(scriptures).toContain("Step 1 is free");
    expect(scriptures).toContain("E-book · ₹121");
    // A course with no authored format shows its price alone.
    expect(scriptures).toContain("₹1,500");
    expect(scriptures).toContain("₹1,621");
    expect(scriptures).toContain("Total of all three steps");
  });

  it("folds two language packages into one step and adds a coming-soon step", () => {
    const html = render(FEATURED_PROPS);
    const card = cardOf(html, "Gurukul Education");
    const lines = text(card);
    // One step in the visitor's language (English by default), then the coming-soon step.
    expect(lines).toContain("True Gurukul Shiksha");
    expect(lines).not.toContain("गुरुकुल शिक्षा");
    expect(lines).toContain("E-book · ₹151");
    expect(lines).toContain("Sanskrit Language teaching");
    expect(lines).toContain("Coming soon");
    expect(lines).toContain("Education  ·  2 steps  ·  English &amp; Hindi");
    expect(card).toContain('aria-label="Notify me when Sanskrit Language teaching launches"');
    expect(lines).toContain("₹151");
    expect(lines).toContain("Total of available steps");
    expect(lines).not.toContain("Step 1 is free");
  });

  it("offers 'Start free step' and names the free step when the featured path opens free", () => {
    const card = featuredOf(render({ ...FEATURED_PROPS, featured: { code: "u5rgwb" } }));
    expect(card).toContain("Start free step");
    expect(card).toContain(
      'href="/site/gita?enrollInviteId=inv-gita&amp;packageSessionId=ps-gita&amp;productPageCode=u5rgwb&amp;level=Short+Film&amp;price=0"',
    );
    expect(text(card)).toContain("Total of all three steps, bought individually. Gita film is free.");
    // The free step's circle is filled (here step 1), the others outlined.
    expect(card).toMatch(/class="[^"]*bg-palette-olive text-white"[^>]*>1</);
    expect(card.match(/bg-palette-olive text-white/g)).toHaveLength(1);
  });

  it("fills only free steps in the stepper (a paid step 1 stays outlined)", () => {
    const card = featuredOf(render(FEATURED_PROPS));
    expect(card).not.toContain("bg-palette-olive text-white");
    const temples = featuredOf(render({ ...FEATURED_PROPS, featured: { code: "92ogt2" } }));
    // India of temples: every step free, so every circle is filled.
    expect(temples.match(/bg-palette-olive text-white/g)).toHaveLength(3);
  });

  it("makes a coming-soon step with a form a 'Notify me' button in the featured stepper too", () => {
    const card = featuredOf(render({ ...FEATURED_PROPS, featured: { code: "ks61g1" } }));
    expect(card).toMatch(
      /<button type="button" aria-label="Notify me when Sanskrit Language teaching launches" class="[^"]*">Sanskrit Language teaching<\/button>/,
    );
    // Without a form it stays plain text.
    const plain = featuredOf(
      render({
        ...FEATURED_PROPS,
        featured: { code: "ks61g1" },
        pathExtras: [{ code: "ks61g1", comingSoon: [{ title: "Sanskrit Language teaching" }] }],
      }),
    );
    expect(plain).toContain("Sanskrit Language teaching");
    expect(plain).not.toContain("Notify me when");
  });

  it("filters by the goal in ?goal= (the featured card hides when the goal excludes it)", () => {
    const html = render(FEATURED_PROPS, { search: "?goal=temples" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Discover India of temples</);
    expect(html).not.toContain('aria-label="Featured learning path"');
    expect(text(html)).toContain("India of temples");
    expect(text(html)).not.toContain("Gurukul Education");
    // An unknown goal shows everything.
    expect(text(render(FEATURED_PROPS, { search: "?goal=nope" }))).toContain("Gurukul Education");
  });

  it("splits over two sections: parts off render nothing, and only the featured section hosts an open path", () => {
    const top = render({ ...FEATURED_PROPS, showGrid: false });
    expect(top).toContain('aria-label="Featured learning path"');
    expect(top).not.toContain("More learning paths");
    const grid = render({ ...FEATURED_PROPS, showGoals: false, showFeatured: false });
    expect(grid).not.toContain('aria-label="Featured learning path"');
    expect(grid).not.toContain('role="group"');
    expect(text(grid)).toContain("More learning paths");

    expect(render({ ...FEATURED_PROPS, showGoals: false, showFeatured: false }, { search: "?path=92ogt2" })).toBe("");
    const host = render({ ...FEATURED_PROPS, showGrid: false }, { search: "?path=92ogt2" });
    expect(host).toContain("Enrol in this path");
    expect(text(host)).toContain("All learning paths");
  });

  it("split over two sections with no paths yet: the empty note shows once (in the featured section)", () => {
    const empty = { tree: { ...TREE, roots: [] } };
    const note = "New learning paths will appear here.";
    const top = render({ ...FEATURED_PROPS, showGrid: false, emptyText: note }, empty);
    const grid = render({ ...FEATURED_PROPS, showGoals: false, showFeatured: false, emptyText: note }, empty);
    expect(top).toContain(note);
    expect(grid).toBe("");
    // Not split: the list still shows its own note.
    expect(render({ ...FEATURED_PROPS, emptyText: note }, empty)).toContain(note);
    expect(render({ mode: "list", emptyText: note, libraryId: LIBRARY }, empty)).toContain(note);
  });

  it("applies authored colours as section vars only when set", () => {
    expect(render(FEATURED_PROPS)).toMatch(/data-path-layout="featured" class="w-full bg-catalogue-bg" style="--lp-outline:[^"]+"/);
    expect(render({ ...FEATURED_PROPS, outlineColor: undefined })).toContain('data-path-layout="featured" class="w-full bg-catalogue-bg">');
  });

  it("shows live names in the visitor's language (and the Hindi version of a folded step)", () => {
    const i18n = {
      enabled: true,
      defaultLocale: "en",
      locales: [
        { code: "en", label: "EN" },
        { code: "hi", label: "हिन्दी" },
      ],
      strings: {
        hi: { Education: "शिक्षा", "Gurukul Education": "गुरुकुल शिक्षा पथ", Hindi: "हिन्दी", English: "अंग्रेज़ी", Animation: "एनिमेशन" },
      },
    };
    const html = render(FEATURED_PROPS, { search: "?lang=hi", i18n });
    const card = text(cardOf(html, "गुरुकुल शिक्षा पथ"));
    expect(card).toContain("गुरुकुल शिक्षा");
    expect(card).not.toContain("True Gurukul Shiksha");
    expect(card).toContain("शिक्षा  ·  2 steps  ·  अंग्रेज़ी &amp; हिन्दी");
    // Format labels go through the dictionary too (the props localizer skips the "animation" key).
    expect(text(cardOf(html, "India of temples"))).toContain("एनिमेशन · Free");
  });

  it("loading: draws only the parts the section shows, on its own band colour", () => {
    const top = render({ ...FEATURED_PROPS, showGrid: false, backgroundColor: "#FFFFFF" }, { libraryLoading: true }); // design-lint-ignore: test fixture colour
    expect(top).toContain('aria-busy="true"');
    expect(top).toContain("style=\"background-color:#FFFFFF\""); // design-lint-ignore: test fixture colour
    expect(top).toContain("rounded-full");
    expect(top).toContain("h-72");
    expect(top).not.toContain("catalogue-skeleton-shimmer h-[190px]"); // design-lint-ignore: Figma card image height

    const grid = render({ ...FEATURED_PROPS, showGoals: false, showFeatured: false }, { libraryLoading: true });
    expect(grid).toContain('aria-busy="true"');
    expect(grid).not.toContain("h-72");
    expect(grid).not.toContain("h-10 w-32 rounded-full");
    expect(grid.match(/catalogue-skeleton-shimmer h-\[190px\]/g)).toHaveLength(2); // design-lint-ignore: Figma card image height
    expect(grid).toContain("lg:grid-cols-2");
    expect(grid).not.toContain("style=");

    // A grid-only section stays empty while an opened path loads in the featured one.
    expect(render({ ...FEATURED_PROPS, showGoals: false, showFeatured: false }, { libraryLoading: true, search: "?path=92ogt2" })).toBe("");
    expect(renderToStaticMarkup(React.createElement(LearningPathFeaturedSkeleton, { showGoals: false, showFeatured: false, showGrid: false }))).toBe("");
  });

  it("keeps every authored chip and the ?goal= pick while product pages load", () => {
    const html = render(FEATURED_PROPS, { search: "?goal=health", pagesLoading: ["forbvy"] });
    // "Learn a craft" matches no path, but tags are not all known yet.
    expect(text(html)).toContain("Learn a craft");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Care for my health</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All paths · 4</);
    // Once loaded, unmatched goals drop out again.
    expect(text(render(FEATURED_PROPS, { search: "?goal=health" }))).not.toContain("Learn a craft");
  });

  it("shows every authored string from the site dictionary in Hindi (props localizer + siteT)", () => {
    const hi = {
      "What do you want to achieve?": "आप क्या पाना चाहते हैं?",
      "All paths": "सभी पथ",
      "Raise my child": "अपने बच्चे का पालन-पोषण",
      "Care for my health": "अपने स्वास्थ्य की देखभाल",
      "Discover India of temples": "मंदिरों के भारत को जानें",
      "Most popular path": "सबसे लोकप्रिय पथ",
      "Sanskrit Language teaching": "संस्कृत भाषा शिक्षण",
      "E-book": "ई-पुस्तक",
      "Animation": "एनिमेशन",
      "Articles - essays": "लेख - निबंध",
      "More learning paths": "और अध्ययन पथ",
      "New paths are added as courses launch": "पाठ्यक्रम शुरू होने के साथ नए पथ जुड़ते हैं",
      Rajaswala: "रजस्वला",
    };
    const i18n = {
      enabled: true,
      defaultLocale: "en",
      locales: [
        { code: "en", label: "EN" },
        { code: "hi", label: "हिन्दी" },
      ],
      strings: { hi },
    };
    const props = { ...FEATURED_PROPS, moreTitle: "More learning paths" };
    const lines = text(render(localizeComponentProps(props, hi), { search: "?lang=hi", i18n }));
    for (const english of Object.keys(hi)) expect(lines.join("\n")).not.toContain(english);
    expect(lines).toContain("आप क्या पाना चाहते हैं?");
    expect(lines).toContain("सभी पथ · 4");
    expect(lines).toContain("अपने बच्चे का पालन-पोषण");
    expect(lines).toContain("सबसे लोकप्रिय पथ");
    expect(lines).toContain("रजस्वला");
    expect(lines).toContain("संस्कृत भाषा शिक्षण");
    expect(lines).toContain("ई-पुस्तक · ₹121");
    expect(lines).toContain("एनिमेशन · Free");
    expect(lines).toContain("लेख - निबंध · Free");
    expect(lines).toContain("और अध्ययन पथ");
    expect(lines).toContain("पाठ्यक्रम शुरू होने के साथ नए पथ जुड़ते हैं");
  });

  it("leaves a list without listLayout on the path cards", () => {
    const html = render({ mode: "list", libraryId: LIBRARY, viewPathLabel: "Open path" });
    expect(html).not.toContain("data-path-layout");
    expect(html).toContain('class="catalogue-section bg-catalogue-bg"');
    expect(html).toContain('aria-label="Open path — India of temples"');
    expect(html).not.toContain("All paths");
  });
});

describe("learningPath sharedWith (opt-in: one copy of goals and the featured path)", () => {
  // The Brahm Varchas split: goal chips + featured path above, the grid below.
  const TOP = { ...FEATURED_PROPS, showGrid: false };
  const GRID_OWN = { ...FEATURED_PROPS, showGoals: false, showFeatured: false };
  const { goals: _g, featured: _f, pathExtras: _x, allGoalsLabel: _a, ...gridBase } = GRID_OWN;
  const sections = (top: Record<string, unknown>) => [
    { id: "paths", type: "learningPath", props: top },
    { id: "band", type: "ctaBanner", props: { heading: "Institutions" } },
    { id: "paths-more", type: "learningPath", props: { ...gridBase, sharedWith: "paths" } },
  ];

  it("a featured-path change keeps it out of the More learning paths grid (own copies kept equal)", () => {
    const featured = { code: "92ogt2", badge: "Most popular path" };
    const grid = text(render({ ...GRID_OWN, featured }));
    expect(grid).toContain("More learning paths");
    expect(grid).not.toContain("India of temples");
    expect(grid).toContain("A woman&#x27;s life stages");
  });

  it("reads goals, featured path and path extras from the section it names", () => {
    const top = { ...TOP, featured: { code: "92ogt2" } };
    const html = render({ ...gridBase, sharedWith: "paths", pageSections: sections(top) });
    const lines = text(html);
    // The featured path of 'paths' is left out of this grid; the old one is back in it.
    expect(lines).not.toContain("India of temples");
    expect(lines).toContain("A woman&#x27;s life stages");
    // pathExtras come along (the coming-soon step of Gurukul Education).
    expect(text(cardOf(html, "Gurukul Education"))).toContain("Sanskrit Language teaching");
    // ?goal= follows the shared goals (without them an unknown goal shows every path).
    const temples = text(render({ ...gridBase, sharedWith: "paths", pageSections: sections(TOP) }, { search: "?goal=temples" }));
    expect(temples).toContain("India of temples");
    expect(temples).not.toContain("First steps in Scriptures");
    expect(text(render(gridBase, { search: "?goal=temples" }))).toContain("First steps in Scriptures");
  });

  it("is honoured only when set, and only for a learningPath section", () => {
    const own = { ...GRID_OWN, featured: { code: "u5rgwb" } } as LearningPathFeaturedOptions;
    expect(withSharedPathOptions(own, sections(TOP))).toBe(own);
    const toBand = { ...own, sharedWith: "band" };
    expect(withSharedPathOptions(toBand, sections(TOP))).toBe(toBand);
    const missing = { ...own, sharedWith: "gone" };
    expect(withSharedPathOptions(missing, sections(TOP))).toBe(missing);
    // The source's values win; what it lacks stays the section's own.
    const merged = withSharedPathOptions<LearningPathFeaturedOptions>({ ...own, sharedWith: "paths", moreTitle: "Mine" }, [
      { id: "paths", type: "learningPath", props: { featured: { code: "forbvy" } } },
    ]);
    expect(merged).toMatchObject({ featured: { code: "forbvy" }, goals: own.goals, moreTitle: "Mine" });
  });

  it("finds the source inside a column and shows its text in the visitor's language", () => {
    const nested = [{ id: "cols", type: "columnLayout", props: { slots: [[{ id: "paths", type: "learningPath", props: TOP }]] } }];
    const hi = { "Raise my child": "अपने बच्चे का पालन-पोषण" };
    const out = withSharedPathOptions<LearningPathFeaturedOptions>({ sharedWith: "paths" }, nested, (p) => localizeComponentProps(p, hi));
    expect(out.goals?.[0]?.label).toBe("अपने बच्चे का पालन-पोषण");
  });
});

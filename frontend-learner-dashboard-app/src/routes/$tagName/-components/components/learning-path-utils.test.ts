import { describe, expect, it, vi } from "vitest";

// folder-library-service builds its API base from the browser location.
vi.mock("@/constants/urls", () => ({ BASE_URL: "" }));

import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../-utils/course-variants";
import type { PublicFolderNode } from "../../-services/folder-library-service";
import type { SiteCartItem } from "../../-utils/site-cart";
import { capCartAdd } from "../site-cart/site-cart-items";
import {
  buildPathSteps,
  chosenVariant,
  collectPathEntries,
  findFolderBySlug,
  levelWithoutLanguage,
  missingFromCart,
  onePerCourse,
  pathCardDetails,
  pathCartItems,
  pathCheckoutTotals,
  pathCourseIds,
  pathSelection,
  pathTotals,
  pathsInScope,
  planPathCart,
  resolvePathScope,
  stepsInCourseLanguage,
  type PathMapping,
} from "./learning-path-utils";

const row = (
  package_id: string,
  package_session_id: string,
  level_name: string,
  price = 100,
  extra: Partial<PathMapping> = {},
): PathMapping => ({
  package_id,
  package_session_id,
  level_name,
  package_name: `Course ${package_id}`,
  status: "ACTIVE",
  payment_plan: { actual_price: price, elevated_price: price * 2, currency: "INR" },
  ...extra,
});

// Display order as the product-page query returns it.
const mappings = [
  row("c1", "c1-en", "English", 500),
  row("c1", "c1-hi", "Hindi", 400),
  row("c2", "c2-hi", "Hindi", 300),
  row("c3", "c3-en", "English", 200, { status: "DELETED" }),
  row("c2", "c2-hi", "Hindi", 300), // the same version listed twice
  row("c4", "c4-en", "English", 0),
];

describe("buildPathSteps", () => {
  it("groups a course's language versions into one step, in display order", () => {
    const steps = buildPathSteps(mappings, { groupVersions: true, languages: LANGS });
    expect(steps.map((s) => s.courseId)).toEqual(["c1", "c2", "c4"]);
    expect(steps[0]!.variants.map((v) => v.package_session_id)).toEqual(["c1-en", "c1-hi"]);
    expect(steps[0]!.languages.map((l) => l.code)).toEqual(["en", "hi"]);
    expect(steps[1]!.variants).toHaveLength(1);
  });

  it("starts each course in the visitor's language when it has one", () => {
    const steps = buildPathSteps(mappings, { groupVersions: true, languages: LANGS, preferredLanguage: "hi" });
    expect(steps.map((s) => s.primary.package_session_id)).toEqual(["c1-hi", "c2-hi", "c4-en"]);
  });

  it("keeps one step per mapping when the site does not group versions", () => {
    const steps = buildPathSteps(mappings, { groupVersions: false, languages: LANGS });
    expect(steps.map((s) => s.primary.package_session_id)).toEqual(["c1-en", "c1-hi", "c2-hi", "c4-en"]);
  });

  it("copes with no mappings", () => {
    expect(buildPathSteps(null, { groupVersions: true, languages: LANGS })).toEqual([]);
  });
});

describe("stepsInCourseLanguage: a course page numbers its own language's steps", () => {
  // The temples path: separate EN / HI packages, language only in the tags.
  const tagged = (id: string, tags: string) => row(id, `${id}-ps`, "India of temples", 0, { tags });
  const path = buildPathSteps(
    [
      tagged("martand-en", "english,short film"),
      tagged("jyeshtheshwar", "hindi,short film"),
      tagged("maikalsuta", "hindi,articles-essays"),
      tagged("martand-hi", "hindi,short film"),
      tagged("no-lang", "for everyone"),
    ],
    { groupVersions: true, languages: LANGS },
  );

  it("drops the other language's steps, keeps steps with no language", () => {
    expect(stepsInCourseLanguage(path, "maikalsuta", LANGS).map((s) => s.courseId)).toEqual([
      "jyeshtheshwar",
      "maikalsuta",
      "martand-hi",
      "no-lang",
    ]);
    expect(stepsInCourseLanguage(path, "martand-en", LANGS).map((s) => s.courseId)).toEqual(["martand-en", "no-lang"]);
  });

  it("treats a course tagged with two languages as both", () => {
    const scriptures = buildPathSteps(
      [
        tagged("geetayan", "hindi,ebook"),
        tagged("rishi", "english,ebook"),
        tagged("raghuveer", "english,hindi,live sessions"),
        tagged("ram-lekhan", "english,hindi,live sessions"),
      ],
      { groupVersions: true, languages: LANGS },
    );
    const ids = (id: string) => stepsInCourseLanguage(scriptures, id, LANGS).map((s) => s.courseId);
    expect(ids("geetayan")).toEqual(["geetayan", "raghuveer", "ram-lekhan"]);
    expect(ids("rishi")).toEqual(["rishi", "raghuveer", "ram-lekhan"]);
    expect(ids("ram-lekhan")).toEqual(["geetayan", "rishi", "raghuveer", "ram-lekhan"]);
  });

  it("keeps every step when the course is not a step or has no language", () => {
    expect(stepsInCourseLanguage(path, "elsewhere", LANGS)).toBe(path);
    expect(stepsInCourseLanguage(path, "no-lang", LANGS)).toBe(path);
  });

  it("shows a grouped step's version in the course's language", () => {
    const grouped = buildPathSteps(mappings, { groupVersions: true, languages: LANGS, preferredLanguage: "en" });
    const out = stepsInCourseLanguage(grouped, "c2", LANGS);
    expect(out.map((s) => s.primary.package_session_id)).toEqual(["c1-hi", "c2-hi"]);
  });

  it("keeps every step, and the visitor's version, on a course that has both languages", () => {
    const grouped = buildPathSteps(mappings, { groupVersions: true, languages: LANGS, preferredLanguage: "hi" });
    const out = stepsInCourseLanguage(grouped, "c1", LANGS);
    expect(out).toEqual(grouped);
    expect(out.map((s) => s.primary.package_session_id)).toEqual(["c1-hi", "c2-hi", "c4-en"]);
  });
});

describe("path selection, cart items and total", () => {
  const steps = buildPathSteps(mappings, { groupVersions: true, languages: LANGS });

  it("honours a per-course language pick and ignores a language the course lacks", () => {
    expect(chosenVariant(steps[0]!, "hi", LANGS).package_session_id).toBe("c1-hi");
    expect(chosenVariant(steps[1]!, "en", LANGS).package_session_id).toBe("c2-hi");
    expect(chosenVariant(steps[0]!, undefined, LANGS).package_session_id).toBe("c1-en");
  });

  it("totals the chosen versions and builds path-sourced cart items", () => {
    // Picks are keyed by the step's key (its first version), not by the course.
    expect(steps[0]!.key).toBe("c1-en");
    const chosen = pathSelection(steps, { [steps[0]!.key]: "hi" }, LANGS);
    expect(chosen.map((v) => v.package_session_id)).toEqual(["c1-hi", "c2-hi", "c4-en"]);
    const items = pathCartItems(chosen, { languages: LANGS, productPageCode: "PATH1", pathTitle: "Shiksha basics" });
    expect(items[0]).toMatchObject({
      packageSessionId: "c1-hi",
      courseId: "c1",
      languageCode: "hi",
      source: { kind: "path", productPageCode: "PATH1", pathTitle: "Shiksha basics" },
    });
    expect(pathTotals(items)).toEqual({ count: 3, total: 700, elevatedTotal: 1400, currency: "INR" });
    expect(pathCourseIds(chosen)).toBe("c1-hi,c2-hi,c4-en");
  });

  it("gives no single total across currencies", () => {
    const items = pathCartItems(
      [row("a", "a1", "English", 10), row("b", "b1", "English", 20, { payment_plan: { actual_price: 5, currency: "USD" } })],
      { languages: LANGS, productPageCode: "P" },
    );
    expect(pathTotals(items).total).toBeNull();
  });

  it("knows which chosen versions are not in the cart yet", () => {
    const items = pathCartItems(pathSelection(steps, {}, LANGS), { languages: LANGS, productPageCode: "P" });
    const inCart = new Set(["c1-en"]);
    expect(missingFromCart(items, (id) => inCart.has(id)).map((i) => i.packageSessionId)).toEqual(["c2-hi", "c4-en"]);
  });
});

describe("buildPathSteps: only language versions fold", () => {
  const codes = (steps: ReturnType<typeof buildPathSteps>) => steps.map((s) => s.variants.map((v) => v.package_session_id));

  it("strips a level's language words, whatever the script or punctuation", () => {
    const en = LANGS[0]!;
    const hi = LANGS[1]!;
    expect(levelWithoutLanguage("Hindi", hi)).toBe("");
    expect(levelWithoutLanguage("Beginner Hindi", hi)).toBe("beginner");
    expect(levelWithoutLanguage("Beginner (English)", en)).toBe("beginner");
    expect(levelWithoutLanguage("हिन्दी - Batch 2", hi)).toBe("batch 2");
    // Whole words only: "Engineering" keeps its letters.
    expect(levelWithoutLanguage("Engineering English", en)).toBe("engineering");
  });

  it("keeps levels that are not language versions as their own steps (nothing vanishes)", () => {
    const steps = buildPathSteps(
      [row("p", "p-l1", "Level 1"), row("p", "p-l2", "Level 2"), row("q", "q1", "Hindi")],
      { groupVersions: true, languages: LANGS },
    );
    expect(codes(steps)).toEqual([["p-l1"], ["p-l2"], ["q1"]]);
    expect(steps.map((s) => s.languages.map((l) => l.code))).toEqual([[], [], ["hi"]]);
    expect(pathCourseIds(pathSelection(steps, {}, LANGS))).toBe("p-l1,p-l2,q1");
  });

  it("folds each level's language versions, one step per level", () => {
    const steps = buildPathSteps(
      [
        row("p", "beg-hi", "Beginner Hindi", 300),
        row("p", "beg-en", "Beginner English", 300),
        row("p", "adv-hi", "Advanced Hindi", 500),
        row("p", "adv-en", "Advanced English", 500),
      ],
      { groupVersions: true, languages: LANGS },
    );
    expect(codes(steps)).toEqual([
      ["beg-hi", "beg-en"],
      ["adv-hi", "adv-en"],
    ]);
    expect(steps.map((s) => s.languages.map((l) => l.code))).toEqual([
      ["en", "hi"],
      ["en", "hi"],
    ]);
    // Both steps are the same course for the cart, but never share a key.
    expect(steps.map((s) => s.courseId)).toEqual(["p", "p"]);
    expect(new Set(steps.map((s) => s.key)).size).toBe(2);
    // A language pick applies to its own step only.
    const chosen = pathSelection(steps, { [steps[1]!.key]: "en" }, LANGS);
    expect(chosen.map((v) => v.package_session_id)).toEqual(["beg-hi", "adv-en"]);
  });

  it("never folds two rows in the same language, nor a level without one", () => {
    const steps = buildPathSteps(
      [row("p", "hi-1", "Hindi"), row("p", "hi-2", "Hindi"), row("p", "en-1", "English"), row("p", "wb", "Workbook")],
      { groupVersions: true, languages: LANGS },
    );
    expect(codes(steps)).toEqual([["hi-1", "en-1"], ["hi-2"], ["wb"]]);
  });

  it("gives every step a unique key, also when versions are not grouped", () => {
    const steps = buildPathSteps(mappings, { groupVersions: false, languages: LANGS });
    expect(steps.map((s) => s.courseId)).toEqual(["c1", "c1", "c2", "c4"]);
    expect(steps.map((s) => s.key)).toEqual(["c1-en", "c1-hi", "c2-hi", "c4-en"]);
  });
});

describe("a path against the site cart (one version per course)", () => {
  // Same course twice on the path: ungrouped versions, or two levels.
  const ungrouped = buildPathSteps(
    [row("p", "p-beg", "Beginner"), row("p", "p-adv", "Advanced"), row("q", "q1", "Hindi")],
    { groupVersions: false, languages: LANGS },
  );
  const items = pathCartItems(pathSelection(ungrouped, {}, LANGS), { languages: LANGS, productPageCode: "PATH" });
  const holds = (cart: SiteCartItem[]) => (id: string) => cart.some((i) => i.packageSessionId === id);

  it("aims for one version per course, keeping the one already in the cart", () => {
    expect(onePerCourse(items, () => false).map((i) => i.packageSessionId)).toEqual(["p-beg", "q1"]);
    expect(onePerCourse(items, (id) => id === "p-adv").map((i) => i.packageSessionId)).toEqual(["p-adv", "q1"]);
  });

  it("settles after ONE add: the whole path is in the cart, and stays so", () => {
    let cart: SiteCartItem[] = [];
    const before = planPathCart(items, holds(cart));
    expect(before.missing.map((i) => i.packageSessionId)).toEqual(["p-beg", "q1"]);
    expect(before.collapsed).toBe(true);
    expect(before.allInCart).toBe(false);

    cart = capCartAdd(cart, before.missing).next;
    const after = planPathCart(items, holds(cart));
    expect(after.allInCart).toBe(true);
    expect(after.someInCart).toBe(false);
    expect(after.missing).toEqual([]);
    expect(pathTotals(after.targets).count).toBe(cart.length);
  });

  it("adds only what is missing when the cart already holds the other version", () => {
    let cart: SiteCartItem[] = [{ packageSessionId: "p-adv", courseId: "p", title: "Course p" }];
    const plan = planPathCart(items, holds(cart));
    expect(plan.someInCart).toBe(true);
    expect(plan.missing.map((i) => i.packageSessionId)).toEqual(["q1"]);
    cart = capCartAdd(cart, plan.missing).next;
    expect(planPathCart(items, holds(cart)).allInCart).toBe(true);
    expect(cart.map((i) => i.packageSessionId)).toEqual(["p-adv", "q1"]);
  });

  it("is not collapsed when every step is a different course", () => {
    const grouped = buildPathSteps(mappings, { groupVersions: true, languages: LANGS });
    const plan = planPathCart(pathCartItems(pathSelection(grouped, {}, LANGS), { languages: LANGS, productPageCode: "P" }), () => false);
    expect(plan.collapsed).toBe(false);
    expect(plan.targets).toHaveLength(3);
  });
});

describe("pathCheckoutTotals: the product page's own pricing", () => {
  const variants = [row("a", "a1", "English", 400), row("b", "b1", "English", 400), row("c", "c1", "English", 400)];
  const plain = pathTotals(pathCartItems(variants, { languages: LANGS, productPageCode: "P" }));

  it("keeps the plain sum when the page prices per course", () => {
    expect(pathCheckoutTotals(plain, variants, null)).toBe(plain);
    expect(pathCheckoutTotals(plain, variants, JSON.stringify({ allowCourseDeselection: true }))).toBe(plain);
  });

  it("charges the basket price a page sets ('any 3 for ₹799'), the sum struck through", () => {
    const settings = JSON.stringify({ basketPricing: { enabled: true, ladder: { prices: [399, 649, 799], perExtra: 150 } } });
    expect(pathCheckoutTotals(plain, variants, settings)).toMatchObject({ total: 799, elevatedTotal: 2400, currency: "INR" });
  });

  it("takes the page's best offer off", () => {
    const settings = JSON.stringify({
      offers: {
        enabled: true,
        rules: [
          { id: "o1", label: "₹100 off", minAmount: 1000, discountType: "FIXED", discountValue: 100 },
          { id: "o2", label: "10% off", minCourses: 3, discountType: "PERCENTAGE", discountValue: 10 },
        ],
      },
    });
    expect(pathCheckoutTotals(plain, variants, settings)).toMatchObject({ total: 1080, elevatedTotal: 2400 });
  });

  it("gives no figure across currencies, and survives a broken configuration", () => {
    const mixed = { ...plain, total: null, elevatedTotal: null, currency: null };
    expect(pathCheckoutTotals(mixed, variants, JSON.stringify({ offers: { enabled: true, rules: [] } }))).toBe(mixed);
    expect(pathCheckoutTotals(plain, variants, "{not json")).toBe(plain);
  });
});

const folder = (id: string, children: PublicFolderNode[], extra: Partial<PublicFolderNode> = {}): PublicFolderNode => ({
  id,
  node_type: "FOLDER",
  title: id,
  children,
  ...extra,
});
const page = (id: string, code: string | null, extra: Partial<PublicFolderNode> = {}): PublicFolderNode => ({
  id,
  node_type: "PRODUCT_PAGE",
  product_page_code: code,
  children: [],
  ...extra,
});

const library: PublicFolderNode[] = [
  folder("shiksha", [
    page("p1", "PATH-A"),
    folder("vedic-maths", [page("p2", "PATH-B"), page("p2b", "PATH-A")], { slug: "vedic-maths" }),
    folder("soon", [page("p3", "PATH-SOON")], { coming_soon: true }),
  ], { slug: "shiksha", title: "शिक्षा", subtitle: "Education" }),
  folder("kala", [page("p4", "PATH-C"), page("p5", null)], { subtitle: "Arts" }),
];

describe("list mode: paths from the folder library", () => {
  it("collects product pages in library order, once each, skipping coming-soon folders", () => {
    const entries = collectPathEntries(library);
    expect(entries.map((e) => e.code)).toEqual(["PATH-A", "PATH-B", "PATH-C"]);
    expect(entries[1]!.parent?.id).toBe("vedic-maths");
    expect(entries[0]!.parent?.id).toBe("shiksha");
  });

  it("finds the stream folder by slug, top level first, case-insensitively", () => {
    expect(findFolderBySlug(library, "SHIKSHA")?.id).toBe("shiksha");
    expect(findFolderBySlug(library, "arts")?.id).toBe("kala"); // slug derived from the subtitle
    expect(findFolderBySlug(library, "vedic-maths")?.id).toBe("vedic-maths");
    expect(findFolderBySlug(library, "nope")).toBeNull();
    expect(findFolderBySlug(library, "")).toBeNull();
  });

  it("scopes the list to ?stream=, else the chosen folder, else everything", () => {
    const stream = resolvePathScope(library, { stream: "shiksha", folderId: "kala" });
    expect(stream).toMatchObject({ kind: "folder", fromStream: true });
    expect(pathsInScope(library, stream).map((e) => e.code)).toEqual(["PATH-A", "PATH-B"]);

    const chosen = resolvePathScope(library, { folderId: "kala" });
    expect(pathsInScope(library, chosen).map((e) => e.code)).toEqual(["PATH-C"]);

    expect(pathsInScope(library, resolvePathScope(library, {})).map((e) => e.code)).toEqual(["PATH-A", "PATH-B", "PATH-C"]);
  });

  it("shows nothing for a stream or folder that is not in the library", () => {
    expect(resolvePathScope(library, { stream: "unknown" })).toEqual({ kind: "missing" });
    expect(resolvePathScope(library, { folderId: "p1" })).toEqual({ kind: "missing" });
    expect(pathsInScope(library, { kind: "missing" })).toEqual([]);
    expect(pathsInScope(library, resolvePathScope(library, { folderId: "soon" }))).toEqual([]);
  });
});

describe("pathCardDetails: the item's own card fields", () => {
  it("reads subtitle, tagline, button label and a validated accent colour", () => {
    expect(
      pathCardDetails({
        subtitle: " Foundations ",
        tagline: "Start with the basics",
        cta_label: "Begin path",
        accent_color: " #F59E0B ", // design-lint-ignore: test fixture colour
      }),
    ).toEqual({
      subtitle: "Foundations",
      tagline: "Start with the basics",
      ctaLabel: "Begin path",
      accentColor: "#F59E0B", // design-lint-ignore: test fixture colour
    });
  });

  it("is empty for a card without them, and never passes an unsafe colour through", () => {
    expect(pathCardDetails({})).toEqual({ subtitle: "", tagline: "", ctaLabel: "", accentColor: null });
    for (const bad of ["red", "url(x)", "#12", "#1234567", "var(--x)", "#abc; background:url(x)"]) { // design-lint-ignore: test fixture colour
      expect(pathCardDetails({ accent_color: bad }).accentColor).toBeNull();
    }
  });
});

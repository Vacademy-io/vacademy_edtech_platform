import { describe, expect, it } from "vitest";
import {
  comingSoonItems,
  distinctParts,
  fillCount,
  fillPrice,
  freeCtaLabelFor,
  inviteAmount,
  isUnfilteredView,
  pickFreeCards,
  resolveColumnSections,
  rowAmount,
  sectionShown,
  spotlightEyebrowParts,
  spotlightPrice,
  spotlightRow,
  spotlightSlidesFor,
  wrapIndex,
  type ColumnView,
  type ResolvedFreeSection,
  type ResolvedSpotlightSection,
} from "./catalog-column-sections";
import { buildCatalogCards, type CatalogRowLike } from "./catalog-cards";
import type { CatalogStream } from "./catalog-streams";

const row = (id: string, price: number, extra: Partial<CatalogRowLike> = {}): CatalogRowLike => ({
  id,
  title: `Course ${id}`,
  description: "",
  price,
  level: "Beginner",
  rating: 0,
  instructor: "",
  packageSessionId: `${id}-ps`,
  ...extra,
});
const cardsOf = (rows: CatalogRowLike[]) => buildCatalogCards(rows, { grouping: false, languages: [] });

const VIEW: ColumnView = { activeStreamSlug: null, searchTerm: "", filterBadgeCount: 0, currentPage: 1 };

describe("resolveColumnSections", () => {
  it("returns nothing for absent or malformed input", () => {
    expect(resolveColumnSections(undefined)).toEqual([]);
    expect(resolveColumnSections({})).toEqual([]);
    expect(resolveColumnSections([null, 3, "x", { kind: "free-courses" }, { id: "a", kind: "carousel" }])).toEqual([]);
  });

  it("applies per-kind defaults, clamps limits and drops duplicate ids", () => {
    const out = resolveColumnSections([
      { id: "free", kind: "free-courses", limit: 40, courseIds: "nope" },
      { id: "free", kind: "coming-soon" },
      { id: "soon", kind: "coming-soon", limit: 0, categorySlugs: ["Chhanda", 4, ""], scope: "everywhere" },
    ]);
    expect(out).toHaveLength(2);
    const [free, soon] = out;
    expect(free).toMatchObject({
      kind: "free-courses",
      placement: "before-grid",
      showWhen: "unfiltered",
      limit: 6,
      courseIds: [],
      seeAllLabel: null,
      badgeText: null,
    });
    expect(soon).toMatchObject({
      kind: "coming-soon",
      placement: "after-grid",
      showWhen: "always",
      limit: 1,
      scope: "active-stream",
      categorySlugs: ["chhanda"],
    });
  });

  it("keeps an authored empty string (hide the link / the pill)", () => {
    const [free] = resolveColumnSections([{ id: "f", kind: "free-courses", seeAllLabel: "", badgeText: "" }]);
    expect(free).toMatchObject({ seeAllLabel: "", badgeText: "" });
  });

  it("spotlight: drops untitled slides and a section left without any; validates CTAs, steps and colours", () => {
    expect(resolveColumnSections([{ id: "s", kind: "spotlight", slides: [{ eyebrow: "x" }] }])).toEqual([]);
    const [spot] = resolveColumnSections([
      {
        id: "s",
        kind: "spotlight",
        showWhen: "unfiltered-or-own-stream",
        autoplayMs: 500,
        colors: { panelColor: "#F5EAC9", ringColor: "red", dotColor: "url(x)" }, // design-lint-ignore: test fixture colour
        slides: [
          {
            title: "Rajaswala Paricharya",
            cta: { label: "Enrol for {price}", action: "course", courseId: "p1" },
            steps: [{ title: "A", tone: "accent" }, { title: "" }, { title: "B" }, { title: "C" }, { title: "D" }, { title: "E" }],
          },
          { title: "Two", cta: { label: "Go", action: "navigate" } },
        ],
      },
    ]) as ResolvedSpotlightSection[];
    expect(spot.showWhen).toBe("unfiltered-or-own-stream");
    expect(spot.autoplayMs).toBe(0);
    expect(spot.colors).toEqual({ panelColor: "#F5EAC9" }); // design-lint-ignore: test fixture colour
    expect(spot.slides.map((s) => s.id)).toEqual(["slide-1", "slide-2"]);
    expect(spot.slides[0].steps.map((s) => s.title)).toEqual(["A", "B", "C", "D"]);
    expect(spot.slides[0].steps[0].tone).toBe("accent");
    expect(spot.slides[0].cta).toEqual({ label: "Enrol for {price}", action: "course", courseId: "p1" });
    // 'navigate' without a route has nowhere to go: no button.
    expect(spot.slides[1].cta).toBeNull();
  });

  it("an unfilled placeholder id is no id: the course button is dropped, other ids are kept", () => {
    const [spot] = resolveColumnSections([
      {
        id: "s",
        kind: "spotlight",
        slides: [
          { title: "A", cta: { label: "Enrol", action: "course", courseId: "<Rajaswala package id>", enrollInviteId: "inv-1" } },
          { title: "B", cta: { label: "Enrol", action: "course", courseId: "8610911c-382c-41a9-9e33-2e4e0882282f", productPageCode: "forbvy" } },
          { title: "C", cta: { label: "View", action: "product-page", productPageCode: "for bvy" } },
        ],
      },
    ]) as ResolvedSpotlightSection[];
    expect(spot.slides[0].cta).toBeNull();
    expect(spot.slides[1].cta).toEqual({
      label: "Enrol",
      action: "course",
      courseId: "8610911c-382c-41a9-9e33-2e4e0882282f",
      productPageCode: "forbvy",
    });
    expect(spot.slides[2].cta).toBeNull();
  });

  it("'unfiltered-or-own-stream' only applies to a spotlight", () => {
    const [free] = resolveColumnSections([{ id: "f", kind: "free-courses", showWhen: "unfiltered-or-own-stream" }]);
    expect(free.showWhen).toBe("unfiltered");
  });
});

describe("views", () => {
  it("the plain view ignores the sort but not a stream, search, filter or later page", () => {
    expect(isUnfilteredView(VIEW)).toBe(true);
    expect(isUnfilteredView({ ...VIEW, activeStreamSlug: "shiksha" })).toBe(false);
    expect(isUnfilteredView({ ...VIEW, searchTerm: " gita " })).toBe(false);
    expect(isUnfilteredView({ ...VIEW, searchTerm: "   " })).toBe(true);
    expect(isUnfilteredView({ ...VIEW, filterBadgeCount: 1 })).toBe(false);
    expect(isUnfilteredView({ ...VIEW, currentPage: 2 })).toBe(false);
  });

  it("spotlight slides follow the stream tab with 'unfiltered-or-own-stream'", () => {
    const [spot] = resolveColumnSections([
      {
        id: "s",
        kind: "spotlight",
        showWhen: "unfiltered-or-own-stream",
        slides: [
          { id: "a", title: "A", streamSlug: "swasthya" },
          { id: "b", title: "B", streamSlug: "shiksha" },
        ],
      },
    ]) as ResolvedSpotlightSection[];
    expect(spotlightSlidesFor(spot, VIEW).map((s) => s.id)).toEqual(["a", "b"]);
    const onSwasthya = { ...VIEW, activeStreamSlug: "Swasthya" };
    expect(spotlightSlidesFor(spot, onSwasthya).map((s) => s.id)).toEqual(["a"]);
    expect(sectionShown(spot, onSwasthya)).toBe(true);
    expect(sectionShown(spot, { ...VIEW, activeStreamSlug: "kala" })).toBe(false);
    expect(sectionShown(spot, { ...onSwasthya, searchTerm: "x" })).toBe(false);
    const plain = { ...spot, showWhen: "unfiltered" as const };
    expect(sectionShown(plain, onSwasthya)).toBe(false);
    expect(sectionShown({ ...spot, showWhen: "always" as const }, { ...VIEW, filterBadgeCount: 3 })).toBe(true);
  });
});

describe("free courses", () => {
  const cfg = (over: Partial<ResolvedFreeSection> = {}) =>
    ({ courseIds: [], limit: 3, ...over }) as Pick<ResolvedFreeSection, "courseIds" | "limit">;
  const rows = [
    row("paid", 500),
    row("f1", 0),
    row("f2", 0),
    row("soon", 0, { coming_soon: { enabled: true } }),
    row("f3", 0),
    row("f4", 0, { packageSessionId: "f4-hindi" }),
  ];
  const titleOf = (c: { primary: CatalogRowLike }) => c.primary.title;

  it("picked ids first, then popularity; paid and coming-soon left out; total counts every free card", () => {
    const ranks = new Map([
      ["f3", 1],
      ["f2", 2],
    ]);
    const { cards, total } = pickFreeCards(cardsOf(rows), cfg({ courseIds: ["f4-hindi", "missing", "paid"] }), {
      ranks,
      titleOf,
    });
    expect(cards.map((c) => c.courseId)).toEqual(["f4", "f3", "f2"]);
    expect(total).toBe(4);
  });

  it("a picked version id selects its merged card", () => {
    const merged = buildCatalogCards(
      [
        row("p1", 0, { package_id: "p1", level: "English", packageSessionId: "p1-en" }),
        row("p1", 0, { package_id: "p1", level: "Hindi", packageSessionId: "p1-hi" }),
        row("p2", 0, { package_id: "p2" }),
      ],
      { grouping: true, languages: [{ code: "en", label: "English" }, { code: "hi", label: "Hindi" }] },
    );
    const { cards, total } = pickFreeCards(merged, cfg({ courseIds: ["p1-hi"], limit: 1 }), { ranks: new Map(), titleOf });
    expect(cards.map((c) => c.courseId)).toEqual(["p1"]);
    expect(total).toBe(2);
  });

  it("CTA label: the first rule matching a format key or tag, else the section label", () => {
    const sec = {
      ctaLabel: "Start free",
      ctaRules: [
        { formats: ["animation", "video"], tags: [], label: "Watch free" },
        { formats: [], tags: ["essay"], label: "Read free" },
      ],
    };
    expect(freeCtaLabelFor(sec, { tagSet: new Set() }, ["Animation"])).toBe("Watch free");
    expect(freeCtaLabelFor(sec, { tagSet: new Set(["essay"]) }, [])).toBe("Read free");
    expect(freeCtaLabelFor(sec, { tagSet: new Set() }, ["ebook"])).toBe("Start free");
    expect(freeCtaLabelFor({ ...sec, ctaLabel: "" }, { tagSet: new Set() }, [])).toBe("");
  });

  it("fills {count}", () => {
    expect(fillCount("See all {count} free", 7)).toBe("See all 7 free");
    expect(fillCount("सभी {count} निःशुल्क देखें", 7)).toBe("सभी 7 निःशुल्क देखें");
  });
});

describe("spotlight helpers", () => {
  const rows = [row("p1", 1001, { currency: "INR", packageSessionId: "s-1" }), row("p1", 0, { packageSessionId: "s-2" })];

  it("finds the CTA's course by session first, else by course id", () => {
    expect(spotlightRow({ label: "x", action: "course", courseId: "p1", packageSessionId: "s-2" }, rows)).toBe(rows[1]);
    expect(spotlightRow({ label: "x", action: "course", courseId: "p1" }, rows)).toBe(rows[0]);
    expect(spotlightRow({ label: "x", action: "course", courseId: "nope" }, rows)).toBeNull();
    expect(spotlightRow(null, rows)).toBeNull();
  });

  it("live price beats the authored one; a free course says Free; no live price falls back", () => {
    const cta = { label: "Enrol for {price}", action: "course" as const, courseId: "p1", price: "₹251" };
    expect(spotlightPrice(cta, rowAmount(rows[0]), "en", "Free")).toEqual({ value: "₹1,001", free: false });
    expect(spotlightPrice(cta, rowAmount(rows[1]), "en", "Free")).toEqual({ value: "Free", free: true });
    expect(spotlightPrice(cta, null, "en", "Free")).toEqual({ value: "₹251", free: false });
    expect(spotlightPrice({ ...cta, price: undefined }, null, "en", "Free")).toEqual({ value: null, free: false });
    expect(rowAmount(null)).toBeNull();
  });

  it("the invite's live plan: the session's entry, its cheapest plan; FREE is 0; nothing → null", () => {
    // bv/rajaswala_invite.json, trimmed.
    const invite = {
      currency: "INR",
      package_session_to_payment_options: [
        { package_session_id: "ps-other", status: "ACTIVE", payment_option: { type: "ONE_TIME", payment_plans: [{ actual_price: 99 }] } },
        {
          package_session_id: "18bba28f",
          status: "ACTIVE",
          payment_option: { type: "ONE_TIME", payment_plans: [{ actual_price: 1001.0, currency: "INR" }, { actual_price: 1500 }] },
        },
      ],
    };
    expect(inviteAmount(invite, "18bba28f")).toEqual({ amount: 1001, currency: "INR" });
    // Session not listed / not named: entry [0], as the course page does.
    expect(inviteAmount(invite, "missing")).toEqual({ amount: 99, currency: "INR" });
    expect(inviteAmount(invite, undefined)).toEqual({ amount: 99, currency: "INR" });
    expect(
      inviteAmount({ package_session_to_payment_options: [{ payment_option: { type: "FREE", payment_plans: [] } }] }, null),
    ).toEqual({ amount: 0, currency: null });
    expect(inviteAmount({ package_session_to_payment_options: [{ payment_option: { payment_plans: [] } }] }, null)).toBeNull();
    expect(inviteAmount(null, "x")).toBeNull();
    expect(inviteAmount({}, "x")).toBeNull();
  });

  it("fills {price}, or drops it with its 'for'", () => {
    expect(fillPrice("Enrol for {price}", "₹251")).toBe("Enrol for ₹251");
    expect(fillPrice("Enrol for {price}", null)).toBe("Enrol");
    expect(fillPrice("{price} में नामांकन", null)).toBe("में नामांकन");
    expect(fillPrice("Included", null)).toBe("Included");
  });

  it("eyebrow: authored part + stream subtitle, once when they match", () => {
    const siteT = (s: string) => ({ "Health | Ayurveda": "स्वास्थ्य | आयुर्वेद" })[s] ?? s;
    const stream = { title: "स्वास्थ्य", subtitle: "Health | Ayurveda" };
    expect(spotlightEyebrowParts({ eyebrow: "Flagship program" }, stream, (s) => s)).toEqual([
      "Flagship program",
      "Health | Ayurveda",
    ]);
    expect(spotlightEyebrowParts({ eyebrow: "प्रमुख कार्यक्रम" }, stream, siteT)).toEqual([
      "प्रमुख कार्यक्रम",
      "स्वास्थ्य | आयुर्वेद",
    ]);
    expect(spotlightEyebrowParts({ eyebrow: "X", eyebrowSuffix: "Y" }, null, siteT)).toEqual(["X", "Y"]);
    expect(distinctParts("शिक्षा", "शिक्षा", "")).toEqual(["शिक्षा"]);
  });

  it("wraps slide indexes both ways", () => {
    expect(wrapIndex(2, 2)).toBe(0);
    expect(wrapIndex(-1, 2)).toBe(1);
    expect(wrapIndex(5, 0)).toBe(0);
  });
});

describe("coming soon", () => {
  const cat = (slug: string, comingSoon: boolean, audienceId: string | null) => ({
    id: slug,
    slug,
    title: slug.toUpperCase(),
    subtitle: slug,
    tags: [slug],
    comingSoon,
    audienceId,
  });
  const streams: CatalogStream[] = [
    {
      id: "s1",
      slug: "shiksha",
      title: "शिक्षा",
      subtitle: "Education",
      tag: "shiksha",
      tags: [],
      comingSoon: false,
      audienceId: null,
      categories: [cat("chhanda", true, "aud"), cat("ganit", true, "aud"), cat("live", false, "aud"), cat("noform", true, null)],
    },
    {
      id: "s2",
      slug: "kala",
      title: "कला",
      subtitle: "Art",
      tag: "kala",
      tags: [],
      comingSoon: false,
      audienceId: null,
      categories: [cat("murti", true, "aud2")],
    },
  ];
  const slugs = (items: { category: { slug: string } }[]) => items.map((i) => i.category.slug);

  it("coming-soon categories with a form, every stream on the plain view", () => {
    expect(slugs(comingSoonItems(streams, { scope: "active-stream", categorySlugs: [], limit: 4 }, null))).toEqual([
      "chhanda",
      "ganit",
      "murti",
    ]);
  });

  it("scope 'active-stream' narrows to the tab; 'all' does not", () => {
    expect(slugs(comingSoonItems(streams, { scope: "active-stream", categorySlugs: [], limit: 4 }, "kala"))).toEqual(["murti"]);
    expect(slugs(comingSoonItems(streams, { scope: "all", categorySlugs: [], limit: 4 }, "kala"))).toHaveLength(3);
  });

  it("categorySlugs pick and order; the limit caps", () => {
    expect(
      slugs(comingSoonItems(streams, { scope: "all", categorySlugs: ["murti", "live", "chhanda"], limit: 4 }, null)),
    ).toEqual(["murti", "chhanda"]);
    expect(slugs(comingSoonItems(streams, { scope: "all", categorySlugs: [], limit: 1 }, null))).toEqual(["chhanda"]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../../-utils/course-variants";
import { resolveCourseFormats } from "../../../-utils/course-format";
import {
  buildEditorialCardView,
  ctaKindOf,
  descriptionOf,
  descriptionPlaceholders,
  editorialPriceRow,
  fillTemplate,
  otherLanguageTitleOf,
  priceStateOf,
  resolveCardDesign,
  resolveGridHeading,
  resolveLoadMore,
  streamOfCard,
  type EditorialCardDeps,
} from "./catalog-card-view";
import { buildCatalogCards, cardPriceView, type CatalogRowLike } from "./catalog-cards";
import type { CatalogStream } from "./catalog-streams";

const row = (over: Partial<CatalogRowLike> & Record<string, unknown>): CatalogRowLike & Record<string, unknown> => ({
  id: "p1",
  package_id: "p1",
  title: "Vedic Parenting - eBook",
  description: "Learn",
  price: 251,
  currency: "INR",
  level: "default",
  level_name: "default",
  rating: 0,
  instructor: "",
  enroll_invite_availability: "AVAILABLE",
  ...over,
});

const stream = (over: Partial<CatalogStream>): CatalogStream => ({
  id: "s",
  slug: "s",
  title: "स्वास्थ्य",
  subtitle: "Health | Ayurveda",
  tag: "swasthya",
  tags: ["swasthya", "garbha-vigyan"],
  comingSoon: false,
  audienceId: null,
  imageUrl: "https://cdn.example.com/swasthya.png",
  accentColor: null,
  categories: [],
  ...over,
});

const FORMATS = resolveCourseFormats({
  courseFormats: {
    ebook: { label: "E-books", levels: ["eBook"] },
    animation: { label: "Short film / Animation", levels: ["Short Film"] },
    elearning: { label: "Interactive, self-paced E-learning" },
    live: { label: "Live sessions" },
  },
});

const deps = (over: Partial<EditorialCardDeps> = {}): EditorialCardDeps => ({
  design: resolveCardDesign({
    cardStyle: "editorial",
    card: {
      formatLabels: { ebook: "E-book", animation: "Animation", elearning: "E-Learning", live: "Live" },
      freeCtaByFormat: { animation: "watch", ebook: "read" },
    },
  })!,
  formats: FORMATS,
  streams: [stream({})],
  languages: LANGS,
  activeLanguage: "en",
  paymentEnabled: true,
  imageFit: "cover",
  siteT: (s) => s,
  t: (key, opts) => (typeof opts === "string" ? opts : typeof opts?.defaultValue === "string" ? opts.defaultValue : key),
  formatAmount: (amount) => `₹${amount.toLocaleString("en-IN")}`,
  formatLaunch: () => null,
  descriptionPlaceholder: "No description available",
  ...over,
});

describe("resolvers (opt-in)", () => {
  it("are null for every section without the props", () => {
    expect(resolveCardDesign(undefined)).toBeNull();
    expect(resolveCardDesign({ layout: "grid", cardFields: [] })).toBeNull();
    expect(resolveCardDesign({ cardStyle: "default" })).toBeNull();
    expect(resolveLoadMore({ layout: "grid" })).toBeNull();
    expect(resolveLoadMore({ pagination: { mode: "pages", pageSize: 9 } })).toBeNull();
    expect(resolveGridHeading({ layout: "grid" })).toBeNull();
  });

  it("validates the card config defensively", () => {
    const d = resolveCardDesign({
      cardStyle: "editorial",
      card: {
        streamLabel: "bogus",
        freeCtaByFormat: { Animation: "WATCH", ebook: "sing" },
        colors: { divider: "#efe6cc", freePrice: "red", loadMoreBorder: "#A08A5C" }, // design-lint-ignore: test fixture colours
        formatLabels: { EBook: " E-book ", bad: 3 },
      },
    })!;
    expect(d.streamLabel).toBe("subtitle");
    expect(d.freeCtaByFormat).toEqual({ animation: "watch" });
    expect(d.colors).toEqual({ divider: "#efe6cc", loadMoreBorder: "#A08A5C" }); // design-lint-ignore: test fixture colours
    expect(d.formatLabels).toEqual({ ebook: "E-book" });
    expect(d.showFreePill && d.showFormatPill && d.showLanguageChips && d.showStreamIcon).toBe(true);
    expect(d.showOtherLanguageTitle).toBe(false);
  });

  it("clamps the load-more page size", () => {
    expect(resolveLoadMore({ pagination: { mode: "loadMore" } })?.pageSize).toBe(9);
    expect(resolveLoadMore({ pagination: { mode: "loadMore", pageSize: 0 } })?.pageSize).toBe(9);
    expect(resolveLoadMore({ pagination: { mode: "loadMore", pageSize: 500 } })?.pageSize).toBe(60);
    expect(resolveLoadMore({ pagination: { mode: "loadMore", pageSize: "12" } })?.pageSize).toBe(12);
  });

  it("fills count templates", () => {
    expect(fillTemplate("Showing {{shown}} of {{ total }}", { shown: 9, total: 24 })).toBe("Showing 9 of 24");
    expect(fillTemplate("{{x}}", {})).toBe("{{x}}");
  });
});

describe("per-card helpers", () => {
  it("finds the stream by any of its tags (category-level tags count)", () => {
    expect(streamOfCard(new Set(["garbha-vigyan"]), [stream({})])?.slug).toBe("s");
    expect(streamOfCard(new Set(["kala"]), [stream({})])).toBeNull();
  });

  it("CTA kind: coming soon > paid > the free kind of the first format naming one", () => {
    const d = deps().design;
    expect(ctaKindOf({ comingSoon: true, free: true }, ["animation"], d)).toBe("comingSoon");
    expect(ctaKindOf({ comingSoon: false, free: false }, ["animation"], d)).toBe("paid");
    expect(ctaKindOf({ comingSoon: false, free: true }, ["live", "animation"], d)).toBe("watch");
    expect(ctaKindOf({ comingSoon: false, free: true }, ["ebook"], d)).toBe("read");
    expect(ctaKindOf({ comingSoon: false, free: true }, [], d)).toBe("start");
  });

  it("price of the displayed version, or its status", () => {
    expect(priceStateOf(row({ price: 0 }), { paymentEnabled: true })).toEqual({ kind: "free" });
    expect(priceStateOf(row({ price: 1500 }), { paymentEnabled: true })).toEqual({ kind: "amount", amount: 1500, currency: "INR" });
    expect(priceStateOf(row({ price: 1500 }), { paymentEnabled: false })).toEqual({ kind: "hidden" });
    expect(priceStateOf(row({ enroll_invite_availability: "NOT_STARTED" }), { paymentEnabled: true }).kind).toBe("notStarted");
    expect(priceStateOf(row({ coming_soon: { enabled: true, launch_date: "2026-12-01" } }), { paymentEnabled: true })).toEqual({
      kind: "comingSoon",
      launchDate: "2026-12-01",
    });
  });

  it("description: authored for any package beats the course's; the placeholder is dropped", () => {
    const a = row({ id: "p1", description: "From HTML" });
    const b = row({ id: "p2", package_id: "p2", description: "HI" });
    expect(descriptionOf([a, b], a, { p2: "Authored" }, "No description available")).toEqual({ text: "Authored", authored: true });
    expect(descriptionOf([a], a, {}, "No description available")).toEqual({ text: "From HTML", authored: false });
    const empty = row({ description: "No description available" });
    expect(descriptionOf([empty], empty, {}, "No description available").text).toBe("");
  });

  it("description: the placeholder of ANY loaded language is dropped (fetched in EN, shown after switching to HI)", () => {
    const PLACEHOLDER: Record<string, string> = { en: "No description available", hi: "कोई विवरण उपलब्ध नहीं है" };
    const i18n = {
      languages: ["hi", "en"],
      store: { data: { en: {}, hi: {} } },
      getFixedT: (lng: string) => (key: string) => (key === "courseCatalog.noDescriptionAvailable" ? PLACEHOLDER[lng] : key),
    };
    const placeholders = descriptionPlaceholders(PLACEHOLDER.hi, i18n);
    expect(placeholders).toEqual(expect.arrayContaining([PLACEHOLDER.en, PLACEHOLDER.hi]));
    const fetchedInEn = row({ description: "No description available" });
    expect(descriptionOf([fetchedInEn], fetchedInEn, {}, placeholders).text).toBe("");
    // A real description survives; a bare mock i18n (no getFixedT) still drops the current one.
    const real = row({ description: "From HTML" });
    expect(descriptionOf([real], real, {}, placeholders).text).toBe("From HTML");
    expect(descriptionPlaceholders("X", { languages: ["en"] })).toContain("X");
    expect(descriptionPlaceholders("X", null)).toContain("X");
  });
});

describe("buildEditorialCardView", () => {
  const VERSIONS = [
    row({ id: "en1", package_id: "en1", title: "Vedic Parenting - eBook", level_name: "eBook", level: "eBook", comma_separeted_tags: "English,garbha-vigyan", price: 251 }),
    row({ id: "hi1", package_id: "hi1", title: "वैदिक पेरेंटिंग - ई पुस्तक", level_name: "eBook", level: "eBook", comma_separeted_tags: "Hindi,garbha-vigyan", price: 201 }),
  ];

  it("a grouped EN+HI e-book: stream line, format pill, both chips (preferred bold), the displayed version's price", () => {
    const [card] = buildCatalogCards(VERSIONS, { grouping: true, languages: LANGS, preferredLanguage: "en", versionGroups: [["en1", "hi1"]] });
    const view = buildEditorialCardView(card, deps());
    expect(view.title).toBe("Vedic Parenting - eBook");
    expect(view.stream).toEqual({ label: "Health | Ayurveda", imageUrl: "https://cdn.example.com/swasthya.png", accentColor: null });
    expect(view.formatPill).toBe("E-book");
    expect(view.freePill).toBeNull();
    expect(view.languages).toEqual([
      { code: "en", label: "English", active: true },
      { code: "hi", label: "Hindi", active: false },
    ]);
    expect(view.price).toEqual({ text: "₹251", tone: "price" });
    expect(view.ctaLabel).toBe("View course");
    expect(view.otherTitle).toBeNull();
  });

  it("a merged card prices by the version the sorts/filters used (priceRow), not the primary — no 'from'", () => {
    const paidEn = row({ id: "en2", package_id: "en2", title: "Garbh Sanskar", comma_separeted_tags: "English", price: 551 });
    const freeHi = row({ id: "hi2", package_id: "hi2", title: "गर्भ संस्कार", comma_separeted_tags: "Hindi", price: 0 });
    const [card] = buildCatalogCards([paidEn, freeHi], { grouping: true, languages: LANGS, preferredLanguage: "en", versionGroups: [["en2", "hi2"]] });
    // Free filter: only the HI row matches.
    const freeOnly = cardPriceView(card, [freeHi]);
    const view = buildEditorialCardView(card, deps(), { priceRow: freeOnly?.row });
    expect(view.title).toBe("Garbh Sanskar");
    expect(view.price).toEqual({ text: "Free", tone: "free" });
    expect(view.freePill).toBe("Free");
    expect(view.ctaLabel).toBe("Start free");
    // Without priceRow (no merged view): the primary's own price, as before.
    expect(buildEditorialCardView(card, deps()).price).toEqual({ text: "₹551", tone: "price" });
    // EN ₹551 + HI ₹201, price sort: the card shows the ₹201 it sorts at, never "from".
    const hi201 = { ...freeHi, price: 201 };
    const [card2] = buildCatalogCards([paidEn, hi201], { grouping: true, languages: LANGS, preferredLanguage: "en", versionGroups: [["en2", "hi2"]] });
    const both = cardPriceView(card2, card2.rows);
    const view2 = buildEditorialCardView(card2, deps(), { priceRow: both?.row });
    expect(view2.price).toEqual({ text: "₹201", tone: "price" });
    expect(view2.ctaLabel).toBe("View course");
  });

  it("editorialPriceRow: price sort → the sorted-at version; else the displayed version when it matches; else the matched one", () => {
    const en = row({ id: "en3", package_id: "en3", comma_separeted_tags: "English", price: 551 });
    const hi = row({ id: "hi3", package_id: "hi3", comma_separeted_tags: "Hindi", price: 201 });
    const [card] = buildCatalogCards([en, hi], { grouping: true, languages: LANGS, preferredLanguage: "en", versionGroups: [["en3", "hi3"]] });
    const all = cardPriceView(card, card.rows);
    expect(editorialPriceRow(card, all, card.rows, true)).toBe(card.rows.find((r) => r.id === "hi3"));
    expect(editorialPriceRow(card, all, card.rows, false)).toBe(card.primary);
    const onlyHi = card.rows.filter((r) => r.id === "hi3");
    expect(editorialPriceRow(card, cardPriceView(card, onlyHi), onlyHi, false)?.id).toBe("hi3");
    expect(editorialPriceRow(card, null, card.rows, true)).toBeNull();
  });

  it("the Hindi visitor gets the Hindi version, its price, and the other title when asked", () => {
    const [card] = buildCatalogCards(VERSIONS, { grouping: true, languages: LANGS, preferredLanguage: "hi", versionGroups: [["en1", "hi1"]] });
    const d = deps({ activeLanguage: "hi" });
    const view = buildEditorialCardView(card, { ...d, design: { ...d.design, showOtherLanguageTitle: true } });
    expect(view.title).toBe("वैदिक पेरेंटिंग - ई पुस्तक");
    expect(view.price?.text).toBe("₹201");
    expect(view.languages.map((l) => l.active)).toEqual([false, true]);
    expect(view.otherTitle).toBe("Vedic Parenting - eBook");
    expect(otherLanguageTitleOf(card, LANGS)).toBe("Vedic Parenting - eBook");
  });

  it("a free short film: Free pill + Free price + 'Watch free'; sections' overrides win", () => {
    const [card] = buildCatalogCards([row({ price: 0, level_name: "Short Film", level: "Short Film" })], { grouping: false, languages: LANGS });
    const view = buildEditorialCardView(card, deps());
    expect(view.freePill).toBe("Free");
    expect(view.formatPill).toBe("Animation");
    expect(view.price).toEqual({ text: "Free", tone: "free" });
    expect(view.ctaLabel).toBe("Watch free");
    const strip = buildEditorialCardView(card, deps(), { ctaLabel: "Start free", imageBadge: "Free trial" });
    expect(strip.ctaLabel).toBe("Start free");
    expect(strip.freePill).toBe("Free trial");
  });

  it("two formats read 'E-Learning · Live'; translated through the site dictionary", () => {
    const dict: Record<string, string> = { "E-Learning": "ई-लर्निंग", Live: "लाइव", "View course": "कोर्स देखें" };
    const [card] = buildCatalogCards([row({ comma_separeted_tags: "format-elearning,format-live" })], { grouping: false, languages: LANGS });
    expect(buildEditorialCardView(card, deps()).formatPill).toBe("E-Learning · Live");
    const d = deps({ siteT: (s) => dict[s] ?? s });
    const hi = buildEditorialCardView(card, { ...d, design: { ...d.design, ctaLabels: { ...d.design.ctaLabels, paid: "View course" } } });
    expect(hi.formatPill).toBe("ई-लर्निंग · लाइव");
    expect(hi.ctaLabel).toBe("कोर्स देखें");
  });

  it("coming soon: no pills, the ribbon instead, launch status, notify CTA from the course", () => {
    const [card] = buildCatalogCards(
      [row({ coming_soon: { enabled: true, button_text: "Notify me", audience_id: "a1" }, level_name: "eBook" })],
      { grouping: false, languages: LANGS },
    );
    const view = buildEditorialCardView(card, deps());
    expect(view.comingSoon?.audienceId).toBe("a1");
    expect(view.formatPill).toBeNull();
    expect(view.freePill).toBeNull();
    expect(view.price?.tone).toBe("status");
    expect(view.ctaLabel).toBe("Notify me");
  });

  it("no format, no stream, no description: nothing invented", () => {
    const [card] = buildCatalogCards([row({ description: "", comma_separeted_tags: "kala" })], { grouping: false, languages: LANGS });
    const view = buildEditorialCardView(card, deps());
    expect(view.formatPill).toBeNull();
    expect(view.stream).toBeNull();
    expect(view.description).toBe("");
    expect(view.languages).toEqual([]);
  });
});

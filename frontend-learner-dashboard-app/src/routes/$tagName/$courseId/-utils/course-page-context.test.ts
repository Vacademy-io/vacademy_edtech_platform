import { describe, expect, it } from "vitest";
import type { CatalogStream } from "../../-components/components/catalog/catalog-streams";
import {
  coursePageContext,
  coursePageTrail,
  findCatalogSection,
  relatedCardStyle,
  showsDuration,
  summaryOf,
} from "./course-page-context";

const stream = (slug: string, title: string, tag: string, categories: Array<[string, string, string]>): CatalogStream => ({
  id: slug,
  slug,
  title,
  subtitle: "",
  tag,
  tags: [tag, ...categories.map(([, , t]) => t)],
  comingSoon: false,
  audienceId: null,
  categories: categories.map(([s, t, tg]) => ({
    id: s,
    slug: s,
    title: t,
    subtitle: "",
    tags: [tg],
    comingSoon: false,
    audienceId: null,
  })),
});

const STREAMS = [
  stream("dharma", "Dharma", "dharma", [["vedic-parenting", "Vedic Parenting", "vedic-parenting"]]),
  stream("swasthya", "Swasthya", "swasthya", [["garbha-vigyan", "Garbha Vigyan", "garbha-vigyan"]]),
];
const GS = { courseFormats: { ebook: { label: "E-books", levels: ["eBook"] }, video: { label: "Video" } } };
const pages = [
  { route: "home", components: [{ type: "courseCatalog", props: { streams: { enabled: true } } }] },
  { route: "courses", title: "All courses", components: [{ type: "hero" }, { type: "courseCatalog", props: { streams: { enabled: true }, render: { cardStyle: "editorial", card: { showStream: true } } } }] },
  { route: "off", components: [{ type: "courseCatalog", enabled: false, props: {} }] },
];

describe("findCatalogSection", () => {
  it("prefers the Courses page's catalogue over the home page's", () => {
    const found = findCatalogSection(pages);
    expect(found?.route).toBe("courses");
    expect(found?.title).toBe("All courses");
    expect(findCatalogSection([pages[0]!])?.route).toBe("home");
    expect(findCatalogSection([])).toBeNull();
    expect(findCatalogSection([pages[2]!])).toBeNull();
  });

  it("names the crumb after the header menu item, not the page's SEO title", () => {
    const site = [{ route: "books-copy", title: "Books & Kits — Acme Academy (Copy)", components: [{ type: "courseCatalog" }] }];
    const header = (navigation: unknown[]) => ({ layout: { header: { props: { navigation } } } });
    expect(findCatalogSection(site, header([{ label: "Home", route: "home" }, { label: "Courses", route: "books-copy" }]))?.title).toBe("Courses");
    // Inside a mega-menu column too.
    expect(findCatalogSection(site, header([{ type: "megaMenu", label: "Learn", columns: [{ links: [{ label: "All courses", route: "/books-copy" }] }] }]))?.title).toBe("All courses");
    // Not in the menu: the page title, as before.
    expect(findCatalogSection(site, header([{ label: "Home", route: "home" }]))?.title).toBe("Books & Kits — Acme Academy (Copy)");
  });
});

describe("coursePageContext", () => {
  const catalog = findCatalogSection(pages);

  it("places a course by its tags: stream, category, formats, breadcrumb and related topic", () => {
    const ctx = coursePageContext({
      tags: ["English", "swasthya", "garbha-vigyan", "format-ebook"],
      levelName: "default",
      globalSettings: GS,
      streams: STREAMS,
      catalog,
    });
    expect(ctx.formatKeys).toEqual(["ebook"]);
    expect(ctx.formatLabels).toEqual(["E-books"]);
    expect(ctx.stream).toEqual({ slug: "swasthya", label: "Swasthya", imageUrl: null, accentColor: null });
    expect(ctx.category).toEqual({ slug: "garbha-vigyan", label: "Garbha Vigyan" });
    expect(ctx.breadcrumb).toEqual([
      { label: "All courses", route: "courses" },
      { label: "Swasthya", route: "courses", search: { stream: "swasthya" } },
      { label: "Garbha Vigyan", route: "courses", search: { stream: "swasthya", category: "garbha-vigyan" } },
    ]);
    expect(ctx.related).toEqual({ tag: "swasthya", label: "Swasthya" });
  });

  it("lists the category when the stream has no tag of its own", () => {
    const untagged = [{ ...STREAMS[1]!, tag: "" }];
    const ctx = coursePageContext({ tags: ["garbha-vigyan"], globalSettings: GS, streams: untagged, catalog });
    expect(ctx.related).toEqual({ tag: "garbha-vigyan", label: "Garbha Vigyan" });
  });

  it("reads a format from the level name too, and falls back to the stream", () => {
    const ctx = coursePageContext({ tags: ["swasthya"], levelName: "eBook", globalSettings: GS, streams: STREAMS, catalog });
    expect(ctx.formatLabels).toEqual(["E-books"]);
    expect(ctx.category).toBeNull();
    expect(ctx.breadcrumb).toHaveLength(2);
    expect(ctx.related).toEqual({ tag: "swasthya", label: "Swasthya" });
  });

  it("is a plain Courses crumb, no chips and no strip on a site that authors none of it", () => {
    const ctx = coursePageContext({ tags: ["anything"], globalSettings: {}, streams: [], catalog });
    expect(ctx.formatLabels).toEqual([]);
    expect(ctx.breadcrumb).toEqual([{ label: "All courses", route: "courses" }]);
    expect(ctx.related).toBeNull();
    expect(coursePageContext({ tags: null, globalSettings: null, streams: [], catalog: null }).breadcrumb).toEqual([]);
  });
});

describe("coursePageTrail", () => {
  const catalog = findCatalogSection(pages);
  const trailOf = (tags: string[]) =>
    coursePageTrail(coursePageContext({ tags, globalSettings: GS, streams: STREAMS, catalog }).breadcrumb);

  it("reads stream then category, without the Courses section's crumb", () => {
    expect(trailOf(["swasthya", "garbha-vigyan"])).toEqual([
      { label: "Swasthya", route: "courses", search: { stream: "swasthya" } },
      { label: "Garbha Vigyan", route: "courses", search: { stream: "swasthya", category: "garbha-vigyan" } },
    ]);
  });

  it("stops at the stream when the course has no category", () => {
    expect(trailOf(["swasthya"])).toEqual([{ label: "Swasthya", route: "courses", search: { stream: "swasthya" } }]);
  });

  it("keeps the Courses crumb for a course in no stream, and is empty without a Courses section", () => {
    expect(trailOf(["anything"])).toEqual([{ label: "All courses", route: "courses" }]);
    expect(coursePageTrail([])).toEqual([]);
  });
});

describe("page helpers", () => {
  it("shows a duration only for formats that are watched or attended", () => {
    expect(showsDuration("15m", ["ebook"])).toBe(false);
    expect(showsDuration("15m", ["ebook", "article"])).toBe(false);
    expect(showsDuration("2h", ["video"])).toBe(true);
    expect(showsDuration("2h", ["ebook", "video"])).toBe(true);
    expect(showsDuration("2h", [])).toBe(true); // a site with no formats: as before
    expect(showsDuration(null, [])).toBe(false);
  });

  it("summarises the description as plain text, cut at a word", () => {
    expect(summaryOf("<p><strong>Garbha</strong> Vigyan&nbsp;eBook</p><p>Second</p>")).toBe("Garbha Vigyan eBook Second");
    const long = summaryOf(`<p>${"word ".repeat(80)}</p>`, 50);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(51);
    expect(summaryOf("")).toBe("");
  });

  it("uses the site's editorial cards for the related strip when its Courses section does", () => {
    const catalog = findCatalogSection(pages)!;
    expect(relatedCardStyle(catalog.props, { source: "folderLibrary", libraryId: "lib" })).toEqual({
      cardStyle: "editorial",
      card: { showStream: true },
      streamsLibraryId: "lib",
    });
    expect(relatedCardStyle({ render: { cardStyle: "default" } }, null)).toEqual({});
    expect(relatedCardStyle(null, null)).toEqual({});
  });
});

describe("placeLabel", () => {
  const swasthya = { title: "स्वास्थ्य व आयुर्वेद", subtitle: "Health & Ayurveda" };
  it("follows the section's label mode, and with both, the language the visitor reads", async () => {
    const { placeLabel } = await import("./course-page-context");
    expect(placeLabel(swasthya, "title", "en")).toBe("स्वास्थ्य व आयुर्वेद");
    expect(placeLabel(swasthya, "subtitle", "hi")).toBe("Health & Ayurveda");
    expect(placeLabel(swasthya, "both", "en")).toBe("Health & Ayurveda");
    expect(placeLabel(swasthya, "both", "hi")).toBe("स्वास्थ्य व आयुर्वेद");
    expect(placeLabel({ title: "Yoga", subtitle: "Practice" }, "both", "en")).toBe("Yoga");
    expect(placeLabel({ title: "स्वास्थ्य", subtitle: "" }, "both", "en")).toBe("स्वास्थ्य");
    expect(placeLabel({ title: "", subtitle: "Only" }, "title", "en")).toBe("Only");
  });
});

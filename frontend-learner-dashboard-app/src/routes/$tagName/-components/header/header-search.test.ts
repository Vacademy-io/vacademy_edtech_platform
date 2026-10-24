import { describe, expect, it, vi } from "vitest";
import type { PublicFolderNode } from "../../-services/folder-library-service";
import { buildMegaMenuModel } from "./mega-menu-model";
import { DEFAULT_COURSE_LANGUAGES } from "../../-utils/course-variants";
import {
  courseSearchItems,
  courseSitePath,
  groupSearchResults,
  normalizeSearchText,
  pageSearchItems,
  pickCourseVersion,
  rankSiteSearch,
  streamSearchItems,
  type SiteSearchItem,
} from "./header-search";

// The folder service module reads the API base URL from `window` at import.
vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test" }));

const item = (id: string, kind: SiteSearchItem["kind"], title: string, extra: Partial<SiteSearchItem> = {}): SiteSearchItem => ({
  id,
  kind,
  title,
  keywords: [],
  link: { href: `/${id}`, external: false },
  ...extra,
});

describe("normalizeSearchText", () => {
  it("folds case, accents and spacing but keeps Devanagari", () => {
    expect(normalizeSearchText("  Café   Crème ")).toBe("cafe creme");
    expect(normalizeSearchText("शिक्षा")).toBe(normalizeSearchText("शिक्षा"));
    expect(normalizeSearchText("शिक्षा")).not.toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("rankSiteSearch", () => {
  const items = [
    item("p-about", "page", "About us"),
    item("c-maths", "course", "Vedic Maths for Kids", { keywords: ["maths", "kids"] }),
    item("c-math2", "course", "Mathematics Olympiad"),
    item("s-maths", "stream", "Maths"),
    item("c-yoga", "course", "Yoga basics", { subtitle: "Beginner", keywords: ["wellness"] }),
    item("cat-hindi", "category", "हिन्दी व्याकरण · Hindi Grammar"),
  ];

  it("ranks exact over prefix over word-prefix over substring", () => {
    // "Mathematics" does not contain "maths", so it is not a hit for that query.
    expect(rankSiteSearch("maths", items).map((r) => r.id)).toEqual(["s-maths", "c-maths"]);
    // Prefix hits (stream before course on a tie) beat the word-prefix inside a title.
    expect(rankSiteSearch("math", items).map((r) => r.id)).toEqual(["s-maths", "c-math2", "c-maths"]);
  });

  it("matches keywords and subtitles below titles", () => {
    expect(rankSiteSearch("wellness", items).map((r) => r.id)).toEqual(["c-yoga"]);
    expect(rankSiteSearch("beginner", items).map((r) => r.id)).toEqual(["c-yoga"]);
    const [title] = rankSiteSearch("yoga", items);
    const [keyword] = rankSiteSearch("wellness", items);
    expect(title.score).toBeGreaterThan(keyword.score);
  });

  it("matches every word of a multi-word query, in any order", () => {
    expect(rankSiteSearch("kids vedic", items).map((r) => r.id)).toEqual(["c-maths"]);
    expect(rankSiteSearch("grammar hindi", items).map((r) => r.id)).toEqual(["cat-hindi"]);
  });

  it("finds Hindi text", () => {
    expect(rankSiteSearch("हिन्दी", items).map((r) => r.id)).toEqual(["cat-hindi"]);
  });

  it("breaks ties by kind (streams first) and then original order", () => {
    const tied = [item("page-x", "page", "Kala"), item("course-x", "course", "Kala"), item("stream-x", "stream", "Kala")];
    expect(rankSiteSearch("kala", tied).map((r) => r.id)).toEqual(["stream-x", "course-x", "page-x"]);
  });

  it("returns nothing for an empty query or no match", () => {
    expect(rankSiteSearch("   ", items)).toEqual([]);
    expect(rankSiteSearch("zzz", items)).toEqual([]);
  });
});

describe("groupSearchResults", () => {
  it("groups by kind, caps each group and orders groups by their best hit", () => {
    const ranked = rankSiteSearch("kala", [
      item("c1", "course", "Kala one"),
      item("c2", "course", "Kala two"),
      item("c3", "course", "Kala three"),
      item("s1", "stream", "Kala"),
      item("cat1", "category", "Kala crafts"),
      item("p1", "page", "Kala page"),
    ]);
    const groups = groupSearchResults(ranked, 2);
    expect(groups.map((g) => g.kind)).toEqual(["streams", "courses", "pages"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["s1", "cat1"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c1", "c2"]);
  });
});

describe("pageSearchItems", () => {
  it("lists published pages by title, the home page by its label, and skips duplicates", () => {
    const pages = [
      { id: "home", route: "", title: "" },
      { id: "about", route: "about-us", title: "About Us" },
      { id: "draft", route: "draft", title: "Draft", published: false },
      { id: "faq", route: "/faq/", title: "" },
      { id: "home2", route: "home", title: "Home again" },
    ];
    const out = pageSearchItems(pages, { homeLabel: "Home" });
    expect(out.map((p) => [p.title, p.link?.href])).toEqual([
      ["Home", "/"],
      ["About Us", "/about-us"],
      ["faq", "/faq"],
    ]);
    expect(out[1].keywords).toContain("about us");
  });

  it("translates titles for display but keeps the source text searchable", () => {
    const [about] = pageSearchItems([{ id: "a", route: "about", title: "About" }], {
      homeLabel: "Home",
      translate: (s) => (s === "About" ? "हमारे बारे में" : s),
    });
    expect(about.title).toBe("हमारे बारे में");
    expect(about.keywords).toContain("About");
  });
});

describe("streamSearchItems", () => {
  const roots: PublicFolderNode[] = [
    {
      id: "edu",
      node_type: "FOLDER",
      title: "शिक्षा",
      subtitle: "Education",
      children: [
        { id: "v", node_type: "FOLDER", title: "वैदिक गणित", subtitle: "Vedic Maths", children: [] },
        { id: "soon", node_type: "FOLDER", title: "Sanskrit", coming_soon: true, audience_id: "aud", children: [] },
      ],
    },
  ];
  const model = buildMegaMenuModel({ library: { id: "l", name: "L" }, roots }, {});

  it("lists streams and categories with their links and notify forms", () => {
    const out = streamSearchItems(model);
    expect(out.map((i) => [i.kind, i.title, i.link?.href ?? null, i.notifyAudienceId ?? null, !!i.comingSoon])).toEqual([
      ["stream", "शिक्षा", "/courses?stream=education", null, false],
      ["category", "वैदिक गणित · Vedic Maths", "/courses?stream=education&category=vedic-maths", null, false],
      ["category", "Sanskrit", null, "aud", true],
    ]);
    expect(out[1].subtitle).toBe("शिक्षा");
    expect(rankSiteSearch("vedic", out).map((i) => i.id)).toEqual(["category:v"]);
    expect(rankSiteSearch("education", out)[0].id).toBe("stream:edu");
  });

  it("marks only coming-soon items, not open ones whose link could not be built", () => {
    const unlinked = buildMegaMenuModel({ library: { id: "l", name: "L" }, roots }, {
      categoryLinkPattern: "javascript:{category}",
    });
    const [, vedic, sanskrit] = streamSearchItems(unlinked);
    expect([vedic.link, vedic.notifyAudienceId, !!vedic.comingSoon]).toEqual([null, undefined, false]);
    expect([sanskrit.notifyAudienceId, sanskrit.comingSoon]).toEqual(["aud", true]);
  });
});

describe("courseSearchItems", () => {
  const rows = [
    { id: "c1", package_name: "Vedic Maths", package_session_id: "ps-en", level_name: "English", comma_separeted_tags: "maths, shiksha" },
    { id: "c1", package_name: "Vedic Maths", package_session_id: "ps-hi", level_name: "Hindi" },
    { package_id: "c2", package_name: "Yoga", level_name: "DEFAULT" },
    { id: "c3", package_name: "  " },
  ];

  it("lists one entry per course, searchable by tags", () => {
    const out = courseSearchItems(rows, { hrefFor: (r) => `/x/${r.package_session_id ?? "none"}` });
    expect(out.map((i) => [i.id, i.title, i.subtitle ?? null, i.link?.href])).toEqual([
      ["course:c1", "Vedic Maths", "English", "/x/ps-en"],
      ["course:c2", "Yoga", null, "/x/none"],
    ]);
    expect(rankSiteSearch("shiksha", out).map((i) => i.id)).toEqual(["course:c1"]);
  });

  it("opens the visitor's language version, like a merged course card", () => {
    const hrefFor = (r: { package_session_id?: string }) => `/x/${r.package_session_id ?? "none"}`;
    const hindi = courseSearchItems(rows, { hrefFor, preferredLanguage: "hi", languages: DEFAULT_COURSE_LANGUAGES });
    expect(hindi.map((i) => [i.id, i.subtitle ?? null, i.link?.href])).toEqual([
      ["course:c1", "Hindi", "/x/ps-hi"],
      ["course:c2", null, "/x/none"],
    ]);
    // Every version stays findable, whichever one the result opens.
    expect(rankSiteSearch("english", hindi).map((i) => i.id)).toEqual(["course:c1"]);
    expect(rankSiteSearch("maths", hindi).map((i) => i.id)).toEqual(["course:c1"]);
    // A language the course is not offered in falls back to its first row.
    const tamil = courseSearchItems(rows, { hrefFor, preferredLanguage: "ta", languages: DEFAULT_COURSE_LANGUAGES });
    expect(tamil[0].link?.href).toBe("/x/ps-en");
  });

  it("pickCourseVersion: the preferred language when the course has it, else the first row", () => {
    const versions = [{ level_name: "English" }, { level_name: "Beginner Hindi" }, { level_name: "Hindi" }];
    expect(pickCourseVersion(versions, "hi", DEFAULT_COURSE_LANGUAGES)).toBe(versions[1]);
    expect(pickCourseVersion(versions, "en", DEFAULT_COURSE_LANGUAGES)).toBe(versions[0]);
    expect(pickCourseVersion(versions, null, DEFAULT_COURSE_LANGUAGES)).toBe(versions[0]);
    expect(pickCourseVersion(versions, "hi", [])).toBe(versions[0]);
    expect(pickCourseVersion([], "hi", DEFAULT_COURSE_LANGUAGES)).toBeUndefined();
  });

  it("builds the course page link the catalogue card would open", () => {
    expect(
      courseSitePath(
        {
          id: "c1",
          package_session_id: "ps-hi",
          enroll_invite_id: "inv",
          level_name: "Hindi",
          course_preview_image_media_id: "media-1",
        },
        null,
      ),
    ).toBe("/c1?enrollInviteId=inv&packageSessionId=ps-hi&bannerImage=media-1&level=Hindi");
    expect(courseSitePath({ id: "c1" }, "toddler-reset")).toBe("/toddler-reset");
    expect(courseSitePath({}, null)).toBeNull();
  });
});

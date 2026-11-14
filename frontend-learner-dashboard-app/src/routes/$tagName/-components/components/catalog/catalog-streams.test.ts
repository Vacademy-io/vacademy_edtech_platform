import { describe, expect, it, vi } from "vitest";

// folder-library-service reads the backend URL (window.location) at import time.
vi.mock("@/constants/urls", () => ({ BASE_URL: "" }));

import type { PublicFolderNode } from "../../../-services/folder-library-service";
import {
  countCardsByStream,
  findStream,
  folderTagSet,
  nextTabIndex,
  streamTabId,
  streamTabText,
  streamsFromFolderTree,
  streamsFromTagItems,
} from "./catalog-streams";
import { buildCatalogCards } from "./catalog-cards";

/** The real course tags of a list, without level keys. */
const real = (tags: string[]) => tags.filter((t) => !t.startsWith("level:")).sort();

const folder = (id: string, extra: Partial<PublicFolderNode> = {}, children: PublicFolderNode[] = []): PublicFolderNode => ({
  id,
  node_type: "FOLDER",
  children,
  ...extra,
});

const page = (id: string): PublicFolderNode => ({ id, node_type: "PRODUCT_PAGE", product_page_code: id, children: [] });

const TREE: PublicFolderNode[] = [
  folder("s1", { title: "शिक्षा", subtitle: "EDUCATION", slug: "shiksha" }, [
    folder("c1", { title: "वैदिक गणित", subtitle: "Vedic Maths", course_tag: "Vedic-Maths" }, [
      folder("c1a", { title: "Deep", slug: "vedic-advanced" }),
      page("pp-1"),
    ]),
    folder("c2", { title: "संस्कृत", subtitle: "Sanskrit", coming_soon: true, audience_id: "aud-1" }),
    folder("c3", { title: "Dup", slug: "sanskrit" }),
    page("pp-2"),
  ]),
  folder("s2", { title: "Kala", coming_soon: true, audience_id: " aud-2 " }),
  page("top-level-page"),
  folder("s3", { title: "Again", slug: "shiksha" }),
];

describe("streamsFromFolderTree", () => {
  const streams = streamsFromFolderTree(TREE);

  it("makes top-level folders streams and keeps empty / coming-soon ones", () => {
    expect(streams.map((s) => s.slug)).toEqual(["shiksha", "kala"]);
    expect(streams[1]).toMatchObject({ title: "Kala", comingSoon: true, audienceId: "aud-2", categories: [] });
  });

  it("collects the stream's own tag plus every folder tag below it", () => {
    expect(streams[0].tag).toBe("shiksha");
    expect(real(streams[0].tags)).toEqual(["sanskrit", "shiksha", "vedic-advanced", "vedic-maths"]);
  });

  it("makes direct sub-folders categories, de-duplicated by slug", () => {
    expect(streams[0].categories.map((c) => [c.slug, c.title, c.subtitle, c.comingSoon])).toEqual([
      ["vedic-maths", "वैदिक गणित", "Vedic Maths", false],
      ["sanskrit", "संस्कृत", "Sanskrit", true],
    ]);
    expect(real(streams[0].categories[0].tags)).toEqual(["vedic-advanced", "vedic-maths"]);
    expect(streams[0].categories[1].audienceId).toBe("aud-1");
  });

  it("handles a missing tree", () => {
    expect(streamsFromFolderTree(undefined)).toEqual([]);
  });

  it("folderTagSet ignores product pages", () => {
    expect(folderTagSet(page("x"))).toEqual([]);
  });
});

describe("streamsFromTagItems", () => {
  it("maps validated items to tag streams", () => {
    expect(streamsFromTagItems([{ label: "Shiksha", slug: "shiksha", tag: "Shiksha" }])).toEqual([
      {
        id: "shiksha",
        slug: "shiksha",
        title: "Shiksha",
        subtitle: "",
        tag: "shiksha",
        tags: ["shiksha", "level:shiksha"],
        comingSoon: false,
        audienceId: null,
        imageUrl: null,
        accentColor: null,
        categories: [],
      },
    ]);
  });

  it("keeps a safe tab icon from the item", () => {
    const [ok, bad] = streamsFromTagItems([
      { label: "A", slug: "a", tag: "a", imageUrl: "https://cdn.example.com/a.png" },
      { label: "B", slug: "b", tag: "b", imageUrl: "javascript:alert(1)" },
    ]);
    expect(ok.imageUrl).toBe("https://cdn.example.com/a.png");
    expect(bad.imageUrl).toBeNull();
  });
});

describe("stream / category image + accent (folder image_url, accent_color)", () => {
  const streams = streamsFromFolderTree([
    folder(
      "s1",
      { title: "A", slug: "a", image_url: "https://cdn.example.com/a.png", accent_color: "#CC7722" }, // design-lint-ignore
      [folder("c1", { title: "C", slug: "c", image_url: "javascript:alert(1)", accent_color: "red" })],
    ),
    folder("s2", { title: "B", slug: "b", image_url: "", accent_color: "#abc" }), // design-lint-ignore
  ]);

  it("carries a safe image and a hex accent through", () => {
    expect(streams[0]).toMatchObject({ imageUrl: "https://cdn.example.com/a.png", accentColor: "#CC7722" }); // design-lint-ignore
    expect(streams[1]).toMatchObject({ imageUrl: null, accentColor: "#abc" }); // design-lint-ignore
  });

  it("drops an unsafe image and a non-hex colour (category too)", () => {
    expect(streams[0].categories[0]).toMatchObject({ imageUrl: null, accentColor: null });
  });
});

describe("countCardsByStream", () => {
  const card = (...tags: string[]) => ({ tagSet: new Set(tags) });
  const STREAMS = [
    { slug: "shiksha", tags: ["shiksha", "vedic-maths"] },
    { slug: "kala", tags: ["kala"] },
    { slug: "soon", tags: ["soon"] },
  ];

  it("counts by the stream filter's rule: category-level tags count, two streams count twice", () => {
    const cards = [card("vedic-maths"), card("shiksha", "kala"), card("kala"), card("other")];
    const { total, bySlug } = countCardsByStream(cards, STREAMS);
    expect(total).toBe(4);
    expect(Object.fromEntries(bySlug)).toEqual({ shiksha: 2, kala: 2, soon: 0 });
  });

  it("handles no streams and no cards", () => {
    expect(countCardsByStream([card("a")], []).bySlug.size).toBe(0);
    expect(countCardsByStream([], STREAMS)).toEqual({
      total: 0,
      bySlug: new Map([
        ["shiksha", 0],
        ["kala", 0],
        ["soon", 0],
      ]),
    });
  });
});

describe("streamTabText", () => {
  const s = { title: "शिक्षा", subtitle: "EDUCATION", slug: "shiksha" };
  it("follows the label mode", () => {
    expect(streamTabText(s, "title")).toEqual({ primary: "शिक्षा", secondary: "" });
    expect(streamTabText(s, "subtitle")).toEqual({ primary: "EDUCATION", secondary: "" });
    expect(streamTabText(s, "both")).toEqual({ primary: "शिक्षा", secondary: "EDUCATION" });
  });

  it("falls back when a text is missing", () => {
    expect(streamTabText({ title: "Kala", subtitle: "", slug: "kala" }, "subtitle")).toEqual({ primary: "Kala", secondary: "" });
    expect(streamTabText({ title: "", subtitle: "", slug: "kala" }, "both")).toEqual({ primary: "kala", secondary: "" });
  });

  it("finds a stream by slug", () => {
    const streams = streamsFromFolderTree(TREE);
    expect(findStream(streams, "kala")?.id).toBe("s2");
    expect(findStream(streams, null)).toBeNull();
    expect(findStream(streams, "nope")).toBeNull();
  });
});

describe("nextTabIndex (arrow keys across the tab row)", () => {
  it("steps with the arrows and wraps around", () => {
    expect(nextTabIndex("ArrowRight", 0, 4)).toBe(1);
    expect(nextTabIndex("ArrowRight", 3, 4)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextTabIndex("ArrowLeft", 2, 4)).toBe(1);
  });

  it("jumps to the ends with Home / End", () => {
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 0, 4)).toBe(3);
  });

  it("mirrors the arrows right-to-left", () => {
    expect(nextTabIndex("ArrowRight", 1, 4, true)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 3, 4, true)).toBe(0);
  });

  it("ignores other keys and a tab it cannot place", () => {
    expect(nextTabIndex("Enter", 1, 4)).toBeNull();
    expect(nextTabIndex("ArrowRight", -1, 4)).toBeNull();
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("streamTabId", () => {
  it("gives every tab its own id, the All tab included", () => {
    expect(streamTabId(":r1:", null)).toBe(":r1:-tab-all");
    expect(streamTabId(":r1:", "shiksha")).toBe(":r1:-tab-s-shiksha");
    // A stream whose key is literally "all" never takes the All tab's id.
    expect(streamTabId(":r1:", "all")).not.toBe(streamTabId(":r1:", null));
    expect(streamTabId(":r1:", "a b/c")).toBe(":r1:-tab-s-a_b_c");
  });
});

describe("level keys: a course levelled like a stream or category belongs to it", () => {
  // Brahm Varchas, 2026-10-16: courses carry only format tags and name their
  // category in the level ("Vedic Parenting", "History", "India of temples").
  const BV: PublicFolderNode[] = [
    folder("dharma", { title: "धर्म | संस्कृति", subtitle: "Virtue | Civilisation", slug: "dharma" }, [
      folder("vp", { title: "वैदिक पेरेंटिंग", subtitle: "Holistic Parenting", course_tag: "vedic-parenting" }),
    ]),
    folder("bharat", { title: "भारत परिक्रमा", subtitle: "Orbiting Bharat", slug: "bharat" }, [
      folder("mandir", { title: "मंदिरों का भारत", subtitle: "India of temples", course_tag: "mandir" }),
      folder("itihas", { title: "इतिहास", subtitle: "History", course_tag: "itihas" }),
    ]),
  ];
  const streams = streamsFromFolderTree(BV);
  type Row = Parameters<typeof buildCatalogCards>[0][number];
  const row = (id: string, level: string, tags = "ebook"): Row =>
    ({
      id,
      package_id: id,
      package_session_id: `ps-${id}`,
      level_name: level,
      comma_separeted_tags: tags,
    }) as unknown as Row;
  const cards = buildCatalogCards(
    [
      row("a", "Vedic Parenting"), // = the category's course tag
      row("b", "India of temples"), // = the category's subtitle
      row("c", "History"), // = the category's subtitle
      row("d", "Ramayan"), // names nothing
      row("e", "default", "vedic-parenting"), // placeholder level, real tag still counts
    ],
    { grouping: false, languages: [] },
  );

  it("counts courses into streams by level name, next to tags", () => {
    const { bySlug } = countCardsByStream(cards, streams);
    expect(bySlug.get("dharma")).toBe(2); // a (level) + e (tag)
    expect(bySlug.get("bharat")).toBe(2); // b + c
  });

  it("puts a course in the category its level names", () => {
    const has = (catSlug: string, card: (typeof cards)[number]) =>
      streams.flatMap((s) => s.categories).find((c) => c.id === catSlug)!.tags.some((t) => card.tagSet.has(t));
    expect(has("mandir", cards[1])).toBe(true);
    expect(has("itihas", cards[1])).toBe(false);
    expect(has("itihas", cards[2])).toBe(true);
  });

  it("never matches a level key to a real tag, nor a placeholder level", () => {
    const { bySlug } = countCardsByStream(
      buildCatalogCards([row("x", "Ramayan", "level:history")], { grouping: false, languages: [] }),
      streams,
    );
    // A literal "level:history" tag is not the History category's level key.
    expect(bySlug.get("bharat")).toBe(0);
    expect(cards[4].tagSet.has("level:default")).toBe(false);
  });
});

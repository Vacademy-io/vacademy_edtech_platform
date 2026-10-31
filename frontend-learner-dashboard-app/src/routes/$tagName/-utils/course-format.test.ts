import { describe, expect, it } from "vitest";
import {
  cardFormatKeys,
  countByFormat,
  courseFormatKeys,
  courseFormatOf,
  resolveCourseFormats,
  rowTags,
  tagKey,
  withTagFormats,
} from "./course-format";

const GS = {
  courseFormats: {
    elearning: { label: "Interactive, self-paced E-learning" },
    ebook: { label: "E-books", levels: ["eBook"], tags: ["e-book"] },
    live: { label: "Live sessions" },
    animation: { label: "Short film / Animation", levels: ["Short Film"] },
    article: { label: "Articles-essays", levels: ["Article/Essay"] },
    merch: { label: "Merchandise (in collaboration)" },
    bad: { levels: ["x"] },
    "": { label: "No key" },
  },
  courseFormatOrder: ["ebook", "elearning"],
};

describe("resolveCourseFormats", () => {
  it("is null when the site authors none", () => {
    expect(resolveCourseFormats(undefined)).toBeNull();
    expect(resolveCourseFormats({})).toBeNull();
    expect(resolveCourseFormats({ courseFormats: [] as never })).toBeNull();
    expect(resolveCourseFormats({ courseFormats: { a: { label: " " } } })).toBeNull();
  });

  it("validates, lower-cases and orders (order list first, then authoring order)", () => {
    const f = resolveCourseFormats(GS)!;
    expect(f.list.map((x) => x.key)).toEqual(["ebook", "elearning", "live", "animation", "article", "merch"]);
    expect(f.byKey.get("ebook")).toEqual({
      key: "ebook",
      label: "E-books",
      levels: ["ebook"],
      tags: ["format-ebook", "e-book"],
    });
  });
});

describe("a course's format", () => {
  const f = resolveCourseFormats(GS);

  it("takes the format-<key> tag first, then a listed tag, then the level name", () => {
    expect(courseFormatKeys({ comma_separeted_tags: "shiksha, Format-Live ,format-elearning", level_name: "eBook" }, f)).toEqual([
      "live",
      "elearning",
      "ebook",
    ]);
    expect(courseFormatKeys({ comma_separeted_tags: "e-book" }, f)).toEqual(["ebook"]);
    expect(courseFormatKeys({ level_name: " short film " }, f)).toEqual(["animation"]);
    expect(courseFormatOf({ level_name: "Article/Essay" }, f)?.label).toBe("Articles-essays");
  });

  it("ignores a format-<key> tag for a key the site does not author, and unknown levels", () => {
    expect(courseFormatKeys({ comma_separeted_tags: "format-podcast", level_name: "default" }, f)).toEqual([]);
    expect(courseFormatOf({ level_name: "default" }, f)).toBeNull();
  });

  it("reads tags from a product-page mapping (comma string) and arrays; level when level_name is absent", () => {
    expect(rowTags({ tags: "a, B", comma_separeted_tags: null })).toEqual(["a", "b"]);
    expect(rowTags({ tags: ["x", " Y "] })).toEqual(["x", "y"]);
    expect(courseFormatKeys({ tags: "format-merch" }, f)).toEqual(["merch"]);
    expect(courseFormatKeys({ level: "eBook" }, f)).toEqual(["ebook"]);
  });

  it("returns nothing at all without settings", () => {
    expect(courseFormatKeys({ comma_separeted_tags: "format-ebook", level_name: "eBook" }, null)).toEqual([]);
    expect(courseFormatOf({ level_name: "eBook" }, null)).toBeNull();
    expect(cardFormatKeys([{ level_name: "eBook" }], null)).toEqual([]);
  });

  it("unions a grouped card's versions and counts zero-count formats too", () => {
    expect(cardFormatKeys([{ level_name: "eBook" }, { comma_separeted_tags: "format-live" }, { level_name: "eBook" }], f)).toEqual([
      "ebook",
      "live",
    ]);
    const counts = countByFormat(
      [{ rows: [{ level_name: "eBook" }] }, { rows: [{ level_name: "eBook" }, { comma_separeted_tags: "format-live" }] }],
      (c) => c.rows,
      f,
    );
    expect(Object.fromEntries(counts)).toEqual({ ebook: 2, elearning: 0, live: 1, animation: 0, article: 0, merch: 0 });
  });
});

describe("tagKey matching", () => {
  it("folds case, spaces, hyphens, slashes and apostrophes", () => {
    expect(tagKey(" Article - Essay ")).toBe("article-essay");
    expect(tagKey("for parents")).toBe(tagKey("for-parents"));
    expect(tagKey("Short film / Animation")).toBe("short-film-animation");
    expect(tagKey("for women's health")).toBe("for-womens-health");
    expect(tagKey("हिंदी")).toBe("हिंदी");
  });

  it("a format-<key> tag still matches a key with an underscore, and its spaced spelling too", () => {
    const formats = resolveCourseFormats({ courseFormats: { audio_book: { label: "Audio Book" } } });
    expect(courseFormatKeys({ comma_separeted_tags: "format-audio_book" }, formats)).toEqual(["audio_book"]);
    expect(courseFormatKeys({ comma_separeted_tags: "Format Audio Book" }, formats)).toEqual(["audio_book"]);
  });

  it("a format alias matches however the course tag is spaced", () => {
    const formats = resolveCourseFormats({ courseFormats: { article: { label: "Articles", tags: ["article-essay"] } } });
    expect(courseFormatKeys({ comma_separeted_tags: "Article - Essay" }, formats)).toEqual(["article"]);
  });
});

describe("withTagFormats", () => {
  const rows = [
    { comma_separeted_tags: "hindi,ebook,for parents" },
    { comma_separeted_tags: "english,Podcast,for everyone,shastra" },
    { comma_separeted_tags: "Podcast,Short film / Animation" },
  ];
  const base = {
    courseFormats: { ebook: { label: "E-books", tags: ["ebook"] } },
    courseFormatsFromTags: { enabled: true, skipPrefixes: ["for"] },
  };

  it("adds every unclaimed tag as a format, labelled as written", () => {
    const gs = withTagFormats(base, rows, (k) => k === "shastra");
    const formats = resolveCourseFormats(gs);
    expect(formats?.list.map((f) => [f.key, f.label])).toEqual([
      ["ebook", "E-books"],
      ["podcast", "Podcast"],
      ["short-film-animation", "Short film / Animation"],
    ]);
    expect(courseFormatKeys(rows[2], formats)).toEqual(["podcast", "short-film-animation"]);
  });

  it("is off unless enabled, and returns the same object when nothing is new", () => {
    const off = { ...base, courseFormatsFromTags: { enabled: false } };
    expect(withTagFormats(off, rows)).toBe(off);
    expect(withTagFormats(base, [rows[0]])).toBe(base);
    expect(withTagFormats(null, rows)).toBeNull();
  });

  it("skips listed tags and the site's language tags", () => {
    const gs = withTagFormats({ ...base, courseFormatsFromTags: { enabled: true, skip: ["podcast", "for everyone", "for parents"] } }, rows, (k) => k === "shastra");
    expect(Object.keys((gs as { courseFormats: object }).courseFormats)).toEqual(["ebook", "short-film-animation"]);
  });
});

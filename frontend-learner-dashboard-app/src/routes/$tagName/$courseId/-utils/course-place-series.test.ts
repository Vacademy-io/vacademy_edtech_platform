import { describe, expect, it, vi } from "vitest";

// learning-path-utils reaches folder-library-service, which builds its API base from the browser location.
vi.mock("@/constants/urls", () => ({ BASE_URL: "" }));

import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../-utils/course-variants";
import { levelKeys } from "../../-utils/level-key";
import type { CatalogCategory, CatalogStream } from "../../-components/components/catalog/catalog-streams";
import type { PathMapping } from "../../-components/components/learning-path-utils";
import {
  catalogueRowAsMapping,
  coursePlaceSeriesCandidates,
  seriesFromMappings,
  type CatalogueCourseRow,
} from "./course-place-series";

// Courses sit in a category by their LEVEL name (the folder's level key), as on a site whose levels are categories.
const cat = (slug: string, title: string): CatalogCategory => ({
  id: slug,
  slug,
  title,
  subtitle: "",
  tags: [slug, ...levelKeys(title)],
  comingSoon: false,
  audienceId: null,
});
const stream = (slug: string, title: string, categories: CatalogCategory[]): CatalogStream => ({
  id: slug,
  slug,
  title,
  subtitle: "",
  tag: slug,
  tags: [slug, ...levelKeys(title), ...categories.flatMap((c) => c.tags)],
  comingSoon: false,
  audienceId: null,
  categories,
});

const PARENTING = cat("holistic-parenting", "Holistic Parenting");
const ASTRONOMY = cat("astronomy", "Astronomy");
const STORY = cat("story-telling", "Story Telling");
const STREAMS = [
  stream("virtue", "Virtue", [PARENTING]),
  stream("education", "Education", [ASTRONOMY, STORY]),
];

let n = 0;
const course = (id: string, name: string, level: string, tags: string, created: string): CatalogueCourseRow => ({
  id,
  package_name: name,
  package_session_id: `ps-${id}-${(n += 1)}`,
  enroll_invite_id: `inv-${id}`,
  level_name: level,
  comma_separeted_tags: tags,
  min_plan_actual_price: 0,
  currency: "INR",
  created_at: created,
});

// The API lists them in its own order; the series reads oldest first.
const ROWS: CatalogueCourseRow[] = [
  course("hp-intro", "Holistic Parenting Introduction", "Holistic Parenting", "english,e-learning", "2026-10-14T15:27:00Z"),
  course("hp-0-5", "Holistic Parenting - 0 to 5 Years", "Holistic Parenting", "english,e-learning", "2026-10-14T11:08:00Z"),
  course("pk-0-5", "पंचकोष 0-5 वर्ष", "Holistic Parenting", "hindi,e-learning", "2026-10-14T11:27:00Z"),
  course("hp-premise", "Holistic Parenting - The Basic Premise", "Holistic Parenting", "english,e-learning", "2026-10-14T11:16:00Z"),
  course("tithi", "Tithi Darshika", "Astronomy", "hindi,live sessions", "2026-10-15T18:30:00Z"),
  course("swadheen", "स्वाधीन राष्ट्र", "Story Telling", "hindi,articles-essays", "2026-10-14T10:43:00Z"),
  course("gurukul-en", "True Gurukul Shiksha", "Story Telling", "english,ebook", "2026-10-14T16:37:00Z"),
];

const OPTS = { groupVersions: true, languages: LANGS, preferredLanguage: null, placeList: true };

const placeSeries = (courseId: string, streamSlug: string, streamLabel: string, category: { slug: string; label: string } | null) => {
  for (const c of coursePlaceSeriesCandidates({
    rows: ROWS,
    streams: STREAMS,
    stream: { slug: streamSlug, label: streamLabel },
    category,
  })) {
    const s = seriesFromMappings(c.mappings, c.name, { ...OPTS, courseId });
    if (s) return s;
  }
  return null;
};

describe("coursePlaceSeriesCandidates", () => {
  it("lists the category's courses, then the stream's, oldest first", () => {
    const [category, streamList] = coursePlaceSeriesCandidates({
      rows: ROWS,
      streams: STREAMS,
      stream: { slug: "virtue", label: "Virtue" },
      category: { slug: "holistic-parenting", label: "Holistic Parenting" },
    });
    expect(category?.kind).toBe("category");
    expect(category?.name).toBe("Holistic Parenting");
    expect(category?.mappings.map((m) => m.package_id)).toEqual(["hp-0-5", "hp-premise", "pk-0-5", "hp-intro"]);
    expect(streamList?.kind).toBe("stream");
  });

  it("gives nothing without streams, rows or a stream for the course", () => {
    const place = { stream: { slug: "virtue", label: "Virtue" }, category: null };
    expect(coursePlaceSeriesCandidates({ rows: ROWS, streams: [], ...place })).toEqual([]);
    expect(coursePlaceSeriesCandidates({ rows: [], streams: STREAMS, ...place })).toEqual([]);
    expect(coursePlaceSeriesCandidates({ rows: ROWS, streams: STREAMS, stream: null, category: null })).toEqual([]);
  });
});

describe("seriesFromMappings for a course in no path", () => {
  it("shows the category's courses in the course's language, numbered as a series, with no next", () => {
    const s = placeSeries("hp-premise", "virtue", "Virtue", { slug: "holistic-parenting", label: "Holistic Parenting" });
    expect(s?.name).toBe("Holistic Parenting");
    // The Hindi पंचकोष course is left out of an English course's chips.
    expect(s?.steps.map((x) => x.courseId)).toEqual(["hp-0-5", "hp-premise", "hp-intro"]);
    expect(s?.steps.find((x) => x.current)?.courseId).toBe("hp-premise");
    expect(s?.next).toBeNull();
  });

  it("falls back to the stream when the category holds no other course in its language", () => {
    const s = placeSeries("tithi", "education", "Education", { slug: "astronomy", label: "Astronomy" });
    expect(s?.name).toBe("Education");
    // English True Gurukul is left out of the Hindi course's chips.
    expect(s?.steps.map((x) => x.courseId)).toEqual(["swadheen", "tithi"]);
  });

  it("shows nothing when the course is alone in its language even in its stream", () => {
    expect(placeSeries("gurukul-en", "education", "Education", { slug: "story-telling", label: "Story Telling" })).toBeNull();
  });

  it("shows nothing for a course the list does not have", () => {
    expect(placeSeries("unlisted", "virtue", "Virtue", { slug: "holistic-parenting", label: "Holistic Parenting" })).toBeNull();
  });

  it("lists a course once even when two of its versions are listed", () => {
    const twice = [
      catalogueRowAsMapping(course("a", "A", "Holistic Parenting", "english", "2026-01-01T00:00:00Z"))!,
      catalogueRowAsMapping(course("a", "A", "Print", "english", "2026-01-02T00:00:00Z"))!,
      catalogueRowAsMapping(course("b", "B", "Holistic Parenting", "english", "2026-01-03T00:00:00Z"))!,
    ];
    expect(seriesFromMappings(twice, "X", { ...OPTS, courseId: "a" })?.steps.map((x) => x.courseId)).toEqual(["a", "b"]);
  });
});

describe("seriesFromMappings for a learning path", () => {
  const path: PathMapping[] = [
    { package_session_id: "p1", package_id: "one", package_name: "Step one", level_name: "Swasthavritta", tags: "english,hindi", status: "ACTIVE" },
    { package_session_id: "p2", package_id: "two", package_name: "Step two", level_name: "Garbha Vigyan", tags: "english", status: "ACTIVE" },
    { package_session_id: "p3", package_id: "three", package_name: "Step three", level_name: "Parenting", tags: "hindi", status: "DELETED" },
  ];

  it("keeps the path's next step", () => {
    const s = seriesFromMappings(path, "A woman's life stages", { ...OPTS, courseId: "one", placeList: false });
    expect(s?.steps.map((x) => x.courseId)).toEqual(["one", "two"]);
    expect(s?.next?.courseId).toBe("two");
  });

  it("is null when the path leaves the course alone in its language", () => {
    const hindiOnly: PathMapping[] = [
      { package_session_id: "h1", package_id: "hi-course", package_name: "हिंदी", level_name: "X", tags: "hindi", status: "ACTIVE" },
      { package_session_id: "e1", package_id: "en-course", package_name: "English", level_name: "X", tags: "english", status: "ACTIVE" },
    ];
    expect(seriesFromMappings(hindiOnly, "P", { ...OPTS, courseId: "hi-course", placeList: false })).toBeNull();
  });
});

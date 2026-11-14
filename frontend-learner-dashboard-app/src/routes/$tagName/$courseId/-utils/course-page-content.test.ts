import { describe, expect, it } from "vitest";
import {
  courseLanguageLabel,
  embedUrlOf,
  parseCoursePageJson,
  previewVideoOf,
  seriesWindow,
  shortStepLabels,
} from "./course-page-content";
import { findAppBanner, findPathLibraryId } from "./course-page-context";

describe("parseCoursePageJson", () => {
  it("reads the mode and the FAQs that have both a question and an answer", () => {
    const raw = JSON.stringify({
      v: 1,
      mode: "SELF_PACED",
      faqs: [{ q: " How long? ", a: "<p>25 min</p>" }, { q: "", a: "orphan" }, { q: "No answer" }, "junk"],
    });
    expect(parseCoursePageJson(raw)).toEqual({ mode: "SELF_PACED", faqs: [{ q: "How long?", a: "<p>25 min</p>" }] });
  });

  it("is empty for anything it cannot read", () => {
    const empty = { mode: null, faqs: [] };
    expect(parseCoursePageJson(null)).toEqual(empty);
    expect(parseCoursePageJson("")).toEqual(empty);
    expect(parseCoursePageJson("{not json")).toEqual(empty);
    expect(parseCoursePageJson("[1,2]")).toEqual(empty);
    expect(parseCoursePageJson(JSON.stringify({ mode: "WEEKLY", faqs: "x" }))).toEqual(empty);
  });

  it("caps the FAQs at thirty", () => {
    const faqs = Array.from({ length: 40 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
    expect(parseCoursePageJson({ faqs }).faqs).toHaveLength(30);
  });
});

describe("previewVideoOf", () => {
  it("finds a preview video in the course media, and none in an image", () => {
    expect(previewVideoOf('{"type":"youtube","id":"dQw4w9WgXcQ"}')).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(previewVideoOf('{"type":"youtube","id":"https://youtu.be/dQw4w9WgXcQ"}')).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(previewVideoOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(previewVideoOf("https://vimeo.com/123456")).toEqual({ kind: "vimeo", id: "123456" });
    expect(previewVideoOf('{"type":"video","id":"media-file-1"}')).toEqual({ kind: "file", id: "media-file-1" });
    expect(previewVideoOf("https://cdn.example.com/p.mp4")).toEqual({ kind: "url", url: "https://cdn.example.com/p.mp4" });
    expect(previewVideoOf('{"type":"image","id":"8dfb2716"}')).toBeNull();
    expect(previewVideoOf("8dfb2716-5df1-4b2c")).toBeNull();
    expect(previewVideoOf("{broken")).toBeNull();
    expect(previewVideoOf(undefined)).toBeNull();
  });

  it("embeds YouTube without tracking cookies, and Vimeo by its player", () => {
    expect(embedUrlOf({ kind: "youtube", id: "abcdef" })).toContain("youtube-nocookie.com/embed/abcdef");
    expect(embedUrlOf({ kind: "vimeo", id: "12" })).toContain("player.vimeo.com/video/12");
    expect(embedUrlOf({ kind: "file", id: "x" })).toBeNull();
  });
});

describe("courseLanguageLabel", () => {
  const langs = [
    { code: "en", label: "English" },
    { code: "hi", label: "Hindi" },
  ];
  it("reads the version's level, else a tag naming a language", () => {
    expect(courseLanguageLabel({ levelName: "Hindi", languages: langs })).toBe("Hindi");
    expect(courseLanguageLabel({ levelName: "English (UK)", languages: langs })).toBe("English");
    expect(courseLanguageLabel({ levelName: "default", tags: ["swasthya", "english"], languages: langs })).toBe("English");
    expect(courseLanguageLabel({ levelName: "default", tags: ["swasthya"], languages: langs })).toBeNull();
    expect(courseLanguageLabel({ levelName: "Hindi", languages: [] })).toBeNull();
  });
});

describe("shortStepLabels", () => {
  it("drops the words every step title starts with, and the separator after them", () => {
    expect(
      shortStepLabels([
        "Holistic Parenting Introduction",
        "Holistic Parenting - Basic premise",
        "Holistic Parenting - 0 to 5 years",
      ]),
    ).toEqual(["Introduction", "Basic premise", "0 to 5 years"]);
  });
  it("keeps titles that share nothing, or would be left empty", () => {
    expect(shortStepLabels(["Yoga", "Gita"])).toEqual(["Yoga", "Gita"]);
    expect(shortStepLabels(["Yoga", "Yoga advanced"])).toEqual(["Yoga", "Advanced"]);
    expect(shortStepLabels(["Only one"])).toEqual(["Only one"]);
  });
});

describe("site lookups", () => {
  const pages = [
    { route: "home", components: [{ type: "ctaBanner", props: { heading: "Not sure?" } }] },
    {
      route: "learning-paths",
      components: [
        { type: "learningPath", props: { libraryId: "lib-paths" } },
        { type: "ctaBanner", props: { heading: "Get the app", mockup: { kind: "phone", image: "p.png" } } },
      ],
    },
  ];
  it("finds the Learning Paths library", () => {
    expect(findPathLibraryId(pages)).toBe("lib-paths");
    expect(findPathLibraryId([pages[0]!])).toBeNull();
  });
  it("finds the site's app banner (a CTA band with a phone), unless the site turns it off", () => {
    expect(findAppBanner(pages)?.props.heading).toBe("Get the app");
    expect(findAppBanner([pages[0]!])).toBeNull();
    expect(findAppBanner(pages, { courseDetails: { appBanner: false } })).toBeNull();
  });
});

describe("seriesWindow", () => {
  const path = (n: number, at: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, current: i === at }));
  const numbers = (steps: ReturnType<typeof path>, limit: unknown) => seriesWindow(steps, limit).map((s) => s.number);

  it("shows every step without a usable limit", () => {
    expect(numbers(path(6, 2), undefined)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbers(path(6, 2), 0)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbers(path(6, 2), "3")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbers(path(3, 0), 3)).toEqual([1, 2, 3]);
  });

  it("keeps a window of `limit` steps around the current course, numbered from 1", () => {
    const ids = (steps: ReturnType<typeof path>, limit: unknown) => seriesWindow(steps, limit).map((s) => s.step.id);
    expect(ids(path(6, 0), 3)).toEqual([1, 2, 3]);
    expect(ids(path(6, 3), 3)).toEqual([3, 4, 5]);
    expect(ids(path(6, 5), 3)).toEqual([4, 5, 6]);
    expect(ids(path(4, 3), 3)).toEqual([2, 3, 4]);
    expect(numbers(path(6, 3), 3)).toEqual([1, 2, 3]);
    expect(numbers(path(4, 3), 3)).toEqual([1, 2, 3]);
    expect(seriesWindow(path(6, 3), 3).filter((s) => s.step.current).map((s) => s.number)).toEqual([2]);
  });

  it("starts at the first step when the course is not one", () => {
    expect(numbers(path(6, -1), 3)).toEqual([1, 2, 3]);
  });
});

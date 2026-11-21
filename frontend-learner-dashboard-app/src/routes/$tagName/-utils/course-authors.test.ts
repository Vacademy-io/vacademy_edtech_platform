import { describe, expect, it } from "vitest";
import { mapCourseAuthors, visibleCourseAuthors } from "./course-authors";

/**
 * Shape of `course-init` → sessions[0].level_with_details[0].instructors for
 * the Brahm Varchas "testing" course on 2026-09-19, after the author was
 * saved with a subtitle and a rich-text bio (phone/email are the real
 * fields the API returns and must never reach the page).
 */
const prodInstructors = [
  {
    id: "c1c683fb-63c3-43cc-a2f2-ea31b2a78006",
    username: "admin_brahmvarchas",
    email: "anshu@brahmvarchas.org",
    full_name: "Admin Brahmvarchas",
    mobile_number: "919311683145",
    profile_pic_file_id: null,
    roles: ["ADMIN"],
    author_subtitle: "लेखक परिचय",
    author_description:
      "<p>जन्म: 20 मार्च, 1969, (झाँसी)</p><p>प्रकाशित उपन्यास: रूही - एक पहेली (2017), मैं मुन्ना हूँ (2020)</p>",
  },
  {
    id: "cb703101-bef0-445d-91fb-9a4af4951ba4",
    email: "abhishek@thewebconcepts.com",
    full_name: "Abhishek",
    profile_pic_file_id: "159276d4-b3cc-4ebb-b9c8-294ff0df6104",
    author_subtitle: "   ",
    author_description: "<p></p>",
  },
];

describe("mapCourseAuthors", () => {
  it("keeps name, subtitle, bio HTML and photo id — and nothing that identifies the account", () => {
    const authors = mapCourseAuthors(prodInstructors, "Unknown Teacher");
    expect(authors).toHaveLength(2);
    expect(authors[0]).toEqual({
      id: "c1c683fb-63c3-43cc-a2f2-ea31b2a78006",
      name: "Admin Brahmvarchas",
      subtitle: "लेखक परिचय",
      description: prodInstructors[0].author_description,
      profilePicId: undefined,
    });
    const serialised = JSON.stringify(authors);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("919311683145");
    expect(serialised).not.toContain("admin_brahmvarchas");
  });

  it("treats an untouched editor (<p></p>) and a blank subtitle as absent, keeps the photo id", () => {
    const [, abhishek] = mapCourseAuthors(prodInstructors, "Unknown Teacher");
    expect(abhishek).toEqual({
      id: "cb703101-bef0-445d-91fb-9a4af4951ba4",
      name: "Abhishek",
      subtitle: undefined,
      description: undefined,
      profilePicId: "159276d4-b3cc-4ebb-b9c8-294ff0df6104",
    });
  });

  it("falls back to the terminology label for a nameless record and to an index id", () => {
    expect(mapCourseAuthors([{ full_name: "  " }], "Unknown Teacher")).toEqual([
      { id: "author-0", name: "Unknown Teacher", subtitle: undefined, description: undefined, profilePicId: undefined },
    ]);
    expect(mapCourseAuthors(null, "x")).toEqual([]);
  });
});

describe("visibleCourseAuthors", () => {
  const authors = mapCourseAuthors(prodInstructors, "Unknown Teacher");

  it("with Show All Teachers OFF (the default) shows the first author with the full profile", () => {
    const shown = visibleCourseAuthors(authors, false, "Admin Brahmvarchas");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.subtitle).toBe("लेखक परिचय");
    expect(shown[0]?.description).toContain("जन्म: 20 मार्च, 1969");
  });

  it("with Show All Teachers ON lists every author", () => {
    expect(visibleCourseAuthors(authors, true).map((a) => a.name)).toEqual([
      "Admin Brahmvarchas",
      "Abhishek",
    ]);
  });

  it("with no faculty at all falls back to the hero's author name, else nothing", () => {
    expect(visibleCourseAuthors([], false, "Creator Name")).toEqual([
      { id: "primary", name: "Creator Name" },
    ]);
    expect(visibleCourseAuthors([], false, null)).toEqual([]);
    expect(visibleCourseAuthors([], true, "Creator Name")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { PublicFolderNode } from "../../-services/folder-library-service";
import { folderBrowserSections, folderTrail } from "./folder-trail";

const folder = (id: string, title: string, children: PublicFolderNode[] = []): PublicFolderNode => ({
  id,
  node_type: "FOLDER",
  title,
  children,
});
const page = (id: string, code: string, title: string): PublicFolderNode => ({
  id,
  node_type: "PRODUCT_PAGE",
  title,
  product_page_code: code,
  children: [],
});

// Current Affairs > Weekly > 2025 > [All 2025 (envecr)], Monthly > 2025
const tree: PublicFolderNode[] = [
  folder("ca", "Current Affairs", [
    folder("weekly", "Weekly", [folder("w25", "2025", [page("pp", "envecr", "All 2025")])]),
    folder("monthly", "Monthly", [folder("m25", "2025")]),
  ]),
  folder("history", "History"),
];

const sitePages = [
  { route: "home", components: [{ type: "folderBrowser", props: { libraryId: "lib", rootFolderId: "ca" } }] },
  { route: "courses", components: [{ type: "folderBrowser", props: { libraryId: "lib", rootFolderId: "" } }] },
  { route: "current-affairs", components: [{ type: "folderBrowser", props: { libraryId: "lib", rootFolderId: "ca" } }] },
  { route: "off", components: [{ type: "folderBrowser", enabled: false, props: { libraryId: "lib" } }] },
  { route: "blog", components: [{ type: "blogList", props: {} }] },
];
const sections = folderBrowserSections(sitePages);

describe("folderBrowserSections", () => {
  it("lists the enabled Folder Browser sections with their library and start folder", () => {
    expect(sections).toEqual([
      { route: "home", libraryId: "lib", rootFolderId: "ca" },
      { route: "courses", libraryId: "lib", rootFolderId: "" },
      { route: "current-affairs", libraryId: "lib", rootFolderId: "ca" },
    ]);
    expect(folderBrowserSections(undefined)).toEqual([]);
  });
});

describe("folderTrail", () => {
  it("is the folders above the product page the visitor came from, each linking to its folder", () => {
    expect(folderTrail({ sections, trees: { lib: tree }, productPageCode: "envecr", tags: ["x"] })).toEqual([
      // The section starting AT the folder shows it at its top; a non-home page wins a tie.
      { key: "ca", title: "Current Affairs", route: "current-affairs", folderId: null },
      { key: "weekly", title: "Weekly", route: "current-affairs", folderId: "weekly" },
      { key: "w25", title: "2025", route: "current-affairs", folderId: "w25" },
    ]);
  });

  it("links a folder above every start folder to a whole-library section", () => {
    const trail = folderTrail({
      sections: folderBrowserSections([
        { route: "history", components: [{ type: "folderBrowser", props: { libraryId: "lib", rootFolderId: "history" } }] },
        { route: "courses", components: [{ type: "folderBrowser", props: { libraryId: "lib", rootFolderId: "" } }] },
      ]),
      trees: { lib: tree },
      productPageCode: "envecr",
    });
    expect(trail?.map((c) => [c.route, c.folderId])).toEqual([
      ["courses", "ca"],
      ["courses", "weekly"],
      ["courses", "w25"],
    ]);
  });

  it("leaves a folder no section shows as plain text", () => {
    const trail = folderTrail({
      sections: [{ route: "history", libraryId: "lib", rootFolderId: "history" }],
      trees: { lib: tree },
      productPageCode: "envecr",
    });
    expect(trail?.every((c) => c.route === null)).toBe(true);
  });

  it("falls back to the tags, linking only a folder name that is unique in the library", () => {
    expect(folderTrail({ sections, trees: { lib: tree }, productPageCode: "unknown", tags: ["Current Affairs", "2025", "Nowhere"] })).toEqual([
      { key: "Current Affairs-0", title: "Current Affairs", route: "current-affairs", folderId: null },
      // Weekly > 2025 and Monthly > 2025: ambiguous, so not a guess.
      { key: "2025-1", title: "2025", route: null, folderId: null },
      { key: "Nowhere-2", title: "Nowhere", route: null, folderId: null },
    ]);
  });

  it("is null until a library tree is loaded, or with nothing to show", () => {
    expect(folderTrail({ sections, trees: {}, productPageCode: "envecr", tags: ["a"] })).toBeNull();
    expect(folderTrail({ sections: [], trees: { lib: tree }, productPageCode: "envecr" })).toBeNull();
    expect(folderTrail({ sections, trees: { lib: tree } })).toBeNull();
  });
});

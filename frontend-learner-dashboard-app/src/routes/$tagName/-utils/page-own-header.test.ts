import { describe, it, expect } from "vitest";
import { pageOpensWithOwnHeader } from "./page-own-header";

/**
 * Getting this wrong is silent and only visible on the live page: the title
 * bar simply appears above a page that already had a header, which is how the
 * 7Cs "Toddler Reset" page shipped with a green bar stacked over its own
 * branded nav.
 */
describe("pageOpensWithOwnHeader", () => {
  const page = (...types: string[]) => types.map((type) => ({ type }));

  it("treats a pasted whole page as having its own header", () => {
    // htmlPage is created by Add Page > HTML page as the page's ONLY
    // component and always brings its own header, nav and footer.
    expect(pageOpensWithOwnHeader(page("htmlPage"))).toBe(true);
  });

  it("treats the other self-titling openers as having their own header", () => {
    for (const type of [
      "heroSection",
      "sectionHeading",
      "detailBlocks",
      "htmlBlock",
      "banner",
    ]) {
      expect(pageOpensWithOwnHeader(page(type))).toBe(true);
    }
  });

  it("wants the fallback title bar for a page that opens with plain content", () => {
    expect(pageOpensWithOwnHeader(page("featureGrid", "ctaBanner"))).toBe(false);
    expect(pageOpensWithOwnHeader(page("textBlock"))).toBe(false);
  });

  it("counts a hero anywhere on the page, not just first", () => {
    expect(pageOpensWithOwnHeader(page("textBlock", "heroSection"))).toBe(true);
  });

  it("only counts the other openers when they come first", () => {
    // A sectionHeading halfway down is a section label, not the page's title.
    expect(pageOpensWithOwnHeader(page("textBlock", "sectionHeading"))).toBe(false);
  });

  it("wants the fallback for an empty page rather than throwing", () => {
    expect(pageOpensWithOwnHeader([])).toBe(false);
    expect(pageOpensWithOwnHeader([undefined, null])).toBe(false);
  });
  it("counts a Courses grid that opens with its own hero, and only then", () => {
    const grid = (props?: unknown) => [{ type: "courseCatalog", props }];
    expect(pageOpensWithOwnHeader(grid({ hero: { enabled: true } }))).toBe(true);
    expect(pageOpensWithOwnHeader(grid())).toBe(false);
    expect(pageOpensWithOwnHeader(grid({ hero: {} }))).toBe(false);
    expect(pageOpensWithOwnHeader(grid({ hero: { enabled: false } }))).toBe(false);
    expect(pageOpensWithOwnHeader([{ type: "textBlock" }, { type: "courseCatalog", props: { hero: { enabled: true } } }])).toBe(false);
  });

  it("looks past a promo popup placed at the top of the page", () => {
    // The popup floats over the page; the section under it is what opens it.
    expect(pageOpensWithOwnHeader(page("promoPopup", "sectionHeading"))).toBe(true);
    expect(pageOpensWithOwnHeader(page("promoPopup", "faqSection"))).toBe(false);
    expect(pageOpensWithOwnHeader(page("promoPopup"))).toBe(false);
  });
});

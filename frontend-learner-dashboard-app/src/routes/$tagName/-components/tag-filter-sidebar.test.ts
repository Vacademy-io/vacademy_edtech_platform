// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Page tag filter as ONE grid (a Books page is 8 rows of 4 books): with a
 * host layout, every tagged column renders in the host's grid, so a filter
 * leaves no half-empty rows; the sidebar style looks like the Courses page
 * (checkbox groups: OR inside a group, AND across groups).
 */

const nav = vi.hoisted(() => ({ searchStr: "", replace: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: nav.replace, location: { href: "/site/books" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site/books", searchStr: nav.searchStr, search: {}, hash: "" };
    return opts?.select ? opts.select(location) : location;
  },
  Link: () => null,
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JsonRenderer } from "./JsonRenderer";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Section = Record<string, unknown>;
const book = (id: string, title: string): Section => ({ id, type: "sectionHeading", enabled: true, props: { title } });
const row = (id: string, books: [string, string[]][], extra: Section = {}): Section => ({
  id,
  type: "columnLayout",
  enabled: true,
  props: { slots: books.map(([t], i) => [book(`${id}-${i}`, t)]), columnTags: books.map(([, tags]) => tags), ...extra },
});
const GROUPS = [
  { label: "Category", tags: ["Storybooks", "Workbooks"] },
  { label: "Age", tags: ["2+ year", "3+ year"] },
];
const page = (hostExtra: Section = {}): Section[] => [
  { id: "intro", type: "sectionHeading", enabled: true, props: { title: "Intro" } },
  row("r1", [["Story 2+", ["Storybooks", "2+ year", "English"]], ["Story 3+", ["Storybooks", "3+ year", "Math"]], ["No tags", []]], {
    showTagFilter: true,
    tagFilterStyle: "sidebar",
    tagFilterGroups: GROUPS,
    ...hostExtra,
  }),
  row("r2", [["Work 2+", ["Workbooks", "2+ year", "English"]], ["Work 3+", ["Workbooks", "3+ year", "Math"]]]),
];

let root: Root | null = null;
const mount = async (components: Section[], searchStr = "", extra: Record<string, unknown> = {}) => {
  nav.searchStr = searchStr;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      h(JsonRenderer, {
        page: { id: "books", route: "books", title: "Books", components },
        globalSettings: {},
        instituteId: "inst",
        tagName: "site",
        ...extra,
      } as never),
    );
  });
  return host;
};
const titles = (el: Element) => [...el.querySelectorAll("h2")].map((n) => n.textContent?.trim());
const aside = (host: HTMLElement) => host.querySelector("aside") as HTMLElement;
const boxes = (host: HTMLElement) =>
  [...aside(host).querySelectorAll("label")].map((l) => ({
    name: l.querySelector("span")?.textContent,
    count: l.querySelectorAll("span")[1]?.textContent,
    checked: (l.querySelector("input") as HTMLInputElement).checked,
    disabled: (l.querySelector("input") as HTMLInputElement).disabled,
  }));

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  nav.replace.mockClear();
});

describe("tag filter as one grid", () => {
  it("every tagged book of the page sits in ONE grid at the host's place", async () => {
    const host = await mount(page());
    const grids = host.querySelectorAll(".grid");
    expect(grids).toHaveLength(1);
    expect(titles(grids[0])).toEqual(["Story 2+", "Story 3+", "No tags", "Work 2+", "Work 3+"]);
    expect(titles(host)[0]).toBe("Intro");
  });

  it("sidebar: authored groups, then a “Tags” group for the rest, with live counts", async () => {
    const host = await mount(page());
    expect([...aside(host).querySelectorAll("h3")].map((n) => n.textContent)).toEqual([
      "Category",
      "Age",
      "jsonRenderer.tagFilterOtherGroup",
    ]);
    expect(boxes(host).slice(0, 4)).toEqual([
      { name: "Storybooks", count: "2", checked: false, disabled: false },
      { name: "Workbooks", count: "2", checked: false, disabled: false },
      { name: "2+ year", count: "2", checked: false, disabled: false },
      { name: "3+ year", count: "2", checked: false, disabled: false },
    ]);
  });

  it("AND across groups, OR inside one: Storybooks + 3+ year → one book, no gaps", async () => {
    const host = await mount(page(), "?tag=Storybooks,3%2B%20year");
    expect(titles(host.querySelector(".grid")!)).toEqual(["Story 3+"]);
    const both = await (async () => {
      act(() => root?.unmount());
      document.body.innerHTML = "";
      return mount(page(), "?tag=Storybooks,Workbooks,2%2B%20year");
    })();
    expect(titles(both.querySelector(".grid")!)).toEqual(["Story 2+", "Work 2+"]);
  });

  it("ticking a box writes ?tag=, Clear all removes it", async () => {
    const host = await mount(page(), "?tag=Storybooks");
    const age3 = [...aside(host).querySelectorAll("label")].find((l) => l.textContent?.includes("3+ year"))!;
    await act(async () => (age3.querySelector("input") as HTMLInputElement).click());
    expect(nav.replace).toHaveBeenLastCalledWith("/site/books?tag=Storybooks%2C3%2B+year");
    const clear = [...aside(host).querySelectorAll("button")].find((b) => b.textContent === "courseCatalog.clearAll")!;
    await act(async () => clear.click());
    expect(nav.replace).toHaveBeenLastCalledWith("/site/books");
  });

  it("no match: a message with Clear all instead of an empty grid", async () => {
    const host = await mount(page(), "?tag=Workbooks,3%2B%20year,English");
    expect(host.querySelector(".grid")).toBeNull();
    expect(host.textContent).toContain("jsonRenderer.tagFilterNoMatch");
  });

  it("chips style: same single grid, one pick at a time", async () => {
    const host = await mount(page({ tagFilterStyle: undefined }), "?tag=2%2B%20year");
    expect(host.querySelector("aside")).toBeNull();
    expect(host.querySelectorAll(".grid")).toHaveLength(1);
    expect(titles(host.querySelector(".grid")!)).toEqual(["Story 2+", "Work 2+"]);
  });

  it("builder preview: the merged layout leaves a note where it sat", async () => {
    const host = await mount(page(), "", { isPreviewMode: true });
    expect(host.textContent).toContain("jsonRenderer.tagFilterMerged");
  });

  it("tags without a filter host: layouts render in place, as before", async () => {
    const comps = page({ showTagFilter: false });
    const host = await mount(comps);
    expect(host.querySelector("aside")).toBeNull();
    expect(titles(host)).toEqual(["Intro", "Story 2+", "Story 3+", "No tags", "Work 2+", "Work 3+"]);
  });
});

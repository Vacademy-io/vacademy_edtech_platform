// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tag filter on column layouts (a Books page: one book per column). Columns
 * carry props.columnTags; a layout with showTagFilter draws the chips; the
 * picked chip lives in ?tag= and filters every tagged layout on the page.
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
const row = (id: string, titles: string[], tags: unknown, extra: Section = {}): Section => ({
  id,
  type: "columnLayout",
  enabled: true,
  props: { slots: titles.map((t, i) => [book(`${id}-${i}`, t)]), columnTags: tags, ...extra },
});

let root: Root | null = null;
const mount = async (components: Section[], searchStr = "") => {
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
      } as never),
    );
  });
  return host;
};
const titles = (host: HTMLElement) => [...host.querySelectorAll("h2, h3")].map((n) => n.textContent?.trim());
const chips = (host: HTMLElement) => [...host.querySelectorAll('[role="group"] button')] as HTMLButtonElement[];

const page = (): Section[] => [
  row("r1", ["Workbook A", "Story A", "Story B"], [["Workbooks", "2 year old"], ["Storybooks"], ["storybooks "]], {
    showTagFilter: true,
    tagFilterAllLabel: "All books",
  }),
  row("r2", ["Workbook B", "Parenting A"], [["Workbooks"], ["Parenting"]]),
  { id: "plain", type: "columnLayout", enabled: true, props: { slots: [[book("p-0", "Untagged intro")]] } },
];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  nav.replace.mockClear();
});

describe("tag filter on column layouts", () => {
  it("draws All + one chip per tag on the page, first-seen order, case-insensitive", async () => {
    const host = await mount(page());
    expect(chips(host).map((b) => b.textContent)).toEqual(["All books", "Workbooks", "2 year old", "Storybooks", "Parenting"]);
    expect(chips(host)[0].getAttribute("aria-pressed")).toBe("true");
    expect(titles(host)).toEqual(["Workbook A", "Story A", "Story B", "Workbook B", "Parenting A", "Untagged intro"]);
  });

  it("?tag= shows only matching columns on every tagged layout; untagged layouts stay", async () => {
    const host = await mount(page(), "?tag=workbooks");
    expect(titles(host)).toEqual(["Workbook A", "Workbook B", "Untagged intro"]);
    expect(chips(host).find((b) => b.getAttribute("aria-pressed") === "true")?.textContent).toBe("Workbooks");
  });

  it("a tagged layout with no match disappears, the host keeps its chips", async () => {
    const host = await mount(page(), "?tag=Parenting");
    expect(titles(host)).toEqual(["Parenting A", "Untagged intro"]);
    expect(chips(host)).toHaveLength(5);
  });

  it("an unknown ?tag= filters nothing", async () => {
    const host = await mount(page(), "?tag=nope");
    expect(titles(host)).toHaveLength(6);
  });

  it("clicking a chip writes ?tag=, All clears it", async () => {
    const host = await mount(page(), "?tag=Workbooks");
    await act(async () => chips(host)[3].click());
    expect(nav.replace).toHaveBeenLastCalledWith("/site/books?tag=Storybooks");
    await act(async () => chips(host)[0].click());
    expect(nav.replace).toHaveBeenLastCalledWith("/site/books");
  });

  it("tagOrder on the filter layout orders the chips", async () => {
    const components = page();
    (components[0].props as Section).tagOrder = ["Parenting", "Storybooks"];
    const host = await mount(components);
    expect(chips(host).map((b) => b.textContent)).toEqual(["All books", "Parenting", "Storybooks", "Workbooks", "2 year old"]);
  });

  it("no tags and no filter bar: the layout renders as before", async () => {
    const host = await mount([row("r", ["One", "Two"], undefined)], "?tag=Workbooks");
    expect(chips(host)).toHaveLength(0);
    expect(titles(host)).toEqual(["One", "Two"]);
  });
});

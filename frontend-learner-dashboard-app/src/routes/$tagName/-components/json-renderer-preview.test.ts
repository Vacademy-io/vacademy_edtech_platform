// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * JsonRenderer in the editor's Website preview (?preview=true): a block
 * inside a column or tab is picked on its own, a block switched off in the
 * editor shows as a strip (only in preview), Browse mode makes the page
 * clickable (the header's mega menu can open) without selecting, and the
 * header is told which page the preview really shows.
 */

const captured = vi.hoisted(() => ({ header: null as Record<string, unknown> | null }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/site" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site", searchStr: "", search: {}, hash: "" };
    return opts?.select ? opts.select(location) : location;
  },
  Link: () => null,
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options === "object" && "label" in options ? `${key}:${options.label}` : key,
    i18n: undefined,
  }),
}));
vi.mock("./components/HeaderComponent", async () => {
  const { createElement } = await import("react");
  return {
    HeaderComponent: (props: Record<string, unknown>) => {
      captured.header = props;
      return createElement("button", { type: "button", "data-testid": "mega-menu" }, "Knowledge Streams");
    },
  };
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Section = Record<string, unknown>;
const heading = (id: string, title: string, extra: Section = {}): Section => ({
  id,
  type: "sectionHeading",
  enabled: true,
  props: { title },
  ...extra,
});
const columns: Section = {
  id: "cols",
  type: "columnLayout",
  enabled: true,
  props: { slots: [[heading("inner", "Inside a column")], [heading("off", "Switched off", { enabled: false })]] },
};
const tabs: Section = {
  id: "tabs",
  type: "tabsAccordion",
  enabled: true,
  props: { mode: "tabs", items: [{ title: "First", slot: [heading("tab-child", "Inside a tab")] }] },
};
const header: Section = { id: "site-header", type: "header", enabled: true, props: { navigation: [] } };

const rendererProps = (components: Section[], extra: Record<string, unknown> = {}) =>
  ({
    page: { id: "courses", route: "courses", title: "Courses", components },
    globalSettings: {},
    instituteId: "inst",
    tagName: "site",
    ...extra,
  }) as never;

let root: Root | null = null;
const mount = async (components: Section[], extra: Record<string, unknown> = {}) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(h(JsonRenderer, rendererProps(components, extra)));
  });
  return host;
};
const block = (host: HTMLElement, id: string) => host.querySelector(`[data-cid="${id}"]`) as HTMLElement;
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  captured.header = null;
});

describe("picking blocks in Select mode", () => {
  it("a click on a block inside a column posts that block with its column layout", async () => {
    const onComponentClick = vi.fn();
    const host = await mount([columns], { isPreviewMode: true, onComponentClick });
    click(block(host, "inner").querySelector("h2, h3, p, div")!);
    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith("inner", "courses", "cols");
  });

  it("a click on the section around it still picks the section", async () => {
    const onComponentClick = vi.fn();
    const host = await mount([columns], { isPreviewMode: true, onComponentClick });
    click(block(host, "cols"));
    expect(onComponentClick).toHaveBeenCalledWith("cols", "courses");
  });

  it("a block inside a tab names the tabs block as its parent", async () => {
    const onComponentClick = vi.fn();
    const host = await mount([tabs], { isPreviewMode: true, onComponentClick });
    click(block(host, "tab-child"));
    expect(onComponentClick).toHaveBeenCalledWith("tab-child", "courses", "tabs");
  });

  it("nested blocks opt back into clicks inside the click-through section", async () => {
    const host = await mount([columns], { isPreviewMode: true, selectedComponentId: "inner" });
    const frame = block(host, "inner");
    expect(frame.className).toContain("pointer-events-auto");
    expect(frame.className).toContain("outline-blue-500");
    expect((frame.firstElementChild as HTMLElement).className).toContain("pointer-events-none");
  });

  it("a sticky rail in a column still sticks: the frame takes its place", async () => {
    const rail = heading("rail", "Enroll", { style: { sticky: { enabled: true, top: 120 } } });
    const host = await mount(
      [{ id: "cols2", type: "columnLayout", enabled: true, props: { slots: [[heading("body", "Body")], [rail]] } }],
      { isPreviewMode: true },
    );
    expect(block(host, "rail").style.position).toBe("sticky");
    expect(block(host, "rail").style.top).toBe("120px");
    expect(block(host, "body").style.position).toBe("");
  });

  it("outside the preview a nested block renders exactly as before", () => {
    const html = renderToString(h(JsonRenderer, rendererProps([columns])));
    expect(html).not.toContain('data-cid="inner"');
    expect(html).toContain("Inside a column");
  });
});

describe("blocks switched off in the editor", () => {
  it("show as a strip in the preview, top level and nested, and can be picked", async () => {
    const onComponentClick = vi.fn();
    const host = await mount([heading("hero-off", "Gone", { enabled: false, type: "heroSection" }), columns], {
      isPreviewMode: true,
      onComponentClick,
    });
    expect(block(host, "hero-off").textContent).toBe("jsonRenderer.hiddenBlock:Hero section");
    expect(block(host, "off").textContent).toBe("jsonRenderer.hiddenBlock:Section heading");
    expect(host.textContent).not.toContain("Switched off");
    click(block(host, "off"));
    expect(onComponentClick).toHaveBeenCalledWith("off", "courses", "cols");
  });

  it("the headless AI preview (previewChrome off) shoots the page as visitors see it", async () => {
    const host = await mount([heading("hero-off", "Gone", { enabled: false, type: "heroSection" }), columns], {
      isPreviewMode: true,
      previewChrome: false,
    });
    expect(host.textContent).not.toContain("jsonRenderer.hiddenBlock");
    expect(block(host, "hero-off")).toBeNull();
    expect(block(host, "off")).toBeNull();
    // No per-block frames inside columns; the section itself can still be found.
    expect(block(host, "inner")).toBeNull();
    expect(block(host, "cols")).not.toBeNull();
    expect(host.textContent).toContain("Inside a column");
  });

  it("render nothing for visitors", () => {
    const html = renderToString(
      h(JsonRenderer, rendererProps([heading("hero-off", "Gone", { enabled: false }), columns])),
    );
    expect(html).not.toContain("jsonRenderer.hiddenBlock");
    expect(html).not.toContain("Switched off");
  });
});

describe("Browse mode", () => {
  it("leaves the page clickable, so the header's mega menu can open, and selects nothing", async () => {
    const onComponentClick = vi.fn();
    const host = await mount([header, columns], { isPreviewMode: true, previewInteractive: true, onComponentClick });
    const section = block(host, "site-header");
    const content = section.querySelector(":scope > div") as HTMLElement;
    expect(content.style.pointerEvents).toBe("");
    expect(section.style.cursor).toBe("");
    expect(block(host, "inner").className).not.toContain("pointer-events");
    click(host.querySelector('[data-testid="mega-menu"]')!);
    click(block(host, "inner"));
    expect(onComponentClick).not.toHaveBeenCalled();
  });

  it("Select mode keeps the section content click-through", async () => {
    const host = await mount([header], { isPreviewMode: true });
    const content = block(host, "site-header").querySelector(":scope > div") as HTMLElement;
    expect(content.style.pointerEvents).toBe("none");
  });

  it("keeps the same markup when switching modes, so open menus and tabs keep their state", async () => {
    const select = renderToString(h(JsonRenderer, rendererProps([tabs], { isPreviewMode: true })));
    const browse = renderToString(
      h(JsonRenderer, rendererProps([tabs], { isPreviewMode: true, previewInteractive: true })),
    );
    const tags = (html: string) => html.match(/<\/?[a-z0-9]+/g);
    expect(tags(browse)).toEqual(tags(select));
  });
});

describe("the header in the preview", () => {
  it("is told the real route of the page shown at the root", async () => {
    await mount([header], { isPreviewMode: true, previewPath: "learning-paths" });
    expect(captured.header?.previewPath).toBe("learning-paths");
  });

  it("gets no preview route on the live site", async () => {
    await mount([header]);
    expect(captured.header?.previewPath).toBeUndefined();
  });
});

describe("Background Color from the style panel", () => {
  const sectionOf = (host: HTMLElement) => host.querySelector("section") as HTMLElement;
  const styled = (style: Record<string, unknown>, props: Section = { title: "Support" }) =>
    heading("bg", "Support", { props, style });

  it("paints the block's own section, which would otherwise cover it", async () => {
    const host = await mount([styled({ backgroundColor: "#fdf6ee" })], { isPreviewMode: true });
    expect(sectionOf(host).style.backgroundColor).toBe("rgb(253, 246, 238)");
  });

  it("does the same on the live site", async () => {
    const host = await mount([styled({ backgroundColor: "#fdf6ee" })]);
    expect(sectionOf(host).style.backgroundColor).toBe("rgb(253, 246, 238)");
  });

  it("switches the heading to light text on a dark colour", async () => {
    const host = await mount([styled({ backgroundColor: "#112233" })]);
    expect(host.querySelector("h2")!.className).toContain("text-white");
  });

  it("leaves a colour set on the block itself alone", async () => {
    const host = await mount([styled({ backgroundColor: "#fdf6ee" }, { title: "Support", backgroundColor: "#112233" })]);
    expect(sectionOf(host).style.backgroundColor).toBe("rgb(17, 34, 51)");
  });

  it("keeps today's rendering when the style also paints an image or gradient", async () => {
    const host = await mount([styled({ backgroundColor: "#fdf6ee", backgroundImage: "https://x/y.png" })]);
    expect(sectionOf(host).style.backgroundColor).toBe("");
  });

  it("keeps today's rendering for a colour that is not #rrggbb", async () => {
    const host = await mount([styled({ backgroundColor: "rgba(0, 0, 0, 0.5)" })]);
    expect(sectionOf(host).style.backgroundColor).toBe("");
    expect(host.querySelector("h2")!.className).toContain("text-catalogue-text-primary");
  });
});

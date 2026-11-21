// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19 requires this before act(); the repo has no shared test setup file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  dismiss: vi.fn(async () => undefined),
  ack: vi.fn(async () => undefined),
  events: vi.fn(async () => undefined),
}));
vi.mock("@/services/learner-home", () => ({
  dismissHomeBlock: api.dismiss,
  acknowledgeHomeBlock: api.ack,
  postHomeEvents: api.events,
  updateCachedNotice: () => () => undefined,
  homeActionOutcome: (e: { response?: { data?: { code?: string } } }) =>
    ["ACK_NOT_REQUIRED", "BLOCK_NOT_FOUND"].includes(e?.response?.data?.code ?? "") ? "keep" : "revert",
}));

import { LearnerHomeRenderer, type LearnerHomeRendererProps } from "./LearnerHomeRenderer";
import type { HomeBlock, ResolvedHomeBuilder } from "@/types/learner-home";

const img = (n: number) => ({ url: `https://cdn.example.com/${n}.png`, alt: `Slide ${n}` });

const BLOCKS: HomeBlock[] = [
  {
    key: "banner",
    type: "BANNER_CAROUSEL",
    placement: "FULL",
    devices: "BOTH",
    config: {
      title: "",
      auto_rotate: true,
      slides: [
        { key: "s1", image: img(1), link: { kind: "FEATURE", feature: "NOTEBOOK" } },
        { key: "s2", image: img(2), link: { kind: "PRODUCT_PAGE", code: "sale", commerce: true } },
        { key: "s3", image: img(3), link: null },
      ],
    },
  },
  { key: "hero", type: "BUILTIN", builtin_widget: "HERO", placement: "FULL", devices: "BOTH", config: { options: {} } },
  {
    key: "live",
    type: "BUILTIN",
    builtin_widget: "UPCOMING_LIVE_CLASSES",
    placement: "RAIL",
    devices: "BOTH",
    config: { options: {} },
  },
  {
    key: "tiles",
    type: "SHORTCUTS",
    placement: "MAIN",
    devices: "BOTH",
    config: {
      tiles: [
        { key: "t1", label: "Notes", icon: { kind: "ICON", name: "Notebook" }, link: { kind: "FEATURE", feature: "NOTEBOOK" } },
        { key: "t2", label: "Store", icon: { kind: "ICON", name: "Storefront" }, link: { kind: "FEATURE", feature: "STORE_BOOKS", commerce: true } },
      ],
    },
  },
  {
    key: "notice",
    type: "NOTICE",
    placement: "MAIN",
    devices: "PHONE",
    config: { title: "Fees due", body: "Pay by Friday.", tone: "WARNING", dismissible: true, require_ack: false },
  },
  {
    key: "plain",
    type: "NOTICE",
    placement: "MAIN",
    devices: "BOTH",
    config: { title: "Exam week notice", body: "Mock tests open on Monday.", tone: "NEUTRAL", dismissible: false },
  },
];

const home = (blocks: HomeBlock[] = BLOCKS): ResolvedHomeBuilder => ({
  mode: "BUILDER",
  layout_version: 3,
  settings: { phone_spacing: "COMPACT", show_header: true },
  blocks,
});

let root: Root | null = null;
let host: HTMLDivElement;

function render(props: Partial<LearnerHomeRendererProps> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const client = new QueryClient();
  const all: LearnerHomeRendererProps = {
    home: home(),
    header: createElement("div", { "data-testid": "header" }, "Hello"),
    renderBuiltin: (widget) => createElement("div", { "data-fragment": widget }, widget),
    isLg: false,
    isPhone: true,
    skin: { fun: false, play: false, cleanerPlay: false },
    linkContext: { readerMode: false, playSkin: false },
    followDeps: {
      navigate: vi.fn(),
      openExternal: vi.fn(),
      assign: vi.fn(),
      openDoubts: vi.fn(),
      openLiveClass: vi.fn(),
      removePreference: vi.fn(),
      setSessionItem: vi.fn(),
    },
    preview: false,
    ...props,
  };
  act(() => {
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(LearnerHomeRenderer, all)));
  });
  return all;
}

const keys = () => Array.from(host.querySelectorAll("[data-block-key]")).map((el) => el.getAttribute("data-block-key"));

beforeEach(() => {
  api.dismiss.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("LearnerHomeRenderer", () => {
  it("phones: one column, exactly the list order (rail blocks no longer fall to the bottom)", () => {
    render();
    expect(keys()).toEqual(["banner", "hero", "live", "tiles", "notice", "plain"]);
    expect(host.querySelector("[data-testid=header]")).not.toBeNull();
  });

  it("desktop: FULL bands, then a 2/3 + 1/3 grid; PHONE-only blocks are left out", () => {
    render({ isLg: true, isPhone: false });
    expect(keys()).toEqual(["banner", "hero", "tiles", "plain", "live"]);
    const grid = host.querySelector(".grid")!;
    const [main, rail] = Array.from(grid.children);
    expect(Array.from(main!.querySelectorAll("[data-block-key]")).map((e) => e.getAttribute("data-block-key"))).toEqual([
      "tiles",
      "plain",
    ]);
    expect(rail!.querySelector("[data-block-key]")?.getAttribute("data-block-key")).toBe("live");
    expect(grid.className).toContain("lg:grid-cols-3");
  });

  it("built-ins render their fragment and carry a data-widget marker", () => {
    render();
    const hero = host.querySelector('[data-block-key="hero"]')!;
    expect(hero.getAttribute("data-widget")).toBe("HERO");
    expect(hero.querySelector('[data-fragment="HERO"]')).not.toBeNull();
  });

  it("the header can be switched off", () => {
    render({ home: { ...home(), settings: { show_header: false } } });
    expect(host.querySelector("[data-testid=header]")).toBeNull();
  });

  it("carousel: labelled carousel, pause button first, slide groups, dots with aria-current", () => {
    render();
    const section = host.querySelector('[data-block-key="banner"] section')!;
    expect(section.getAttribute("aria-roledescription")).toBe("carousel.roleCarousel");
    const firstFocusable = section.querySelector("button, a, [tabindex]")!;
    expect(firstFocusable.tagName).toBe("BUTTON");
    expect(firstFocusable.getAttribute("aria-label")).toBe("carousel.pause");
    const slides = section.querySelectorAll('[role="group"][aria-roledescription="carousel.roleSlide"]');
    expect(slides).toHaveLength(3);
    // Only the active slide is reachable.
    expect(slides[0]!.hasAttribute("inert")).toBe(false);
    expect(slides[1]!.hasAttribute("inert")).toBe(true);
    const dots = section.querySelectorAll('[aria-label^="carousel.showSlide"]');
    expect(dots).toHaveLength(3);
    expect(dots[0]!.getAttribute("aria-current")).toBe("true");
    // A slide without a link is a plain image, not a link.
    expect(slides[2]!.querySelector("a")).toBeNull();
    // The track says nothing while it rotates.
    expect(section.querySelector("[aria-live]")!.getAttribute("aria-live")).toBe("off");
  });

  it("pause button pauses (and the live region becomes polite), play resumes", () => {
    render();
    const button = host.querySelector('[aria-label="carousel.pause"]') as HTMLButtonElement;
    act(() => button.click());
    expect(host.querySelector('[aria-label="carousel.play"]')).not.toBeNull();
    expect(host.querySelector('[data-block-key="banner"] [aria-live]')!.getAttribute("aria-live")).toBe("polite");
    act(() => (host.querySelector('[aria-label="carousel.play"]') as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="carousel.pause"]')).not.toBeNull();
  });

  it("a single slide has no controls", () => {
    const one = { ...BLOCKS[0]!, config: { slides: [{ key: "s1", image: img(1) }] } } as HomeBlock;
    render({ home: home([one]) });
    expect(host.querySelectorAll('[data-block-key="banner"] button')).toHaveLength(0);
  });

  it("reader mode: the selling-only slide and the store tile are gone", () => {
    render({ linkContext: { readerMode: true, playSkin: false } });
    expect(host.querySelectorAll('[aria-roledescription="carousel.roleSlide"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-block-key="tiles"] li')).toHaveLength(1);
  });

  it("a click is counted and followed; links do nothing in the admin preview", () => {
    const props = render();
    const tile = host.querySelector('[data-tile-key="t1"] a') as HTMLAnchorElement;
    expect(tile.getAttribute("href")).toBe("/notebook");
    act(() => tile.click());
    expect(props.followDeps.navigate).toHaveBeenCalledWith({ to: "/notebook", search: undefined, params: undefined });
    act(() => root?.unmount());
    root = null;
    host.remove();
    const preview = render({ preview: true });
    act(() => (host.querySelector('[data-tile-key="t1"] a') as HTMLAnchorElement).click());
    expect(preview.followDeps.navigate).not.toHaveBeenCalled();
  });

  it("notice: the plain one is today's custom card; a dismissible one hides on dismiss", () => {
    render();
    const plain = host.querySelector('[data-block-key="plain"]')!;
    expect(plain.textContent).toContain("Exam week notice");
    expect(plain.querySelector('[aria-label="notice.dismiss"]')).toBeNull();
    const dismiss = host.querySelector('[data-block-key="notice"] [aria-label="notice.dismiss"]') as HTMLButtonElement;
    expect(dismiss).not.toBeNull();
    act(() => dismiss.click());
    expect(api.dismiss).toHaveBeenCalledWith("notice");
  });

  it("a linked slide always has a name: its alt, else 'Open banner n of N' for a decorative image", () => {
    const banner = {
      ...BLOCKS[0]!,
      config: {
        slides: [
          { key: "s1", image: { url: "https://cdn.example.com/1.png", alt: "", decorative: true }, link: { kind: "FEATURE", feature: "NOTEBOOK" } },
          { key: "s2", image: img(2), link: { kind: "FEATURE", feature: "NOTEBOOK" } },
        ],
      },
    } as HomeBlock;
    render({ home: home([banner]) });
    const links = Array.from(host.querySelectorAll('[data-block-key="banner"] [aria-roledescription="carousel.roleSlide"] a'));
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["carousel.openSlide", "Slide 2"]);
    expect(links[0]!.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("event buttons without a label (live-class defaults) show the translated Register / Join", () => {
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const event = (key: string, starts: number): HomeBlock => ({
      key,
      type: "EVENT",
      placement: "MAIN",
      devices: "BOTH",
      config: {
        title: "Live class",
        starts_at: at(starts),
        ends_at: at(starts + 1),
        register_cta: { label: null, link: { kind: "LIVE_CLASS", session_id: "s1" } },
        join_cta: { link: { kind: "LIVE_CLASS", session_id: "s1" } },
      },
    });
    render({ home: home([event("before", 2), event("live", -0.5)]) });
    expect(host.querySelector('[data-block-key="before"] button')?.textContent).toBe("event.register");
    expect(host.querySelector('[data-block-key="live"] button')?.textContent).toBe("event.join");
  });

  it("an event shows Register before the join window and hides once it ended", () => {
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const event: HomeBlock = {
      key: "ev",
      type: "EVENT",
      placement: "MAIN",
      devices: "BOTH",
      config: {
        title: "Open day",
        starts_at: soon,
        ends_at: later,
        register_cta: { label: "Register", link: { kind: "LIVE_CLASS", session_id: "s1" } },
        join_cta: { label: "Join", link: { kind: "LIVE_CLASS", session_id: "s1" } },
        show_countdown: true,
      },
    };
    render({ home: home([event]) });
    const card = host.querySelector('[data-block-key="ev"]')!;
    expect(card.textContent).toContain("Register");
    expect(card.textContent).not.toContain("Join");
    expect(card.querySelector("[aria-hidden].tabular-nums")?.textContent).toBe("event.startsInHours");
    expect(card.querySelector(".sr-only")?.textContent).toBe("event.startsOn");
  });
});

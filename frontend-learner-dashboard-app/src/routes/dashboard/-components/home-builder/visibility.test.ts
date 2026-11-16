// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { HomeBlock } from "@/types/learner-home";
import {
  builtinForLegacyWidget,
  builtinsOnScreen,
  deviceAllows,
  funKeepsBuiltin,
  hasEnded,
  prepareBlocks,
  type PrepareContext,
} from "./visibility";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const PAST = "2026-11-16T09:59:00Z";
const FUTURE = "2026-11-16T10:01:00Z";
const ctx = (over: Partial<PrepareContext> = {}): PrepareContext => ({
  readerMode: false,
  playSkin: false,
  isPhone: true,
  nowMs: NOW,
  funSkin: false,
  ...over,
});
const img = { url: "https://cdn.example.com/a.webp", alt: "A" };
const builtin = (key: string, widget: string, devices: HomeBlock["devices"] = "BOTH"): HomeBlock =>
  ({ key, type: "BUILTIN", builtin_widget: widget, placement: "MAIN", devices, config: { options: {} } }) as HomeBlock;

describe("device filter", () => {
  it("BOTH everywhere, PHONE below 768, DESKTOP from 768", () => {
    expect(deviceAllows("BOTH", true)).toBe(true);
    expect(deviceAllows("PHONE", true)).toBe(true);
    expect(deviceAllows("PHONE", false)).toBe(false);
    expect(deviceAllows("DESKTOP", false)).toBe(true);
    expect(deviceAllows("DESKTOP", true)).toBe(false);
    const blocks = [builtin("a", "HERO", "PHONE"), builtin("b", "PINS", "DESKTOP")];
    expect(prepareBlocks(blocks, ctx({ isPhone: true })).map((b) => b.key)).toEqual(["a"]);
    expect(prepareBlocks(blocks, ctx({ isPhone: false })).map((b) => b.key)).toEqual(["b"]);
  });
});

describe("expiry tick", () => {
  it("hides a block whose window ended, and an event that ended", () => {
    expect(hasEnded(PAST, NOW)).toBe(true);
    expect(hasEnded(FUTURE, NOW)).toBe(false);
    expect(hasEnded(null, NOW)).toBe(false);
    const ended = { ...builtin("a", "PINS"), ends_at: PAST } as HomeBlock;
    const event: HomeBlock = {
      key: "e",
      type: "EVENT",
      placement: "MAIN",
      devices: "BOTH",
      config: { title: "Webinar", starts_at: "2026-11-16T09:00:00Z", ends_at: PAST },
    };
    expect(prepareBlocks([ended, event], ctx())).toEqual([]);
  });

  it("drops ended slides and keeps at most 5", () => {
    const slides = Array.from({ length: 7 }, (_, i) => ({ key: `s${i}`, image: img, ends_at: i === 0 ? PAST : null }));
    const [banner] = prepareBlocks(
      [{ key: "b", type: "BANNER_CAROUSEL", placement: "FULL", devices: "BOTH", config: { slides } }],
      ctx()
    );
    if (banner?.type !== "BANNER_CAROUSEL") throw new Error("banner expected");
    expect(banner.config.slides.map((s) => s.key)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });
});

describe("reader mode", () => {
  it("removes selling-only slides, unlinks commerce links on the rest", () => {
    const blocks: HomeBlock[] = [
      {
        key: "b",
        type: "BANNER_CAROUSEL",
        placement: "FULL",
        devices: "BOTH",
        config: {
          slides: [
            { key: "sell", image: img, link: { kind: "PRODUCT_PAGE", code: "x", commerce: true } },
            { key: "ext", image: img, link: { kind: "URL", url: "https://pay.example.com", sells_something: true, commerce: true } },
            { key: "ok", image: img, link: { kind: "FEATURE", feature: "NOTEBOOK" } },
          ],
        },
      },
    ];
    const [banner] = prepareBlocks(blocks, ctx({ readerMode: true }));
    if (banner?.type !== "BANNER_CAROUSEL") throw new Error("banner expected");
    expect(banner.config.slides.map((s) => [s.key, s.link?.kind ?? null])).toEqual([
      ["ext", null],
      ["ok", "FEATURE"],
    ]);
  });

  it("a shelf keeps only owned courses and loses its commerce 'see all'; an all-unowned shelf disappears", () => {
    const shelf = (courses: Array<{ id: string; owned: boolean }>): HomeBlock => ({
      key: "sh",
      type: "COURSE_SHELF",
      placement: "MAIN",
      devices: "BOTH",
      config: {
        title: "New",
        see_all: { kind: "COURSE_LIST", tag: null },
        courses: courses.map((c) => ({
          package_id: c.id,
          name: c.id,
          owned: c.owned,
          link: { kind: "COURSE", package_id: c.id, owned: c.owned, commerce: !c.owned },
        })),
      },
    });
    const [kept] = prepareBlocks([shelf([{ id: "a", owned: true }, { id: "b", owned: false }])], ctx({ readerMode: true }));
    if (kept?.type !== "COURSE_SHELF") throw new Error("shelf expected");
    expect(kept.config.courses.map((c) => c.package_id)).toEqual(["a"]);
    expect(prepareBlocks([shelf([{ id: "b", owned: false }])], ctx({ readerMode: true }))).toEqual([]);
    expect(prepareBlocks([shelf([{ id: "b", owned: false }])], ctx())).toHaveLength(1);
  });

  it("tiles and buttons with commerce links are removed; a shortcuts block with none left disappears", () => {
    const shortcuts: HomeBlock = {
      key: "t",
      type: "SHORTCUTS",
      placement: "MAIN",
      devices: "BOTH",
      config: {
        tiles: [
          { key: "store", label: "Store", icon: { kind: "ICON", name: "Storefront" }, link: { kind: "FEATURE", feature: "STORE_BOOKS", commerce: true } },
        ],
      },
    };
    expect(prepareBlocks([shortcuts], ctx({ readerMode: true }))).toEqual([]);
    const notice: HomeBlock = {
      key: "n",
      type: "NOTICE",
      placement: "MAIN",
      devices: "BOTH",
      config: { title: "Sale", button: { label: "Buy", link: { kind: "PRODUCT_PAGE", code: "x", commerce: true } } },
    };
    const [n] = prepareBlocks([notice], ctx({ readerMode: true }));
    if (n?.type !== "NOTICE") throw new Error("notice expected");
    expect(n.config.button).toBeNull();
  });
});

describe("features, notices, Fun leave-outs", () => {
  it("a tile to a feature the learner lacks is removed", () => {
    const shortcuts: HomeBlock = {
      key: "t",
      type: "SHORTCUTS",
      placement: "MAIN",
      devices: "BOTH",
      config: {
        tiles: [
          { key: "hw", label: "Homework", icon: { kind: "ICON", name: "Notebook" }, link: { kind: "FEATURE", feature: "HOMEWORK" } },
          { key: "nb", label: "Notes", icon: { kind: "ICON", name: "Notebook" }, link: { kind: "FEATURE", feature: "NOTEBOOK" } },
        ],
      },
    };
    const [t] = prepareBlocks([shortcuts], ctx({ features: { HOMEWORK: false } }));
    if (t?.type !== "SHORTCUTS") throw new Error("shortcuts expected");
    expect(t.config.tiles.map((x) => x.key)).toEqual(["nb"]);
  });

  it("keeps a CTA whose label is null (the block shows its default label)", () => {
    const notice: HomeBlock = {
      key: "n",
      type: "NOTICE",
      placement: "MAIN",
      devices: "BOTH",
      config: { title: "Hi", button: { label: null, link: { kind: "FEATURE", feature: "NOTEBOOK" } } },
    };
    const [n] = prepareBlocks([notice], ctx());
    if (n?.type !== "NOTICE") throw new Error("notice expected");
    expect(n.config.button).not.toBeNull();
  });

    it("a dismissed notice is gone", () => {
    const notice: HomeBlock = {
      key: "n",
      type: "NOTICE",
      placement: "MAIN",
      devices: "BOTH",
      config: { title: "Hi", state: { dismissed: true } },
    };
    expect(prepareBlocks([notice], ctx())).toEqual([]);
  });

  it("the Fun skin leaves out the same widgets as its classic home", () => {
    expect(funKeepsBuiltin("STATS_ROW")).toBe(false);
    expect(funKeepsBuiltin("MY_MENTORS")).toBe(false);
    expect(funKeepsBuiltin("HERO")).toBe(true);
    expect(funKeepsBuiltin("EXPLORE_BUTTONS")).toBe(true);
    const blocks = [builtin("h", "HERO"), builtin("s", "STATS_ROW"), builtin("e", "ENROLLED_COURSES")];
    expect(prepareBlocks(blocks, ctx({ funSkin: true })).map((b) => b.key)).toEqual(["h", "e"]);
    expect(prepareBlocks(blocks, ctx()).map((b) => b.key)).toEqual(["h", "s", "e"]);
  });

  it("a built-in appears once, unknown block types are skipped", () => {
    const blocks = [builtin("a", "HERO"), builtin("b", "HERO"), { key: "x", type: "MARQUEE" } as unknown as HomeBlock];
    expect(prepareBlocks(blocks, ctx()).map((b) => b.key)).toEqual(["a"]);
    expect([...builtinsOnScreen(prepareBlocks(blocks, ctx())).keys()]).toEqual(["HERO"]);
  });

  it("maps the classic widget switches to their built-in", () => {
    expect(builtinForLegacyWidget("coursesStat")).toBe("STATS_ROW");
    expect(builtinForLegacyWidget("evaluationStat")).toBe("STATS_ROW");
    expect(builtinForLegacyWidget("exploreBooks")).toBe("EXPLORE_BUTTONS");
    expect(builtinForLegacyWidget("gettingStarted")).toBe("HERO");
    expect(builtinForLegacyWidget("custom:abc")).toBeNull();
  });
});

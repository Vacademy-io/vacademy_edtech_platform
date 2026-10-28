import { describe, expect, it } from "vitest";
import {
  arrangeBottomBar,
  deviceForWidth,
  isExternalNavRoute,
  normalizeNavRoute,
  resolveStudentLayout,
} from "./student-layout";

describe("deviceForWidth", () => {
  it("splits at the md and lg breakpoints", () => {
    expect(deviceForWidth(390)).toBe("mobile");
    expect(deviceForWidth(767)).toBe("mobile");
    expect(deviceForWidth(768)).toBe("tablet");
    expect(deviceForWidth(1023)).toBe("tablet");
    expect(deviceForWidth(1024)).toBe("desktop");
  });
});

describe("resolveStudentLayout — unconfigured keeps today's behaviour", () => {
  it("play skin: bottom bar on phones only, sidebar kept", () => {
    const m = resolveStudentLayout(undefined, { device: "mobile", playSkin: true });
    expect(m.showBottomBar).toBe(true);
    expect(m.hideSidebar).toBe(false);
    const d = resolveStudentLayout(null, { device: "desktop", playSkin: true });
    expect(d.showBottomBar).toBe(false);
    const t = resolveStudentLayout({}, { device: "tablet", playSkin: true });
    expect(t.showBottomBar).toBe(false);
  });

  it("other skins: never a bottom bar", () => {
    const m = resolveStudentLayout(undefined, { device: "mobile", playSkin: false });
    expect(m.showBottomBar).toBe(false);
    expect(m.hideSidebar).toBe(false);
  });

  it("every header item shown, sidebar-mirroring bar, no wallpaper", () => {
    const r = resolveStudentLayout(undefined, { device: "mobile", playSkin: true });
    expect(Object.values(r.header).every(Boolean)).toBe(true);
    expect(r.bottomBar).toEqual({ items: null, maxVisible: 4, showLabels: true, style: "classic" });
    expect(r.wallpaper).toBeNull();
  });
});

describe("resolveStudentLayout — configured", () => {
  it("per-device placement", () => {
    const layout = {
      navigation: { mobile: "bottomBar", tablet: "both", desktop: "sidebar" },
    } as const;
    const m = resolveStudentLayout(layout, { device: "mobile", playSkin: false });
    expect([m.showBottomBar, m.hideSidebar]).toEqual([true, true]);
    const t = resolveStudentLayout(layout, { device: "tablet", playSkin: false });
    expect([t.showBottomBar, t.hideSidebar]).toEqual([true, false]);
    const d = resolveStudentLayout(layout, { device: "desktop", playSkin: true });
    expect([d.showBottomBar, d.hideSidebar]).toEqual([false, false]);
  });

  it("sidebar placement removes the play bottom bar on phones", () => {
    const r = resolveStudentLayout(
      { navigation: { mobile: "sidebar" } },
      { device: "mobile", playSkin: true }
    );
    expect(r.showBottomBar).toBe(false);
  });

  it("unknown placement falls back to auto", () => {
    const r = resolveStudentLayout(
      { navigation: { mobile: "floating" as never } },
      { device: "mobile", playSkin: true }
    );
    expect(r.placement).toBe("auto");
    expect(r.showBottomBar).toBe(true);
  });

  it("header switches", () => {
    const r = resolveStudentLayout(
      { header: { showAchievements: false, showHelp: false } },
      { device: "desktop", playSkin: false }
    );
    expect(r.header.showAchievements).toBe(false);
    expect(r.header.showHelp).toBe(false);
    expect(r.header.showNotifications).toBe(true);
  });

  it("back and home switch separately; the legacy combined switch fills in", () => {
    const opts = { device: "mobile", playSkin: true } as const;
    const own = resolveStudentLayout({ header: { showHome: false } }, opts);
    expect(own.header.showBack).toBe(true);
    expect(own.header.showHome).toBe(false);

    const legacy = resolveStudentLayout({ header: { showBackHome: false } }, opts);
    expect(legacy.header.showBack).toBe(false);
    expect(legacy.header.showHome).toBe(false);

    const mixed = resolveStudentLayout(
      { header: { showBackHome: false, showBack: true } },
      opts
    );
    expect(mixed.header.showBack).toBe(true);
    expect(mixed.header.showHome).toBe(false);
  });

  it("bottom bar items: visible only, sorted, blank routes dropped; maxVisible clamped", () => {
    const r = resolveStudentLayout(
      {
        bottomBar: {
          maxVisible: 9,
          showLabels: false,
          items: [
            { id: "b", route: "/b", order: 2, visible: true },
            { id: "a", route: "/a", order: 1, visible: true },
            { id: "hidden", route: "/h", order: 0, visible: false },
            { id: "blank", route: "  ", order: 3, visible: true },
          ],
        },
      },
      { device: "mobile", playSkin: false }
    );
    expect(r.bottomBar.items?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(r.bottomBar.maxVisible).toBe(4);
    expect(r.bottomBar.showLabels).toBe(false);
  });

  it("wallpaper: needs enabled + image; phone image on phones; overlay sanitised", () => {
    const wallpaper = {
      enabled: true,
      imageUrl: "https://cdn/x.jpg",
      mobileImageUrl: "https://cdn/m.jpg",
      overlayColor: "#000000",
      overlayOpacity: 150,
      scope: "dashboard" as const,
    };
    const m = resolveStudentLayout({ wallpaper }, { device: "mobile", playSkin: false });
    expect(m.wallpaper).toEqual({
      imageUrl: "https://cdn/m.jpg",
      overlayColor: "#000000",
      overlayOpacity: 0.9,
      dashboardOnly: true,
    });
    const d = resolveStudentLayout(
      { wallpaper: { ...wallpaper, overlayColor: "red" } },
      { device: "desktop", playSkin: false }
    );
    expect(d.wallpaper?.imageUrl).toBe("https://cdn/x.jpg");
    // invalid colour + a strength set = the colour input's default (black)
    expect(d.wallpaper?.overlayColor).toBe("#000000");
    const none = resolveStudentLayout(
      { wallpaper: { enabled: true, imageUrl: "https://cdn/x.jpg" } },
      { device: "desktop", playSkin: false }
    );
    expect(none.wallpaper?.overlayColor).toBeNull();
    expect(
      resolveStudentLayout(
        { wallpaper: { ...wallpaper, enabled: false } },
        { device: "desktop", playSkin: false }
      ).wallpaper
    ).toBeNull();
  });

  it("external routes", () => {
    expect(isExternalNavRoute("https://x.com")).toBe(true);
    expect(isExternalNavRoute("/dashboard")).toBe(false);
  });
});

describe("bottom bar style + center button", () => {
  it("style defaults to classic, accepts floating only", () => {
    const f = resolveStudentLayout({ bottomBar: { style: "floating" } }, { device: "mobile", playSkin: false });
    expect(f.bottomBar.style).toBe("floating");
    const x = resolveStudentLayout({ bottomBar: { style: "weird" as never } }, { device: "mobile", playSkin: false });
    expect(x.bottomBar.style).toBe("classic");
  });

  it("keeps only the first highlighted tab", () => {
    const r = resolveStudentLayout(
      {
        bottomBar: {
          items: [
            { id: "a", route: "/a", order: 1, visible: true, highlight: true },
            { id: "b", route: "/b", order: 2, visible: true, highlight: true },
          ],
        },
      },
      { device: "mobile", playSkin: false }
    );
    expect(r.bottomBar.items?.map((i) => !!i.highlight)).toEqual([true, false]);
  });

  it("puts the center button in the middle and counts it toward maxVisible", () => {
    const items = ["home", "courses", "live", "tests", "profile", "extra"].map((id) => ({
      id,
      highlight: id === "live",
    }));
    const { visible, overflow } = arrangeBottomBar(items, 5);
    expect(visible.map((i) => i.id)).toEqual(["home", "courses", "live", "tests", "profile"]);
    expect(overflow.map((i) => i.id)).toEqual(["extra"]);
    const first = arrangeBottomBar(
      items.map((i) => ({ ...i, highlight: i.id === "home" })),
      5
    );
    expect(first.visible.map((i) => i.id)).toEqual(["courses", "live", "home", "tests", "profile"]);
  });

  it("without a center button it is a plain split", () => {
    const { visible, overflow } = arrangeBottomBar([{ id: 1 }, { id: 2 }, { id: 3 }], 2);
    expect(visible.length).toBe(2);
    expect(overflow.length).toBe(1);
  });
});

describe("rail placement", () => {
  it("tablet / desktop: rail replaces the sidebar, no bottom bar", () => {
    for (const device of ["tablet", "desktop"] as const) {
      const r = resolveStudentLayout({ navigation: { [device]: "rail" } }, { device, playSkin: true });
      expect([r.showRail, r.hideSidebar, r.showBottomBar]).toEqual([true, true, false]);
    }
  });
  it("phone: rail falls back to the bottom bar", () => {
    const r = resolveStudentLayout({ navigation: { mobile: "rail" } }, { device: "mobile", playSkin: false });
    expect([r.placement, r.showRail, r.showBottomBar, r.hideSidebar]).toEqual(["bottomBar", false, true, true]);
  });
  it("unconfigured never shows the rail", () => {
    const r = resolveStudentLayout(undefined, { device: "desktop", playSkin: true });
    expect(r.showRail).toBe(false);
  });
});

describe("normalizeNavRoute", () => {
  it("adds the leading slash, turns www. into a website, keeps full URLs", () => {
    expect(normalizeNavRoute(" study-library ")).toBe("/study-library");
    expect(normalizeNavRoute("/dashboard")).toBe("/dashboard");
    expect(normalizeNavRoute("www.x.com/a")).toBe("https://www.x.com/a");
    expect(normalizeNavRoute("https://x.com")).toBe("https://x.com");
  });
});

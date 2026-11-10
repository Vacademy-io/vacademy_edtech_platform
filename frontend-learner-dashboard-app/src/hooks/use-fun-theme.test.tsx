// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// An opaque-origin jsdom has no storage; the code under test only needs these four.
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
});

// The settings service's network side is not under test here.
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { get: vi.fn() } }));

const { useFunTheme, FUN_FONTS_LINK_ID, FUN_FONTS_HREF } = await import("./use-fun-theme");
const { useFunSkinRuntime, FUN_BRAND_VARS } = await import("@/components/design-system/fun/use-fun-skin-runtime");
const { resolveUiSkin } = await import("@/utils/institute-theme-roles");
const { applyUiSkinFromSettings } = await import("@/services/student-display-settings");
const { THEME_ROLE_SETTINGS_KEY } = await import("@/types/theme-role-settings");
type Settings = Parameters<typeof applyUiSkinFromSettings>[0];

const root = document.documentElement;
const skinClasses = () =>
  Array.from(root.classList)
    .filter((name) => name.startsWith("ui-"))
    .sort()
    .join(" ");
const saveSkin = (skin: string | undefined) =>
  localStorage.setItem(THEME_ROLE_SETTINGS_KEY, JSON.stringify({ roles: skin ? { skin } : {} }));
const legacy = (type: string) => ({ ui: { type } }) as unknown as Settings;
const fontLink = () => document.getElementById(FUN_FONTS_LINK_ID) as HTMLLinkElement | null;

beforeEach(() => {
  localStorage.clear();
  root.className = "light";
  root.removeAttribute("style");
  fontLink()?.remove();
});

describe("resolveUiSkin and the Fun skin", () => {
  it("accepts fun from THEME_SETTING", () => {
    saveSkin("fun");
    expect(resolveUiSkin("play")).toBe("fun");
  });
  it("accepts fun as the legacy ui.type too", () => {
    saveSkin(undefined);
    expect(resolveUiSkin("fun")).toBe("fun");
  });
  it("falls back to ui.type, then default, for a skin it does not know (as an older app does)", () => {
    saveSkin("somethingNewer");
    expect(resolveUiSkin("play")).toBe("play");
    expect(resolveUiSkin(null)).toBe("default");
  });
});

describe("applyUiSkinFromSettings", () => {
  it("puts ui-fun on alone and takes it off on a switch", () => {
    saveSkin("fun");
    applyUiSkinFromSettings(legacy("play"));
    expect(skinClasses()).toBe("ui-fun");

    for (const [skin, classes] of [
      ["cleanerPlay", "ui-cleaner-play"],
      ["play", "ui-play"],
      ["vibrant", "ui-vibrant"],
      ["corporate", "ui-corporate"],
      ["default", ""],
    ] as const) {
      saveSkin("fun");
      applyUiSkinFromSettings(legacy("play"));
      saveSkin(skin);
      applyUiSkinFromSettings(legacy("default"));
      expect(skinClasses()).toBe(classes);
    }
    expect(root.classList.contains("light")).toBe(true);
  });
  it("leaves the classes to the QA override when it names fun", () => {
    localStorage.setItem("DEBUG_UI_TYPE", "fun");
    root.classList.add("ui-fun");
    saveSkin("default");
    applyUiSkinFromSettings(legacy("default"));
    expect(skinClasses()).toBe("ui-fun");
  });
});

describe("useFunTheme and the skin runtime", () => {
  let host: HTMLDivElement;
  afterEach(() => host?.remove());

  async function render(Component: () => null) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    await act(async () => reactRoot.render(<Component />));
    return reactRoot;
  }

  it("follows the class on <html> and loads the fonts only once Fun is on", async () => {
    const seen: boolean[] = [];
    const reactRoot = await render(() => {
      seen.push(useFunTheme());
      return null;
    });
    expect(seen.at(-1)).toBe(false);
    expect(fontLink()).toBeNull();

    for (const other of ["ui-play", "ui-cleaner-play", "ui-vibrant", "ui-corporate"]) {
      await act(async () => {
        root.classList.add(other);
      });
      expect(seen.at(-1)).toBe(false);
      expect(fontLink()).toBeNull();
      root.classList.remove(other);
    }

    await act(async () => {
      root.classList.add("ui-fun");
    });
    expect(seen.at(-1)).toBe(true);
    expect(fontLink()?.href).toBe(FUN_FONTS_HREF);
    expect(document.querySelectorAll(`#${FUN_FONTS_LINK_ID}`)).toHaveLength(1);

    await act(async () => {
      root.classList.remove("ui-fun");
    });
    expect(seen.at(-1)).toBe(false);
    await act(async () => reactRoot.unmount());
  });

  it("writes the brand shades on <html> only while Fun is on, and clears them after", async () => {
    root.style.setProperty("--primary-500", "221 83% 53%");
    const reactRoot = await render(() => {
      useFunSkinRuntime();
      return null;
    });
    const styleBefore = root.getAttribute("style");
    for (const name of FUN_BRAND_VARS) expect(root.style.getPropertyValue(name)).toBe("");

    await act(async () => {
      root.classList.add("ui-fun");
    });
    expect(root.style.getPropertyValue("--fun-brand")).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue("--fun-brand-tint")).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue("--fun-brand-lip")).toMatch(/^#[0-9a-f]{6}$/);

    const first = root.style.getPropertyValue("--fun-brand");
    await act(async () => {
      root.style.setProperty("--primary-500", "38 92% 50%"); // a pale amber
    });
    expect(root.style.getPropertyValue("--fun-brand")).not.toBe(first);

    await act(async () => {
      root.classList.remove("ui-fun");
    });
    for (const name of FUN_BRAND_VARS) expect(root.style.getPropertyValue(name)).toBe("");
    root.style.setProperty("--primary-500", "221 83% 53%");
    expect(root.getAttribute("style")).toBe(styleBefore);
    await act(async () => reactRoot.unmount());
  });
});

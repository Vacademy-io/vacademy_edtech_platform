/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("ai settings shortcut preference", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("is off until someone turns it on, so learners never see the gear", async () => {
    const store = await import("./ai-settings-shortcut");
    expect(store.isAiSettingsShortcutEnabled()).toBe(false);
  });

  it("persists the choice both ways", async () => {
    const store = await import("./ai-settings-shortcut");

    store.setAiSettingsShortcutEnabled(true);
    expect(store.isAiSettingsShortcutEnabled()).toBe(true);
    expect(localStorage.getItem("AI_SETTINGS_SHORTCUT_ENABLED_V1")).toBe("true");

    store.setAiSettingsShortcutEnabled(false);
    expect(store.isAiSettingsShortcutEnabled()).toBe(false);
    expect(localStorage.getItem("AI_SETTINGS_SHORTCUT_ENABLED_V1")).toBe(
      "false"
    );
  });

  it("reads the stored choice back on the next load", async () => {
    localStorage.setItem("AI_SETTINGS_SHORTCUT_ENABLED_V1", "true");
    const store = await import("./ai-settings-shortcut");
    expect(store.isAiSettingsShortcutEnabled()).toBe(true);
  });

  describe("shouldShowAiSettingsShortcut", () => {
    it("hides the gear for an institute that never set the flag", async () => {
      const { shouldShowAiSettingsShortcut } = await import(
        "./ai-settings-shortcut"
      );
      expect(shouldShowAiSettingsShortcut(undefined, false)).toBe(false);
      expect(shouldShowAiSettingsShortcut(false, false)).toBe(false);
    });

    it("shows it when either the institute or this device asks for it", async () => {
      const { shouldShowAiSettingsShortcut } = await import(
        "./ai-settings-shortcut"
      );
      expect(shouldShowAiSettingsShortcut(true, false)).toBe(true);
      expect(shouldShowAiSettingsShortcut(undefined, true)).toBe(true);
      expect(shouldShowAiSettingsShortcut(true, true)).toBe(true);
    });
  });
});

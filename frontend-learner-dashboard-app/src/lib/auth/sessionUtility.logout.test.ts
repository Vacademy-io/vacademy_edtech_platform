// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
const setBranding = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      prefs.delete(key);
    },
    clear: async () => prefs.clear(),
    keys: async () => ({ keys: [...prefs.keys()] }),
  },
}));
vi.mock("@/services/domain-routing", () => ({ setCachedInstituteBranding: setBranding }));

import { removeTokensAndLogout } from "./sessionUtility";

describe("removeTokensAndLogout", () => {
  it("clears the in-memory branding copy", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await removeTokensAndLogout();
    expect(setBranding).toHaveBeenCalledWith(null);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("axios", () => ({ default: { get } }));
vi.mock("@/lib/auth/session-institute", () => ({
  readSessionInstituteId: async () => session.id,
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  notifyNamingSettingsUpdated: () => {},
}));
vi.mock("@/constants/urls", () => ({ urlInstituteDetails: "https://api.example/institute" }));

const siteWords = [{ key: "Course", customValue: "site word" }];

const load = async () => {
  vi.resetModules();
  return import("./institute-naming-seed");
};

describe("ensureInstituteNamingSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    session.id = null;
    get.mockReset();
    get.mockResolvedValue({
      data: { setting: JSON.stringify({ setting: { NAMING_SETTING: { data: { data: siteWords } } } }) },
    });
  });

  it("seeds the site's words for a signed-out visitor", async () => {
    const { ensureInstituteNamingSettings } = await load();
    await ensureInstituteNamingSettings("site");
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")).toEqual(siteWords);
  });

  it("seeds them for a learner of this institute", async () => {
    session.id = "site";
    const { ensureInstituteNamingSettings } = await load();
    await ensureInstituteNamingSettings("site");
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")).toEqual(siteWords);
  });

  it("leaves a signed-in learner of another institute with their own words", async () => {
    session.id = "own";
    localStorage.setItem("namingSettings", "own words");
    const { ensureInstituteNamingSettings } = await load();
    await ensureInstituteNamingSettings("site");
    expect(localStorage.getItem("namingSettings")).toBe("own words");
    expect(get).not.toHaveBeenCalled();
  });
});

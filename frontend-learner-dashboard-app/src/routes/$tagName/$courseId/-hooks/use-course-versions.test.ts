// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/urls", () => ({
  ENROLLMENT_INVITE_URL: "https://api.test/invite",
  urlCourseDetails: "https://api.test/search",
  GET_PRODUCT_PAGE_BY_CODE: () => "https://api.test/by-code",
}));

const service = vi.hoisted(() => ({
  fetchCourseLevels: vi.fn(),
  getOpenEnrollInvite: vi.fn(),
}));
type CourseLevelsService = typeof import("../../-services/course-levels-service");
vi.mock("../../-services/course-levels-service", async (importActual: () => Promise<CourseLevelsService>) => ({
  ...(await importActual()),
  fetchCourseLevels: service.fetchCourseLevels,
  getOpenEnrollInvite: service.getOpenEnrollInvite,
}));

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_COURSE_LANGUAGES } from "../../-utils/course-variants";
import type { CourseLevel } from "../../-services/course-levels-service";
import { useCourseVersions, type CourseVersionsState } from "./use-course-versions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const level = (over: Partial<CourseLevel> & { packageSessionId: string }): CourseLevel => ({
  levelId: null,
  levelName: null,
  sessionId: null,
  sessionName: null,
  enrollInviteId: null,
  price: null,
  elevatedPrice: null,
  currency: null,
  availability: null,
  availableSlots: null,
  durationMinutes: null,
  instructors: null,
  source: "catalogue",
  ...over,
});

const hi = level({ packageSessionId: "ps-hi", levelName: "Hindi", enrollInviteId: "inv-hi", price: 499 });
const en = level({ packageSessionId: "ps-en", levelName: "English", enrollInviteId: "inv-en", price: 999 });

type HookOpts = Parameters<typeof useCourseVersions>[0];
const baseOpts: HookOpts = {
  enabled: true,
  instituteId: "inst",
  courseId: "pkg",
  courseInit: null,
  languages: DEFAULT_COURSE_LANGUAGES,
  preferredLanguage: null,
};

let root: Root | null = null;
let latest: CourseVersionsState | null = null;

const Harness: React.FC<{ opts: HookOpts }> = ({ opts }) => {
  latest = useCourseVersions(opts);
  return null;
};

const flush = async () => {
  await act(async () => {
    // Versions, then the link's invite, then the selected version's invite.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

const mount = async (opts: HookOpts) => {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(React.createElement(Harness, { opts })));
  await flush();
};

const rerender = async (opts: HookOpts) => {
  act(() => root!.render(React.createElement(Harness, { opts })));
  await flush();
};

beforeEach(() => {
  service.fetchCourseLevels.mockReset().mockResolvedValue([hi, en]);
  service.getOpenEnrollInvite.mockReset().mockImplementation(async (_inst: string, id: string) => ({
    id,
    availability_status: "AVAILABLE",
    package_session_to_payment_options: [],
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
});

describe("useCourseVersions", () => {
  it("makes no request at all for a site that did not opt in", async () => {
    await mount({ ...baseOpts, enabled: false, urlEnrollInviteId: "inv-x" });
    expect(latest?.status).toBe("off");
    expect(latest?.selected).toBeNull();
    expect(service.fetchCourseLevels).not.toHaveBeenCalled();
    expect(service.getOpenEnrollInvite).not.toHaveBeenCalled();
  });

  it("orders versions by language, selects the first with an invite and loads its invite", async () => {
    await mount(baseOpts);
    expect(service.fetchCourseLevels).toHaveBeenCalledWith({ instituteId: "inst", courseId: "pkg", productPageCode: undefined });
    expect(latest?.status).toBe("ready");
    expect(latest?.versions.map((v) => v.packageSessionId)).toEqual(["ps-en", "ps-hi"]);
    expect(latest?.selected?.packageSessionId).toBe("ps-en");
    expect(latest?.options.map((o) => o.code)).toEqual(["en", "hi"]);
    expect(service.getOpenEnrollInvite).toHaveBeenLastCalledWith("inst", "inv-en");
    expect(latest?.invite?.id).toBe("inv-en");
  });

  it("follows the URL and keeps the URL's invite for that version", async () => {
    await mount({ ...baseOpts, urlPackageSessionId: "ps-hi", urlEnrollInviteId: "promo-hi" });
    expect(latest?.selected?.packageSessionId).toBe("ps-hi");
    expect(latest?.selectedInviteId).toBe("promo-hi");
    expect(latest?.invite?.id).toBe("promo-hi");
  });

  it("prefers the visitor's language when the URL names no version", async () => {
    await mount({ ...baseOpts, preferredLanguage: "hi" });
    expect(latest?.selected?.packageSessionId).toBe("ps-hi");
  });

  it("switches on select() without refetching the versions", async () => {
    await mount(baseOpts);
    act(() => latest!.select("ps-hi"));
    await flush();
    expect(latest?.selected?.packageSessionId).toBe("ps-hi");
    expect(latest?.selectedInviteId).toBe("inv-hi");
    expect(latest?.invite?.id).toBe("inv-hi");
    expect(service.fetchCourseLevels).toHaveBeenCalledTimes(1);
  });

  it("keeps a pick once the URL reflects it, and lets a later URL take over", async () => {
    await mount(baseOpts);
    act(() => latest!.select("ps-hi"));
    await rerender({ ...baseOpts, urlPackageSessionId: "ps-hi", urlEnrollInviteId: "inv-hi" });
    expect(latest?.selected?.packageSessionId).toBe("ps-hi");
    // e.g. an in-page link or Back/Forward to the English version
    await rerender({ ...baseOpts, urlPackageSessionId: "ps-en", urlEnrollInviteId: "inv-en" });
    expect(latest?.selected?.packageSessionId).toBe("ps-en");
    expect(latest?.selectedInviteId).toBe("inv-en");
  });

  it("resolves a non-default ?enrollInviteId through the package sessions it sells", async () => {
    service.getOpenEnrollInvite.mockImplementation(async (_inst: string, id: string) => ({
      id,
      package_session_to_payment_options: id === "special" ? [{ package_session_id: "ps-hi" }] : [],
    }));
    await mount({ ...baseOpts, urlEnrollInviteId: "special" });
    await flush();
    expect(latest?.selected?.packageSessionId).toBe("ps-hi");
    expect(latest?.selectedInviteId).toBe("special");
  });

  describe("a promo invite from the link (?enrollInviteId=PROMO)", () => {
    const sells = (map: Record<string, string[]>) =>
      service.getOpenEnrollInvite.mockImplementation(async (_inst: string, id: string) => ({
        id,
        availability_status: "AVAILABLE",
        package_session_to_payment_options: (map[id] ?? []).map((ps) => ({ package_session_id: ps })),
      }));

    it("keeps PROMO for every version it sells, switching away and back", async () => {
      sells({ promo: ["ps-en", "ps-hi"] });
      const landing = { ...baseOpts, urlPackageSessionId: "ps-en", urlEnrollInviteId: "promo" };
      await mount(landing);
      // Read even though the link also names the version.
      expect(service.getOpenEnrollInvite).toHaveBeenCalledWith("inst", "promo");
      expect(latest?.selectedInviteId).toBe("promo");

      let updates: Record<string, string | null> | null = null;
      act(() => {
        updates = latest!.select("ps-hi");
      });
      expect(updates).toMatchObject({ packageSessionId: "ps-hi", enrollInviteId: "promo", level: "Hindi" });
      await rerender({ ...landing, urlPackageSessionId: "ps-hi" });
      expect(latest?.selected?.packageSessionId).toBe("ps-hi");
      expect(latest?.selectedInviteId).toBe("promo");
      expect(latest?.invite?.id).toBe("promo");

      act(() => {
        updates = latest!.select("ps-en");
      });
      expect(updates).toMatchObject({ packageSessionId: "ps-en", enrollInviteId: "promo" });
      await rerender(landing);
      expect(latest?.selectedInviteId).toBe("promo");
    });

    it("uses a version's own invite where PROMO does not sell it, and finds PROMO again", async () => {
      sells({ promo: ["ps-en"] });
      const landing = { ...baseOpts, urlPackageSessionId: "ps-en", urlEnrollInviteId: "promo" };
      await mount(landing);

      let updates: Record<string, string | null> | null = null;
      act(() => {
        updates = latest!.select("ps-hi");
      });
      expect(updates).toMatchObject({ packageSessionId: "ps-hi", enrollInviteId: "inv-hi" });
      // The URL now carries Hindi's own invite — written here, so PROMO is kept.
      await rerender({ ...landing, urlPackageSessionId: "ps-hi", urlEnrollInviteId: "inv-hi" });
      expect(latest?.selectedInviteId).toBe("inv-hi");

      act(() => {
        updates = latest!.select("ps-en");
      });
      expect(updates).toMatchObject({ packageSessionId: "ps-en", enrollInviteId: "promo" });
      await rerender(landing);
      expect(latest?.selectedInviteId).toBe("promo");
      expect(latest?.invite?.id).toBe("promo");
    });

    it("lets the visitor pick a version only PROMO sells", async () => {
      service.fetchCourseLevels.mockResolvedValue([en, { ...hi, enrollInviteId: null }]);
      sells({ promo: ["ps-en", "ps-hi"] });
      await mount({ ...baseOpts, urlPackageSessionId: "ps-en", urlEnrollInviteId: "promo" });
      expect(latest?.options.find((o) => o.code === "hi")?.disabled).toBe(false);
      let updates: Record<string, string | null> | null = null;
      act(() => {
        updates = latest!.select("ps-hi");
      });
      expect(updates).toMatchObject({ packageSessionId: "ps-hi", enrollInviteId: "promo" });
    });

    it("refuses a version nothing can enrol in", async () => {
      service.fetchCourseLevels.mockResolvedValue([en, { ...hi, enrollInviteId: null }]);
      await mount(baseOpts);
      expect(latest?.options.find((o) => o.code === "hi")?.disabled).toBe(true);
      let updates: Record<string, string | null> | null = { x: "not called" };
      act(() => {
        updates = latest!.select("ps-hi");
      });
      expect(updates).toBeNull();
      expect(latest?.selected?.packageSessionId).toBe("ps-en");
    });

    it("stays loading until it knows what the link's invite sells", async () => {
      let release: (value: unknown) => void = () => {};
      service.getOpenEnrollInvite.mockImplementation((_inst: string, id: string) =>
        id === "promo"
          ? new Promise((resolve) => (release = resolve))
          : Promise.resolve({ id, package_session_to_payment_options: [] }),
      );
      await mount({ ...baseOpts, urlEnrollInviteId: "promo" });
      expect(latest?.versions).toHaveLength(2);
      expect(latest?.status).toBe("loading");
      release({ id: "promo", package_session_to_payment_options: [{ package_session_id: "ps-hi" }] });
      await flush();
      expect(latest?.status).toBe("ready");
      expect(latest?.selected?.packageSessionId).toBe("ps-hi");
      expect(latest?.selectedInviteId).toBe("promo");
    });

    it("settles on the link's invite when it cannot be read", async () => {
      service.getOpenEnrollInvite.mockImplementation(async (_inst: string, id: string) => {
        if (id === "promo") throw new Error("offline");
        return { id, package_session_to_payment_options: [] };
      });
      await mount({ ...baseOpts, urlPackageSessionId: "ps-hi", urlEnrollInviteId: "promo" });
      expect(latest?.status).toBe("ready");
      // The version the link named keeps the link's invite; the others their own.
      expect(latest?.selectedInviteId).toBe("promo");
      let updates: Record<string, string | null> | null = null;
      act(() => {
        updates = latest!.select("ps-en");
      });
      expect(updates).toMatchObject({ enrollInviteId: "inv-en" });
      await flush();
    });

    it("lets a new link's invite replace the held one", async () => {
      sells({ promo: ["ps-en", "ps-hi"], other: ["ps-hi"] });
      const landing = { ...baseOpts, urlPackageSessionId: "ps-en", urlEnrollInviteId: "promo" };
      await mount(landing);
      // e.g. an in-page link to the Hindi version with another invite
      await rerender({ ...landing, urlPackageSessionId: "ps-hi", urlEnrollInviteId: "other" });
      expect(service.getOpenEnrollInvite).toHaveBeenCalledWith("inst", "other");
      expect(latest?.selectedInviteId).toBe("other");
      // English is not sold by "other": its own invite.
      let updates: Record<string, string | null> | null = null;
      act(() => {
        updates = latest!.select("ps-en");
      });
      expect(updates).toMatchObject({ enrollInviteId: "inv-en" });
      await flush();
    });
  });

  it("offers a Level picker when the selected language has several versions", async () => {
    service.fetchCourseLevels.mockResolvedValue([
      level({ packageSessionId: "ps-hi-b", levelName: "Beginner Hindi", enrollInviteId: "inv-b" }),
      level({ packageSessionId: "ps-hi-a", levelName: "Advanced Hindi", enrollInviteId: "inv-a" }),
      en,
    ]);
    await mount({ ...baseOpts, urlPackageSessionId: "ps-hi-b" });
    expect(latest?.levelOptions.map((o) => o.label)).toEqual(["Beginner Hindi", "Advanced Hindi"]);
    act(() => {
      latest!.select("ps-hi-a");
    });
    await flush();
    expect(latest?.selected?.packageSessionId).toBe("ps-hi-a");
    expect(latest?.selectedInviteId).toBe("inv-a");
  });

  it("offers no Level picker when language versions are off", async () => {
    service.fetchCourseLevels.mockResolvedValue([
      level({ packageSessionId: "ps-1", levelName: "Batch 1", enrollInviteId: "inv-1" }),
      level({ packageSessionId: "ps-2", levelName: "Batch 2", enrollInviteId: "inv-2" }),
    ]);
    await mount({ ...baseOpts, languages: [] });
    expect(latest?.levelOptions).toEqual([]);
  });

  it("stays usable when the versions cannot be loaded", async () => {
    service.fetchCourseLevels.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mount(baseOpts);
    expect(latest?.status).toBe("error");
    expect(latest?.selected).toBeNull();
    expect(latest?.options).toEqual([]);
    warn.mockRestore();
  });

  it("starts over for another course", async () => {
    await mount(baseOpts);
    act(() => latest!.select("ps-hi"));
    service.fetchCourseLevels.mockResolvedValue([level({ packageSessionId: "ps-2", levelName: "English", enrollInviteId: "inv-2" })]);
    await rerender({ ...baseOpts, courseId: "pkg-2" });
    expect(latest?.selected?.packageSessionId).toBe("ps-2");
    expect(service.fetchCourseLevels).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/urls", () => ({
  ENROLLMENT_INVITE_URL: "https://api.test/open/learner/enroll-invite",
  urlCourseDetails: "https://api.test/open/packages/v2/search",
  GET_PRODUCT_PAGE_BY_CODE: (code: string, instituteId: string) =>
    `https://api.test/open/v1/product-page/by-code?code=${code}&instituteId=${instituteId}`,
}));

const axiosMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => ({ default: axiosMock }));

import {
  courseLevelsCacheSize,
  fetchCatalogueCourseLevels,
  fetchProductPageCourseLevels,
  getOpenEnrollInvite,
  invitePackageSessionIds,
  invitePaymentEntryFor,
  mapCatalogueRows,
  mapProductPageMappings,
  mergeCourseInit,
  primeOpenEnrollInvite,
  type CourseLevel,
} from "./course-levels-service";

const COURSE = "pkg-yoga";

/** Two language versions of one course + a row of another course (an old backend ignores package_ids). */
const searchRows = [
  {
    id: COURSE,
    package_session_id: "ps-en",
    level_id: "lvl-en",
    level_name: "English",
    session_id: "ses-1",
    session_name: "2026",
    enroll_invite_id: "inv-en",
    min_plan_actual_price: 999,
    min_plan_elevated_price: 1999,
    currency: "INR",
    enroll_invite_availability: "AVAILABLE",
    available_slots: 12,
    read_time_in_minutes: 60,
    instructors: [{ id: "u1", full_name: "Row Author" }],
  },
  {
    id: COURSE,
    package_session_id: "ps-hi",
    level_id: "lvl-hi",
    level_name: "Hindi",
    session_id: "ses-1",
    session_name: "2026",
    enroll_invite_id: null,
    min_plan_actual_price: null,
    currency: "INR",
  },
  { id: "pkg-other", package_session_id: "ps-other", level_name: "English", enroll_invite_id: "inv-x" },
  // The same package session twice (two invites racing in the payment CTE) keeps the first row.
  { id: COURSE, package_session_id: "ps-en", level_name: "English", enroll_invite_id: "inv-dup" },
];

describe("mapCatalogueRows", () => {
  it("keeps only this course's package sessions, once each, with invite + price", () => {
    const levels = mapCatalogueRows(searchRows, COURSE);
    expect(levels.map((l) => l.packageSessionId)).toEqual(["ps-en", "ps-hi"]);
    expect(levels[0]).toMatchObject({
      levelId: "lvl-en",
      levelName: "English",
      sessionId: "ses-1",
      sessionName: "2026",
      enrollInviteId: "inv-en",
      price: 999,
      elevatedPrice: 1999,
      currency: "INR",
      availability: "AVAILABLE",
      availableSlots: 12,
      durationMinutes: 60,
      source: "catalogue",
    });
    expect(levels[1]).toMatchObject({ enrollInviteId: null, price: null, elevatedPrice: null });
  });

  it("accepts package_id as well as id, and tolerates junk", () => {
    expect(mapCatalogueRows([{ package_id: COURSE, package_session_id: "ps-1" }], COURSE)).toHaveLength(1);
    expect(mapCatalogueRows(null, COURSE)).toEqual([]);
    expect(mapCatalogueRows([null, 3, { id: COURSE }], COURSE)).toEqual([]);
    expect(mapCatalogueRows(searchRows, "")).toEqual([]);
  });
});

describe("mapProductPageMappings", () => {
  const mappings = [
    { package_id: COURSE, package_session_id: "ps-hi", enroll_invite_id: "pp-inv-hi", level_name: "Hindi", display_order: 2, status: "ACTIVE", payment_plan: { actual_price: 499, elevated_price: 999, currency: "INR" } },
    { package_id: COURSE, package_session_id: "ps-en", enroll_invite_id: "pp-inv-en", level_name: "English", display_order: 1, status: "ACTIVE", payment_plan: { actual_price: 599, currency: "INR" } },
    { package_id: COURSE, package_session_id: "ps-en", enroll_invite_id: "pp-inv-en-2", level_name: "English", display_order: 5, status: "ACTIVE", payment_plan: { actual_price: 1 } },
    { package_id: COURSE, package_session_id: "ps-old", level_name: "Hindi", display_order: 0, status: "DELETED" },
    { package_id: "pkg-other", package_session_id: "ps-x", status: "ACTIVE" },
  ];

  it("uses the product page's own invite and plan, in its display order, active mappings only", () => {
    const levels = mapProductPageMappings(mappings, COURSE);
    expect(levels.map((l) => l.packageSessionId)).toEqual(["ps-en", "ps-hi"]);
    expect(levels[0]).toMatchObject({ enrollInviteId: "pp-inv-en", price: 599, currency: "INR", source: "productPage" });
    expect(levels[1]).toMatchObject({ enrollInviteId: "pp-inv-hi", price: 499, elevatedPrice: 999 });
  });
});

describe("mergeCourseInit", () => {
  const init = {
    package_sessions: [
      { id: "ps-en", level: { id: "lvl-en", level_name: "English" }, session: { id: "ses-1", session_name: "2026" } },
      { id: "ps-hi", level: { id: "lvl-hi", level_name: "Hindi" }, session: { id: "ses-1", session_name: "2026" } },
    ],
    sessions: [
      {
        session_dto: { id: "ses-1", session_name: "2026" },
        level_with_details: [
          { id: "lvl-en", name: "English", read_time_in_minutes: 120, instructors: [{ id: "u2", full_name: "English Author" }] },
          { id: "lvl-hi", name: "Hindi", read_time_in_minutes: 150, instructors: [{ id: "u3", full_name: "Hindi Author" }] },
        ],
      },
    ],
  };

  it("takes duration and authors from the version's own session + level", () => {
    const merged = mergeCourseInit(mapCatalogueRows(searchRows, COURSE), init);
    expect(merged[0].durationMinutes).toBe(120);
    expect(merged[0].instructors).toEqual([{ id: "u2", full_name: "English Author" }]);
    expect(merged[1].durationMinutes).toBe(150);
    expect(merged[1].instructors).toEqual([{ id: "u3", full_name: "Hindi Author" }]);
  });

  it("fills level/session ids for product page versions from package_sessions", () => {
    const merged = mergeCourseInit(
      mapProductPageMappings([{ package_id: COURSE, package_session_id: "ps-hi", status: "ACTIVE" }], COURSE),
      init,
    );
    expect(merged[0]).toMatchObject({ levelId: "lvl-hi", sessionId: "ses-1", levelName: "Hindi", sessionName: "2026", durationMinutes: 150 });
  });

  it("records a version course-init knows with no faculty as having none ([]), not unknown", () => {
    const noFaculty = {
      ...init,
      sessions: [
        {
          session_dto: { id: "ses-1" },
          level_with_details: [{ id: "lvl-hi", name: "Hindi", read_time_in_minutes: 0, instructors: [] }],
        },
      ],
    };
    const [pp] = mergeCourseInit(
      mapProductPageMappings([{ package_id: COURSE, package_session_id: "ps-hi", status: "ACTIVE" }], COURSE),
      noFaculty,
    );
    expect(pp.instructors).toEqual([]);
    expect(pp.durationMinutes).toBe(0);
    // A row with authors still wins over course-init's empty list.
    const [row] = mergeCourseInit(mapCatalogueRows([searchRows[0]], COURSE), {
      ...noFaculty,
      sessions: [{ session_dto: { id: "ses-1" }, level_with_details: [{ id: "lvl-en", instructors: [] }] }],
    });
    expect(row.instructors).toEqual([{ id: "u1", full_name: "Row Author" }]);
  });

  it("keeps the row's values when course-init has nothing for the version", () => {
    const rowOnly: CourseLevel[] = mapCatalogueRows(searchRows, COURSE);
    expect(mergeCourseInit(rowOnly, { sessions: [], package_sessions: [] })[0]).toMatchObject({
      durationMinutes: 60,
      instructors: [{ id: "u1", full_name: "Row Author" }],
    });
    expect(mergeCourseInit(rowOnly, null)).toBe(rowOnly);
  });
});

describe("invitePaymentEntryFor (the payment-option pick)", () => {
  const shared = {
    package_session_to_payment_options: [
      { package_session_id: "ps-en", status: "ACTIVE", payment_option: { id: "po-en" } },
      { package_session_id: "ps-hi", status: "INACTIVE", payment_option: { id: "po-hi-old" } },
      { package_session_id: "ps-hi", status: "ACTIVE", payment_option: { id: "po-hi" } },
    ],
  };

  it("picks the entry of the selected version, not entry [0]", () => {
    expect(invitePaymentEntryFor(shared, "ps-hi")?.payment_option?.id).toBe("po-hi");
    expect(invitePaymentEntryFor(shared, "ps-en")?.payment_option?.id).toBe("po-en");
  });

  it("falls back to entry [0] when the version is not listed (the previous behaviour)", () => {
    expect(invitePaymentEntryFor(shared, "pkg-yoga")?.payment_option?.id).toBe("po-en");
    expect(invitePaymentEntryFor(shared, undefined)?.payment_option?.id).toBe("po-en");
  });

  it("uses a lone inactive match rather than another version's entry", () => {
    const invite = {
      package_session_to_payment_options: [
        { package_session_id: "ps-en", status: "ACTIVE", payment_option: { id: "po-en" } },
        { package_session_id: "ps-hi", status: "INACTIVE", payment_option: { id: "po-hi" } },
      ],
    };
    expect(invitePaymentEntryFor(invite, "ps-hi")?.payment_option?.id).toBe("po-hi");
  });

  it("handles invites without entries", () => {
    expect(invitePaymentEntryFor({ package_session_to_payment_options: [] }, "ps-en")).toBeUndefined();
    expect(invitePaymentEntryFor(null, "ps-en")).toBeUndefined();
    expect(invitePackageSessionIds(shared)).toEqual(["ps-en", "ps-hi", "ps-hi"]);
    expect(invitePackageSessionIds(undefined)).toEqual([]);
  });
});

describe("network", () => {
  beforeEach(() => {
    axiosMock.get.mockReset();
    axiosMock.post.mockReset();
  });

  it("asks the catalogue search for this course only and filters what comes back", async () => {
    axiosMock.post.mockResolvedValue({ data: { content: searchRows } });
    const levels = await fetchCatalogueCourseLevels("inst-1", COURSE);
    expect(levels.map((l) => l.packageSessionId)).toEqual(["ps-en", "ps-hi"]);
    const [url, body, config] = axiosMock.post.mock.calls[0];
    expect(url).toBe("https://api.test/open/packages/v2/search");
    expect(body.package_ids).toEqual([COURSE]);
    expect(config.params).toMatchObject({ instituteId: "inst-1", page: 0 });
    // Cached: a second read (a version switch, a remount) does not refetch.
    await fetchCatalogueCourseLevels("inst-1", COURSE);
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
  });

  it("caches this course's versions, not the (possibly whole-catalogue) response", async () => {
    const everyCourse = [
      ...searchRows,
      ...Array.from({ length: 200 }, (_, i) => ({ id: `pkg-${i}`, package_session_id: `ps-${i}`, enroll_invite_id: `inv-${i}` })),
    ];
    axiosMock.post.mockResolvedValue({ data: { content: everyCourse } });
    const first = await fetchCatalogueCourseLevels("inst-cache", COURSE);
    const second = await fetchCatalogueCourseLevels("inst-cache", COURSE);
    expect(first.map((l) => l.packageSessionId)).toEqual(["ps-en", "ps-hi"]);
    // The same mapped list both times: nothing is re-read from a kept response.
    expect(second).toBe(first);
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
  });

  it("drops expired entries and never grows past its cap", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
      for (let i = 0; i < 60; i += 1) primeOpenEnrollInvite("inst-cap", `inv-${i}`, { id: `inv-${i}` });
      expect(courseLevelsCacheSize()).toBeLessThanOrEqual(40);
      // The newest entries are the ones kept.
      await expect(getOpenEnrollInvite("inst-cap", "inv-59")).resolves.toMatchObject({ id: "inv-59" });
      expect(axiosMock.get).not.toHaveBeenCalled();

      vi.setSystemTime(new Date("2026-10-09T10:02:00Z")); // past the 60 s TTL
      primeOpenEnrollInvite("inst-cap", "fresh", { id: "fresh" });
      expect(courseLevelsCacheSize()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a product page's mappings for a product page visit", async () => {
    axiosMock.get.mockResolvedValue({
      data: { mappings: [{ package_id: COURSE, package_session_id: "ps-hi", enroll_invite_id: "pp", status: "ACTIVE" }] },
    });
    const levels = await fetchProductPageCourseLevels("inst-1", "PATH1", COURSE);
    expect(levels).toHaveLength(1);
    expect(axiosMock.get.mock.calls[0][0]).toContain("code=PATH1");
  });

  it("reuses an invite the page already fetched, and retries after a failure", async () => {
    primeOpenEnrollInvite("inst-1", "inv-primed", { id: "inv-primed", availability_status: "EXPIRED" });
    await expect(getOpenEnrollInvite("inst-1", "inv-primed")).resolves.toMatchObject({ availability_status: "EXPIRED" });
    expect(axiosMock.get).not.toHaveBeenCalled();

    axiosMock.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ data: { id: "inv-2" } });
    await expect(getOpenEnrollInvite("inst-1", "inv-2")).rejects.toThrow("offline");
    await expect(getOpenEnrollInvite("inst-1", "inv-2")).resolves.toMatchObject({ id: "inv-2" });
    expect(axiosMock.get.mock.calls[0][0]).toBe("https://api.test/open/learner/enroll-invite/inst-1/inv-2");
  });
});

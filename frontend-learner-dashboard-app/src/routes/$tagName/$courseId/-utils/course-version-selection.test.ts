import { describe, expect, it, vi } from "vitest";

vi.mock("@/constants/urls", () => ({
  ENROLLMENT_INVITE_URL: "https://api.test/invite",
  urlCourseDetails: "https://api.test/search",
  GET_PRODUCT_PAGE_BY_CODE: () => "https://api.test/by-code",
}));

import { defaultParseSearch } from "@tanstack/react-router";
import { DEFAULT_COURSE_LANGUAGES, preferredCourseLanguage } from "../../-utils/course-variants";
import { withSearchParams } from "../../-utils/catalogue-url-state";
import type { CourseLevel } from "../../-services/course-levels-service";
import {
  SITE_CART_MAX_ITEMS,
  buildCourseCartItem,
  cartCanTake,
  effectiveInviteIdFor,
  grantCovers,
  keepsLinkInviteEnrolment,
  languageOptionsFor,
  levelOptionsFor,
  localizeCourseDisplay,
  orderVersions,
  pickInitialVersion,
  resolveVersionOffer,
  searchParamValue,
  searchText,
  urlDesignatedVersion,
  versionOwnDetails,
  versionSearchUpdates,
  type InviteGrant,
  type VersionSelectionInput,
} from "./course-version-selection";

const languages = DEFAULT_COURSE_LANGUAGES; // en (EN), hi (हिं)

const version = (over: Partial<CourseLevel> & { packageSessionId: string }): CourseLevel => ({
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

const hi = version({ packageSessionId: "ps-hi", levelName: "Hindi", enrollInviteId: "inv-hi", price: 499 });
const en = version({ packageSessionId: "ps-en", levelName: "English", enrollInviteId: "inv-en", price: 999 });
const enNoInvite = version({ packageSessionId: "ps-en-2", levelName: "Beginner English" });
const misc = version({ packageSessionId: "ps-misc", levelName: "Batch 2", enrollInviteId: "inv-misc" });

const input = (over: Partial<VersionSelectionInput> = {}): VersionSelectionInput => ({ languages, ...over });

describe("orderVersions", () => {
  it("follows the site's language order, unknown languages last, source order within", () => {
    expect(orderVersions([misc, hi, enNoInvite, en], languages).map((v) => v.packageSessionId)).toEqual([
      "ps-en-2",
      "ps-en",
      "ps-hi",
      "ps-misc",
    ]);
  });

  it("leaves the order alone when language versions are off", () => {
    const list = [hi, en];
    expect(orderVersions(list, [])).toBe(list);
  });
});

describe("languageOptionsFor", () => {
  const ordered = orderVersions([hi, enNoInvite, en, misc], languages);

  it("offers one segment per language with labels and chips from the site settings", () => {
    const options = languageOptionsFor(ordered, languages, null);
    expect(options).toEqual([
      { code: "en", label: "English", chip: "EN", packageSessionId: "ps-en", disabled: false },
      { code: "hi", label: "Hindi", chip: "हिं", packageSessionId: "ps-hi", disabled: false },
    ]);
  });

  it("lets the selected version represent its language", () => {
    const options = languageOptionsFor(ordered, languages, "ps-en-2");
    expect(options[0]).toMatchObject({ packageSessionId: "ps-en-2", disabled: true });
  });

  it("disables a language whose versions have no invite", () => {
    const options = languageOptionsFor([enNoInvite, hi], languages, "ps-hi");
    expect(options.find((o) => o.code === "en")).toMatchObject({ disabled: true });
  });

  it("has fewer than two options when the course is single-language (no picker)", () => {
    expect(languageOptionsFor([en, enNoInvite, misc], languages, null)).toHaveLength(1);
  });
});

describe("pickInitialVersion", () => {
  const versions = orderVersions([hi, en, enNoInvite], languages);

  it("1. honours ?packageSessionId, even for a version without an invite", () => {
    expect(pickInitialVersion(versions, input({ urlPackageSessionId: "ps-hi", preferredLanguage: "en" }))).toBe(hi);
    expect(pickInitialVersion(versions, input({ urlPackageSessionId: "ps-en-2" }))).toBe(enNoInvite);
  });

  it("2. else the level of ?enrollInviteId (default invite or one the invite sells)", () => {
    expect(pickInitialVersion(versions, input({ urlEnrollInviteId: "inv-hi", preferredLanguage: "en" }))).toBe(hi);
    expect(
      pickInitialVersion(
        versions,
        input({ urlEnrollInviteId: "special", grant: { inviteId: "special", packageSessionIds: ["ps-hi"] } }),
      ),
    ).toBe(hi);
    // What another invite sells says nothing about the URL's invite.
    expect(
      pickInitialVersion(
        versions,
        input({ urlEnrollInviteId: "special", grant: { inviteId: "other", packageSessionIds: ["ps-hi"] } }),
      ),
    ).toBe(en);
  });

  it("2b. one invite selling both languages resolves to the visitor's language", () => {
    const shared = [
      version({ packageSessionId: "a-en", levelName: "English", enrollInviteId: "bundle" }),
      version({ packageSessionId: "a-hi", levelName: "Hindi", enrollInviteId: "bundle" }),
    ];
    expect(pickInitialVersion(shared, input({ urlEnrollInviteId: "bundle", preferredLanguage: "hi" }))?.packageSessionId).toBe("a-hi");
    expect(pickInitialVersion(shared, input({ urlEnrollInviteId: "bundle" }))?.packageSessionId).toBe("a-en");
  });

  it("3. else the visitor's language from the site locale", () => {
    const preferred = preferredCourseLanguage("hi", languages);
    expect(pickInitialVersion(versions, input({ preferredLanguage: preferred }))).toBe(hi);
  });

  it("3b. a stale ?packageSessionId falls through to the next rule", () => {
    expect(pickInitialVersion(versions, input({ urlPackageSessionId: "gone", preferredLanguage: "hi" }))).toBe(hi);
  });

  it("4. else the first version with an invite; 5. else the first version", () => {
    expect(pickInitialVersion(versions, input())).toBe(en);
    expect(pickInitialVersion(versions, input({ preferredLanguage: "mr" }))).toBe(en);
    expect(pickInitialVersion([enNoInvite], input())).toBe(enNoInvite);
    expect(pickInitialVersion([], input())).toBeNull();
  });

  it("does not auto-pick a preferred-language version nobody can enrol in", () => {
    const hiClosed = version({ packageSessionId: "ps-hi-x", levelName: "Hindi" });
    expect(pickInitialVersion([en, hiClosed], input({ preferredLanguage: "hi" }))).toBe(en);
  });
});

describe("effectiveInviteIdFor / grantCovers (the link's invite)", () => {
  // ?enrollInviteId=PROMO, an invite that sells both language versions.
  const promoBoth: InviteGrant = { inviteId: "promo", packageSessionIds: ["ps-en", "ps-hi"], landingPackageSessionId: "ps-en" };
  // A promo that sells only English.
  const promoEn: InviteGrant = { inviteId: "promo", packageSessionIds: ["ps-en"] };

  it("enrols every version the link's invite sells through it, the rest through their own", () => {
    expect(effectiveInviteIdFor(en, promoBoth)).toBe("promo");
    expect(effectiveInviteIdFor(hi, promoBoth)).toBe("promo");
    expect(effectiveInviteIdFor(hi, promoEn)).toBe("inv-hi");
    expect(effectiveInviteIdFor(en, null)).toBe("inv-en");
    expect(effectiveInviteIdFor(enNoInvite, null)).toBeNull();
  });

  it("switching away and back keeps the promo for the versions it sells", () => {
    // Landed on English at the promo price; the URL now follows each pick.
    const picks = [hi, en, hi, en];
    expect(picks.map((v) => versionSearchUpdates(v, effectiveInviteIdFor(v, promoBoth)).enrollInviteId)).toEqual([
      "promo",
      "promo",
      "promo",
      "promo",
    ]);
    // A promo for English only: Hindi uses its own invite, English gets the promo back.
    expect(picks.map((v) => versionSearchUpdates(v, effectiveInviteIdFor(v, promoEn)).enrollInviteId)).toEqual([
      "inv-hi",
      "promo",
      "inv-hi",
      "promo",
    ]);
  });

  it("makes a version only the promo sells enrollable (and pickable)", () => {
    const hiPromoOnly = version({ packageSessionId: "ps-hi", levelName: "Hindi" }); // no default invite
    const grant: InviteGrant = { inviteId: "promo", packageSessionIds: ["ps-en", "ps-hi"] };
    expect(effectiveInviteIdFor(hiPromoOnly, grant)).toBe("promo");
    expect(languageOptionsFor([en, hiPromoOnly], languages, "ps-en", grant)).toEqual([
      expect.objectContaining({ code: "en", disabled: false }),
      expect.objectContaining({ code: "hi", packageSessionId: "ps-hi", disabled: false }),
    ]);
    expect(languageOptionsFor([en, hiPromoOnly], languages, "ps-en", null)[1].disabled).toBe(true);
    // The first version that can be enrolled in, counting the promo's.
    expect(pickInitialVersion([enNoInvite, hiPromoOnly], input({ grant }))).toBe(hiPromoOnly);
    expect(pickInitialVersion([enNoInvite, hiPromoOnly], input())).toBe(enNoInvite);
  });

  it("while what the invite sells is unknown, only the version the link named keeps it", () => {
    const unknown: InviteGrant = { inviteId: "promo", packageSessionIds: null, landingPackageSessionId: "ps-hi" };
    expect(grantCovers(unknown, hi)).toBe(true);
    expect(grantCovers(unknown, en)).toBe(false);
    expect(effectiveInviteIdFor(en, unknown)).toBe("inv-en");
    expect(grantCovers({ inviteId: "promo", packageSessionIds: null }, hi)).toBe(false);
    // An invite that is a version's own default always covers that version.
    expect(grantCovers({ inviteId: "inv-hi", packageSessionIds: null }, hi)).toBe(true);
  });

  it("does not hand a product page version another invite", () => {
    const pp = version({ packageSessionId: "ps-hi", levelName: "Hindi", enrollInviteId: "pp-hi", source: "productPage" });
    expect(effectiveInviteIdFor(pp, promoBoth)).toBe("pp-hi");
  });

  it("urlDesignatedVersion uses what the URL's invite sells", () => {
    const grant: InviteGrant = { inviteId: "promo", packageSessionIds: ["ps-hi"] };
    expect(urlDesignatedVersion([en, hi], input({ urlEnrollInviteId: "promo", grant }))).toBe(hi);
    expect(urlDesignatedVersion([en, hi], input({ urlPackageSessionId: "ps-en", urlEnrollInviteId: "promo", grant }))).toBe(en);
    expect(urlDesignatedVersion([en, hi], input({ urlEnrollInviteId: "promo" }))).toBeNull();
  });
});

describe("keepsLinkInviteEnrolment (site cart vs the link's invite)", () => {
  const promoEn: InviteGrant = { inviteId: "promo", packageSessionIds: ["ps-en"] };
  const keeps = (
    selected: CourseLevel | null,
    grant: InviteGrant | null,
    urlEnrollInviteId: string | null,
    status: "off" | "loading" | "ready" | "error" = "ready",
  ) =>
    keepsLinkInviteEnrolment({
      status,
      selected,
      selectedInviteId: selected ? effectiveInviteIdFor(selected, grant) : null,
      urlEnrollInviteId,
    });

  it("leaves a plain visit (the version's own catalogue invite) to the site cart", () => {
    const ownLink: InviteGrant = { inviteId: "inv-en", packageSessionIds: ["ps-en"] };
    expect(keeps(en, ownLink, "inv-en")).toBe(false);
    expect(keeps(en, null, null)).toBe(false); // a bare link
    // Switched to Hindi on a plain English link: Hindi's own invite.
    expect(keeps(hi, ownLink, "inv-hi")).toBe(false);
  });

  it("keeps the invite flow while a promo or bundle link prices the version on screen", () => {
    expect(keeps(en, promoEn, "promo")).toBe(true);
    const bundle: InviteGrant = { inviteId: "bundle", packageSessionIds: ["ps-en", "ps-hi"] };
    expect(keeps(hi, bundle, "bundle")).toBe(true);
    // A version only the promo sells (no catalogue invite of its own).
    const hiPromoOnly = version({ packageSessionId: "ps-hi", levelName: "Hindi" });
    expect(keeps(hiPromoOnly, { inviteId: "promo", packageSessionIds: ["ps-hi"] }, "promo")).toBe(true);
  });

  it("gives a version the promo does not sell back to the site cart", () => {
    // Landed on English through an English-only promo, switched to Hindi.
    expect(keeps(hi, promoEn, "inv-hi")).toBe(false);
  });

  it("decides nothing while the versions load; with none known, a link's invite is kept", () => {
    expect(keeps(null, promoEn, "promo", "loading")).toBe(false);
    expect(keeps(null, null, "promo", "error")).toBe(true);
    expect(keeps(null, null, "inv-en", "ready")).toBe(true);
    expect(keeps(null, null, null, "error")).toBe(false);
  });
});

describe("levelOptionsFor (several versions in one language)", () => {
  const beginnerHi = version({ packageSessionId: "ps-hi-b", levelName: "Beginner Hindi", enrollInviteId: "inv-b" });
  const advancedHi = version({ packageSessionId: "ps-hi-a", levelName: "Advanced Hindi" });
  const all = orderVersions([beginnerHi, advancedHi, en], languages);

  it("lists the selected language's versions, each pickable when it can be enrolled in", () => {
    expect(levelOptionsFor(all, languages, "ps-hi-b")).toEqual([
      { packageSessionId: "ps-hi-b", label: "Beginner Hindi", disabled: false },
      { packageSessionId: "ps-hi-a", label: "Advanced Hindi", disabled: true },
    ]);
    // The language picker still offers one Hindi segment, represented by the selection.
    expect(languageOptionsFor(all, languages, "ps-hi-b").map((o) => o.packageSessionId)).toEqual(["ps-en", "ps-hi-b"]);
  });

  it("is empty when the selected language has one version", () => {
    expect(levelOptionsFor(all, languages, "ps-en")).toEqual([]);
    expect(levelOptionsFor(all, languages, null)).toEqual([]);
  });

  it("tells two batches of the same level apart by session", () => {
    const a = version({ packageSessionId: "a", levelName: "Hindi", sessionName: "2025", enrollInviteId: "i-a" });
    const b = version({ packageSessionId: "b", levelName: "Hindi", sessionName: "2026", enrollInviteId: "i-b" });
    const c = version({ packageSessionId: "c", levelName: "Hindi", enrollInviteId: "i-c" });
    expect(levelOptionsFor([a, b, c], languages, "a").map((o) => o.label)).toEqual(["Hindi · 2025", "Hindi · 2026", "Hindi (3)"]);
  });
});

describe("versionOwnDetails", () => {
  it("uses the version's own read time and authors, even when empty", () => {
    expect(versionOwnDetails({ durationMinutes: 90, instructors: [{ full_name: "A" }] }, 2)).toEqual({
      durationMinutes: 90,
      instructors: [{ full_name: "A" }],
    });
    expect(versionOwnDetails({ durationMinutes: null, instructors: null }, 2)).toEqual({ durationMinutes: null, instructors: [] });
    expect(versionOwnDetails({ durationMinutes: 0, instructors: [] }, 1)).toEqual({ durationMinutes: 0, instructors: [] });
  });

  it("keeps the course-level values only for a lone version whose details are unknown", () => {
    expect(versionOwnDetails({ durationMinutes: null, instructors: null }, 1)).toEqual({
      durationMinutes: undefined,
      instructors: undefined,
    });
  });
});

describe("cartCanTake (the 40-course cap)", () => {
  const full = Array.from({ length: SITE_CART_MAX_ITEMS }, (_, i) => ({ packageSessionId: `ps-${i}`, courseId: `c-${i}` }));

  it("refuses a new course when the cart is full", () => {
    expect(SITE_CART_MAX_ITEMS).toBe(40);
    expect(cartCanTake(full, { packageSessionId: "ps-new", courseId: "c-new" })).toBe(false);
    expect(cartCanTake(full.slice(1), { packageSessionId: "ps-new", courseId: "c-new" })).toBe(true);
  });

  it("always takes a version already in the cart or a swap of a course's version", () => {
    expect(cartCanTake(full, { packageSessionId: "ps-3", courseId: "c-3" })).toBe(true);
    expect(cartCanTake(full, { packageSessionId: "ps-3-hi", courseId: "c-3" })).toBe(true);
  });
});

describe("URL values (TanStack parses search values as JSON)", () => {
  it("JSON-quotes only what the router would read back as something else", () => {
    expect(searchParamValue("10")).toBe('"10"');
    expect(searchParamValue("true")).toBe('"true"');
    expect(searchParamValue("Hindi")).toBe("Hindi");
    expect(searchParamValue("4f9c2a1e-77b0-4c1e-9d0a-2b8f6c0d1e2f")).toBe("4f9c2a1e-77b0-4c1e-9d0a-2b8f6c0d1e2f");
  });

  it("round-trips a picked version through the query string as strings", () => {
    const numeric = version({ packageSessionId: "12345", levelName: "10", enrollInviteId: "true" });
    const qs = withSearchParams("?lang=hi", versionSearchUpdates(numeric, "true"));
    const parsed = defaultParseSearch(qs) as Record<string, unknown>;
    expect(parsed).toMatchObject({ lang: "hi", packageSessionId: "12345", enrollInviteId: "true", level: "10" });
    expect(defaultParseSearch(withSearchParams("", versionSearchUpdates(hi, "inv-hi")))).toEqual({
      packageSessionId: "ps-hi",
      enrollInviteId: "inv-hi",
      level: "Hindi",
    });
  });

  it("searchText turns a parsed value back into text", () => {
    expect(searchText(10)).toBe("10");
    expect(searchText(true)).toBe("true");
    expect(searchText("ps-1")).toBe("ps-1");
    expect(searchText("")).toBeUndefined();
    expect(searchText(undefined)).toBeUndefined();
    expect(searchText(null)).toBeUndefined();
  });
});

describe("resolveVersionOffer", () => {
  const invite = {
    availability_status: "EXPIRED",
    setting_json: '{"setting":{}}',
    package_session_to_payment_options: [
      { package_session_id: "ps-en", payment_option: { payment_plans: [{ actual_price: 899, elevated_price: 1299, currency: "USD" }] } },
      { package_session_id: "ps-hi", payment_option: { payment_plans: [{ actual_price: 0, currency: "INR" }] } },
    ],
  };

  it("uses the invite plan of THIS version's entry", () => {
    expect(resolveVersionOffer(hi, invite)).toEqual({
      price: 0,
      elevatedPrice: undefined,
      currency: "INR",
      availability: "EXPIRED",
      settingJson: '{"setting":{}}',
    });
    expect(resolveVersionOffer(en, invite)).toMatchObject({ price: 899, elevatedPrice: 1299, currency: "USD" });
  });

  it("shows the search row's price until the invite has loaded", () => {
    const row = version({ packageSessionId: "ps-en", levelName: "English", price: 999, elevatedPrice: 1500, currency: "INR", availability: "AVAILABLE" });
    expect(resolveVersionOffer(row, null)).toEqual({ price: 999, elevatedPrice: 1500, currency: "INR", availability: "AVAILABLE", settingJson: undefined });
    expect(resolveVersionOffer(enNoInvite, null).price).toBe(0);
  });

  it("keeps a product page version on that page's own plan", () => {
    const pp = version({ packageSessionId: "ps-en", levelName: "English", price: 450, currency: "INR", source: "productPage" });
    expect(resolveVersionOffer(pp, invite)).toMatchObject({ price: 450, currency: "INR", availability: "EXPIRED" });
  });
});

describe("versionSearchUpdates", () => {
  it("names the picked version and the invite it is enrolled through, and drops the link's price/slots", () => {
    expect(versionSearchUpdates(hi, "inv-hi")).toEqual({
      packageSessionId: "ps-hi",
      enrollInviteId: "inv-hi",
      level: "Hindi",
      price: null,
      available_slots: null,
    });
    expect(versionSearchUpdates(hi, "promo").enrollInviteId).toBe("promo");
    expect(versionSearchUpdates(enNoInvite, null).enrollInviteId).toBeNull();
  });
});

describe("buildCourseCartItem", () => {
  it("builds a base-language cart line for the version", () => {
    expect(
      buildCourseCartItem({
        courseId: "pkg-yoga",
        title: "Yoga",
        packageSessionId: "ps-hi",
        levelName: "Hindi",
        languages,
        price: 499,
        currency: "INR",
        image: "media-1",
        enrollInviteId: "inv-hi",
      }),
    ).toEqual({
      packageSessionId: "ps-hi",
      courseId: "pkg-yoga",
      title: "Yoga",
      levelName: "Hindi",
      languageCode: "hi",
      price: 499,
      elevatedPrice: undefined,
      currency: "INR",
      image: "media-1",
      enrollInviteId: "inv-hi",
      source: { kind: "course" },
    });
  });

  it("drops placeholder images and empty invites", () => {
    const item = buildCourseCartItem({ courseId: "c", title: "T", packageSessionId: "p", languages, image: "/api/placeholder/800/400", enrollInviteId: "" });
    expect(item.image).toBeUndefined();
    expect(item.enrollInviteId).toBeUndefined();
    expect(item.languageCode).toBeUndefined();
  });
});

describe("localizeCourseDisplay", () => {
  const dict: Record<string, string> = { Yoga: "योग", Hindi: "हिन्दी", Wellness: "स्वास्थ्य" };
  const t = (s: string) => dict[s] ?? s;

  it("translates live text for display", () => {
    const course = { title: "Yoga", level: "Hindi", tags: ["Wellness", "Beginner"], price: 499, packageSessionId: "ps-hi" };
    expect(localizeCourseDisplay(course, t)).toEqual({ ...course, title: "योग", level: "हिन्दी", tags: ["स्वास्थ्य", "Beginner"] });
  });

  it("returns the same object when nothing is translated", () => {
    const course = { title: "Pilates", tags: ["Core"], price: 1 };
    expect(localizeCourseDisplay(course, t)).toBe(course);
    expect(localizeCourseDisplay(course, (s) => s)).toBe(course);
  });
});

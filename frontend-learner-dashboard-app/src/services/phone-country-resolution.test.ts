// @vitest-environment jsdom
//
// The suite-wide default is `node`, but importing the domain-routing service
// pulls in `constants/urls` -> `config/baseUrl`, which reads
// `window.location.hostname` at module scope.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHONE_COUNTRY_GEO_MODE,
  DEFAULT_PREFERRED_COUNTRIES,
  resolvePhoneCountries,
  hasResolvedPhonePreferences,
  setCachedPhoneCountryGeoMode,
  getPreferredPhoneCountries,
} from "./domain-routing";
import {
  ALL_ZONES,
  countryFromLanguageTag,
  countryFromTimeZone,
} from "@/utils/geo-country";

/**
 * The learner dashboard carries its own copy of this chain (separate repo,
 * separate bundle) and must reach the same answer as the admin dashboard for
 * the same institute — otherwise a lead captured on a catalogue page and the
 * same lead edited in the admin panel disagree about which country a number
 * belongs to. These cases are deliberately the same ones asserted in
 * `frontend-admin-dashboard/src/services/__tests__/phone-country-resolution`;
 * a divergence between the two copies fails here.
 */

const INSTITUTE_LIST = ["gb", "ie"];

describe("GUARANTEE: a configured preferred country always beats geo-location", () => {
  // The product requirement in one block. The institute's DB preference is the
  // preference; the region a form is opened in is only ever a fallback for when
  // the institute has expressed none. Only the opt-in GEO_FIRST mode reverses
  // this, and it is never the default.

  it.each([["ru"], ["us"], ["de"], ["ae"], ["jp"], ["br"], [null]])(
    "a form opened in %s still starts on the institute's country",
    (openedIn) => {
      expect(
        resolvePhoneCountries("INSTITUTE_FIRST", ["gb", "ie"], openedIn).defaultCountry,
      ).toBe("gb");
    },
  );

  it("holds for a single-country institute, the most common configuration", () => {
    expect(resolvePhoneCountries("INSTITUTE_FIRST", ["in"], "ru").defaultCountry).toBe("in");
  });

  it("holds under the default mode specifically — nobody has to opt in", () => {
    expect(
      resolvePhoneCountries(DEFAULT_PHONE_COUNTRY_GEO_MODE, ["ae"], "ru").defaultCountry,
    ).toBe("ae");
  });

  it("geo only fills in when the institute expressed no preference at all", () => {
    expect(resolvePhoneCountries("INSTITUTE_FIRST", [], "ru").defaultCountry).toBe("ru");
  });

  it("and a preference that has not LOADED yet still cannot be beaten by geo", () => {
    // An institute may have a preference in the database that this page has not
    // fetched yet — on a cold browser the configured list is empty for a moment
    // and looks identical to "configured nothing". getPreferredPhoneCountries
    // withholds the visitor until a resolve has happened, so geo cannot slip in
    // ahead of a preference we simply have not read.
    localStorage.clear();
    expect(hasResolvedPhonePreferences()).toBe(false);
    expect(getPreferredPhoneCountries().defaultCountry).toBe("in");
    localStorage.clear();
  });

  it("GEO_FIRST is the ONLY way the region can win, and it is opt-in", () => {
    expect(resolvePhoneCountries("GEO_FIRST", ["gb"], "ru").defaultCountry).toBe("ru");
    expect(DEFAULT_PHONE_COUNTRY_GEO_MODE).not.toBe("GEO_FIRST");
  });
});

describe("resolvePhoneCountries", () => {
  describe("INSTITUTE_FIRST — the institute is the preference", () => {
    it("uses the configured list and ignores where the form is opened", () => {
      const result = resolvePhoneCountries(
        "INSTITUTE_FIRST",
        INSTITUTE_LIST,
        "ru",
      );

      expect(result.defaultCountry).toBe("gb");
      expect(result.preferredCountries).toEqual(INSTITUTE_LIST);
    });

    it("keeps the configured ORDER, not just the membership", () => {
      expect(
        resolvePhoneCountries("INSTITUTE_FIRST", ["ae", "in", "us"], "us")
          .preferredCountries,
      ).toEqual(["ae", "in", "us"]);
    });

    it("falls back to the visitor when the institute configured nothing", () => {
      const result = resolvePhoneCountries("INSTITUTE_FIRST", [], "ru");

      expect(result.defaultCountry).toBe("ru");
      expect(result.preferredCountries).toEqual(["ru", "in", "us", "gb", "au", "ae"]);
    });

    it("does not duplicate the visitor when it is already a platform default", () => {
      expect(
        resolvePhoneCountries("INSTITUTE_FIRST", [], "us").preferredCountries,
      ).toEqual(["us", "in", "gb", "au", "ae"]);
    });

    it("falls back to the platform default when nothing is known at all", () => {
      const result = resolvePhoneCountries("INSTITUTE_FIRST", [], null);

      expect(result.defaultCountry).toBe("in");
      expect(result.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
    });
  });

  describe("GEO_FIRST — the visitor wins", () => {
    it("pre-selects the visitor and keeps the institute list ordering behind it", () => {
      const result = resolvePhoneCountries("GEO_FIRST", INSTITUTE_LIST, "ru");

      expect(result.defaultCountry).toBe("ru");
      expect(result.preferredCountries).toEqual(["ru", "gb", "ie"]);
    });

    it("hoists rather than duplicates a visitor already in the institute list", () => {
      const result = resolvePhoneCountries("GEO_FIRST", ["gb", "ie"], "ie");

      expect(result.defaultCountry).toBe("ie");
      expect(result.preferredCountries).toEqual(["ie", "gb"]);
    });

    it("falls back to the institute list when the visitor cannot be placed", () => {
      const result = resolvePhoneCountries("GEO_FIRST", INSTITUTE_LIST, null);

      expect(result.defaultCountry).toBe("gb");
      expect(result.preferredCountries).toEqual(INSTITUTE_LIST);
    });
  });

  describe("INSTITUTE_ONLY — the visitor is never consulted", () => {
    it("ignores a detected country that was passed in anyway", () => {
      const result = resolvePhoneCountries(
        "INSTITUTE_ONLY",
        INSTITUTE_LIST,
        "ru",
      );

      expect(result.defaultCountry).toBe("gb");
      expect(result.detectedCountry).toBeNull();
    });

    it("holds the India default rather than following the visitor when unconfigured", () => {
      const result = resolvePhoneCountries("INSTITUTE_ONLY", [], "ru");

      expect(result.defaultCountry).toBe("in");
      expect(result.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
    });
  });

  it("keeps every country the per-form fallbacks used to pin", () => {
    // The catalogue checkout and enrolment-payment dialogs each carried their
    // own ["in","us","gb","au","ae"] before these lists were unified. Losing
    // "ae" would make a Gulf buyer scroll for their own country on the payment
    // screen — a silent regression with no error to notice it by.
    expect(DEFAULT_PREFERRED_COUNTRIES).toContain("ae");
    expect(DEFAULT_PREFERRED_COUNTRIES[0]).toBe("in");
  });

  it("defaults to the mode that preserves pre-existing behaviour", () => {
    expect(DEFAULT_PHONE_COUNTRY_GEO_MODE).toBe("INSTITUTE_FIRST");
    expect(
      resolvePhoneCountries(DEFAULT_PHONE_COUNTRY_GEO_MODE, INSTITUTE_LIST, "ru")
        .defaultCountry,
    ).toBe("gb");
  });
});

describe("an unresolved institute is never overridden by geo", () => {
  // Several public routes (the product-page checkout, the assessment
  // registration form) render phone fields without ever resolving domain
  // routing. On a cold browser the institute's preference — and its
  // INSTITUTE_ONLY opt-out — is unknown there. Both "configured nothing" and
  // "never asked" leave the country list empty, so without a marker the form
  // would take the geo branch and ignore a portal that asked not to be located.

  it("withholding the visitor keeps such a route on the pre-feature default", () => {
    const result = resolvePhoneCountries("INSTITUTE_FIRST", [], null);

    expect(result.defaultCountry).toBe("in");
    expect(result.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
  });

  it("and INSTITUTE_ONLY cannot be overridden even if a country IS detected", () => {
    expect(resolvePhoneCountries("INSTITUTE_ONLY", ["ae"], "ru").defaultCountry).toBe("ae");
    expect(resolvePhoneCountries("INSTITUTE_ONLY", [], "ru").defaultCountry).toBe("in");
  });

  it("hasResolvedPhonePreferences is false until a resolve has happened", () => {
    localStorage.clear();
    expect(hasResolvedPhonePreferences()).toBe(false);
  });

  it("and true once the mode has been cached, even for a null column", () => {
    localStorage.clear();
    // A null column still writes a concrete value — that is what makes the key
    // a reliable "we asked" marker rather than "they configured something".
    setCachedPhoneCountryGeoMode(null);

    expect(hasResolvedPhonePreferences()).toBe(true);
    localStorage.clear();
  });
});

describe("countryFromTimeZone", () => {
  it.each([
    ["Europe/Moscow", "ru"],
    ["America/New_York", "us"],
    ["Asia/Kolkata", "in"],
    // Chrome reported the legacy spelling for years and some devices still do.
    ["Asia/Calcutta", "in"],
    ["Europe/Kyiv", "ua"],
    ["Europe/Kiev", "ua"],
    ["Asia/Saigon", "vn"],
    ["Asia/Dubai", "ae"],
    ["Australia/Sydney", "au"],
    ["Europe/London", "gb"],
  ])("maps %s to %s", (zone, expected) => {
    expect(countryFromTimeZone(zone)).toBe(expected);
  });

  it.each([["Etc/GMT+5"], ["UTC"], ["Not/AZone"], [""], [null], [undefined]])(
    "returns null for %s, which names no country",
    (zone) => {
      expect(countryFromTimeZone(zone as string | null | undefined)).toBeNull();
    },
  );
});

describe("every country we can emit is one the phone input can render", () => {
  // Handing react-phone-input-2 a country it has no entry for does NOT fall back
  // to a default — it renders an empty field with no flag and no dial code, so
  // the visitor cannot tell what their number will be read as. The IANA zone
  // table names 13 such territories. This is the learner-side copy of the same
  // invariant the admin suite pins; both bundles ship their own zone table.
  const LIBRARY_ISO2 = new Set(
    [
      ...readFileSync(require.resolve("react-phone-input-2"), "utf8").matchAll(
        /"([a-z]{2})",\s*"[0-9]{1,4}"/g,
      ),
    ].map((m) => m[1]),
  );

  it("the library list we validate against was actually found", () => {
    expect(LIBRARY_ISO2.size).toBeGreaterThan(200);
    expect(LIBRARY_ISO2.has("ru")).toBe(true);
  });

  it.each([
    ["Europe/Mariehamn", "fi"],
    ["Indian/Cocos", "au"],
    ["Indian/Christmas", "au"],
    ["Africa/El_Aaiun", "ma"],
    ["Europe/Guernsey", "gb"],
    ["Atlantic/South_Georgia", "fk"],
    ["Europe/Isle_of_Man", "gb"],
    ["Pacific/Pitcairn", "nz"],
    ["Arctic/Longyearbyen", "no"],
    ["Indian/Kerguelen", "re"],
    ["Pacific/Midway", "us"],
    ["Indian/Mayotte", "re"],
  ])("%s resolves to %s — its real dialling plan, not a dead field", (zone, expected) => {
    expect(countryFromTimeZone(zone)).toBe(expected);
  });

  it("Antarctica has no dialling plan, so it resolves to null", () => {
    expect(countryFromTimeZone("Antarctica/McMurdo")).toBeNull();
  });

  it("NO timezone anywhere can produce a country the library cannot render", () => {
    const unrenderable = ALL_ZONES.map((z) => countryFromTimeZone(z))
      .filter((c): c is string => c !== null)
      .filter((c) => !LIBRARY_ISO2.has(c));

    expect([...new Set(unrenderable)]).toEqual([]);
  });

  it("a hand-typed override cannot produce a dead field either", () => {
    expect(countryFromLanguageTag("en-UK")).toBe("gb");
    expect(countryFromLanguageTag("en-ZZ")).toBeNull();
  });
});

describe("countryFromLanguageTag", () => {
  it.each([
    ["ru-RU", "ru"],
    ["en-GB", "gb"],
    ["zh-Hant-TW", "tw"],
    ["pt_BR", "br"],
  ])("reads the region out of %s", (tag, expected) => {
    expect(countryFromLanguageTag(tag)).toBe(expected);
  });

  it.each([["en"], ["und"], [""], [null]])(
    "returns null for %s, which carries no region",
    (tag) => {
      expect(countryFromLanguageTag(tag as string | null)).toBeNull();
    },
  );

  it("does not mistake a Unicode extension key for a region", () => {
    // The `ca` in `en-u-ca-gregory` names the calendar, not Canada.
    expect(countryFromLanguageTag("en-u-ca-gregory")).toBeNull();
    expect(countryFromLanguageTag("en-t-jp")).toBeNull();
    expect(countryFromLanguageTag("en-GB-u-ca-gregory")).toBe("gb");
  });
});

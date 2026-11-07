import { describe, expect, it } from "vitest";

import {
  COUNTRY_NAME_TO_CODE_MAP,
  getCountryCode,
  lookupCountryCode,
} from "./country-code-mapping";

/**
 * `lookupCountryCode` was split out of `getCountryCode` so a caller can tell
 * "the visitor chose a country" apart from "nothing to go on". That distinction
 * decides whether a form passes a `country` prop to PhoneInputField at all —
 * and passing one suppresses the field's own institute-preference/geo
 * resolution, so a guess dressed up as an answer would pin the field to the
 * platform fallback.
 *
 * `getCountryCode` keeps every one of its old callers (the state/city lookup in
 * registration-step among them), so these assert the refactor did not move it.
 */
describe("getCountryCode is unchanged by the lookupCountryCode split", () => {
  it.each([
    ["India", "in"],
    ["india", "in"],
    ["  Germany  ", "de"],
    ["UNITED KINGDOM", "gb"],
    ["bosnia and herzegovina", "ba"],
  ])("maps %j to %j", (name, expected) => {
    expect(getCountryCode(name)).toBe(expected);
    expect(lookupCountryCode(name)).toBe(expected);
  });

  it.each([[""], ["Freedonia"], ["  "], ["12345"]])(
    "falls back to the caller's default for %j",
    (name) => {
      // The historical default, still relied on by the state/city lookup.
      expect(getCountryCode(name)).toBe("au");
      expect(getCountryCode(name, "in")).toBe("in");
    },
  );

  it("agrees with lookupCountryCode across the whole table", () => {
    for (const name of Object.keys(COUNTRY_NAME_TO_CODE_MAP)) {
      expect(getCountryCode(name, "zz")).toBe(lookupCountryCode(name));
    }
  });
});

describe("lookupCountryCode says nothing rather than guessing", () => {
  it.each([[""], [null], [undefined], ["Freedonia"], ["   "]])(
    "returns undefined for %j",
    (name) => {
      expect(lookupCountryCode(name as string)).toBeUndefined();
    },
  );

  it("is the only difference: a real name still resolves", () => {
    expect(lookupCountryCode("Australia")).toBe("au");
  });
});

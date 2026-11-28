import { describe, expect, it } from "vitest";
import {
  DESKTOP_AUTH_CLASSES,
  MOBILE_AUTH_CLASSES,
  desktopAuthVariant,
  desktopNavItemClasses,
  mobileAuthVariant,
  orderSwitcherLocales,
} from "./header-variants";

/**
 * The literal class strings below are what the header rendered before these
 * options existed. A header without the new props must keep producing them
 * exactly — this pins that.
 */
describe("auth button looks", () => {
  it("keeps the original position rule when no style is set", () => {
    expect(DESKTOP_AUTH_CLASSES[desktopAuthVariant(undefined, 0)]).toBe("bg-primary-500 text-white hover:bg-primary-400");
    expect(DESKTOP_AUTH_CLASSES[desktopAuthVariant(undefined, 1)]).toBe(
      "border border-primary-500 text-primary-500 hover:bg-primary-50",
    );
    expect(DESKTOP_AUTH_CLASSES[desktopAuthVariant(undefined, 3)]).toBe(
      "border border-primary-500 text-primary-500 hover:bg-primary-50",
    );
    expect(MOBILE_AUTH_CLASSES[mobileAuthVariant(undefined, 0)]).toBe("bg-primary-500 text-white hover:bg-primary-400");
    expect(MOBILE_AUTH_CLASSES[mobileAuthVariant(undefined, 1)]).toBe("text-primary-500 hover:bg-primary-50");
  });

  it("uses the authored style wherever the button sits", () => {
    expect(desktopAuthVariant("text", 0)).toBe("text");
    expect(desktopAuthVariant("primary", 1)).toBe("primary");
    expect(desktopAuthVariant("outline", 0)).toBe("outline");
    expect(mobileAuthVariant("outline", 1)).toBe("outline");
    expect(mobileAuthVariant("primary", 2)).toBe("primary");
  });

  it("ignores unknown styles", () => {
    expect(desktopAuthVariant("fancy", 0)).toBe("primary");
    expect(desktopAuthVariant("", 1)).toBe("outline");
    expect(mobileAuthVariant(42, 1)).toBe("text");
  });
});

describe("desktopNavItemClasses", () => {
  it("keeps the original pill classes when no active style is set", () => {
    expect(desktopNavItemClasses(true, undefined)).toBe("text-primary-500 bg-primary-50");
    expect(desktopNavItemClasses(false, undefined)).toBe(
      "text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover",
    );
    expect(desktopNavItemClasses(true, "pill")).toBe("text-primary-500 bg-primary-50");
  });

  it("underlines the active item for the underline style", () => {
    expect(desktopNavItemClasses(true, "underline")).toContain("underline");
    expect(desktopNavItemClasses(true, "underline")).toContain("text-primary-500");
    expect(desktopNavItemClasses(true, "underline")).not.toContain("bg-primary-50");
    expect(desktopNavItemClasses(false, "underline")).not.toMatch(/(^|\s)underline(\s|$)/);
  });
});

describe("orderSwitcherLocales", () => {
  const offered = [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ];

  it("puts the base language last: हिन्दी | EN on an English site, whatever the stored order", () => {
    // The Languages settings always save the base language first.
    expect(orderSwitcherLocales(offered, [{ code: "en" }, { code: "hi" }], "en").map((l) => l.label)).toEqual([
      "हिन्दी",
      "EN",
    ]);
    expect(orderSwitcherLocales(offered, [{ code: "hi" }, { code: "en" }], "en").map((l) => l.code)).toEqual([
      "hi",
      "en",
    ]);
    expect(orderSwitcherLocales(offered, undefined, " EN ").map((l) => l.code)).toEqual(["hi", "en"]);
    // A Hindi site offers English first.
    expect(orderSwitcherLocales(offered, undefined, "hi").map((l) => l.code)).toEqual(["en", "hi"]);
  });

  it("keeps the stored order among the other languages", () => {
    const three = [...offered, { code: "mr", label: "मराठी" }];
    expect(
      orderSwitcherLocales(three, [{ code: "en" }, { code: "mr" }, { code: "hi" }], "en").map((l) => l.code),
    ).toEqual(["mr", "hi", "en"]);
    expect(orderSwitcherLocales(three, [{ code: "en" }], "en").map((l) => l.code)).toEqual(["hi", "mr", "en"]);
  });

  it("without a base language follows the stored order, then the offered one, ignoring unknown codes", () => {
    expect(orderSwitcherLocales(offered, [{ code: " HI " }]).map((l) => l.code)).toEqual(["hi", "en"]);
    expect(orderSwitcherLocales(offered, undefined).map((l) => l.code)).toEqual(["en", "hi"]);
    expect(orderSwitcherLocales(offered, [{ code: "fr" }, {}], "fr").map((l) => l.code)).toEqual(["en", "hi"]);
  });
});

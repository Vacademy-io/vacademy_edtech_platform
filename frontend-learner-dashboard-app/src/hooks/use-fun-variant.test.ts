// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  FUN_VARIANT_FONTS,
  FUN_VARIANT_FONTS_LINK_ID,
  isDarkFunVariantOn,
  readFunVariant,
  syncFunVariantFonts,
} from "./use-fun-variant";

const root = () => document.documentElement;

beforeEach(() => {
  root().className = "light";
  document.getElementById(FUN_VARIANT_FONTS_LINK_ID)?.remove();
});

describe("Fun variants", () => {
  it("reads the variant class, none for plain Fun", () => {
    root().className = "light ui-fun";
    expect(readFunVariant()).toBeNull();
    root().className = "light ui-fun ui-stage";
    expect(readFunVariant()).toBe("stage");
    root().className = "light ui-fun ui-neon-city";
    expect(readFunVariant()).toBe("neonCity");
  });

  it("only the night skins are dark", () => {
    root().className = "light ui-fun ui-pulse";
    expect(isDarkFunVariantOn()).toBe(true);
    root().className = "light ui-fun ui-neon-city";
    expect(isDarkFunVariantOn()).toBe(true);
    root().className = "light ui-fun ui-calm";
    expect(isDarkFunVariantOn()).toBe(false);
    root().className = "light ui-fun";
    expect(isDarkFunVariantOn()).toBe(false);
  });

  it("keeps one font link, swapped per variant and removed when off", () => {
    syncFunVariantFonts("stage");
    syncFunVariantFonts("pulse");
    const links = document.querySelectorAll(`#${FUN_VARIANT_FONTS_LINK_ID}`);
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(FUN_VARIANT_FONTS.pulse);
    syncFunVariantFonts(null);
    expect(document.getElementById(FUN_VARIANT_FONTS_LINK_ID)).toBeNull();
  });
});

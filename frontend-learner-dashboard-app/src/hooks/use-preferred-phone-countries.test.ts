// @vitest-environment jsdom
//
// Covers the race that made a phone field show +91 to a visitor in any country:
// the form renders, THEN domain routing answers, and nothing re-read the answer.
// See `hooks/use-preferred-phone-countries` for the measurements.
//
// Modules are reset between tests because the domain-routing service holds the
// phone-preference cache in module scope, and "this device has never resolved an
// institute" is precisely the state under test.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Service = typeof import("@/services/domain-routing");
type HookModule = typeof import("./use-preferred-phone-countries");

/**
 * Minimal renderHook. The app has no @testing-library/react (the vitest config
 * only picks up `*.test.ts`, so there are no component tests to need it) and
 * this needs exactly one probe component.
 */
const renderHook = <T,>(hook: () => T) => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const result = { current: undefined as T };
  const Probe = () => {
    result.current = hook();
    return null;
  };

  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    result,
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
};

let service: Service;
let usePreferredPhoneCountries: HookModule["usePreferredPhoneCountries"];
const mounted: Array<() => void> = [];

beforeEach(async () => {
  window.localStorage.clear();
  // The visitor's country comes from the browser timezone, which jsdom reports
  // as the machine's. `?phoneCountry=` is the supported override and is what
  // support uses to reproduce what a visitor abroad sees, so the tests drive
  // detection through the same door. Set before any import so nothing has
  // memoized a detection yet.
  window.history.replaceState({}, "", "/?phoneCountry=us");

  const vitest = await import("vitest");
  vitest.vi.resetModules();

  service = await import("@/services/domain-routing");
  // Imported after the reset so it closes over the same fresh service instance.
  ({ usePreferredPhoneCountries } = await import("./use-preferred-phone-countries"));
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

const render = (options?: { freeze?: boolean }) => {
  const handle = renderHook(() => usePreferredPhoneCountries(options));
  mounted.push(handle.unmount);
  return handle;
};

/** What `resolveDomainRouting` does on a successful reply, in the same order. */
const domainRoutingReplies = (preferred: string | null, mode: string | null) => {
  act(() => {
    service.setCachedPreferredCountries(preferred);
    service.setCachedPhoneCountryGeoMode(mode);
  });
};

describe("THE BUG: a form that renders before domain routing replies", () => {
  it("starts on the platform fallback while the institute is still unknown", () => {
    // Not a bug in itself — geo-detection is deliberately withheld until we know
    // what the institute wants, so an INSTITUTE_ONLY portal is never overridden.
    const { result } = render();

    expect(service.hasResolvedPhonePreferences()).toBe(false);
    expect(result.current.defaultCountry).toBe("in");
  });

  it("corrects itself to the visitor's country when the reply finally lands", () => {
    // This is the regression. Before the subscription existed the field stayed
    // on +91 forever, because every caller read the cache once and memoized it.
    const { result } = render();
    expect(result.current.defaultCountry).toBe("in");

    // Elevate Education's real configuration: no preferred countries, default mode.
    domainRoutingReplies("", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("us");
    expect(result.current.preferredCountries[0]).toBe("us");
  });

  it("still lets a configured institute list win over the visitor", () => {
    const { result } = render();

    domainRoutingReplies("gb,ie", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("gb");
    expect(result.current.preferredCountries).toEqual(["gb", "ie"]);
  });

  it("never consults the visitor under INSTITUTE_ONLY", () => {
    const { result } = render();

    domainRoutingReplies("", "INSTITUTE_ONLY");

    expect(result.current.defaultCountry).toBe("in");
    expect(result.current.detectedCountry).toBeNull();
  });
});

describe("RULE 1: the institute's live answer wins, and confirming it costs nothing", () => {
  it("keeps the cached answer when the reply agrees with it", () => {
    domainRoutingReplies("gb", "INSTITUTE_FIRST");
    const { result } = render();
    const first = result.current;

    domainRoutingReplies("gb", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("gb");
    // Same object: React bailed out, so no phone widget saw a changed prop.
    expect(result.current).toBe(first);
  });

  it("takes a genuinely different answer — the cache is not authoritative", () => {
    // Only a live resolve can trigger this (nothing else writes those caches),
    // so a changed answer means the institute really did say something else.
    // Honouring it is the whole point: a stale cache must never outrank the
    // preference this portal just sent us.
    domainRoutingReplies("gb", "INSTITUTE_FIRST");
    const { result } = render();
    expect(result.current.defaultCountry).toBe("gb");

    domainRoutingReplies("de", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("de");
  });

  it("waits for the geo mode, not just the country list", () => {
    // `resolveDomainRouting` writes the two caches in sequence. Only the second
    // marks the preferences resolved; acting on the first would read a
    // half-written state as final.
    const { result } = render();

    act(() => {
      service.setCachedPreferredCountries("");
    });
    expect(service.hasResolvedPhonePreferences()).toBe(false);
    expect(result.current.defaultCountry).toBe("in");

    act(() => {
      service.setCachedPhoneCountryGeoMode("INSTITUTE_FIRST");
    });
    expect(result.current.defaultCountry).toBe("us");
  });
});

describe("RULE 2: never change the country under someone who is typing", () => {
  // react-phone-input-2's componentDidUpdate reacts to a changed `country` prop
  // by calling updateCountry, which overwrites the field with just the new dial
  // code AND does not fire onChange — so react-hook-form would keep the old full
  // number while the box showed "+1". Verified against the installed 2.15.1.
  it("drops the late correction while the field holds a number", () => {
    const { result } = render({ freeze: true });
    expect(result.current.defaultCountry).toBe("in");

    domainRoutingReplies("", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("in");
  });

  it("drops it permanently — a later unfreeze does not re-apply it", () => {
    // Clearing the box after the preference landed must not suddenly swap the
    // country: the visitor has been looking at that flag, and they can change it
    // themselves in one click.
    let frozen = true;
    const handle = renderHook(() => usePreferredPhoneCountries({ freeze: frozen }));
    mounted.push(handle.unmount);

    domainRoutingReplies("", "INSTITUTE_FIRST");
    expect(handle.result.current.defaultCountry).toBe("in");

    frozen = false;
    domainRoutingReplies("", "INSTITUTE_FIRST");
    expect(handle.result.current.defaultCountry).toBe("in");
  });
});

describe("the subscription itself", () => {
  it("stops delivering after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = service.subscribePhoneCountries(() => {
      calls += 1;
    });

    service.setCachedPhoneCountryGeoMode("INSTITUTE_FIRST");
    expect(calls).toBe(1);

    unsubscribe();
    service.setCachedPhoneCountryGeoMode("GEO_FIRST");
    expect(calls).toBe(1);
  });

  it("survives a listener that throws, and still reaches the others", () => {
    // A subscriber must never be able to break the domain-routing resolve it is
    // riding on.
    const reached: string[] = [];
    service.subscribePhoneCountries(() => {
      throw new Error("boom");
    });
    service.subscribePhoneCountries(() => {
      reached.push("second");
    });

    expect(() => service.setCachedPhoneCountryGeoMode("INSTITUTE_FIRST")).not.toThrow();
    expect(reached).toEqual(["second"]);
  });

  it("does not leak a listener after the component unmounts", () => {
    const { unmount } = render();
    unmount();

    // The listener is gone, so this must not attempt a state update on an
    // unmounted root.
    expect(() => domainRoutingReplies("", "INSTITUTE_FIRST")).not.toThrow();
  });
});

describe("PRECEDENCE: a configured preferred country always beats geo", () => {
  // The product rule, asserted on the path this hook actually controls. The
  // pure resolver is covered in services/phone-country-resolution.test.ts; what
  // matters here is that a late reply cannot end up choosing geo over a list
  // the institute did configure.

  it("uses the institute list, not the visitor, when the reply is slow", () => {
    const { result } = render();
    expect(result.current.defaultCountry).toBe("in");

    domainRoutingReplies("gb,ie", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("gb");
    expect(result.current.detectedCountry).toBe("us"); // detected, and overruled
  });

  it("only falls through to geo when the institute configured nothing", () => {
    const { result } = render();

    domainRoutingReplies("", "INSTITUTE_FIRST");

    expect(result.current.defaultCountry).toBe("us");
  });

  it("REGRESSION: a stale cache from a previously-visited institute must not pin geo", () => {
    // The device already carries a geo-mode key from institute A, which had no
    // preferred countries. `hasResolvedPhonePreferences()` therefore reads TRUE
    // before institute B has said anything, so a hook that settles on the first
    // render would use A's empty list, pick the visitor, and then ignore B's
    // real reply — showing +1 to a visitor on a portal that explicitly asked
    // for +44.
    window.localStorage.setItem("InstitutePhoneCountryGeoMode", "INSTITUTE_FIRST");

    const { result } = render();
    expect(result.current.defaultCountry).toBe("us"); // A's (empty) preference

    domainRoutingReplies("gb,ie", "INSTITUTE_FIRST"); // B finally answers

    expect(result.current.defaultCountry).toBe("gb");
    expect(result.current.preferredCountries).toEqual(["gb", "ie"]);
  });

  it("does not re-render when the reply merely confirms what was cached", () => {
    // The fast path. Same answer in must mean no new object out, or every phone
    // field on the page would see a changed `country` prop for no reason.
    domainRoutingReplies("gb,ie", "INSTITUTE_FIRST");
    const { result } = render();
    const first = result.current;

    domainRoutingReplies("gb,ie", "INSTITUTE_FIRST");

    expect(result.current).toBe(first); // identity, not just equality
  });
});

describe("phoneFieldHasInput: the freeze signal", () => {
  it("treats a dial-code-only value as input — this is the bug isBlankPhone hid", async () => {
    // Picking a country from the flag dropdown fires onChange("44"), which the
    // form stores as "+44". `isBlankPhone` calls that blank (<=3 digits), so
    // freezing on it left an explicit country choice unprotected — and a visitor
    // correcting a wrong flag on a slow load is exactly who this must protect.
    const { phoneFieldHasInput } = await import("./use-preferred-phone-countries");
    const { isBlankPhone } = await import("@/lib/phone-validation");

    expect(isBlankPhone("+44")).toBe(true); // why the old test was wrong
    expect(phoneFieldHasInput("+44")).toBe(true); // why the new one is right
  });

  it.each([["+1"], ["+91"], ["+919876543210"], ["44"], ["7"]])(
    "counts %j as the visitor having acted",
    async (value) => {
      const { phoneFieldHasInput } = await import("./use-preferred-phone-countries");
      expect(phoneFieldHasInput(value)).toBe(true);
    },
  );

  it.each([[""], ["+"], [null], [undefined], [{}], [42]])(
    "counts %j as untouched",
    async (value) => {
      // An untouched field stores "": the dial code shown in the box is internal
      // to the widget and never reaches form state. Non-strings are not input.
      const { phoneFieldHasInput } = await import("./use-preferred-phone-countries");
      expect(phoneFieldHasInput(value)).toBe(false);
    },
  );

  it("protects a country the visitor picked from the dropdown", () => {
    // End to end through the hook: the field holds only the dial code of the
    // country they chose, and the institute's answer arrives a second later.
    const { result } = render({ freeze: phoneFieldHasInputAtRender("+44") });
    expect(result.current.defaultCountry).toBe("in");

    domainRoutingReplies("", "INSTITUTE_FIRST");

    // Not "us": their explicit choice outranks our late correction.
    expect(result.current.defaultCountry).toBe("in");
  });
});

/** Local mirror so the case above reads as the call site writes it. */
function phoneFieldHasInputAtRender(value: string): boolean {
  return typeof value === "string" && /\d/.test(value);
}

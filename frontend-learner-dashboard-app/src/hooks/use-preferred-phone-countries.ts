/**
 * Reads the country a phone field should start on, and — unlike a bare
 * `getPreferredPhoneCountries()` call — notices when the institute's
 * preferences arrive late.
 *
 * ## Why this exists
 *
 * `getPreferredPhoneCountries()` is synchronous by design: `react-phone-input-2`
 * resets the field to a bare dial code whenever its `country` prop changes (see
 * the freeze rule below), so the country has to be known at mount. But the value
 * it reads is filled by `resolveDomainRouting()`, an async call that public
 * routes never wait for — `/learner-invitation-response` and friends are in
 * `PUBLIC_ROUTES`, so the root `beforeLoad` returns before the auth branch that
 * resolves routing.
 *
 * Measured against production: the phone field mounts ~1.95s in and domain
 * routing answers ~1.93s in. Roughly 30ms of margin. On a slower connection the
 * order flips, `hasResolvedPhonePreferences()` reads false, geo-detection is
 * withheld, and the field falls back to `DEFAULT_PREFERRED_COUNTRIES[0]` — +91
 * for a visitor anywhere on earth — and stays there, because every caller read
 * the cache once and memoized it.
 *
 * ## The two rules that keep this safe
 *
 * 1. **The institute's own answer always wins, whenever it arrives.** Every
 *    notification is a live `resolveDomainRouting` reply — those two setters
 *    have no other caller — so each one is this page's institute speaking, and
 *    it outranks whatever the device happened to have cached.
 *
 *    Settling on the first *resolved-looking* read is not enough, and that is
 *    the subtle case: `InstitutePhoneCountryGeoMode` persists across visits, so
 *    a device that previously opened an institute with no preferred countries
 *    reads as "resolved" on arrival at one that has `gb,ie`. A hook that
 *    stopped there would pick the visitor's country and then ignore the real
 *    reply — showing +1 on a portal that explicitly asked for +44, which
 *    inverts the product rule that a configured preference beats geo.
 *
 *    Re-applying is safe because the answer is compared before it is stored: a
 *    reply that merely confirms the cache returns the identical object, React
 *    bails out of the re-render, and the phone widget never sees a changed
 *    `country` prop. So the common case — cache already correct — still costs
 *    nothing, exactly like the direct call this replaced.
 *
 * 2. **Never under someone who is typing.** `react-phone-input-2`'s
 *    `componentDidUpdate` reacts to a changed `country` prop by calling
 *    `updateCountry`, which overwrites `formattedNumber` with just the new dial
 *    code — discarding the digits typed so far — and does NOT fire `onChange`,
 *    so react-hook-form would keep the old full number while the box showed
 *    "+1". Callers pass `freeze` (normally `!isBlankPhone(value)`); when it is
 *    set at the moment the preference lands, the late update is dropped
 *    permanently and the field keeps the country it already had.
 *
 * ## Known limitation: a late list moves the flag, not the picker order
 *
 * `react-phone-input-2` copies `preferredCountries` into state in its
 * constructor, and its `componentDidUpdate` reacts only to `country` and
 * `value`. So when the institute's list arrives late, the selected country and
 * dial code update — the thing this whole module exists for — but the pinned
 * order inside the dropdown stays on whatever list was there at mount.
 *
 * Forcing a remount with `key={preferredCountries.join(",")}` looks like the
 * obvious fix and is NOT one: it was tried, and it breaks the correction
 * outright — the remounted widget comes back on the platform fallback (+91)
 * instead of the resolved country, verified in a browser across every case in
 * this module's test matrix. Do not reintroduce it without that matrix passing.
 *
 * The residual cost is cosmetic: on a cold cache the picker pins the platform
 * default list rather than the institute's, in a dropdown that still lists every
 * country and whose selected entry is correct. That is strictly better than
 * before this module existed, when the dial code itself was wrong.
 *
 * Rule 2 costs nothing in practice: the form itself takes ~2s to appear, so the
 * window in which a visitor could have typed before the preference lands is
 * tiny — and in that window keeping their digits is plainly worth more than
 * correcting a flag they can change in one click.
 */
import { useEffect, useRef, useState } from "react";

import {
  getPreferredPhoneCountries,
  hasResolvedPhonePreferences,
  subscribePhoneCountries,
  type ResolvedPhoneCountries,
} from "@/services/domain-routing";

/**
 * Whether a phone field already carries something of the visitor's own, and so
 * must not have its country changed underneath it. This is the value to pass as
 * {@link UsePreferredPhoneCountriesOptions.freeze}.
 *
 * **Do not use `isBlankPhone` for this.** That answers a different question —
 * "is this a usable phone number?" — and deliberately calls anything with three
 * or fewer digits blank, because a field holding only a dial code has not really
 * been filled in. But picking a country from the flag dropdown fires
 * `onChange("44")` (`handleFlagItemClick` in react-phone-input-2 2.15.1), so an
 * explicit choice of the United Kingdom is stored as `"+44"` — two digits, which
 * `isBlankPhone` calls blank. Freezing on that test would leave the visitor's
 * own country selection unprotected, and it is the single likeliest thing for
 * them to do on a slow load: see the wrong flag, fix it, and have the late
 * preference silently overwrite it a second later.
 *
 * An untouched field stores the empty string — the dial code the box displays is
 * internal to the widget and never reaches form state — so "holds a digit" is
 * exactly "the visitor picked a country or typed something". It also covers a
 * pre-filled edit form, which needs the same protection: `updateCountry`
 * overwrites the box on a `country` prop change whatever the current value is.
 */
export const phoneFieldHasInput = (value: unknown): boolean =>
  typeof value === "string" && /\d/.test(value);

export interface UsePreferredPhoneCountriesOptions {
  /**
   * True when this field already carries the visitor's own input. While set, a
   * late-arriving preference is ignored rather than overwriting it. Pass
   * {@link phoneFieldHasInput} of the field's value.
   */
  freeze?: boolean;
}

export const usePreferredPhoneCountries = (
  options?: UsePreferredPhoneCountriesOptions,
): ResolvedPhoneCountries => {
  const [resolved, setResolved] = useState<ResolvedPhoneCountries>(
    // Lazy: `getPreferredPhoneCountries` touches localStorage, and re-running it
    // on every render of a form with several phone fields is pure waste.
    getPreferredPhoneCountries,
  );

  // Rule 2's latch. Once a correction has been withheld because the visitor was
  // typing, this field stops accepting them for good — re-applying later would
  // move the country under someone who has been looking at that flag.
  const abandoned = useRef(false);

  // Mirrored into a ref because the listener below is registered once, on mount,
  // and would otherwise close over the `freeze` of that first render.
  const freezeRef = useRef(options?.freeze ?? false);
  freezeRef.current = options?.freeze ?? false;

  useEffect(() => {
    const apply = () => {
      if (abandoned.current) return;

      // A notification can fire before the institute is actually known:
      // `resolveDomainRouting` writes the preferred-countries cache first and
      // the geo mode second, and only the second flips this to true. Waiting for
      // it is what stops a half-written state — a country list with no mode yet
      // — from being read as this institute's final answer.
      if (!hasResolvedPhonePreferences()) return;

      if (freezeRef.current) {
        abandoned.current = true;
        return;
      }

      const next = getPreferredPhoneCountries();
      setResolved((current) =>
        current.defaultCountry === next.defaultCountry &&
        current.preferredCountries.join(",") === next.preferredCountries.join(",")
          ? // Identical answer — the common case, where the reply only confirms
            // what was cached. Returning `current` keeps React from re-rendering,
            // and so keeps the phone widget from seeing a changed `country` prop
            // at all. This is what makes rule 1 free on the fast path.
            current
          : next,
      );
    };

    const unsubscribe = subscribePhoneCountries(apply);
    // The preferences can land between this component's render and this effect
    // (React commits asynchronously, and the resolve is already in flight), in
    // which case the notification we just subscribed to has already been missed.
    apply();

    return unsubscribe;
  }, []);

  return resolved;
};

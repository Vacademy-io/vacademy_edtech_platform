import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_PHONE_COUNTRY_GEO_MODE,
    DEFAULT_PREFERRED_COUNTRIES,
    resolvePhoneCountries,
    hasResolvedPhonePreferences,
    getPreferredPhoneCountries,
    cacheInstituteBranding,
} from '../../domain-routing';
import {
    countryFromLanguageTag,
    countryFromTimeZone,
    detectVisitorCountry,
    resetDetectedCountryForTests,
    ALL_ZONES,
} from '@/utils/geo-country';

const INSTITUTE_LIST = ['gb', 'ie'];

describe('GUARANTEE: a configured preferred country always beats geo-location', () => {
    // The product requirement in one block. The institute's DB preference is the
    // preference; the region a form is opened in is only ever a fallback for when
    // the institute has expressed none. Only the opt-in GEO_FIRST mode reverses
    // this, and it is never the default.

    it.each([['ru'], ['us'], ['de'], ['ae'], ['jp'], ['br'], [null]])(
        'a form opened in %s still starts on the institute\'s country',
        (openedIn) => {
            const result = resolvePhoneCountries('INSTITUTE_FIRST', ['gb', 'ie'], openedIn);

            expect(result.defaultCountry).toBe('gb');
        }
    );

    it('holds for a single-country institute, the most common configuration', () => {
        expect(resolvePhoneCountries('INSTITUTE_FIRST', ['in'], 'ru').defaultCountry).toBe('in');
    });

    it('holds under the default mode specifically — nobody has to opt in to get it', () => {
        expect(
            resolvePhoneCountries(DEFAULT_PHONE_COUNTRY_GEO_MODE, ['ae'], 'ru').defaultCountry
        ).toBe('ae');
    });

    it('geo only fills in when the institute expressed no preference at all', () => {
        expect(resolvePhoneCountries('INSTITUTE_FIRST', [], 'ru').defaultCountry).toBe('ru');
    });

    it('and a preference that has not LOADED yet still cannot be beaten by geo', () => {
        // The subtle half. An institute may have a preference in the database that
        // this page has not fetched yet — on a cold browser the configured list is
        // empty for a moment, and it looks identical to "configured nothing".
        // getPreferredPhoneCountries withholds the visitor entirely until a resolve
        // has happened, so geo cannot slip in ahead of a preference we simply have
        // not read. This is that call, with detection withheld.
        localStorage.clear();
        expect(hasResolvedPhonePreferences()).toBe(false);
        expect(getPreferredPhoneCountries().defaultCountry).toBe('in');

        // Once the institute's real preference lands, it takes over.
        cacheInstituteBranding('inst-1', {
            instituteId: 'inst-1',
            instituteName: 'Test',
            commaSeparatedPreferredCountry: 'ae,in',
        });
        expect(getPreferredPhoneCountries().defaultCountry).toBe('ae');
        localStorage.clear();
    });

    it('GEO_FIRST is the ONLY way the region can win, and it is opt-in', () => {
        expect(resolvePhoneCountries('GEO_FIRST', ['gb'], 'ru').defaultCountry).toBe('ru');
        expect(DEFAULT_PHONE_COUNTRY_GEO_MODE).not.toBe('GEO_FIRST');
    });
});

describe('resolvePhoneCountries', () => {
    describe('INSTITUTE_FIRST — the institute is the preference', () => {
        it('uses the configured list and ignores where the form is opened', () => {
            const result = resolvePhoneCountries('INSTITUTE_FIRST', INSTITUTE_LIST, 'ru');

            expect(result.defaultCountry).toBe('gb');
            expect(result.preferredCountries).toEqual(INSTITUTE_LIST);
        });

        it('keeps the configured ORDER, not just the membership', () => {
            expect(
                resolvePhoneCountries('INSTITUTE_FIRST', ['ae', 'in', 'us'], 'us').preferredCountries
            ).toEqual(['ae', 'in', 'us']);
        });

        it('falls back to the visitor when the institute configured nothing', () => {
            const result = resolvePhoneCountries('INSTITUTE_FIRST', [], 'ru');

            expect(result.defaultCountry).toBe('ru');
            // The visitor's country leads; the platform defaults fill in behind it.
            expect(result.preferredCountries).toEqual(['ru', 'in', 'us', 'gb', 'au', 'ae']);
        });

        it('does not duplicate the visitor when it is already a platform default', () => {
            const result = resolvePhoneCountries('INSTITUTE_FIRST', [], 'us');

            expect(result.preferredCountries).toEqual(['us', 'in', 'gb', 'au', 'ae']);
        });

        it('falls back to the platform default when nothing is known at all', () => {
            const result = resolvePhoneCountries('INSTITUTE_FIRST', [], null);

            expect(result.defaultCountry).toBe('in');
            expect(result.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
        });
    });

    describe('GEO_FIRST — the visitor wins', () => {
        it('pre-selects the visitor and keeps the institute list ordering behind it', () => {
            const result = resolvePhoneCountries('GEO_FIRST', INSTITUTE_LIST, 'ru');

            expect(result.defaultCountry).toBe('ru');
            expect(result.preferredCountries).toEqual(['ru', 'gb', 'ie']);
        });

        it('hoists rather than duplicates a visitor already in the institute list', () => {
            const result = resolvePhoneCountries('GEO_FIRST', ['gb', 'ie'], 'ie');

            expect(result.defaultCountry).toBe('ie');
            expect(result.preferredCountries).toEqual(['ie', 'gb']);
        });

        it('falls back to the institute list when the visitor cannot be placed', () => {
            const result = resolvePhoneCountries('GEO_FIRST', INSTITUTE_LIST, null);

            expect(result.defaultCountry).toBe('gb');
            expect(result.preferredCountries).toEqual(INSTITUTE_LIST);
        });
    });

    describe('INSTITUTE_ONLY — the visitor is never consulted', () => {
        it('ignores a detected country that was passed in anyway', () => {
            const result = resolvePhoneCountries('INSTITUTE_ONLY', INSTITUTE_LIST, 'ru');

            expect(result.defaultCountry).toBe('gb');
            expect(result.detectedCountry).toBeNull();
        });

        it('holds the India default rather than following the visitor when unconfigured', () => {
            const result = resolvePhoneCountries('INSTITUTE_ONLY', [], 'ru');

            expect(result.defaultCountry).toBe('in');
            expect(result.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
        });
    });

    it('keeps every country the per-form fallbacks used to pin', () => {
        // The catalogue checkout and enrolment-payment dialogs each carried their
        // own ['in','us','gb','au','ae'] before these lists were unified. Losing
        // 'ae' would make a Gulf buyer scroll for their own country on the
        // payment screen — a silent regression with no error to notice it by.
        expect(DEFAULT_PREFERRED_COUNTRIES).toContain('ae');
        expect(DEFAULT_PREFERRED_COUNTRIES[0]).toBe('in');
    });

    it('defaults to the mode that preserves pre-existing behaviour', () => {
        // An institute that has configured countries must see no change from
        // this feature until it opts in, so the default mode has to be the one
        // where its list still wins outright.
        expect(DEFAULT_PHONE_COUNTRY_GEO_MODE).toBe('INSTITUTE_FIRST');
        expect(
            resolvePhoneCountries(DEFAULT_PHONE_COUNTRY_GEO_MODE, INSTITUTE_LIST, 'ru')
                .defaultCountry
        ).toBe('gb');
    });
});

describe('an unresolved institute is never overridden by geo', () => {
    // The trap: several public routes (the product-page checkout, the assessment
    // registration form) render phone fields without ever resolving domain
    // routing. On a cold browser the institute's preference — and its
    // INSTITUTE_ONLY opt-out — is simply unknown there. Both "configured
    // nothing" and "never asked" leave the country list empty, so without a
    // marker the form would take the geo branch and quietly ignore a portal
    // that explicitly asked not to be geo-located.

    it('withholding the visitor keeps such a route on the pre-feature default', () => {
        // What getPreferredPhoneCountries passes when nothing has been resolved.
        const result = resolvePhoneCountries('INSTITUTE_FIRST', [], null);

        expect(result.defaultCountry).toBe('in');
        expect(result.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
    });

    it('and INSTITUTE_ONLY cannot be overridden even if a country IS detected', () => {
        expect(resolvePhoneCountries('INSTITUTE_ONLY', ['ae'], 'ru').defaultCountry).toBe('ae');
        expect(resolvePhoneCountries('INSTITUTE_ONLY', [], 'ru').defaultCountry).toBe('in');
    });

    it('hasResolvedPhonePreferences is false with no cached branding', () => {
        localStorage.clear();
        expect(hasResolvedPhonePreferences()).toBe(false);
    });

    it('and true once branding has been cached', () => {
        localStorage.clear();
        cacheInstituteBranding('inst-1', {
            instituteId: 'inst-1',
            instituteName: 'Test',
            commaSeparatedPreferredCountry: 'ae',
            phoneCountryGeoMode: 'INSTITUTE_ONLY',
        });

        expect(hasResolvedPhonePreferences()).toBe(true);
        // And now the institute's real preference drives the field.
        expect(getPreferredPhoneCountries().defaultCountry).toBe('ae');
        localStorage.clear();
    });
});

describe('countryFromTimeZone', () => {
    it.each([
        ['Europe/Moscow', 'ru'],
        ['America/New_York', 'us'],
        ['Asia/Kolkata', 'in'],
        // Chrome reported the legacy spelling for years and some devices still do.
        ['Asia/Calcutta', 'in'],
        ['Europe/Kyiv', 'ua'],
        ['Europe/Kiev', 'ua'],
        ['Asia/Saigon', 'vn'],
        ['Asia/Dubai', 'ae'],
        ['Australia/Sydney', 'au'],
        ['Europe/London', 'gb'],
    ])('maps %s to %s', (zone, expected) => {
        expect(countryFromTimeZone(zone)).toBe(expected);
    });

    it('is case-insensitive and tolerates padding', () => {
        expect(countryFromTimeZone('  europe/moscow  ')).toBe('ru');
    });

    it.each([
        ['Etc/GMT+5'],
        ['UTC'],
        ['Not/AZone'],
        [''],
        [null],
        [undefined],
    ])('returns null for %s, which names no country', (zone) => {
        expect(countryFromTimeZone(zone as string | null | undefined)).toBeNull();
    });
});

describe('every country we can emit is one the phone input can render', () => {
    // The bug this pins: handing react-phone-input-2 a country it has no entry
    // for does NOT fall back to a default — it renders an empty field with no
    // flag and no dial code, so the visitor cannot tell what their number will
    // be read as. `country="gg"` yields "" where `country="ru"` yields "+7".
    // The IANA zone table names 13 such territories, so detection has to be
    // filtered rather than trusted.
    const LIBRARY_ISO2 = new Set(
        [
            ...readFileSync(require.resolve('react-phone-input-2'), 'utf8').matchAll(
                /"([a-z]{2})",\s*"[0-9]{1,4}"/g
            ),
        ].map((m) => m[1])
    );

    it('the library list we validate against was actually found', () => {
        // Guards the assertions below from silently passing on an empty set if the
        // bundle's shape ever changes.
        expect(LIBRARY_ISO2.size).toBeGreaterThan(200);
        expect(LIBRARY_ISO2.has('ru')).toBe(true);
    });

    it.each([
        // Every zone whose country the library cannot render.
        ['Europe/Mariehamn', 'fi'], // Åland
        ['Indian/Cocos', 'au'],
        ['Indian/Christmas', 'au'],
        ['Africa/El_Aaiun', 'ma'], // Western Sahara
        ['Europe/Guernsey', 'gb'],
        ['Atlantic/South_Georgia', 'fk'],
        ['Europe/Isle_of_Man', 'gb'],
        ['Pacific/Pitcairn', 'nz'],
        ['Arctic/Longyearbyen', 'no'], // Svalbard
        ['Indian/Kerguelen', 're'], // French Southern Territories
        ['Pacific/Midway', 'us'], // US Minor Outlying
        ['Indian/Mayotte', 're'],
    ])('%s resolves to %s — its real dialling plan, not a dead field', (zone, expected) => {
        expect(countryFromTimeZone(zone)).toBe(expected);
    });

    it('Antarctica has no dialling plan, so it resolves to null rather than a broken field', () => {
        expect(countryFromTimeZone('Antarctica/McMurdo')).toBeNull();
    });

    it('NO timezone anywhere can produce a country the library cannot render', () => {
        // The real invariant, swept across all 549 zones rather than spot-checked.
        const unrenderable = ALL_ZONES.map((z) => countryFromTimeZone(z))
            .filter((c): c is string => c !== null)
            .filter((c) => !LIBRARY_ISO2.has(c));

        expect([...new Set(unrenderable)]).toEqual([]);
    });

    it('a hand-typed override cannot produce a dead field either', () => {
        // ?phoneCountry=uk is the spelling people actually type; it is not ISO.
        expect(countryFromLanguageTag('en-UK')).toBe('gb');
        // And genuine junk falls back rather than reaching the input.
        expect(countryFromLanguageTag('en-ZZ')).toBeNull();
        expect(countryFromLanguageTag('en-QQ')).toBeNull();
    });
});

describe('countryFromLanguageTag', () => {
    it.each([
        ['ru-RU', 'ru'],
        ['en-GB', 'gb'],
        ['zh-Hant-TW', 'tw'],
        ['pt_BR', 'br'],
    ])('reads the region out of %s', (tag, expected) => {
        expect(countryFromLanguageTag(tag)).toBe(expected);
    });

    it.each([['en'], ['und'], [''], [null]])(
        'returns null for %s, which carries no region',
        (tag) => {
            expect(countryFromLanguageTag(tag as string | null)).toBeNull();
        }
    );

    it('does not mistake a Unicode extension key for a region', () => {
        // The `ca` in `en-u-ca-gregory` names the calendar, not Canada. Scanning
        // the whole tag for "any two letters" reads it as a country.
        expect(countryFromLanguageTag('en-u-ca-gregory')).toBeNull();
        expect(countryFromLanguageTag('en-t-jp')).toBeNull();
        // A real region before the singleton is still found.
        expect(countryFromLanguageTag('en-GB-u-ca-gregory')).toBe('gb');
    });

    it.each([
        ['es-419'], // UN M.49 region, not a country
        ['ca-ES-valencia'], // variant after a region — region still wins
    ])('handles %s without inventing a country', (tag) => {
        const result = countryFromLanguageTag(tag);
        expect(result === null || result === 'es').toBe(true);
    });
});

describe('detectVisitorCountry', () => {
    beforeEach(() => {
        resetDetectedCountryForTests();
    });

    it('reads the browser timezone', () => {
        // jsdom resolves to whatever TZ the test process is in; asserting the
        // exact country would make this test machine-dependent. Asserting that
        // it agrees with the mapper is the real contract.
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const expected = countryFromTimeZone(zone) ?? countryFromLanguageTag(navigator.language);

        expect(detectVisitorCountry()).toBe(expected);
    });

    it('memoizes, so every phone field on a form pays for detection once', () => {
        expect(detectVisitorCountry()).toBe(detectVisitorCountry());
    });

    it('does not manufacture a country from the locale when the zone was withheld', () => {
        // A privacy browser reports `UTC` and, almost always, `en-US`. Trusting
        // the locale there would hand an Indian visitor +1 in exactly the case
        // where we know least — worse than the institute default they had before.
        const realIntl = Intl.DateTimeFormat;
        try {
            // @ts-expect-error — narrowing the global for one assertion
            Intl.DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: 'UTC' }) });
            resetDetectedCountryForTests();

            expect(detectVisitorCountry()).toBeNull();
        } finally {
            Intl.DateTimeFormat = realIntl;
            resetDetectedCountryForTests();
        }
    });

    it('still reads the locale when the browser has no timezone API at all', () => {
        // A genuinely absent signal is different from a withheld one, and is the
        // only case where a locale region is the best thing available.
        const realIntl = Intl.DateTimeFormat;
        try {
            // @ts-expect-error — narrowing the global for one assertion
            Intl.DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: undefined }) });
            resetDetectedCountryForTests();

            const expected = countryFromLanguageTag(navigator.language);
            expect(detectVisitorCountry()).toBe(expected);
        } finally {
            Intl.DateTimeFormat = realIntl;
            resetDetectedCountryForTests();
        }
    });
});

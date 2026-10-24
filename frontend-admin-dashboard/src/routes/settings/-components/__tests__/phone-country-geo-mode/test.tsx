import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The `t` used here is backed by the REAL en locale file, so a key this field
// renders but the locale never defines shows up as the raw
// `configForm.phone.geoModes.GEO_FIRST.label` string — which is exactly how it
// would look to an institute admin, and exactly what an assertion on English
// copy will catch. This screen has three option labels and three hints that all
// live behind interpolated key paths, which is precisely where a raw key hides.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../../public/locales/en/settingsWhiteLabel.json'))
        .default as Record<string, unknown>;

    const translate = (key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                en
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };

    return { useTranslation: () => ({ t: translate }) };
});

// Pin the "visitor" so the preview line is deterministic. Without this the test
// would assert whatever country CI happens to sit in.
vi.mock('@/utils/geo-country', () => ({
    detectVisitorCountry: vi.fn(() => 'ru'),
}));

import { detectVisitorCountry } from '@/utils/geo-country';
import PhoneCountryGeoModeField from '@/routes/settings/-components/PhoneCountryGeoModeField';

const detect = detectVisitorCountry as unknown as ReturnType<typeof vi.fn>;

const renderField = (props: Partial<React.ComponentProps<typeof PhoneCountryGeoModeField>> = {}) => {
    const onChange = vi.fn();
    render(
        <PhoneCountryGeoModeField
            value={undefined}
            preferredCountriesValue={undefined}
            onChange={onChange}
            {...props}
        />
    );
    return { onChange };
};

describe('PhoneCountryGeoModeField', () => {
    beforeEach(() => {
        detect.mockReturnValue('ru');
    });

    it('renders real copy, not raw i18n keys', () => {
        renderField();

        expect(screen.getByText('When a form is opened abroad')).toBeInTheDocument();
        // The selected option's label and its hint both come from interpolated
        // key paths — the shape most likely to silently fall through.
        expect(screen.getByText('Preferred countries win')).toBeInTheDocument();
        expect(screen.getByText(/The list above decides/)).toBeInTheDocument();
        expect(screen.queryByText(/configForm\.phone/)).not.toBeInTheDocument();
    });

    it('shows INSTITUTE_FIRST when the portal has never set a mode', () => {
        renderField({ value: undefined });

        expect(screen.getByText('Preferred countries win')).toBeInTheDocument();
    });

    it('falls back to INSTITUTE_FIRST rather than rendering a stored junk value', () => {
        renderField({ value: 'IP_LOOKUP' });

        expect(screen.getByText('Preferred countries win')).toBeInTheDocument();
    });

    describe('the resolution preview', () => {
        it("states the institute's country when its list wins", () => {
            renderField({ value: 'INSTITUTE_FIRST', preferredCountriesValue: 'gb,ie' });

            // Detected RU, but the configured list is authoritative → GB.
            expect(screen.getByText(/You are in .*RU\./)).toBeInTheDocument();
            expect(screen.getByText(/would start on .*GB\./)).toBeInTheDocument();
        });

        it("states the visitor's country when the visitor wins", () => {
            renderField({ value: 'GEO_FIRST', preferredCountriesValue: 'gb,ie' });

            expect(screen.getByText(/would start on .*RU\./)).toBeInTheDocument();
        });

        it('follows the visitor under INSTITUTE_FIRST when nothing is configured', () => {
            // The behaviour change this feature exists for: an unconfigured
            // portal stops hard-defaulting to India.
            renderField({ value: 'INSTITUTE_FIRST', preferredCountriesValue: undefined });

            expect(screen.getByText(/would start on .*RU\./)).toBeInTheDocument();
        });

        it('holds the platform default under INSTITUTE_ONLY', () => {
            renderField({ value: 'INSTITUTE_ONLY', preferredCountriesValue: undefined });

            expect(screen.getByText(/would start on .*IN\./)).toBeInTheDocument();
        });

        it('says so plainly when the region cannot be detected', () => {
            detect.mockReturnValue(null);
            renderField({ value: 'INSTITUTE_FIRST', preferredCountriesValue: undefined });

            expect(screen.getByText(/region could not be detected/)).toBeInTheDocument();
            expect(screen.getByText(/would start on .*IN\./)).toBeInTheDocument();
        });

        it('reflects unsaved edits to the preferred countries', () => {
            // The operator has typed a new list but not saved. The preview must
            // describe what they are about to save, not what is stored.
            renderField({ value: 'INSTITUTE_FIRST', preferredCountriesValue: 'ae,in' });

            expect(screen.getByText(/would start on .*AE\./)).toBeInTheDocument();
        });
    });

    // Radix renders its options in a portal only while open, and jsdom cannot
    // drive its pointer-event-based trigger without @testing-library/user-event
    // (not a dependency here). Asserting each mode's own copy renders when it is
    // the SELECTED one covers the same six locale keys the dropdown would show,
    // which is what actually breaks — the onChange wiring is a single typed
    // callback the compiler already checks.
    it.each([
        ['INSTITUTE_FIRST', 'Preferred countries win', /The list above decides/],
        ['GEO_FIRST', "Follow the visitor's country", /pre-selected/],
        ['INSTITUTE_ONLY', 'Preferred countries only', /Never look at where a form is opened from/],
    ])('renders the label and hint for %s', (mode, label, hint) => {
        renderField({ value: mode });

        expect(screen.getByText(label as string)).toBeInTheDocument();
        expect(screen.getByText(hint as RegExp)).toBeInTheDocument();
    });
});

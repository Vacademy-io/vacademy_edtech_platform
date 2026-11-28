import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import {
    asList,
    asPage,
    normalizeLocation,
    normalizeTaxClass,
    normalizeTaxSettings,
} from './commerce-api';
import { readCommerceError } from './commerce-errors';
import { GST_STATE_CODES, gstinCheckCharacter, gstinProblem, normalizeGstin } from './gstin';
import { isTrivialPin, looksLikePin, pinProblem, sanitizePinInput } from './pin-rules';
import { buildSetupChecklist, setupProgress } from './setup-checklist';
import { COMMERCE_STATUS_MAPS, commerceStatusMeta } from './status-maps';
import type { CommerceLocation, CommerceTaxSettings, TaxClass } from './commerce-types';

describe('PIN rules (same as CommercePinService)', () => {
    it.each(['482915', '4829157', '48291573', '112233', '135790'])('%s is accepted', (pin) => {
        expect(pinProblem(pin)).toBeNull();
    });

    it.each(['', '12345', '123456789', '12a456', ' 482915', '4829 15'])(
        '"%s" has the wrong shape',
        (pin) => expect(pinProblem(pin)).toBe('format')
    );

    it.each(['111111', '00000000', '123456', '2345678', '87654321', '654321'])(
        '%s is too easy to guess',
        (pin) => {
            expect(isTrivialPin(pin)).toBe(true);
            expect(pinProblem(pin)).toBe('trivial');
        }
    );

    it('typing an existing PIN checks the shape only', () => {
        expect(looksLikePin('123456')).toBe(true);
        expect(looksLikePin('12345')).toBe(false);
    });

    it('the input keeps digits only and stops at eight', () => {
        expect(sanitizePinInput('12a3-4 5678999')).toBe('12345678');
    });
});

describe('GSTIN as typed', () => {
    // Two published GSTINs whose check character is known.
    it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4'])('%s is well formed', (gstin) => {
        expect(gstinCheckCharacter(gstin.slice(0, 14))).toBe(gstin.charAt(14));
        expect(gstinProblem(gstin)).toBeNull();
        expect(gstinProblem(gstin, gstin.slice(0, 2))).toBeNull();
    });

    it('names the problem', () => {
        expect(gstinProblem('27AAPFU0939F1Z')).toBe('length');
        expect(gstinProblem('27AAPFU0939F1ZVX')).toBe('length');
        expect(gstinProblem('2AAAPFU0939F1ZV')).toBe('shape');
        expect(gstinProblem('27AAPFU0939F1YV')).toBe('shape');
        expect(gstinProblem('27AAPFU0939F1ZV', '08')).toBe('state');
        expect(gstinProblem('27AAPFU0939F1ZW')).toBe('checksum');
        // One mistyped digit in the middle is caught by the check character.
        expect(gstinProblem('27AAPFU0938F1ZV')).toBe('checksum');
    });

    it('spaces and lower case are forgiven', () => {
        expect(normalizeGstin(' 27aapfu 0939f1zv ')).toBe('27AAPFU0939F1ZV');
        expect(gstinProblem(' 27aapfu0939f1zv ')).toBeNull();
    });

    it('state codes are two digits and unique', () => {
        expect(new Set(GST_STATE_CODES).size).toBe(GST_STATE_CODES.length);
        GST_STATE_CODES.forEach((code) => expect(code).toMatch(/^\d{2}$/));
    });
});

const settings = (over: Partial<CommerceTaxSettings> = {}): CommerceTaxSettings => ({
    tax_mode: 'REGULAR',
    slab_basis: null,
    slab_compare: null,
    round_total_to: null,
    seller_gstin: '27AAPFU0939F1ZV',
    seller_state_code: '27',
    seller_legal_name: null,
    seller_address: null,
    ...over,
});

const location = (over: Partial<CommerceLocation> = {}): CommerceLocation => ({
    id: 'loc-1',
    code: 'MAIN',
    name: 'Main store',
    address_line1: null,
    address_line2: null,
    city: null,
    pincode: null,
    state_code: '27',
    gstin: null,
    is_store: true,
    is_warehouse: false,
    is_source: false,
    is_temporary: false,
    starts_on: null,
    ends_on: null,
    sells_online: false,
    is_pos_enabled: false,
    status: 'ACTIVE',
    ...over,
});

const taxClass = (rules: number): TaxClass => ({
    id: 'tc-1',
    code: 'COTTON',
    name: 'Cotton',
    hsn_code: '5208',
    unit: 'MTR',
    status: 'ACTIVE',
    rules: Array.from({ length: rules }, () => ({
        min_unit_price: 0,
        max_unit_price: null,
        rate_percent: 5,
        cess_percent: null,
        effective_from: '2026-04-01',
        effective_to: null,
    })),
});

describe('setup checklist', () => {
    const statusOf = (items: ReturnType<typeof buildSetupChecklist>) =>
        Object.fromEntries(items.map((item) => [item.id, item.status]));

    it('has nine items in the documented order; 1 to 6 block orders', () => {
        const items = buildSetupChecklist({
            taxSettings: undefined,
            locations: undefined,
            taxClasses: undefined,
            hasPin: undefined,
        });
        expect(items.map((item) => item.id)).toEqual([
            'business',
            'locations',
            'onlineFulfilment',
            'taxClasses',
            'shipping',
            'payments',
            'documentSeries',
            'labels',
            'staff',
        ]);
        expect(items.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(items.filter((item) => item.blocksOrders).map((item) => item.number)).toEqual([
            1, 2, 3, 4, 5, 6,
        ]);
    });

    it('what could not be read is "could not check", never "to do"', () => {
        const status = statusOf(
            buildSetupChecklist({
                taxSettings: undefined,
                locations: undefined,
                taxClasses: undefined,
                hasPin: undefined,
            })
        );
        expect(status.business).toBe('UNKNOWN');
        expect(status.locations).toBe('UNKNOWN');
        expect(status.taxClasses).toBe('UNKNOWN');
        expect(status.staff).toBe('UNKNOWN');
        expect(status.shipping).toBe('COMING_SOON');
    });

    it('a fresh shop: everything that can be done is to do', () => {
        const items = buildSetupChecklist({
            taxSettings: settings({ tax_mode: null, seller_gstin: null, seller_state_code: null }),
            locations: [],
            taxClasses: [],
            hasPin: false,
        });
        const status = statusOf(items);
        expect(status.business).toBe('TODO');
        expect(status.locations).toBe('TODO');
        expect(status.taxClasses).toBe('TODO');
        expect(status.staff).toBe('TODO');
        expect(status.onlineFulfilment).toBe('COMING_SOON');
        const progress = setupProgress(items);
        expect(progress).toMatchObject({ done: 0, actionable: 4 });
        expect(progress.remaining.map((item) => item.id)).toEqual([
            'business',
            'locations',
            'taxClasses',
            'staff',
        ]);
    });

    it('Regular without a GSTIN is not done; with one it is', () => {
        const base = { locations: [], taxClasses: [], hasPin: false };
        expect(
            statusOf(
                buildSetupChecklist({ ...base, taxSettings: settings({ seller_gstin: null }) })
            ).business
        ).toBe('TODO');
        expect(statusOf(buildSetupChecklist({ ...base, taxSettings: settings() })).business).toBe(
            'DONE'
        );
        expect(
            statusOf(
                buildSetupChecklist({
                    ...base,
                    taxSettings: settings({ tax_mode: 'UNREGISTERED', seller_gstin: null }),
                })
            ).business
        ).toBe('DONE');
    });

    it('tax classes are not needed outside Regular, and need a slab inside it', () => {
        const base = { locations: [], hasPin: false };
        expect(
            statusOf(
                buildSetupChecklist({
                    ...base,
                    taxSettings: settings({ tax_mode: 'COMPOSITION' }),
                    taxClasses: [],
                })
            ).taxClasses
        ).toBe('NOT_NEEDED');
        expect(
            statusOf(
                buildSetupChecklist({ ...base, taxSettings: settings(), taxClasses: [taxClass(0)] })
            ).taxClasses
        ).toBe('TODO');
        expect(
            statusOf(
                buildSetupChecklist({ ...base, taxSettings: settings(), taxClasses: [taxClass(1)] })
            ).taxClasses
        ).toBe('DONE');
    });

    it('an inactive location does not count; a location that sells online completes item 3', () => {
        const base = { taxSettings: settings(), taxClasses: [], hasPin: true };
        expect(
            statusOf(
                buildSetupChecklist({ ...base, locations: [location({ status: 'INACTIVE' })] })
            ).locations
        ).toBe('TODO');
        const done = statusOf(
            buildSetupChecklist({ ...base, locations: [location({ sells_online: true })] })
        );
        expect(done.locations).toBe('DONE');
        expect(done.onlineFulfilment).toBe('DONE');
        expect(done.staff).toBe('DONE');
    });
});

describe('status maps', () => {
    it('every status has a label key under its kind and one of the four chip colours', () => {
        Object.entries(COMMERCE_STATUS_MAPS).forEach(([kind, map]) => {
            Object.entries(map).forEach(([value, meta]) => {
                expect(meta.labelKey).toBe(`status.${kind}.${value}`);
                expect(['SUCCESS', 'DANGER', 'WARNING', 'INFO']).toContain(meta.tone);
            });
        });
    });

    it('an unknown value is shown as it came, in the neutral colour', () => {
        expect(commerceStatusMeta('product', 'active')).toMatchObject({
            known: true,
            tone: 'SUCCESS',
            value: 'ACTIVE',
        });
        expect(commerceStatusMeta('product', 'ON_HOLD')).toMatchObject({
            known: false,
            tone: 'INFO',
            value: 'ON_HOLD',
        });
        expect(commerceStatusMeta('product', null)).toMatchObject({ known: false, value: '' });
    });
});

describe('wire normalisers', () => {
    it('a list endpoint may answer an array or a page', () => {
        expect(asList([1, 2])).toEqual([1, 2]);
        expect(asList({ content: [1] })).toEqual([1]);
        expect(asList(null)).toEqual([]);
        expect(asList('<html>')).toEqual([]);
    });

    it('reads a Spring page', () => {
        expect(
            asPage(
                {
                    content: [1, 2],
                    number: 2,
                    size: 20,
                    totalPages: 5,
                    totalElements: 91,
                    last: false,
                },
                20
            )
        ).toEqual({
            content: [1, 2],
            page_no: 2,
            page_size: 20,
            total_pages: 5,
            total_elements: 91,
            last: false,
        });
        expect(asPage([1], 50)).toMatchObject({ page_no: 0, page_size: 50, total_elements: 1 });
    });

    it('no settings row reads as "not set up"', () => {
        expect(normalizeTaxSettings(null).tax_mode).toBeNull();
        expect(normalizeTaxSettings('').tax_mode).toBeNull();
        expect(normalizeTaxSettings({ tax_mode: 'REGULAR', seller_gstin: '' })).toMatchObject({
            tax_mode: 'REGULAR',
            seller_gstin: null,
        });
    });

    it('a location accepts is_store or the bare entity name', () => {
        expect(normalizeLocation({ id: 'a', code: 'A', name: 'A', is_store: true })).toMatchObject({
            is_store: true,
            is_warehouse: false,
        });
        expect(
            normalizeLocation({ id: 'a', code: 'A', name: 'A', warehouse: true, pos_enabled: true })
        ).toMatchObject({ is_warehouse: true, is_pos_enabled: true });
        expect(normalizeLocation({ code: 'A' })).toBeNull();
    });

    it('a tax class keeps decimal strings as numbers and drops a slab without a rate', () => {
        expect(
            normalizeTaxClass({
                id: 't',
                code: 'C',
                name: 'Cotton',
                rules: [
                    {
                        min_unit_price: '0',
                        max_unit_price: '1000.00',
                        rate_percent: '5',
                        effective_from: '2026-04-01',
                    },
                    { min_unit_price: 1000, effective_from: '2026-04-01' },
                ],
            })?.rules
        ).toEqual([
            {
                id: undefined,
                min_unit_price: 0,
                max_unit_price: 1000,
                rate_percent: 5,
                cess_percent: null,
                effective_from: '2026-04-01',
                effective_to: null,
            },
        ]);
    });
});

describe('server error sentences', () => {
    const axiosLike = (data: unknown) => {
        const error = new AxiosError('Request failed');
        error.response = { data, status: 403, statusText: '', headers: {}, config: {} as never };
        return error;
    };

    it('splits the leading code from the sentence', () => {
        expect(
            readCommerceError(
                axiosLike({ ex: 'PIN_LOCKED: Too many wrong tries. Try in 5 minutes.' }),
                'x'
            )
        ).toEqual({ code: 'PIN_LOCKED', message: 'Too many wrong tries. Try in 5 minutes.' });
        expect(
            readCommerceError(axiosLike({ ex: 'FEATURE_DISABLED: commerce.pos is off' }), 'x').code
        ).toBe('FEATURE_DISABLED');
    });

    it('keeps a sentence that only looks like it has a code', () => {
        expect(readCommerceError(axiosLike({ ex: 'NOTE: duplicate SKU' }), 'x')).toEqual({
            code: null,
            message: 'NOTE: duplicate SKU',
        });
    });

    it('falls back when the server said nothing', () => {
        expect(readCommerceError(new Error('boom'), 'Could not save')).toEqual({
            code: null,
            message: 'Could not save',
        });
        expect(readCommerceError(axiosLike({}), 'Could not save').message).toBe('Could not save');
    });
});

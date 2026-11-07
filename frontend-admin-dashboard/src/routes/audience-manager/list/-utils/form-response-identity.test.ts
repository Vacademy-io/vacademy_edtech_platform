import { describe, expect, it } from 'vitest';

import { buildIdentitySync, rewritePhoneLike, samePhone } from './form-response-identity';

const identity = {
    fullName: 'Asha Verma',
    email: 'asha@example.com',
    mobile: '919812345678',
    parentMobile: '9812345678',
};

describe('samePhone', () => {
    it('ignores formatting and the country code', () => {
        expect(samePhone('+91 98123-45678', '9812345678')).toBe(true);
        expect(samePhone('919812345678', '9812345678')).toBe(true);
    });

    it('never matches short or blank numbers', () => {
        expect(samePhone('12345', '12345')).toBe(false);
        expect(samePhone('', '')).toBe(false);
        expect(samePhone(null, '9812345678')).toBe(false);
    });
});

describe('rewritePhoneLike', () => {
    it('keeps the stored dial-code prefix for a bare 10-digit entry', () => {
        expect(rewritePhoneLike('919812345678', '9900011122')).toBe('919900011122');
        expect(rewritePhoneLike('+919812345678', '99000 11122')).toBe('+919900011122');
    });

    it('keeps a bare stored number bare', () => {
        expect(rewritePhoneLike('9812345678', '9900011122')).toBe('9900011122');
    });

    it('uses a full international entry as typed', () => {
        expect(rewritePhoneLike('919812345678', '+91 99000 11122')).toBe('919900011122');
        expect(rewritePhoneLike('+919812345678', '919900011122')).toBe('+919900011122');
    });
});

describe('buildIdentitySync', () => {
    it("moves the lead's own phone onto the auth user and the enquiry", () => {
        const sync = buildIdentitySync(
            [{ id: 'phone', rawValue: '9812345678' }],
            { phone: '9900011122' },
            identity
        );
        expect(sync.userDetails.mobile_number).toBe('919900011122');
        expect(sync.parentMobile).toBe('9900011122');
        expect(sync.invalid).toEqual([]);
    });

    it("leaves a referrer's number as just an answer", () => {
        const sync = buildIdentitySync(
            [{ id: 'refPhone', rawValue: '9000000001' }],
            { refPhone: '9000000002' },
            identity
        );
        expect(sync.userDetails).toEqual({});
        expect(sync.parentMobile).toBeUndefined();
    });

    it('only touches the copy the old answer matched', () => {
        const sync = buildIdentitySync(
            [{ id: 'phone', rawValue: '9812345678' }],
            { phone: '9900011122' },
            { ...identity, mobile: '917000000000' }
        );
        expect(sync.userDetails).toEqual({});
        expect(sync.parentMobile).toBe('9900011122');
    });

    it('syncs email and name when they mirror the auth user', () => {
        const sync = buildIdentitySync(
            [
                { id: 'email', rawValue: 'ASHA@example.com' },
                { id: 'name', rawValue: 'asha verma' },
            ],
            { email: 'asha.v@example.com', name: 'Asha V' },
            identity
        );
        expect(sync.userDetails).toEqual({
            email: 'asha.v@example.com',
            full_name: 'Asha V',
            mobile_number: '919812345678',
        });
    });

    it('flags values that cannot replace the identity', () => {
        const sync = buildIdentitySync(
            [
                { id: 'phone', rawValue: '9812345678' },
                { id: 'email', rawValue: 'asha@example.com' },
                { id: 'name', rawValue: 'Asha Verma' },
            ],
            { phone: '98', email: 'not-an-email', name: '  ' },
            identity
        );
        expect(sync.invalid.map((i) => i.kind)).toEqual(['phone', 'email', 'name']);
        expect(sync.userDetails).toEqual({});
        expect(sync.parentMobile).toBeUndefined();
    });

    it('sends the unchanged half of the dedupe key with a phone or email change', () => {
        const phoneOnly = buildIdentitySync(
            [{ id: 'phone', rawValue: '9812345678' }],
            { phone: '9900011122' },
            identity
        );
        expect(phoneOnly.userDetails).toEqual({
            mobile_number: '919900011122',
            email: 'asha@example.com',
        });

        const nameOnly = buildIdentitySync(
            [{ id: 'name', rawValue: 'Asha Verma' }],
            { name: 'Asha V' },
            identity
        );
        expect(nameOnly.userDetails).toEqual({ full_name: 'Asha V' });
    });

    it('ignores answers that did not change', () => {
        const sync = buildIdentitySync([{ id: 'phone', rawValue: '9812345678' }], {}, identity);
        expect(sync).toEqual({ userDetails: {}, invalid: [] });
    });
});

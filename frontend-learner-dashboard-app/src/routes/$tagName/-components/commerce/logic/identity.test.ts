import { describe, expect, it } from 'vitest';
import { buyerIdentityOf, identityDemandOf, identityRules, type IdentityInput } from './identity';

const base: IdentityInput = { mode: 'EITHER', method: 'PREPAID', phoneTokenFresh: false, sessionForPhone: false, serverAsksOtp: false };

describe('buyer identity setting', () => {
    it('reads the mode, defaulting to EITHER', () => {
        expect(buyerIdentityOf('phone_otp')).toBe('PHONE_OTP');
        expect(buyerIdentityOf(' EMAIL ')).toBe('EMAIL');
        expect(buyerIdentityOf('garbage')).toBe('EITHER');
        expect(buyerIdentityOf(null)).toBe('EITHER');
    });
});

describe('identity rules per mode', () => {
    it('PHONE_OTP: the code is required before paying; e-mail is optional', () => {
        const rules = identityRules({ ...base, mode: 'PHONE_OTP' });
        expect(rules).toMatchObject({ otpRequired: true, emailRequired: false, verified: false, canSaveAddress: false });
        expect(identityRules({ ...base, mode: 'PHONE_OTP', phoneTokenFresh: true })).toMatchObject({ otpRequired: false, verified: true, canSaveAddress: true });
    });

    it('EMAIL: phone and e-mail required; the code only when the server asks or for COD', () => {
        expect(identityRules({ ...base, mode: 'EMAIL' })).toMatchObject({ otpRequired: false, emailRequired: true, otpRecommended: false });
        expect(identityRules({ ...base, mode: 'EMAIL', serverAsksOtp: true })).toMatchObject({ otpRequired: true, emailRequired: true });
        expect(identityRules({ ...base, mode: 'EMAIL', method: 'COD' })).toMatchObject({ otpRequired: true });
        // Even a verified phone keeps e-mail required in EMAIL mode.
        expect(identityRules({ ...base, mode: 'EMAIL', phoneTokenFresh: true })).toMatchObject({ emailRequired: true, verified: true });
    });

    it('EITHER: WhatsApp recommended; e-mail required only without a proved phone', () => {
        expect(identityRules(base)).toMatchObject({ otpRequired: false, emailRequired: true, otpRecommended: true });
        expect(identityRules({ ...base, phoneTokenFresh: true })).toMatchObject({ otpRequired: false, emailRequired: false, verified: true });
        expect(identityRules({ ...base, serverAsksOtp: true })).toMatchObject({ otpRequired: true });
    });

    it('COD always wants a fresh code, in every mode', () => {
        for (const mode of ['PHONE_OTP', 'EMAIL', 'EITHER'] as const) {
            expect(identityRules({ ...base, mode, method: 'COD' }).otpRequired).toBe(true);
            expect(identityRules({ ...base, mode, method: 'COD', phoneTokenFresh: true }).otpRequired).toBe(false);
        }
    });

    it('a stored session counts for a prepaid order only', () => {
        for (const mode of ['PHONE_OTP', 'EMAIL', 'EITHER'] as const) {
            expect(identityRules({ ...base, mode, sessionForPhone: true }).verified).toBe(true);
            expect(identityRules({ ...base, mode, sessionForPhone: true }).otpRequired).toBe(false);
            expect(identityRules({ ...base, mode, method: 'COD', sessionForPhone: true })).toMatchObject({ verified: false, otpRequired: true });
        }
    });
});

describe('what a refusal asks of the identity step', () => {
    it('reads the three identity refusals', () => {
        expect(identityDemandOf('phone_verification_required', { param: 'phone_token', reason: 'mode' })).toEqual({ kind: 'otp' });
        expect(identityDemandOf('email_required', { otp_allowed: true })).toEqual({ kind: 'email', otpAllowed: true });
        expect(identityDemandOf('email_required', { otp_allowed: false })).toEqual({ kind: 'email', otpAllowed: false });
        expect(identityDemandOf('too_many_open_orders', { otp_allows_more: true })).toEqual({ kind: 'otp_or_wait', otpAllowed: true });
        expect(identityDemandOf('too_many_open_orders', null)).toEqual({ kind: 'otp_or_wait', otpAllowed: false });
        expect(identityDemandOf('price_changed', null)).toBeNull();
    });
});

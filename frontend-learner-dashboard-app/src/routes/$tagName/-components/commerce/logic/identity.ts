/**
 * Who the buyer is, per the shop's `buyer_identity` setting (contract P2 §3, §9). Pure: the
 * checkout page asks it which fields are required and whether the WhatsApp code must be passed
 * before "Pay" or "Place order". The server decides in the end (§3 truth table); this only keeps
 * the page from sending an order the server will refuse.
 */
import type { BuyerIdentity, PaymentMethod } from '../api/types';

export const buyerIdentityOf = (value: unknown): BuyerIdentity => {
    const mode = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return mode === 'PHONE_OTP' || mode === 'EMAIL' ? mode : 'EITHER';
};

export interface IdentityInput {
    mode: BuyerIdentity;
    method: PaymentMethod;
    /** A fresh verified-phone token for the number in the field (passed OTP on this page). */
    phoneTokenFresh: boolean;
    /** A stored shopper session proved for the number in the field. */
    sessionForPhone: boolean;
    /**
     * The server asked for the code: 403 phone_verification_required, 429 too_many_open_orders
     * with otp_allows_more, or the shopper chose it after email_required with otp_allowed.
     */
    serverAsksOtp: boolean;
}

export interface IdentityRules {
    /** The phone counts as proved for this order. */
    verified: boolean;
    /** The code must be passed before the order can be sent. */
    otpRequired: boolean;
    /** "Verify with WhatsApp" is shown (required, recommended or for saved addresses). */
    otpOffered: boolean;
    /** The WhatsApp button is the recommended path (EITHER, before an e-mail is typed). */
    otpRecommended: boolean;
    emailRequired: boolean;
    /** Save the address and the WhatsApp marketing tick are offered only to a proved phone. */
    canSaveAddress: boolean;
}

export const identityRules = (input: IdentityInput): IdentityRules => {
    const { mode, method, phoneTokenFresh, sessionForPhone, serverAsksOtp } = input;
    // A session stands in for the code on a prepaid order only; cash on delivery always wants
    // a fresh code (the server consumes it).
    const verified = method === 'COD' ? phoneTokenFresh : phoneTokenFresh || sessionForPhone;
    let otpRequired: boolean;
    let emailRequired: boolean;
    switch (mode) {
        case 'PHONE_OTP':
            otpRequired = !verified;
            emailRequired = false;
            break;
        case 'EMAIL':
            otpRequired = !verified && (method === 'COD' || serverAsksOtp);
            emailRequired = true;
            break;
        default:
            otpRequired = !verified && (method === 'COD' || serverAsksOtp);
            emailRequired = !verified;
    }
    return {
        verified,
        otpRequired,
        otpOffered: !verified,
        otpRecommended: mode !== 'EMAIL' && !verified,
        emailRequired,
        canSaveAddress: verified,
    };
};

/** What the server's refusal asks of the identity step, or null when it is about something else. */
export type IdentityDemand = { kind: 'otp' } | { kind: 'email'; otpAllowed: boolean } | { kind: 'otp_or_wait'; otpAllowed: boolean };

export const identityDemandOf = (code: string, details: Record<string, unknown> | null | undefined): IdentityDemand | null => {
    switch (code) {
        case 'phone_verification_required':
            return { kind: 'otp' };
        case 'email_required':
            return { kind: 'email', otpAllowed: details?.otp_allowed === true };
        case 'too_many_open_orders':
            return { kind: 'otp_or_wait', otpAllowed: details?.otp_allows_more === true };
        default:
            return null;
    }
};

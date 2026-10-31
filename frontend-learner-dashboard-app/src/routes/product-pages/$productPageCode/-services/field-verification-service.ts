import axios from 'axios';
import { REQUEST_WHATSAPP_OTP, VERIFY_WHATSAPP_OTP } from '@/constants/urls';
import type { VerificationChannel } from '@/components/common/enroll-by-invite/-utils/custom-field-helpers';

/**
 * Sends and checks the one-time codes that gate a verifiable form field.
 *
 * Both endpoints are anonymous by design — `request-generic-whatsapp-otp` and
 * `verify-generic-whatsapp-otp` exist precisely for "guest checkout, lead
 * verification" — so this works for a logged-out visitor on a product page.
 * Neither issues a token: verifying proves the visitor owns the number, and
 * nothing more. The account is still created by the normal form submit.
 *
 * The institute id decides which WhatsApp business account sends the message
 * and which OTP_REQUEST template it uses, so an institute's own branding and
 * language follow automatically. `templateName` overrides that per field for
 * the rare form that wants its own wording.
 */

export interface SendCodeArgs {
    channel: VerificationChannel;
    /** E.164, exactly as the phone input produced it. */
    value: string;
    instituteId: string;
    templateName?: string;
    languageCode?: string;
}

export interface CheckCodeArgs {
    channel: VerificationChannel;
    value: string;
    code: string;
}

const asApiMessage = (error: unknown, fallback: string): string => {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { message?: string; error?: string } | undefined;
        return data?.message || data?.error || fallback;
    }
    return fallback;
};

export const sendVerificationCode = async ({
    channel,
    value,
    instituteId,
    templateName,
    languageCode,
}: SendCodeArgs): Promise<void> => {
    if (channel !== 'WHATSAPP') throw new Error('Unsupported verification channel');
    try {
        await axios.post(REQUEST_WHATSAPP_OTP, {
            phone_number: value,
            institute_id: instituteId,
            ...(templateName?.trim() ? { template_name: templateName.trim() } : {}),
            ...(languageCode?.trim() ? { language_code: languageCode.trim() } : {}),
        });
    } catch (error) {
        throw new Error(asApiMessage(error, "Couldn't send the code. Check the number and try again."));
    }
};

/**
 * Returns whether the code matched. A rejected code is an ANSWER, not an
 * error — only a request that never got a verdict throws, so the caller can
 * tell "wrong code" from "we could not check".
 */
export const checkVerificationCode = async ({
    channel,
    value,
    code,
}: CheckCodeArgs): Promise<boolean> => {
    if (channel !== 'WHATSAPP') throw new Error('Unsupported verification channel');
    try {
        const response = await axios.post<boolean>(VERIFY_WHATSAPP_OTP, {
            phone_number: value,
            otp: code,
        });
        return response.data === true;
    } catch (error) {
        // A 4xx from this endpoint means the code was refused, not that the
        // check failed to run.
        if (axios.isAxiosError(error) && error.response && error.response.status < 500) {
            return false;
        }
        throw new Error(asApiMessage(error, "Couldn't check that code. Please try again."));
    }
};

/**
 * When a form answer on the Form Response card is edited, decide which of the
 * lead's own identity copies must follow it, so the new value shows everywhere.
 *
 * A lead's phone / email / name live in several places:
 *  - the form answer itself (custom field value),
 *  - the auth user — Overview, lead names and emails everywhere,
 *  - `audience_response.parent_mobile` — the number lists, Check Lead and
 *    click-to-call use first for that enquiry.
 *
 * An answer is treated as the lead's own copy only when its OLD value equals the
 * stored one. A form can carry other people's details (a "Reference Phone Number"),
 * and matching on the field name alone would move the referrer's number onto the
 * lead — so a non-matching answer stays an answer and nothing else changes.
 */

export interface FormAnswer {
    id: string;
    rawValue: string | null;
}

export interface LeadIdentity {
    fullName?: string | null;
    email?: string | null;
    /** Auth user's mobile. */
    mobile?: string | null;
    /** This response's `parent_mobile` (the enquiry's own number). */
    parentMobile?: string | null;
}

export interface IdentitySync {
    userDetails: { full_name?: string; email?: string; mobile_number?: string };
    parentMobile?: string;
    /** Changed answers that mirror the lead's identity but whose new value can't be stored there. */
    invalid: Array<{ fieldId: string; kind: 'phone' | 'email' | 'name' }>;
}

const digits = (value?: string | null) => (value ?? '').replace(/\D/g, '');
const norm = (value?: string | null) => (value ?? '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same number, ignoring formatting and a country code: the last 10 digits match. */
export const samePhone = (a?: string | null, b?: string | null): boolean => {
    const da = digits(a);
    const db = digits(b);
    return da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10);
};

/**
 * Writes `next` in the stored value's format. Phone login matches the stored
 * string exactly (canonical `91XXXXXXXXXX`), so a bare 10-digit entry keeps the
 * old dial-code prefix (and a leading "+" when the old value had one).
 */
export const rewritePhoneLike = (stored: string | null | undefined, next: string): string => {
    const nd = digits(next);
    const od = digits(stored);
    const plus = (stored ?? '').trim().startsWith('+') ? '+' : '';
    if (nd.length === 10 && od.length > 10) return `${plus}${od.slice(0, -10)}${nd}`;
    if (nd.length > 10) return `${plus}${nd}`;
    return nd;
};

export const buildIdentitySync = (
    answers: FormAnswer[],
    changed: Record<string, string>,
    identity: LeadIdentity
): IdentitySync => {
    const sync: IdentitySync = { userDetails: {}, invalid: [] };

    answers.forEach((answer) => {
        if (!(answer.id in changed)) return;
        const before = answer.rawValue ?? '';
        const after = (changed[answer.id] ?? '').trim();

        // Email first — an address never looks like a phone or a name.
        if (before.includes('@')) {
            if (norm(before) !== norm(identity.email)) return;
            if (!EMAIL_RE.test(after)) {
                sync.invalid.push({ fieldId: answer.id, kind: 'email' });
                return;
            }
            sync.userDetails.email = after;
            return;
        }

        const isAuthPhone = samePhone(before, identity.mobile);
        const isParentPhone = samePhone(before, identity.parentMobile);
        if (isAuthPhone || isParentPhone) {
            if (digits(after).length < 10) {
                sync.invalid.push({ fieldId: answer.id, kind: 'phone' });
                return;
            }
            if (isAuthPhone)
                sync.userDetails.mobile_number = rewritePhoneLike(identity.mobile, after);
            if (isParentPhone) sync.parentMobile = rewritePhoneLike(identity.parentMobile, after);
            return;
        }

        if (norm(before) && norm(before) === norm(identity.fullName)) {
            if (!after) {
                sync.invalid.push({ fieldId: answer.id, kind: 'name' });
                return;
            }
            sync.userDetails.full_name = after;
        }
    });

    // The backend rebuilds the campaign dedupe key from the email AND phone it is
    // sent (sha of "email|phone"), so sending one alone would key the lead on a blank
    // other half. Send the unchanged one too — the Overview editor always sends both.
    const { userDetails } = sync;
    if (userDetails.mobile_number && !userDetails.email && identity.email?.trim()) {
        userDetails.email = identity.email.trim();
    }
    if (userDetails.email && !userDetails.mobile_number && identity.mobile?.trim()) {
        userDetails.mobile_number = identity.mobile.trim();
    }

    return sync;
};

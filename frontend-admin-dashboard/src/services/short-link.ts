import axios from 'axios';
import { PUBLIC_GET_OR_CREATE_SHORT_LINK } from '@/constants/urls';

/**
 * `short_links.source` values understood by media_service.
 *
 * The pair (source, sourceId) *is* the identity of a short link: asking for the
 * same pair twice returns the code that already exists rather than minting a
 * second one. That is what makes a link stable once an admin has printed it on
 * a flyer or pasted it into a WhatsApp broadcast.
 */
export const SHORT_LINK_SOURCE = {
    /** An audience campaign's public `/audience-response` form. sourceId = campaign id. */
    AUDIENCE_CAMPAIGN: 'AUDIENCE_CAMPAIGN',
    /**
     * An enquiry campaign's `/enquiry-response` form. Kept distinct from
     * AUDIENCE_CAMPAIGN even though both are keyed on a campaign id, because the
     * two point at different learner-portal routes — sharing one source would let
     * whichever form was shortened first decide where the other one's code lands.
     */
    ENQUIRY_CAMPAIGN: 'ENQUIRY_CAMPAIGN',
    /** A platform training video (Assist Dock → Training). sourceId = training_video id. */
    TRAINING_VIDEO: 'TRAINING_VIDEO',
} as const;

export interface GetOrCreateShortLinkRequest {
    source: string;
    sourceId: string;
    destinationUrl: string;
    /**
     * Selects the institute's own short domain when one is configured in
     * media_service's `backend_base_url` table (e.g. `u.shikshanation.com`);
     * everyone else lands on the platform default, `u.vacademy.io`.
     */
    instituteId?: string;
    /**
     * Readability hint, not a reservation. The server slugifies it
     * ("Open Day 2026" -> `open-day-2026`) and appends a random suffix if that
     * slug is taken, so the caller never has to check for collisions.
     */
    shortCode?: string;
}

/** Length of the generated code. Matches the platform: 22,310 of ~22,400 rows in
 *  prod `short_links` are exactly 6 characters. */
const SHORT_CODE_LENGTH = 6;

/**
 * A stable 6-character code for an entity.
 *
 * Deliberately NOT derived from the entity's NAME. media_service turns a hint into
 * a slug of up to 50 characters, so "Class 10 Science Olympiad Registration 2026"
 * yields a "short" link longer than the URL it replaces — prod already carries the
 * evidence (`/s/dont-believe-everything-you-think`). Six random-looking characters
 * is what the other 99.6% of the table uses, and what fits in an SMS or gets read
 * aloud.
 *
 * Deterministic rather than random on purpose: the value is part of the caller's
 * react-query key, so a fresh random string on every render would change the key
 * and refire the request. Hashing the id gives the same code on every render, in
 * every component, across reloads.
 *
 * Only a HINT — the server slugifies it (a no-op for lowercase alphanumerics) and
 * appends a random suffix if that code is already taken, so collisions are the
 * server's problem, not ours.
 */
export const toShortCodeHint = (sourceId: string): string => {
    // Two FNV-1a passes with different offset bases, combined — one 32-bit pass
    // alone leaves visible clustering for inputs as similar as sequential UUIDs.
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < sourceId.length; i++) {
        const c = sourceId.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    }
    // Base36 over a 52-bit space: comfortably more than 36^6 (~2.2e9) so every
    // code is reachable, and Number stays exact below 2^53.
    const combined = h1 * 0x100000 + (h2 % 0x100000);
    return combined.toString(36).padStart(SHORT_CODE_LENGTH, '0').slice(-SHORT_CODE_LENGTH);
};

export interface ShortLinkResponse {
    /** Just the code, e.g. `open-day-2026`. */
    shortName: string;
    /** The full shareable URL, e.g. `https://u.vacademy.io/s/open-day-2026`. */
    absoluteUrl: string;
}

/**
 * Get-or-create the short link for a source entity.
 *
 * Public endpoint (media_service permits `/media-service/public/**` without a
 * token), so this deliberately uses a bare axios rather than the authenticated
 * instance: there is no 401 to recover from here, and routing it through the
 * refresh/logout interceptor would let a shortening hiccup bounce an admin out
 * of the app.
 */
export const getOrCreateShortLink = async (
    request: GetOrCreateShortLinkRequest
): Promise<ShortLinkResponse> => {
    const { data } = await axios.post<ShortLinkResponse>(PUBLIC_GET_OR_CREATE_SHORT_LINK, {
        source: request.source,
        sourceId: request.sourceId,
        destinationUrl: request.destinationUrl,
        instituteId: request.instituteId,
        shortCode: request.shortCode,
    });

    if (!data?.absoluteUrl) {
        throw new Error('Short link service returned no URL');
    }

    return data;
};

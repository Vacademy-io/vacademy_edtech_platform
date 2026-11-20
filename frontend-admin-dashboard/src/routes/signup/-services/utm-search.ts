import { z } from 'zod';
import type { SignupContext } from './self-signup';

/**
 * A utm value as text. The router reads a value that looks like JSON ("2026", "true") as a number
 * or a boolean, and a plain z.string() would then reject the whole page.
 */
const utmValue = z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : String(v)),
    z.string().optional()
);

/** The visit's utm tags a sign-up page takes from the product's website (spread into its search schema). */
export const utmSearchSchema = {
    utm_source: utmValue,
    utm_medium: utmValue,
    utm_campaign: utmValue,
    utm_content: utmValue,
    utm_term: utmValue,
};

type UtmContext = Pick<SignupContext, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'>;

/** The tags as sign-up context: auth passes them on to the lead, and a Google sign-up brings them back. */
export const utmContext = (search: UtmContext): UtmContext => ({
    utm_source: search.utm_source,
    utm_medium: search.utm_medium,
    utm_campaign: search.utm_campaign,
    utm_content: search.utm_content,
    utm_term: search.utm_term,
});

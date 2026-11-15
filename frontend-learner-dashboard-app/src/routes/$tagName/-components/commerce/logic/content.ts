/**
 * Readers for the props of the shop's content blocks (ui/ContentSections.tsx). Pure and
 * tolerant: an authored page may hold anything, so every reader returns a clean value or an
 * empty one, and a block with nothing usable renders nothing.
 */

export type Props = Record<string, unknown>;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

export const str = (value: unknown, max = 2000): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

export const strings = (value: unknown, max = 24): string[] =>
    (Array.isArray(value) ? value : []).map((v) => str(v, 400)).filter(Boolean).slice(0, max);

/** The object items of a list prop, at most `max` of them. */
export const records = (value: unknown, max = 24): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).filter(isRecord).slice(0, max);

export interface Cta {
    label: string;
    /** Site-relative address ("our-story", "c/sarees"), "#anchor", or a full https/tel/mailto link. */
    route: string;
}

/** A call to action: { label, route }; null unless both are there. */
export const cta = (value: unknown): Cta | null => {
    if (!isRecord(value)) return null;
    const label = str(value.label, 80);
    const route = str(value.route, 300);
    return label && route ? { label, route } : null;
};

/** Where a link goes: a page of this site, an anchor on this page, or somewhere else. */
export const linkKind = (route: string): 'site' | 'anchor' | 'external' | 'invalid' => {
    if (!route) return 'invalid';
    if (route.startsWith('#')) return /^#[A-Za-z][\w-]{0,60}$/.test(route) ? 'anchor' : 'invalid';
    if (/^(https:\/\/|http:\/\/|tel:|mailto:)/i.test(route)) return 'external';
    // Anything else with a scheme (javascript:, data:) is refused.
    if (/^[a-z][a-z0-9+.-]*:/i.test(route) || route.startsWith('//')) return 'invalid';
    return 'site';
};

/** Strip a site route to the form ShopLink takes ("/our-story" → "our-story"). */
export const siteRoute = (route: string): string => route.replace(/^\/+/, '');

/** Digits of a phone number with its leading +, for tel: links. "" when it is not a number. */
export const telHref = (phone: string): string => {
    const digits = (phone || '').replace(/[^\d+]/g, '');
    const count = digits.replace(/\D/g, '').length;
    return count >= 6 && count <= 15 ? `tel:${digits}` : '';
};

/** A maps link: the given https URL, else a search for the address. */
export const mapsHref = (mapUrl: string, address: string): string => {
    if (/^https:\/\//i.test(mapUrl)) return mapUrl;
    const query = (address || '').trim();
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
};

/** An anchor id an author typed ("Reseller form" → "reseller-form"); "" when none. */
export const anchorId = (value: unknown): string =>
    str(value, 60)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^(\d)/, 'a-$1');

/** Items grouped by a text key in first-seen order; items without one go in a "" group. */
export const groupBy = <T extends Record<string, unknown>>(items: T[], key: string): Array<{ name: string; items: T[] }> => {
    const groups: Array<{ name: string; items: T[] }> = [];
    for (const item of items) {
        const name = str(item[key], 80);
        let group = groups.find((g) => g.name === name);
        if (!group) {
            group = { name, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
};

/* ── lead form ─────────────────────────────────────────────────────── */

export const LEAD_FIELDS = ['name', 'phone', 'email', 'city', 'organisation', 'quantity', 'message'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

/** The fields a form asks for, in the fixed order; name and phone are always asked. */
export const leadFields = (value: unknown): LeadField[] => {
    const wanted = new Set(strings(value).map((f) => f.toLowerCase()));
    return LEAD_FIELDS.filter((field) => field === 'name' || field === 'phone' || wanted.has(field));
};

/** An Indian mobile as 10 digits ("+91 98765-43210" → "9876543210"); null when it is not one. */
export const normalizeMobile = (raw: string): string | null => {
    let digits = (raw || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type LeadErrors = Partial<Record<LeadField, 'required' | 'phoneInvalid' | 'emailInvalid'>>;

/** What is wrong with a filled form; {} when it can be sent. Name and phone are required. */
export const validateLead = (values: Partial<Record<LeadField, string>>, fields: readonly LeadField[]): LeadErrors => {
    const errors: LeadErrors = {};
    if (fields.includes('name') && !(values.name || '').trim()) errors.name = 'required';
    if (fields.includes('phone')) {
        if (!(values.phone || '').trim()) errors.phone = 'required';
        else if (!normalizeMobile(values.phone || '')) errors.phone = 'phoneInvalid';
    }
    const email = (values.email || '').trim();
    if (fields.includes('email') && email && !EMAIL.test(email)) errors.email = 'emailInvalid';
    return errors;
};

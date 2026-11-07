/**
 * Chat cards (Site Assistant SPEC §4.4), as the admin shows them read-only in
 * transcripts and the preview chat. A card arrives as `{type, ...fields}` (or
 * `{type, data: {...}}`); anything unknown or malformed is dropped. Links are
 * kept only when https or site-relative.
 */

export interface CourseCard {
    id: string;
    title: string;
    subtitle: string | null;
    imageUrl: string | null;
    priceLabel: string | null;
    url: string | null;
    badges: string[];
    languages: string[];
    formatLabels: string[];
    availability: string | null;
}

export interface LiveClassItem {
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    timezone: string | null;
    isPaid: boolean;
    priceLabel: string | null;
    registrationUrl: string | null;
}

export interface ContactField {
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: string[];
}

export type SiteAssistantCard =
    | { type: 'course'; course: CourseCard }
    | { type: 'course_list'; items: CourseCard[]; moreUrl: string | null }
    | { type: 'compare'; rows: { label: string; values: string[] }[]; courses: CourseCard[] }
    | {
          type: 'path';
          name: string;
          steps: {
              position: number;
              title: string;
              url: string | null;
              priceLabel: string | null;
          }[];
      }
    | {
          type: 'page_link';
          title: string;
          href: string | null;
          sectionId: string | null;
          snippet: string | null;
      }
    | { type: 'live_class_list'; items: LiveClassItem[] }
    | { type: 'notice'; title: string; body: string; endsAt: string | null }
    | {
          type: 'contact_info';
          email: string | null;
          phone: string | null;
          whatsapp: string | null;
          address: string | null;
          loginUrl: string | null;
      }
    | {
          type: 'contact_form';
          kind: string;
          reason: string;
          campaignId: string | null;
          fields: ContactField[];
          consentText: string | null;
      };

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null;
const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(s).filter((x): x is string => !!x) : [];
const objs = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObject) : []);

/**
 * An https URL or a site-relative path — the backend's rule (cards.safe_href): whitespace,
 * control characters and backslashes anywhere are refused, because browsers read `/\evil.org`
 * and `\\evil.org` as protocol-relative links to another host.
 */
export function safeHref(v: unknown): string | null {
    const href = s(v)?.trim();
    if (!href) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\s\\]/.test(href)) return null;
    if (href.startsWith('/') && !href.startsWith('//')) return href;
    try {
        return new URL(href).protocol === 'https:' ? href : null;
    } catch {
        return null;
    }
}

const course = (r: Raw): CourseCard | null => {
    const title = s(r.title);
    if (!title) return null;
    return {
        id: s(r.id) ?? title,
        title,
        subtitle: s(r.subtitle),
        imageUrl: safeHref(r.image_url),
        priceLabel: s(r.price_label),
        url: safeHref(r.url),
        badges: strs(r.badges),
        languages: strs(r.languages),
        formatLabels: strs(r.format_labels),
        availability: s(r.availability),
    };
};
const courses = (v: unknown) =>
    objs(v)
        .map(course)
        .filter((c): c is CourseCard => !!c);

export function normalizeCard(raw: unknown): SiteAssistantCard | null {
    if (!isObject(raw)) return null;
    const type = s(raw.type ?? raw.card_type);
    const d: Raw = isObject(raw.data) ? raw.data : isObject(raw.payload) ? raw.payload : raw;
    switch (type) {
        case 'course': {
            const c = course(d);
            return c ? { type, course: c } : null;
        }
        case 'course_list':
            return { type, items: courses(d.items), moreUrl: safeHref(d.more_url) };
        case 'compare':
            return {
                type,
                rows: objs(d.rows).map((r) => ({
                    label: s(r.label) ?? '',
                    values: Array.isArray(r.values) ? r.values.map((x) => s(x) ?? '—') : [],
                })),
                courses: courses(d.courses),
            };
        case 'path':
            return {
                type,
                name: s(d.name) ?? '',
                steps: objs(d.steps).map((st, i) => ({
                    position: typeof st.position === 'number' ? st.position : i + 1,
                    title: s(st.title) ?? '',
                    url: safeHref(st.url),
                    priceLabel: s(st.price_label),
                })),
            };
        case 'page_link':
            return {
                type,
                title: s(d.title) ?? '',
                href: safeHref(d.href),
                sectionId: s(d.section_id),
                snippet: s(d.snippet),
            };
        case 'live_class_list':
            return {
                type,
                items: objs(d.items).map((it) => ({
                    title: s(it.title) ?? '',
                    startsAt: s(it.starts_at),
                    endsAt: s(it.ends_at),
                    timezone: s(it.timezone),
                    isPaid: it.is_paid === true,
                    priceLabel: s(it.price_label),
                    registrationUrl: safeHref(it.registration_url),
                })),
            };
        case 'notice':
            return { type, title: s(d.title) ?? '', body: s(d.body) ?? '', endsAt: s(d.ends_at) };
        case 'contact_info':
            return {
                type,
                email: s(d.email),
                phone: s(d.phone),
                whatsapp: s(d.whatsapp),
                address: s(d.address),
                loginUrl: safeHref(d.login_url),
            };
        case 'contact_form':
            return {
                type,
                kind: s(d.kind) ?? 'SALES',
                reason: s(d.reason) ?? '',
                campaignId: s(d.campaign_id),
                fields: objs(d.fields).map((f) => ({
                    key: s(f.key) ?? '',
                    label: s(f.label) ?? s(f.key) ?? '',
                    type: s(f.type) ?? 'text',
                    required: f.required === true,
                    options: strs(f.options),
                })),
                consentText: s(d.consent_text),
            };
        default:
            return null;
    }
}

export const normalizeCards = (v: unknown): SiteAssistantCard[] =>
    (Array.isArray(v) ? v : []).map(normalizeCard).filter((c): c is SiteAssistantCard => !!c);

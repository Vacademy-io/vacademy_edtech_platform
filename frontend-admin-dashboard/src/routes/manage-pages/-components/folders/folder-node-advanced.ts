import type { FolderNode, FolderNodeInput, FolderNodeType } from '../../-services/folder-library-service';

/**
 * The "Advanced" fields of a folder-library item — link key, course tag,
 * subtitle, tagline, button label, link, accent colour and coming soon — as
 * pure helpers, so the dialog and its tests share one set of rules.
 *
 * The limits and formats mirror the server (Knowledge Streams spec §3): the
 * dialog explains a problem before saving instead of surfacing a 4xx.
 */

export const FOLDER_FIELD_LIMITS = {
    slug: 120,
    courseTag: 191,
    subtitle: 255,
    tagline: 255,
    ctaLabel: 120,
    linkUrl: 2048,
    audienceId: 255,
} as const;

const SLUG_PATTERN = /^[a-z0-9-]{1,120}$/;
const ACCENT_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Text → link key, the same way the learner's folderSlug() derives one. */
export const slugFromText = (text: string | null | undefined): string =>
    (text || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/**
 * The link key the live site uses for a folder — byte-for-byte the learner's
 * folderSlug(): the explicit slug, else one made from the subtitle (or, when
 * there is no subtitle, the title), else the folder's id.
 */
export const effectiveFolderSlug = (n: {
    id: string;
    slug?: string | null;
    subtitle?: string | null;
    title?: string | null;
}): string => {
    const explicit = (n.slug || '').trim();
    if (explicit) return explicit;
    return slugFromText(n.subtitle || n.title || '') || n.id;
};

/**
 * A link key to offer the admin: from the subtitle (usually the English
 * caption under a Hindi title), else the title. '' when neither has a single
 * latin letter or digit — a Hindi-only title needs a key typed by hand.
 */
export const suggestFolderSlug = (subtitle: string, title: string): string => {
    const raw = slugFromText(subtitle) || slugFromText(title);
    return raw.slice(0, FOLDER_FIELD_LIMITS.slug).replace(/-+$/g, '');
};

/** Keeps typing inside the allowed alphabet: lowercase letters, digits and dashes. */
export const sanitizeSlugInput = (raw: string): string =>
    raw
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, FOLDER_FIELD_LIMITS.slug);

export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug);

/**
 * Tabs, line breaks and other control characters (U+0000–U+001F, U+007F).
 * Browsers drop tabs and newlines from a URL before reading it, so "/\t/evil"
 * would leave the site. Checked by char code: a control-character regex is
 * exactly what no-control-regex exists to flag.
 */
const hasControlCharacter = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
};

/**
 * Whitespace as Java's Character.isWhitespace sees it (the server's check on
 * a link's host), minus the control characters refused before it is used.
 * No-break spaces (U+00A0, U+2007, U+202F) are not whitespace there.
 */
const HOST_WHITESPACE = new Set([
    0x20, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
    0x205f, 0x3000,
]);

const hasHostWhitespace = (host: string): boolean => [...host].some((c) => HOST_WHITESPACE.has(c.charCodeAt(0)));

/**
 * A folder link is a page on the site (/courses?stream=x) or a full http(s)
 * address — the server's rule (CatalogueFolderService.linkUrlOrNull), so the
 * dialog never refuses a link the server would keep, nor lets through one it
 * would refuse: no control characters; a "/" link must not start with "//" or
 * "/\" (both leave the site) but may hold spaces ("/courses?q=yoga basics");
 * an http(s) address needs a host without spaces or backslashes. javascript:,
 * data: and anything else are refused. Empty is fine: it means "the default
 * link". Length is checked separately (FOLDER_FIELD_LIMITS.linkUrl).
 */
export const isSafeFolderLink = (raw: string): boolean => {
    const url = raw.trim();
    if (!url) return true;
    if (hasControlCharacter(url)) return false;
    if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\');
    const address = /^https?:\/\/([^/?#]*)/i.exec(url);
    const host = address?.[1] ?? '';
    return !!host && !host.includes('\\') && !hasHostWhitespace(host);
};

export const isValidAccentColor = (raw: string | null | undefined): boolean => ACCENT_PATTERN.test((raw || '').trim());

/** Editable state of the Advanced section. */
export interface FolderAdvancedDraft {
    slug: string;
    courseTag: string;
    subtitle: string;
    tagline: string;
    ctaLabel: string;
    linkUrl: string;
    accentColor: string;
    comingSoon: boolean;
    audienceId: string;
}

export const draftFromNode = (node: FolderNode | null): FolderAdvancedDraft => ({
    slug: node?.slug || '',
    courseTag: node?.course_tag || '',
    subtitle: node?.subtitle || '',
    tagline: node?.tagline || '',
    ctaLabel: node?.cta_label || '',
    linkUrl: node?.link_url || '',
    accentColor: node?.accent_color || '',
    comingSoon: !!node?.coming_soon,
    audienceId: node?.audience_id || '',
});

/** True when the node already carries any Advanced value — the section then opens by itself. */
export const hasAdvancedValues = (node: FolderNode | null): boolean => {
    const d = draftFromNode(node);
    return (
        d.comingSoon ||
        [d.slug, d.courseTag, d.subtitle, d.tagline, d.ctaLabel, d.linkUrl, d.accentColor, d.audienceId].some(
            (v) => v.trim() !== ''
        )
    );
};

type TextField = 'slug' | 'courseTag' | 'subtitle' | 'tagline' | 'ctaLabel' | 'linkUrl' | 'accentColor' | 'audienceId';

const TEXT_FIELDS: { field: TextField; key: keyof FolderNodeInput; node: keyof FolderNode; foldersOnly: boolean }[] = [
    { field: 'slug', key: 'slug', node: 'slug', foldersOnly: true },
    { field: 'courseTag', key: 'course_tag', node: 'course_tag', foldersOnly: true },
    { field: 'subtitle', key: 'subtitle', node: 'subtitle', foldersOnly: false },
    { field: 'tagline', key: 'tagline', node: 'tagline', foldersOnly: false },
    { field: 'ctaLabel', key: 'cta_label', node: 'cta_label', foldersOnly: false },
    { field: 'linkUrl', key: 'link_url', node: 'link_url', foldersOnly: true },
    { field: 'accentColor', key: 'accent_color', node: 'accent_color', foldersOnly: false },
    { field: 'audienceId', key: 'audience_id', node: 'audience_id', foldersOnly: true },
];

/** Which Advanced fields an item type offers: folders get all of them, product-page items the card wording and colour. */
export const advancedFieldsFor = (nodeType: FolderNodeType): Set<TextField | 'comingSoon'> => {
    const fields = new Set<TextField | 'comingSoon'>();
    for (const f of TEXT_FIELDS) if (nodeType === 'FOLDER' || !f.foldersOnly) fields.add(f.field);
    if (nodeType === 'FOLDER') fields.add('comingSoon');
    return fields;
};

/**
 * The Advanced part of the request: only what changed. On create, empty
 * fields and an unset coming-soon flag are left out; on update an untouched
 * field is omitted (the server leaves it as is) and a cleared one is sent as
 * '' (the server clears it). An admin who never opens the section therefore
 * sends exactly the request the dialog sent before these fields existed.
 */
export const buildAdvancedPatch = (
    node: FolderNode | null,
    draft: FolderAdvancedDraft,
    nodeType: FolderNodeType
): Partial<FolderNodeInput> => {
    const offered = advancedFieldsFor(nodeType);
    const patch: Record<string, string | boolean> = {};
    for (const f of TEXT_FIELDS) {
        if (!offered.has(f.field)) continue;
        const next = draft[f.field].trim();
        const current = String((node?.[f.node] as string | null | undefined) || '').trim();
        if (node ? next !== current : next !== '') patch[f.key] = next;
    }
    if (offered.has('comingSoon')) {
        if (node ? draft.comingSoon !== !!node.coming_soon : draft.comingSoon) patch.coming_soon = draft.comingSoon;
    }
    return patch as Partial<FolderNodeInput>;
};

/**
 * First problem that would make the server refuse the Advanced fields; null
 * when they can be saved. Only what the save actually sends is checked (see
 * buildAdvancedPatch): a value stored by another client — the API, an
 * assistant — that this dialog would not accept itself never blocks renaming
 * the item. `node` is the item being edited (null when creating).
 */
export const validateAdvancedDraft = (
    draft: FolderAdvancedDraft,
    nodeType: FolderNodeType,
    node: FolderNode | null = null
): string | null => {
    const patch = buildAdvancedPatch(node, draft, nodeType);
    const sent = (key: keyof FolderNodeInput): string | null => {
        const value = (patch as Record<string, unknown>)[key];
        return typeof value === 'string' && value ? value : null;
    };
    const slug = sent('slug');
    if (slug && !isValidSlug(slug)) {
        return 'The link key can use only lowercase letters, numbers and dashes (up to 120).';
    }
    const courseTag = sent('course_tag');
    if (courseTag && courseTag.length > FOLDER_FIELD_LIMITS.courseTag) {
        return `The course tag is too long (max ${FOLDER_FIELD_LIMITS.courseTag} characters).`;
    }
    if (courseTag && courseTag.includes(',')) {
        return 'The course tag is a single tag, so it cannot contain commas.';
    }
    const link = sent('link_url');
    if (link && link.length > FOLDER_FIELD_LIMITS.linkUrl) {
        return `The link is too long (max ${FOLDER_FIELD_LIMITS.linkUrl} characters).`;
    }
    if (link && hasControlCharacter(link)) {
        return 'The link contains a line break or tab. Paste it again on one line.';
    }
    if (link && !isSafeFolderLink(link)) {
        return 'The link must be a page on your site (starting with /) or a full address starting with https://.';
    }
    const accent = sent('accent_color');
    if (accent && !isValidAccentColor(accent)) {
        return 'The accent colour must be a hex colour such as #F97316.'; // design-lint-ignore: example in copy, not a style
    }
    return null;
};

/**
 * Link keys already used by other folders of the library (as the live site
 * resolves them), so the dialog can warn before two streams answer to the
 * same ?stream= value. Maps key → the folder's display name.
 */
export const takenFolderSlugs = (
    roots: FolderNode[],
    excludeId: string | null | undefined,
    label: (n: FolderNode) => string
): Map<string, string> => {
    const taken = new Map<string, string>();
    const walk = (nodes: FolderNode[]) => {
        for (const n of nodes) {
            if (n.node_type === 'FOLDER' && n.id !== excludeId) {
                const key = effectiveFolderSlug(n);
                if (!taken.has(key)) taken.set(key, label(n));
            }
            walk(n.children || []);
        }
    };
    walk(roots);
    return taken;
};

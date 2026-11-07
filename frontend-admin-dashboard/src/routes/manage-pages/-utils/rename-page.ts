import type { CatalogueConfig } from '../-types/editor-types';

/** The home page's address: the site root, so its slug is never renamed. */
export const HOME_ROUTES = new Set(['', 'home', 'homepage']);

/** The prop names a page link is stored under (every LinkPicker in the builder writes one of these). */
const LINK_KEYS = new Set([
    'route',
    'target',
    'url',
    'link',
    'linkUrl',
    'href',
    'buttonTarget',
    'helpRoute',
    'logoLink',
]);

const retarget = (value: string, from: string, to: string): string => {
    // "books-copy", "/books-copy", "/books-copy#plans", "books-copy?stream=x"
    const m = /^(\/?)([^#?]*)([#?].*)?$/.exec(value);
    if (!m || m[2] !== from) return value;
    return `${m[1]}${to}${m[3] ?? ''}`;
};

const walk = (node: unknown, from: string, to: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, from, to));
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] =
            typeof value === 'string' && LINK_KEYS.has(key)
                ? retarget(value, from, to)
                : walk(value, from, to);
    }
    return out;
};

/**
 * Renames a page. A new slug also moves every menu item, button and link that
 * pointed at the old one, so a rename never leaves a "page not found" behind.
 * The config is returned unchanged when the slug is taken.
 */
export const renamePageInConfig = (
    config: CatalogueConfig,
    pageId: string,
    title: string,
    route: string
): CatalogueConfig => {
    const page = config.pages.find((p) => p.id === pageId);
    if (!page) return config;
    const from = (page.route || '').replace(/^\//, '');
    const to = route.replace(/^\//, '');
    const moveRoute = !!to && to !== from && !HOME_ROUTES.has(from.toLowerCase());
    if (moveRoute && config.pages.some((p) => p.id !== pageId && p.route === to)) return config;

    const renamed: CatalogueConfig = {
        ...config,
        pages: config.pages.map((p) =>
            p.id === pageId
                ? { ...p, title: title.trim() || undefined, ...(moveRoute ? { route: to } : {}) }
                : p
        ),
    };
    if (!moveRoute) return renamed;
    return {
        ...renamed,
        globalSettings: walk(renamed.globalSettings, from, to) as CatalogueConfig['globalSettings'],
        pages: renamed.pages.map((p) => ({
            ...p,
            components: walk(p.components, from, to) as typeof p.components,
        })),
    };
};

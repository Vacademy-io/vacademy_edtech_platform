/**
 * The shop of the site on screen, for every commerce section: its settings, the visitor's
 * language, the messages, the API client and the link builder. Mounted by the fixed-route
 * templates, by each commerce section on an authored page and by the header slot, so a
 * section works the same wherever it is placed.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { BASE_URL } from '@/constants/urls';
import { RouteMatcher } from '../../../-services/route-matcher';
import { useCatalogueLocale } from '../../../-utils/catalogue-locale';
import { LOCALE_PARAM } from '../../../-utils/catalogue-i18n';
import { readSearchParam, withSearchParams } from '../../../-utils/catalogue-url-state';
import { withLocaleParam } from '../../../-utils/catalogue-site-language';
import { createCommerceClient, type CommerceClient } from '../api/client';
import { parseCommerceConfig, resolveCommerceLocale, type CommerceConfig } from '../config';
import { createTranslate, type Translate } from '../i18n';
import { carriedHash } from '../logic/checkout';
import type { CommerceRoute } from '../routes';
import { followOtherTabs, useCommerceCart } from '../state/cart-store';

export interface CommerceSite {
    instituteId: string;
    tagName: string;
    config: CommerceConfig;
    locale: string;
    baseLocale: string;
    locales: string[];
    setLocale(code: string): void;
    /** Interface messages of the shop. */
    t: Translate;
    /** Settings and authored text through the site dictionary. */
    siteT(text: string | null | undefined): string;
    client: CommerceClient;
    /** A site-relative address ("p/<slug>") as an href on this host, in the visitor's language. */
    href(to: string): string;
    /** Absolute URL of a site-relative address, for sharing. */
    absoluteUrl(to: string): string;
    /** The institute's name for titles ("Red saree | Example Brand"); "" when unknown. */
    siteName: string;
}

const CommerceSiteContext = createContext<CommerceSite | null>(null);

/** Same key the site's own language provider uses, so the two always agree. */
const localeStorageKey = (tagName: string) => `catalogue-locale:${tagName}`;

/** The institute's own tab title (white-label branding), mirrored to storage by the app shell. */
const readBrandName = (): string => {
    try {
        const parsed = JSON.parse(localStorage.getItem('TabBranding') || 'null') as { tabText?: unknown } | null;
        return typeof parsed?.tabText === 'string' ? parsed.tabText.trim() : '';
    } catch {
        return '';
    }
};

const readStoredLocale = (tagName: string): string | null => {
    try {
        return localStorage.getItem(localeStorageKey(tagName));
    } catch {
        return null;
    }
};

export const CommerceSiteProvider: React.FC<{
    instituteId: string;
    tagName: string;
    globalSettings: unknown;
    /** The institute's name, where the caller knows it (the route files do). */
    siteName?: string | null;
    children: React.ReactNode;
}> = ({ instituteId, tagName, globalSettings, siteName: givenName, children }) => {
    const parent = useContext(CommerceSiteContext);
    const siteName = useMemo(() => (givenName || '').trim() || readBrandName(), [givenName]);
    const config = useMemo(() => parseCommerceConfig(globalSettings), [globalSettings]);
    const siteLocale = useCatalogueLocale();
    const router = useRouter();
    const searchStr = useLocation({ select: (l) => l.searchStr || '' });
    const urlLocale = readSearchParam(searchStr, LOCALE_PARAM);
    const [stored, setStored] = useState<string | null>(() => readStoredLocale(tagName));
    const siteDefault = (globalSettings as { i18n?: { defaultLocale?: string } } | null)?.i18n?.defaultLocale;

    const resolved = useMemo(
        () =>
            resolveCommerceLocale({
                config,
                siteDefaultLocale: siteLocale.enabled ? siteLocale.baseLocale : siteDefault,
                // A site with languages has already resolved the visitor's choice: follow it.
                urlLocale: siteLocale.enabled ? siteLocale.locale : urlLocale,
                storedLocale: siteLocale.enabled ? null : stored,
            }),
        [config, siteLocale.enabled, siteLocale.baseLocale, siteLocale.locale, siteDefault, urlLocale, stored]
    );
    const { locale, baseLocale, locales } = resolved;

    const setLocale = useCallback(
        (code: string) => {
            if (siteLocale.enabled && siteLocale.locales.some((l) => l.code === code)) {
                siteLocale.setLocale(code);
                return;
            }
            try {
                localStorage.setItem(localeStorageKey(tagName), code);
            } catch {
                // Private mode: the choice lasts while ?lang= stays in the address.
            }
            setStored(code);
            const location = router.history.location;
            const next = withSearchParams(location.search || '', { [LOCALE_PARAM]: code === baseLocale ? null : code });
            // The router may still remember a fragment the order page already took out of the
            // address; an order or link token in it is never put back.
            router.history.replace(`${location.pathname}${next}${carriedHash(location.hash)}`);
        },
        [siteLocale, tagName, baseLocale, router]
    );

    const t = useMemo(() => createTranslate(locale), [locale]);
    const client = useMemo(
        () => createCommerceClient({ baseUrl: BASE_URL, publishableKey: config.publishableKey, locale }),
        [config.publishableKey, locale]
    );
    const href = useCallback(
        (to: string) => withLocaleParam(RouteMatcher.pagePath(tagName, to), locale === baseLocale ? null : locale),
        [tagName, locale, baseLocale]
    );
    const absoluteUrl = useCallback(
        (to: string) => `${typeof window === 'undefined' ? '' : window.location.origin}${href(to)}`,
        [href]
    );

    // One cart per site and device; other tabs of the same site stay in step.
    const bind = useCommerceCart((s) => s.bind);
    useEffect(() => {
        bind(instituteId, tagName);
        return followOtherTabs();
    }, [bind, instituteId, tagName]);

    const value = useMemo<CommerceSite>(
        () => ({
            instituteId,
            tagName,
            config,
            locale,
            baseLocale,
            locales,
            setLocale,
            t,
            siteT: siteLocale.t,
            client,
            href,
            absoluteUrl,
            siteName,
        }),
        [instituteId, tagName, config, locale, baseLocale, locales, setLocale, t, siteLocale.t, client, href, absoluteUrl, siteName]
    );

    // A section inside a template is already inside the site's provider.
    if (parent && parent.instituteId === instituteId && parent.tagName === tagName) return <>{children}</>;
    return <CommerceSiteContext.Provider value={value}>{children}</CommerceSiteContext.Provider>;
};

export const useCommerceSite = (): CommerceSite => {
    const site = useContext(CommerceSiteContext);
    if (!site) throw new Error('useCommerceSite: no CommerceSiteProvider above this component');
    return site;
};

/* ── page data context ────────────────────────────────────────────── */

/**
 * What the fixed route on screen is about: a template's sections
 * read the Product or Collection of the route from here instead of taking it as a prop, so the
 * same section works on a template and, with an explicit source, on an authored page. The
 * records themselves live in the query cache (ui/queries.ts: usePageProduct), keyed by this.
 */
const CommercePageContext = createContext<CommerceRoute | null>(null);

export const CommercePageProvider: React.FC<{ route: CommerceRoute; children: React.ReactNode }> = ({ route, children }) => (
    <CommercePageContext.Provider value={route}>{children}</CommercePageContext.Provider>
);

/** The route of the page on screen; null on an authored page. */
export const useCommercePage = (): CommerceRoute | null => useContext(CommercePageContext);

/* ── links ────────────────────────────────────────────────────────── */

export interface ShopLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
    /** Site-relative address: "p/<slug>", "c/<slug>?sort=newest", "search?q=…", "" for home. */
    to: string;
}

/**
 * A real anchor (crawlable, opens in a new tab on modifier-click) that navigates inside the
 * app. Always by `href`, so an address with its own query string keeps it.
 */
export const ShopLink = React.forwardRef<HTMLAnchorElement, ShopLinkProps>(({ to, onClick, children, ...rest }, ref) => {
    const { href } = useCommerceSite();
    const router = useRouter();
    const target = href(to);
    return (
        <a
            ref={ref}
            href={target}
            onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                if (rest.target === '_blank') return;
                event.preventDefault();
                void router.navigate({ href: target });
            }}
            {...rest}
        >
            {children}
        </a>
    );
});
ShopLink.displayName = 'ShopLink';

/** navigate() for shop addresses, in the visitor's language. */
export const useShopNavigate = () => {
    const { href } = useCommerceSite();
    const router = useRouter();
    return useCallback(
        (to: string, opts?: { replace?: boolean }) => router.navigate({ href: href(to), replace: opts?.replace }),
        [href, router]
    );
};

/** A wa.me link with a message, or "" when the shop has no WhatsApp number. */
export const whatsappLink = (number: string, text: string): string => {
    const digits = (number || '').replace(/\D/g, '');
    return digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : '';
};

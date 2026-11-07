import React from 'react';
import { useParams } from '@tanstack/react-router';
import { RouteMatcher } from '../-services/route-matcher';
import { useCatalogueTag } from './CatalogueTagContext';
import { useCatalogueLocale } from '../-utils/catalogue-locale';
import { withLocaleParam } from '../-utils/catalogue-site-language';
import { useSiteNavigate } from '../-utils/catalogue-route-search';

interface CatalogueLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    /** The route value — can be a page slug ("about-us"), "homepage", full URL, or #anchor */
    to: string;
    children: React.ReactNode;
}

/**
 * Smart link component for catalogue pages.
 * - External URLs (http/https/mailto/tel) → regular <a> with target=_blank
 * - Anchor links (#pricing) → smooth scroll to element
 * - Page + anchor (about-us#team) → navigate to page, then scroll
 * - Internal routes → SPA navigation via TanStack Router
 */
export const CatalogueLink: React.FC<CatalogueLinkProps> = ({ to, children, target, className, style, ...rest }) => {
    const siteNavigate = useSiteNavigate();
    const params = useParams({ strict: false }) as { tagName?: string };
    // Context first: on a root-mounted host the param is a page route, not the tag.
    const tagName = useCatalogueTag(params.tagName || '');
    // A visitor reading the site in a non-base language keeps it on every
    // internal link — in the href too, so crawlers and new tabs reach the
    // translated page. null on single-language sites (links unchanged).
    const siteLocale = useCatalogueLocale();
    const carryLocale = siteLocale.enabled && siteLocale.locale !== siteLocale.baseLocale ? siteLocale.locale : null;

    if (!to || to === '#') {
        return <span className={className} style={style} {...rest}>{children}</span>;
    }

    const isExternal = to.startsWith('http://') || to.startsWith('https://') || to.startsWith('mailto:') || to.startsWith('tel:');

    if (isExternal) {
        return (
            <a href={to} target={target || '_blank'} rel="noopener noreferrer" className={className} style={style} {...rest}>
                {children}
            </a>
        );
    }

    // Parse anchor from route: "about-us#team" → route="about-us", hash="#team"
    // Pure anchor: "#pricing" → route="", hash="#pricing"
    const hashIndex = to.indexOf('#');
    const routePart = hashIndex >= 0 ? to.slice(0, hashIndex) : to;
    const hashPart = hashIndex >= 0 ? to.slice(hashIndex) : '';

    // Pure anchor link on current page
    if (!routePart && hashPart) {
        const handleAnchorClick = (e: React.MouseEvent) => {
            e.preventDefault();
            const el = document.getElementById(hashPart.slice(1));
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        return (
            <a href={hashPart} onClick={handleAnchorClick} className={className} style={style} {...rest}>
                {children}
            </a>
        );
    }

    // Internal route (possibly with anchor). A page route may arrive as
    // "/new/contact" (authored as an absolute site path) — strip the tag so a
    // root-mounted host does not emit "/new/contact" for a page that lives at
    // "/contact"; RouteMatcher.pagePath() then applies whichever prefix the
    // host actually uses.
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strippedRoute = tagName
        ? routePart.replace(new RegExp(`^/?${escapedTag}(?=/|$)`, 'i'), '')
        : routePart;
    const fullPath = RouteMatcher.pagePath(tagName, strippedRoute);
    const linkPath = withLocaleParam(fullPath, carryLocale);
    const fullHref = linkPath + hashPart;

    const handleClick = (e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey || target === '_blank') return;
        e.preventDefault();
        // `navigate({ to })` with the authored address, exactly as always —
        // unless the router is carrying a site language, when an address with
        // its own query string goes by `href` so ?lang= joins that query
        // instead of following a second "?" (see siteNavigateOptions). Without
        // a language to carry, linkPath is fullPath.
        siteNavigate(linkPath).then(() => {
            if (hashPart) {
                // Wait for page render, then scroll to anchor
                requestAnimationFrame(() => {
                    const el = document.getElementById(hashPart.slice(1));
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
        });
    };

    return (
        <a href={fullHref} onClick={handleClick} target={target} className={className} style={style} {...rest}>
            {children}
        </a>
    );
};

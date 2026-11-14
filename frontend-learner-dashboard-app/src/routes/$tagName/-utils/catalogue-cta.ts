/**
 * Helpers for the hardcoded mobile bottom-bar CTAs (Login / Get Started).
 *
 * The desktop header renders its auth buttons from the catalogue's configured
 * `authLinks`, so removing "Get Started" there is a pure config change. The mobile
 * bottom bar historically hardcoded the same buttons, which meant a catalogue that
 * dropped "Get Started" from its header still showed it on mobile. These helpers let
 * the mobile bar mirror the same `authLinks` config so both stay consistent.
 */

import { findRootPage } from './catalogue-root-page';

type AuthLink = { label?: string; route?: string; audienceId?: string; formTitle?: string };

const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * The page a visitor is on: the one routed at `pageSlug`, else the home page
 * (catalogue-root-page.ts: matched by its route first and only then by id
 * 'home'), so a site that moved its old home page elsewhere (its route
 * changed, its id did not) still reads the header of the page actually served
 * at the root.
 */
function findActivePage(catalogueData: any, pageSlug?: string): any {
    const pages: any[] = catalogueData?.pages || [];
    if (pageSlug) return pages.find((p) => p?.route === pageSlug || p?.route === `/${pageSlug}`);
    return findRootPage(pages);
}

/**
 * Resolve the auth links for the header the learner actually sees on a page: the
 * page's own header component if it has one, else the global header template.
 * Returns [] when the catalogue defines no auth links at all.
 */
export function resolveHeaderAuthLinks(catalogueData: any, pageSlug?: string): AuthLink[] {
    const page = findActivePage(catalogueData, pageSlug);
    const pageHeader = page?.components?.find((c: any) => c?.type === 'header');
    const links =
        pageHeader?.props?.authLinks ??
        catalogueData?.globalSettings?.layout?.header?.props?.authLinks;
    return Array.isArray(links) ? links : [];
}

/**
 * Whether the mobile "Get Started" CTA should render. It mirrors the header config:
 * shown only when the header advertises a "Get Started" (or signup / lead-form) auth
 * link. When a catalogue defines NO auth links at all, the legacy behaviour is kept
 * (show it) so default-config institutes are unaffected.
 */
export function shouldShowMobileGetStarted(catalogueData: any, pageSlug?: string): boolean {
    const links = resolveHeaderAuthLinks(catalogueData, pageSlug);
    if (links.length === 0) return true; // no authLinks configured → legacy default
    return links.some((l) => {
        const r = norm(l.route);
        const label = norm(l.label);
        return r === 'getstarted' || label === 'getstarted' || r === 'signup';
    });
}


/**
 * Links the mobile bottom bar should render — the SAME buttons as the header,
 * so the bar has one mental model: "your header buttons, stacked for thumbs".
 *
 * Returns:
 *  - null  → the catalogue never configured authLinks → legacy default bar
 *            (Login + Get Started) so existing institutes are unaffected;
 *  - []    → the admin explicitly removed every header button → hide the bar;
 *  - [...] → render these (login routes, campaign-form buttons, page links).
 */
export function resolveMobileBarLinks(catalogueData: any, pageSlug?: string): AuthLink[] | null {
    const page = findActivePage(catalogueData, pageSlug);
    const pageHeader = page?.components?.find((c: any) => c?.type === 'header');
    const links =
        pageHeader?.props?.authLinks ??
        catalogueData?.globalSettings?.layout?.header?.props?.authLinks;
    return Array.isArray(links) ? links : null;
}

/** Classification the bar shares with the header's click handling. */
export function classifyBarLink(link: AuthLink): 'login' | 'signup' | 'form' | 'leadCollection' | 'navigate' {
    if (((link.audienceId as string) || '').trim()) return 'form';
    const r = norm(link.route);
    if (r === 'login') return 'login';
    if (r === 'signup') return 'signup';
    const label = norm(link.label);
    if (r === 'getstarted' || r === '' || label.includes('getstarted')) return 'leadCollection';
    return 'navigate';
}

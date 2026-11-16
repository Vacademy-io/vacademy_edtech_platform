/**
 * The only commerce code outside the commerce chunk, part 1: lazy handles for the two places
 * that draw shop UI inside existing components (a `commerce*` section in JsonRenderer, the
 * buttons in the site header). Depends on React and config.ts only, so importing it adds a few
 * hundred bytes and nothing else to the components that use it. A site without a shop never
 * triggers the import of the chunk, so the course pages' bundle does not grow.
 */
import React, { Suspense, lazy } from 'react';
import { RouteMatcher } from '../../-services/route-matcher';
import { categoryBarOn, isCommerceEnabled, parseCommerceConfig } from './config';
import { commercePageKey, siteSegments } from './routes';

const entry = () => import('./entry');

const LazyCommerceSection = lazy(() => entry().then((m) => ({ default: m.CommerceSection })));
const LazyCommerceHeaderSlot = lazy(() => entry().then((m) => ({ default: m.CommerceHeaderSlot })));
const LazyCommerceHeaderRow = lazy(() => entry().then((m) => ({ default: m.CommerceHeaderRow })));

interface SiteProps {
    instituteId: string;
    tagName: string;
    globalSettings: unknown;
}

/** True for a section type the commerce chunk renders ("commerceProductRail"…). */
export const isCommerceSectionType = (type: unknown): type is string =>
    typeof type === 'string' && /^commerce[A-Z]/.test(type);

const FALLBACK_HEIGHT: Record<string, string> = {
    commerceTrustStrip: 'min-h-24',
    commerceAnnouncementBar: 'min-h-11',
    commerceWhatsAppButton: '',
    commerceProductGrid: 'min-h-screen',
};

/** A `commerce*` section of an authored page. Renders nothing on a site without a shop. */
export const CommerceSectionSlot: React.FC<SiteProps & { type: string; props: Record<string, unknown> }> = (props) => {
    if (!isCommerceEnabled(props.globalSettings)) return null;
    return (
        // The section's place is held while the shop's code loads, so the page below does not
        // jump: a strip is short, a rail or a grid of tiles is a card tall, a floating button none.
        <Suspense fallback={<div className={FALLBACK_HEIGHT[props.type] ?? 'min-h-72'} aria-hidden="true" />}>
            <LazyCommerceSection {...props} />
        </Suspense>
    );
};

/** The shop's buttons in the site header. Renders nothing on a site without a shop. */
export const CommerceHeaderSlot: React.FC<SiteProps & { showLanguage?: boolean; className?: string }> = (props) => {
    if (!props.instituteId || !isCommerceEnabled(props.globalSettings)) return null;
    return (
        // Two 44 px buttons' worth of room, so the header does not shift when they arrive.
        <Suspense fallback={<span className="inline-block h-11 w-24" aria-hidden="true" />}>
            <LazyCommerceHeaderSlot {...props} />
        </Suspense>
    );
};

/**
 * True when the site's category bar shows on the page at this browser path. Worked out from the
 * settings and the address alone, so the header and the page offset agree at the first paint.
 * False on every site without commerce.categoryBar.enabled.
 */
export const isCategoryBarOn = (globalSettings: unknown, tagName: string | null | undefined, pathname: string): boolean => {
    const config = parseCommerceConfig(globalSettings);
    if (!config.enabled || !config.categoryBar) return false;
    const tag = tagName || '';
    return categoryBarOn(config, commercePageKey(siteSegments(pathname, tag ? RouteMatcher.basePath(tag) : '', tag)));
};

/** True when the bar is on for an authored page's route ("homepage", "shop") or a fixed route's kind ("product"). */
export const isCategoryBarOnFor = (globalSettings: unknown, pageRoute: string | null | undefined): boolean => {
    const config = parseCommerceConfig(globalSettings);
    if (!config.enabled || !config.categoryBar) return false;
    return categoryBarOn(config, commercePageKey((pageRoute || '').split('/')));
};

/**
 * The category bar, a second row of the fixed site header. Its 48 px are held while the shop's
 * code loads, so nothing under the header moves. The caller renders it only when isCategoryBarOn.
 */
export const CommerceHeaderRow: React.FC<SiteProps & { menuOpen?: boolean }> = (props) => {
    if (!props.instituteId || !isCommerceEnabled(props.globalSettings)) return null;
    return (
        <Suspense fallback={<div className="h-12" aria-hidden="true" />}>
            <LazyCommerceHeaderRow {...props} />
        </Suspense>
    );
};

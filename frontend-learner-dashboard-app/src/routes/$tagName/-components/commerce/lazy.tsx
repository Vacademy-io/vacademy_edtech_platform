/**
 * The only commerce code outside the commerce chunk, part 1: lazy handles for the two places
 * that draw shop UI inside existing components (a `commerce*` section in JsonRenderer, the
 * buttons in the site header). Depends on React and config.ts only, so importing it adds a few
 * hundred bytes and nothing else to the components that use it. A site without a shop never
 * triggers the import of the chunk, so the course pages' bundle does not grow.
 */
import React, { Suspense, lazy } from 'react';
import { RouteMatcher } from '../../-services/route-matcher';
import { categoryBarOn, categoryBarPhotosOn, isCommerceEnabled, parseCommerceConfig } from './config';
import { bannerBox, ratioCss } from './logic/banner-box';
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
    commerceNewsCarousel: 'min-h-96',
};

/**
 * The rotating banner's exact box (commerceBannerCarousel), from the same props and the same
 * reader its stylesheet uses: the section's padding, the shell's width, the picture's aspect
 * ratio below and above 640 px, and the row of dots and the pause button.
 */
const BannerFallback: React.FC<{ props: Record<string, unknown> }> = ({ props }) => {
    const banner = bannerBox(props);
    if (banner.slides === 0) return null;
    return (
        <div className="py-8 md:py-12" aria-hidden="true">
            <div
                className="mx-auto w-full px-4 lg:px-8"
                // The ratios are the section's own props (dynamic), the width the site's theme value.
                style={{ maxWidth: 'var(--catalogue-content-max, 1216px)', ['--cmx-bx-m' as string]: ratioCss(banner.ratioPhone), ['--cmx-bx-d' as string]: ratioCss(banner.ratio) }} // design-lint-ignore
            >
                <div className="-mx-4 aspect-[var(--cmx-bx-m)] bg-catalogue-bg-muted sm:mx-0 sm:aspect-[var(--cmx-bx-d)] sm:rounded-lg" />
                {banner.bar && <div className="mt-2 h-11" />}
            </div>
        </div>
    );
};

/** A `commerce*` section of an authored page. Renders nothing on a site without a shop. */
export const CommerceSectionSlot: React.FC<SiteProps & { type: string; props: Record<string, unknown> }> = (props) => {
    if (!isCommerceEnabled(props.globalSettings)) return null;
    return (
        // The section's place is held while the shop's code loads, so the page below does not
        // jump: a strip is short, a rail or a grid of tiles is a card tall, a floating button none,
        // and the banner its exact box.
        <Suspense
            fallback={
                props.type === 'commerceBannerCarousel' ? (
                    <BannerFallback props={props.props} />
                ) : (
                    <div className={FALLBACK_HEIGHT[props.type] ?? 'min-h-72'} aria-hidden="true" />
                )
            }
        >
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

/** The bar's page key at a browser path ("home", "collection", "shop"…). */
const pageKeyAt = (tagName: string | null | undefined, pathname: string): string => {
    const tag = tagName || '';
    return commercePageKey(siteSegments(pathname, tag ? RouteMatcher.basePath(tag) : '', tag));
};

/** The bar's page key of an authored page's route ("homepage", "shop") or a fixed route's kind ("product"). */
const pageKeyFor = (pageRoute: string | null | undefined): string => commercePageKey((pageRoute || '').split('/'));

/** What the page offset under the fixed header needs: the bar on, and its 96 px photo row open (style "image"). */
export interface CategoryBarOffset {
    categoryBar: boolean;
    categoryPhotos: boolean;
}

const offsetAt = (globalSettings: unknown, pageKey: string): CategoryBarOffset => {
    const config = parseCommerceConfig(globalSettings);
    if (!config.enabled || !config.categoryBar) return { categoryBar: false, categoryPhotos: false };
    return { categoryBar: categoryBarOn(config, pageKey), categoryPhotos: categoryBarPhotosOn(config, pageKey) };
};

/**
 * True when the site's category bar shows on the page at this browser path. Worked out from the
 * settings and the address alone, so the header and the page offset agree at the first paint.
 * False on every site without commerce.categoryBar.enabled.
 */
export const isCategoryBarOn = (globalSettings: unknown, tagName: string | null | undefined, pathname: string): boolean =>
    offsetAt(globalSettings, pageKeyAt(tagName, pathname)).categoryBar;

/** True when the bar is on for an authored page's route ("homepage", "shop") or a fixed route's kind ("product"). */
export const isCategoryBarOnFor = (globalSettings: unknown, pageRoute: string | null | undefined): boolean =>
    offsetAt(globalSettings, pageKeyFor(pageRoute)).categoryBar;

/** The page offset's view of the bar at a browser path (headerOffsetClass's third argument). */
export const categoryBarOffsetAt = (globalSettings: unknown, tagName: string | null | undefined, pathname: string): CategoryBarOffset =>
    offsetAt(globalSettings, pageKeyAt(tagName, pathname));

/** The page offset's view of the bar for an authored page's route or a fixed route's kind. */
export const categoryBarOffsetFor = (globalSettings: unknown, pageRoute: string | null | undefined): CategoryBarOffset =>
    offsetAt(globalSettings, pageKeyFor(pageRoute));

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

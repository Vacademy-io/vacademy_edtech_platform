/**
 * The commerce chunk: everything a shop needs, loaded only on a site with a shop. The route
 * files, JsonRenderer and the site header reach it through React.lazy (lazy.tsx), so a course
 * site never downloads it.
 */
import React, { Suspense, lazy, useRef } from 'react';
import { useLocation } from '@tanstack/react-router';
import './theme/commerce.css';
import { useCatalogueTracking, type TrackingSettings } from '../../-utils/catalogue-tracking';
import { readSearchParam } from '../../-utils/catalogue-url-state';
import { CatalogueChrome } from '../CatalogueChrome';
import type { CommerceRoute } from './routes';
import { sectionsOf } from './templates';
import { ratioClass } from './logic/media';
import { CartPage } from './ui/Cart';
import { CategoryBar, HeaderSlot } from './ui/Chrome';
import { ShopHead } from './ui/Head';
import { CollectionTemplate, SearchTemplate } from './ui/Listing';
import { ProductTemplate } from './ui/Product';
import { ScanLanding } from './ui/Scan';
import { CommerceSectionView } from './ui/Sections';
import { useCommerceThemeVars } from './ui/primitives';
import { CommercePageProvider, CommerceSiteProvider, useCommerceSite } from './ui/site';
import { useCommerceFonts, useOnline, useShopScroll } from './ui/hooks';
import type { MessageKey } from './i18n';

const BuyPages = lazy(() => import('./ui/buy-pages'));

const BUYING_TITLES: Record<string, MessageKey> = {
    checkout: 'checkout.title',
    order: 'order.pageTitle',
    track: 'track.title',
    account: 'account.title',
};

const isBuying = (route: CommerceRoute): route is Extract<CommerceRoute, { kind: 'checkout' | 'order' | 'track' | 'account' }> =>
    route.kind === 'checkout' || route.kind === 'order' || route.kind === 'track' || route.kind === 'account';

const BuyingFallback: React.FC = () => (
    <div className="cmx-shell cmx-section" aria-busy="true">
        <div className="cmx-skel mb-4 h-8 w-40" aria-hidden="true" />
        <div className="cmx-skel cmx-skel--field w-full" aria-hidden="true" />
    </div>
);

interface SiteProps {
    instituteId: string;
    tagName: string;
    globalSettings: unknown;
    /** The institute's name for page titles, where the caller knows it. */
    siteName?: string | null;
}

const hasSiteHeader = (globalSettings: unknown): boolean => {
    const header = (globalSettings as { layout?: { header?: { enabled?: boolean } } } | null)?.layout?.header;
    return !!header && header.enabled !== false;
};

/** What makes two addresses the same PAGE: the route and its record, and for a search its text. */
const pageIdOf = (route: CommerceRoute, q: string): string =>
    route.kind === 'product' || route.kind === 'collection'
        ? `${route.kind}:${route.slug}`
        : route.kind === 'scan'
          ? `scan:${route.code}`
          : route.kind === 'search'
            ? `search:${q}`
            : route.kind;

const RouteBody: React.FC<{ route: CommerceRoute; siteHeader: boolean; tracking: TrackingSettings | null }> = ({ route, siteHeader, tracking }) => {
    const { config, locale, t } = useCommerceSite();
    const themeVars = useCommerceThemeVars();
    const online = useOnline();
    useCommerceFonts();
    // The site's own GA4 / GTM / Meta Pixel (globalSettings.tracking), which the authored pages
    // already load; without it a visitor who lands on a product page would send no event at all.
    useCatalogueTracking(tracking);
    const q = useLocation({ select: (l) => readSearchParam(l.searchStr || '', 'q') || '' });
    const mainRef = useRef<HTMLElement>(null);
    // A tapped page opens at the top with focus on its content; Back returns to where the shopper was.
    useShopScroll(pageIdOf(route, route.kind === 'search' ? q : ''), mainRef);
    return (
        <div className={`cmx cmx-page ${ratioClass(config.theme.imageRatio)}`} lang={locale} style={themeVars}>
            {!siteHeader && (
                // A site without a header of its own still gets search, language and cart.
                <div className="cmx-topbar">
                    <div className="cmx-shell flex items-center justify-end">
                        <HeaderSlot />
                    </div>
                </div>
            )}
            {!online && (
                <p className="cmx-offline" role="status">
                    {t('offline.banner')}
                </p>
            )}
            {/* Checkout keeps the shopper on the form: no category menu to wander off through. */}
            {route.kind !== 'checkout' && <CategoryBar current={route.kind === 'collection' ? route.slug : null} />}
            <main id="catalogue-main" tabIndex={-1} ref={mainRef} className="outline-none">
                {route.kind === 'product' && <ProductTemplate key={route.slug} slug={route.slug} sections={sectionsOf(config, 'product')} />}
                {route.kind === 'collection' && <CollectionTemplate key={route.slug} slug={route.slug} sections={sectionsOf(config, 'collection')} />}
                {route.kind === 'search' && <SearchTemplate sections={sectionsOf(config, 'search')} />}
                {route.kind === 'cart' && (
                    <>
                        <ShopHead title={t('cart.title')} noindex />
                        <CartPage />
                    </>
                )}
                {route.kind === 'scan' && <ScanLanding code={route.code} />}
                {isBuying(route) && (
                    <>
                        <ShopHead title={t(BUYING_TITLES[route.kind]!)} noindex />
                        <Suspense fallback={<BuyingFallback />}>
                            <BuyPages kind={route.kind} />
                        </Suspense>
                    </>
                )}
            </main>
        </div>
    );
};

/** A fixed shop route inside the site's own chrome (header, footer, theme, language). */
export const CommerceRoutePage: React.FC<SiteProps & { route: CommerceRoute }> = ({ instituteId, tagName, globalSettings, siteName, route }) => (
    <CatalogueChrome tagName={tagName} instituteId={instituteId}>
        <CommerceSiteProvider instituteId={instituteId} tagName={tagName} globalSettings={globalSettings} siteName={siteName}>
            <CommercePageProvider route={route}>
                <RouteBody
                    route={route}
                    siteHeader={hasSiteHeader(globalSettings)}
                    tracking={(globalSettings as { tracking?: TrackingSettings } | null)?.tracking || null}
                />
            </CommercePageProvider>
        </CommerceSiteProvider>
    </CatalogueChrome>
);

/** A `commerce*` section of an authored page. */
export const CommerceSection: React.FC<SiteProps & { type: string; props: Record<string, unknown> }> = ({
    instituteId,
    tagName,
    globalSettings,
    type,
    props,
}) => (
    <CommerceSiteProvider instituteId={instituteId} tagName={tagName} globalSettings={globalSettings}>
        <SectionFonts />
        <CommerceSectionView type={type} props={props} />
    </CommerceSiteProvider>
);

const SectionFonts: React.FC = () => {
    useCommerceFonts();
    return null;
};

/** Search, language and cart for the site header (and the overlay and drawer they open). */
export const CommerceHeaderSlot: React.FC<SiteProps & { showLanguage?: boolean; className?: string }> = ({
    instituteId,
    tagName,
    globalSettings,
    showLanguage,
    className,
}) => (
    <CommerceSiteProvider instituteId={instituteId} tagName={tagName} globalSettings={globalSettings}>
        <HeaderSlot showLanguage={showLanguage} className={className} />
    </CommerceSiteProvider>
);

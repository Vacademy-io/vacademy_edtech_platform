/**
 * Commerce sections for authored pages (Home): category rail,
 * product rail, trust strip, collection grid and occasion banner. Each takes its source in
 * its props, so it can sit on any page.
 */
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Category } from '../api/types';
import { findCategory } from '../edge/commerce-edge';
import { withinDates } from '../logic/dates';
import { ratioClass } from '../logic/media';
import { BARE_SECTIONS, CONTENT_SECTIONS } from './ContentSections';
import { ErrorState, useCommerceThemeVars, usePresetClass } from './primitives';
import { ProductRail } from './ProductCard';
import { ReassuranceRows } from './Product';
import { menuCategories, useCategoryTree, usePageProduct, useProductRail } from './queries';
import { ShopLink, useCommerceSite, whatsappLink } from './site';

type Props = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);

const SectionHead: React.FC<{ title: string; to?: string; cta?: string }> = ({ title, to, cta }) => {
    const { t } = useCommerceSite();
    if (!title && !to) return null;
    return (
        <div className="cmx-head">
            {title && <h2 className="cmx-h2">{title}</h2>}
            {to && (
                <ShopLink to={to} className="cmx-link cmx-small shrink-0">
                    {cta || t('rail.viewAll')}
                </ShopLink>
            )}
        </div>
    );
};

/** Named collections in the order given, or the menu categories when `auto`. */
const useTiles = (slugs: string[], max: number, minInStock: number): { tiles: Category[]; loading: boolean } => {
    const { data, isLoading } = useCategoryTree();
    const tiles = useMemo(() => {
        if (slugs.length > 0) {
            return slugs
                .map((slug) => findCategory(data?.data, slug)?.node)
                .filter((node): node is Category => !!node)
                .slice(0, max);
        }
        return menuCategories(data?.data, minInStock).slice(0, max);
    }, [data, slugs, max, minInStock]);
    return { tiles, loading: isLoading };
};

const Tiles: React.FC<{ tiles: Category[]; loading: boolean; count: number; rail?: boolean; compact?: boolean }> = ({
    tiles,
    loading,
    count,
    rail,
    compact,
}) => {
    // A rail swipes sideways on a phone (one row before the first product); a grid stays a grid.
    // Compact tiles are small square chips, one row on a desktop, so products follow sooner.
    const className = cn('cmx-tiles', rail && 'cmx-tiles--rail', compact && 'cmx-tiles--compact');
    if (loading) {
        return (
            <ul className={className} aria-hidden="true">
                {Array.from({ length: Math.min(count, 4) }, (_, i) => (
                    <li key={i} className="cmx-tile">
                        <div className="cmx-img cmx-skel" />
                        <span className="cmx-tile__name">&nbsp;</span>
                    </li>
                ))}
            </ul>
        );
    }
    return (
        <ul className={className}>
            {tiles.map((tile) => (
                <li key={tile.slug}>
                    <ShopLink to={`c/${tile.slug}`} className="cmx-tile">
                        <span className="cmx-img block">
                            {tile.image_url && <img src={tile.image_url} alt="" loading="lazy" decoding="async" width={400} height={500} />}
                        </span>
                        <span className="cmx-tile__name">{tile.name || tile.slug}</span>
                    </ShopLink>
                </li>
            ))}
        </ul>
    );
};

/** commerceCategoryRail: props { title, collectionIds | auto, max: 8, minInStock: 4, size: "compact" }. */
const CategoryRail: React.FC<{ props: Props }> = ({ props }) => {
    const { config, siteT } = useCommerceSite();
    const max = num(props.max, 8, 1, 12);
    const { tiles, loading } = useTiles(strings(props.collectionIds), max, num(props.minInStock, config.minInStock, 0, 1000));
    if (!loading && tiles.length === 0) return null;
    return (
        <>
            <SectionHead title={siteT(str(props.title))} />
            <Tiles tiles={tiles} loading={loading} count={max} rail compact={str(props.size) === 'compact'} />
        </>
    );
};

/** commerceCollectionGrid ("shop by need"): props { title, collectionIds }. */
const CollectionGrid: React.FC<{ props: Props }> = ({ props }) => {
    const { siteT } = useCommerceSite();
    const slugs = strings(props.collectionIds);
    const { tiles, loading } = useTiles(slugs, 12, 0);
    if (slugs.length === 0 || (!loading && tiles.length === 0)) return null;
    return (
        <>
            <SectionHead title={siteT(str(props.title))} />
            <Tiles tiles={tiles} loading={loading} count={slugs.length} />
        </>
    );
};

/**
 * commerceProductRail: props { title, source: "collection" | "new", collection, limit: 6,
 * inStockOnly: true, showQuickAdd, cta }. "Bestsellers" is a hand-kept collection in Phase 1.
 */
const ProductRailSection: React.FC<{ props: Props }> = ({ props }) => {
    const { siteT } = useCommerceSite();
    // Without a source of its own, a rail on a product template follows the page's product:
    // more from its category.
    const pageProduct = usePageProduct().data;
    const pageCategory = (pageProduct?.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY')?.slug || '';
    const source = str(props.source) || (str(props.collection) || pageCategory ? 'collection' : 'new');
    const collection = source === 'collection' ? str(props.collection) || pageCategory : '';
    const limit = num(props.limit, 6, 1, 12);
    const query = useProductRail({
        collection: collection || undefined,
        sort: source === 'new' ? 'newest' : 'recommended',
        inStock: props.inStockOnly === false ? undefined : true,
        pageSize: limit,
    });
    const products = query.data?.data || [];
    if (query.isError) return <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />;
    if (!query.isPending && products.length === 0) return null;
    return (
        <>
            <SectionHead title={siteT(str(props.title))} to={collection ? `c/${collection}` : undefined} cta={siteT(str(props.cta)) || undefined} />
            {query.isPending ? (
                <ul className="cmx-rail" aria-hidden="true">
                    {Array.from({ length: Math.min(limit, 4) }, (_, i) => (
                        <li key={i} className="cmx-card">
                            <div className="cmx-img cmx-skel" />
                            <div className="cmx-card__body">
                                <div className="cmx-skel h-4 w-11/12" />
                                <div className="cmx-skel h-5 w-1/3" />
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <ProductRail
                    products={products}
                    columns={Math.min(limit, 4)}
                    showQuickAdd={props.showQuickAdd !== false}
                    listId={collection ? `rail:c/${collection}` : `rail:${source}`}
                    listName={siteT(str(props.title)) || undefined}
                />
            )}
        </>
    );
};

/** commerceTrustStrip: the shop's reassurance items, each opening its policy sheet. */
const TrustStrip: React.FC = () => {
    const { config } = useCommerceSite();
    return <ReassuranceRows items={config.reassurance.slice(0, 4)} variant="strip" />;
};

/**
 * commerceOccasionBanner: props { eyebrow, title, text, image, collectionId, cta, startDate,
 * endDate, whatsappLabel, whatsappMessage }. Shown only between its dates.
 */
const OccasionBanner: React.FC<{ props: Props }> = ({ props }) => {
    const { siteT, t, config } = useCommerceSite();
    // A bare end date keeps the banner up until the end of that day, in the shopper's own time.
    if (!withinDates(Date.now(), str(props.startDate), str(props.endDate))) return null;
    const collection = str(props.collectionId);
    const title = siteT(str(props.title));
    if (!title || !collection) return null;
    const image = str(props.image);
    const wa = str(props.whatsappLabel) ? whatsappLink(config.whatsappNumber, siteT(str(props.whatsappMessage))) : '';
    return (
        <div className="cmx-banner">
            {image && (
                <div className="cmx-img cmx-banner__img">
                    <img src={image} alt="" loading="lazy" decoding="async" width={800} height={500} />
                </div>
            )}
            <div className="cmx-banner__body">
                {str(props.eyebrow) && <span className="cmx-eyebrow">{siteT(str(props.eyebrow))}</span>}
                <h2 className="cmx-h2">{title}</h2>
                {str(props.text) && <p className="cmx-body">{siteT(str(props.text))}</p>}
                <ShopLink to={`c/${collection}`} className="cmx-btn cmx-btn--primary self-start">
                    {siteT(str(props.cta)) || t('rail.viewAll')}
                </ShopLink>
                {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="cmx-link cmx-tap inline-flex items-center self-start">
                        {siteT(str(props.whatsappLabel))}
                    </a>
                )}
            </div>
        </div>
    );
};

const SECTIONS: Record<string, React.FC<{ props: Props }>> = {
    commerceCategoryRail: CategoryRail,
    commerceCollectionGrid: CollectionGrid,
    commerceProductRail: ProductRailSection,
    commerceTrustStrip: TrustStrip,
    commerceOccasionBanner: OccasionBanner,
    ...CONTENT_SECTIONS,
};

export const COMMERCE_SECTION_TYPES = [...Object.keys(SECTIONS), ...Object.keys(BARE_SECTIONS)];

/** "#partner" style anchor of a section: lowercase letters, digits and hyphens only. */
const sectionAnchor = (value: unknown): string | undefined => {
    const id = str(value).toLowerCase();
    return /^[a-z][a-z0-9-]{0,60}$/.test(id) ? id : undefined;
};

/** One commerce section of an authored page; an unknown type renders nothing. */
export const CommerceSectionView: React.FC<{ type: string; props: Props }> = ({ type, props }) => {
    const { config, locale } = useCommerceSite();
    const preset = usePresetClass();
    const themeVars = useCommerceThemeVars();
    const Bare = BARE_SECTIONS[type];
    const Section = SECTIONS[type];
    if ((!Section && !Bare) || !config.enabled) return null;
    if (Bare) {
        return (
            <div className={cn('cmx', preset)} lang={locale} style={themeVars}>
                <Bare props={props} />
            </div>
        );
    }
    return (
        <section
            id={sectionAnchor(props.anchor)}
            className={cn('cmx cmx-section', preset, ratioClass(config.theme.imageRatio), props.band === true && 'cmx-band')}
            lang={locale}
            style={themeVars}
        >
            <div className="cmx-shell">
                <Section props={props} />
            </div>
        </section>
    );
};

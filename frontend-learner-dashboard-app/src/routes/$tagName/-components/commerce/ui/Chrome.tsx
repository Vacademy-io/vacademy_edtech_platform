/**
 * The shop's part of the site chrome: search and cart buttons with
 * a count and the language text switch for the site header, the search overlay with
 * suggestions, the cart drawer, and the category bar fed by /categories.
 */
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { CaretDown, MagnifyingGlass, ShoppingBagOpen, SquaresFour, WhatsappLogo, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Category } from '../api/types';
import { cartCount } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { localeLabel } from '../i18n';
import { apiPathTo, parseCommerceRoute, commercePageKey, siteSegments, withQuery } from '../routes';
import { RouteMatcher } from '../../../-services/route-matcher';
import { categoryBarPhotosOn } from '../config';
import { activeBarChip, barChips, type BarChip } from '../logic/category-bar';
import { PHOTO_ROW_COLLAPSE_Y, useHeaderBottom, useHeaderFold } from './hooks';
import { thumbUrl } from '../logic/media';
import { CartDrawer } from './Cart';
import { Layer, PriceText, useCommerceThemeVars, usePresetClass } from './primitives';
import { menuCategories, useCategoryTree, useProduct, useSuggestions } from './queries';
import { ShopLink, useCommerceSite, useShopNavigate, whatsappLink } from './site';

const OPEN_SEARCH_EVENT = 'commerce:open-search';

/** Opens the search overlay from anywhere on the page (a hero button, the no-results page). */
export const openCommerceSearch = (): void => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
};

/** "हिं | EN": text, never a flag. Hidden on a shop with one language. */
export const LanguageSwitch: React.FC<{ className?: string }> = ({ className }) => {
    const { locales, locale, setLocale, t } = useCommerceSite();
    if (locales.length < 2) return null;
    return (
        <div className={cn('cmx-lang', className)} role="group" aria-label={t('nav.language')}>
            {locales.map((code, index) => (
                <React.Fragment key={code}>
                    {index > 0 && <span aria-hidden="true">|</span>}
                    <button type="button" lang={code} aria-pressed={code === locale} onClick={() => code !== locale && setLocale(code)}>
                        {localeLabel(code)}
                    </button>
                </React.Fragment>
            ))}
        </div>
    );
};

/* ── search overlay ───────────────────────────────────────────────── */

export const SearchOverlay: React.FC<{ open: boolean; onClose(): void }> = ({ open, onClose }) => {
    const { t, siteT, config } = useCommerceSite();
    const navigate = useShopNavigate();
    const inputRef = useRef<HTMLInputElement>(null);
    const listId = useId();
    const [text, setText] = useState('');
    const [active, setActive] = useState(-1);
    const q = text.trim();
    const { data, isFetching } = useSuggestions(open ? text : '');
    const tree = useCategoryTree(open);
    const categories = useMemo(() => menuCategories(tree.data?.data, config.minInStock).slice(0, 8), [tree.data, config.minInStock]);

    useEffect(() => {
        if (!open) {
            setText('');
            setActive(-1);
        }
    }, [open]);

    const products = q.length >= 2 ? (data?.products || []).slice(0, 6) : [];
    const collections = q.length >= 2 ? (data?.collections || []).slice(0, 3) : [];
    // Arrow keys walk one flat list: collections, then products, then "see all".
    const rows = [
        ...collections.map((c) => ({ key: `c:${c.slug}`, to: apiPathTo(c.path) || `c/${c.slug}` })),
        ...products.map((p) => ({ key: `p:${p.id}`, to: apiPathTo(p.path) || `p/${p.slug}` })),
        ...(q.length >= 2 ? [{ key: 'all', to: withQuery('search', { q }) }] : []),
    ];
    const go = (to: string) => {
        onClose();
        void navigate(to);
    };
    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const row = active >= 0 ? rows[active] : undefined;
        if (row) go(row.to);
        else if (q) go(withQuery('search', { q }));
    };
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (!rows.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => (i + 1) % rows.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
        }
    };
    const rowId = (index: number) => `${listId}-row-${index}`;
    const noResults = q.length >= 2 && !isFetching && !!data && products.length === 0 && collections.length === 0;
    const whatsapp = whatsappLink(config.whatsappNumber, t('search.whatsappText', { q }));
    let rowIndex = -1;

    return (
        <Layer open={open} onClose={onClose} side="top" title={t('search.label')} initialFocus={inputRef}
            header={
                <form role="search" className="flex flex-1 items-center gap-2" onSubmit={submit}>
                    <label className="cmx-search__field">
                        <MagnifyingGlass size={20} aria-hidden="true" className="shrink-0" />
                        <span className="cmx-sr">{t('search.label')}</span>
                        <input
                            ref={inputRef}
                            className="cmx-search__input"
                            type="search"
                            inputMode="search"
                            enterKeyHint="search"
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            maxLength={120}
                            placeholder={t('search.placeholder')}
                            value={text}
                            onChange={(e) => {
                                setText(e.target.value);
                                setActive(-1);
                            }}
                            onKeyDown={onKeyDown}
                            role="combobox"
                            aria-expanded={rows.length > 0}
                            aria-controls={listId}
                            aria-autocomplete="list"
                            aria-activedescendant={active >= 0 ? rowId(active) : undefined}
                        />
                        {text && (
                            <button type="button" className="cmx-icon-btn -me-2" onClick={() => { setText(''); inputRef.current?.focus(); }} aria-label={t('search.clear')}>
                                <X size={16} aria-hidden="true" />
                            </button>
                        )}
                    </label>
                </form>
            }
        >
            <div className="cmx-layer__body">
                <div className="cmx-shell flex flex-col gap-6 px-0">
                    <p className="cmx-sr" role="status" aria-live="polite">
                        {q.length >= 2 ? (isFetching ? t('search.suggesting') : t('search.suggestCount', { count: products.length + collections.length })) : ''}
                    </p>
                    {q.length < 2 && (
                        <>
                            {config.popularSearches.length > 0 && (
                                <section aria-label={t('search.popular')}>
                                    <h2 className="cmx-eyebrow mb-3">{t('search.popular')}</h2>
                                    <ul className="cmx-pills">
                                        {config.popularSearches.map((term) => (
                                            <li key={term}>
                                                <button type="button" className="cmx-chip" onClick={() => go(withQuery('search', { q: siteT(term) }))}>
                                                    {siteT(term)}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                            {categories.length > 0 && (
                                <section aria-label={t('nav.categories')}>
                                    <h2 className="cmx-eyebrow mb-3">{t('nav.categories')}</h2>
                                    <ul className="cmx-pills">
                                        {categories.map((c) => (
                                            <li key={c.slug}>
                                                <ShopLink to={`c/${c.slug}`} className="cmx-chip" onClick={onClose}>
                                                    {c.name || c.slug}
                                                </ShopLink>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                            {config.popularSearches.length === 0 && categories.length === 0 && (
                                <p className="cmx-muted">{t('search.prompt')}</p>
                            )}
                        </>
                    )}
                    {rows.length > 0 && (
                        <ul id={listId} role="listbox" aria-label={t('search.label')} className="cmx-search__list">
                            {collections.map((c) => {
                                rowIndex += 1;
                                const index = rowIndex;
                                return (
                                    <li key={`c:${c.slug}`} id={rowId(index)} role="option" aria-selected={active === index}>
                                        <ShopLink to={rows[index]!.to} className="cmx-search__row" onClick={onClose} tabIndex={-1}>
                                            <span className="cmx-eyebrow">{t('search.collections')}</span>
                                            <span className="font-medium">{c.name || c.slug}</span>
                                        </ShopLink>
                                    </li>
                                );
                            })}
                            {products.map((p) => {
                                rowIndex += 1;
                                const index = rowIndex;
                                const thumb = thumbUrl(p.image);
                                return (
                                    <li key={`p:${p.id}`} id={rowId(index)} role="option" aria-selected={active === index}>
                                        <ShopLink to={rows[index]!.to} className="cmx-search__row" onClick={onClose} tabIndex={-1}>
                                            <span className="cmx-img cmx-search__thumb">
                                                {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" width={44} height={55} />}
                                            </span>
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="cmx-small truncate font-medium">{p.name}</span>
                                                <PriceText price={p.price} scale={p.qty_scale} unit={p.unit} className="cmx-small" />
                                            </span>
                                        </ShopLink>
                                    </li>
                                );
                            })}
                            {q.length >= 2 && (
                                <li id={rowId(rows.length - 1)} role="option" aria-selected={active === rows.length - 1}>
                                    <ShopLink to={rows[rows.length - 1]!.to} className="cmx-search__row cmx-link" onClick={onClose} tabIndex={-1}>
                                        {t('search.seeAll', { q })}
                                    </ShopLink>
                                </li>
                            )}
                        </ul>
                    )}
                    {noResults && (
                        <div className="flex flex-col items-start gap-3">
                            <p className="font-medium">{t('search.none.title', { q })}</p>
                            <p className="cmx-small cmx-muted">{t('search.none.body')}</p>
                            {whatsapp && (
                                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--outline">
                                    <WhatsappLogo size={18} aria-hidden="true" />
                                    {t('search.askWhatsapp')}
                                </a>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Layer>
    );
};

/* ── header slot ──────────────────────────────────────────────────── */

/**
 * What the shop adds to the site header: search, the language switch (only when the header
 * does not show the site's own) and the cart button with its count. It also owns the search
 * overlay and the cart drawer, so they exist on every page that has the header.
 */
export const HeaderSlot: React.FC<{ showLanguage?: boolean; className?: string }> = ({ showLanguage = true, className }) => {
    const { t, locale } = useCommerceSite();
    const themeVars = useCommerceThemeVars();
    const cart = useCommerceCart((s) => s.cart);
    const hydrated = useCommerceCart((s) => s.hydrated);
    const openDrawer = useCommerceCart((s) => s.openDrawer);
    const [searchOpen, setSearchOpen] = useState(false);
    const count = hydrated ? cartCount(cart) : 0;
    // Where the fixed header ends, for the rows pinned under it (--cmx-head-bottom).
    const slotRef = useRef<HTMLSpanElement>(null);
    useHeaderBottom(slotRef);
    const [bump, setBump] = useState(false);
    const previous = useRef(count);
    useEffect(() => {
        if (count > previous.current) {
            setBump(true);
            const timer = setTimeout(() => setBump(false), 450);
            previous.current = count;
            return () => clearTimeout(timer);
        }
        previous.current = count;
    }, [count]);
    useEffect(() => {
        const open = () => setSearchOpen(true);
        window.addEventListener(OPEN_SEARCH_EVENT, open);
        return () => window.removeEventListener(OPEN_SEARCH_EVENT, open);
    }, []);
    return (
        <span ref={slotRef} className={cn('cmx cmx-slot', className)} lang={locale} style={themeVars}>
            <button type="button" className="cmx-icon-btn" onClick={() => setSearchOpen(true)} aria-label={t('nav.search')} aria-haspopup="dialog">
                <MagnifyingGlass size={22} aria-hidden="true" />
            </button>
            {showLanguage && <LanguageSwitch />}
            <button
                type="button"
                className="cmx-icon-btn"
                onClick={openDrawer}
                aria-haspopup="dialog"
                aria-label={count > 0 ? t('nav.cartCount', { count }) : t('nav.cart')}
            >
                <ShoppingBagOpen size={22} aria-hidden="true" />
                {count > 0 && (
                    <span className={cn('cmx-count', bump && 'cmx-count--bump')} aria-hidden="true">
                        {count > 99 ? '99+' : count}
                    </span>
                )}
            </button>
            <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
            <CartDrawer />
        </span>
    );
};

/* ── category bar ─────────────────────────────────────────────────── */

const CategoryItem: React.FC<{ node: Category; current: string | null }> = ({ node, current }) => {
    const { t } = useCommerceSite();
    const children = node.children || [];
    return (
        <li className="cmx-catbar__item">
            <ShopLink to={`c/${node.slug}`} className="cmx-catbar__link" aria-current={current === node.slug ? 'page' : undefined}>
                {node.name || node.slug}
                {children.length > 0 && <CaretDown size={12} aria-hidden="true" className="hidden lg:inline" />}
            </ShopLink>
            {children.length > 0 && (
                <ul className="cmx-catbar__menu" aria-label={t('nav.more', { name: node.name || node.slug })}>
                    {children.map((child) => (
                        <li key={child.slug}>
                            <ShopLink to={`c/${child.slug}`} aria-current={current === child.slug ? 'page' : undefined}>
                                {child.name || child.slug}
                            </ShopLink>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
};

/**
 * The category menu of a shop: categories with enough products in stock, two levels. A row
 * that scrolls sideways on a phone; on a desktop the second level opens on hover and on
 * keyboard focus. Its height is reserved while the tree loads.
 */
export const CategoryBar: React.FC<{ current?: string | null }> = ({ current = null }) => {
    const { t, config } = useCommerceSite();
    const { data, isLoading } = useCategoryTree();
    const categories = useMemo(() => menuCategories(data?.data, config.minInStock), [data, config.minInStock]);
    if (!isLoading && categories.length === 0) return null;
    return (
        <nav className="cmx-catbar" aria-label={t('nav.categories')}>
            <div className="cmx-shell">
                <ul className="cmx-catbar__row">
                    {isLoading
                        ? Array.from({ length: 5 }, (_, i) => (
                              <li key={i} className="cmx-catbar__link" aria-hidden="true">
                                  <span className="cmx-skel h-4 w-16" />
                              </li>
                          ))
                        : categories.map((node) => <CategoryItem key={node.slug} node={node} current={current} />)}
                </ul>
            </div>
        </nav>
    );
};

/* ── category bar in the site header (commerce.categoryBar) ────────── */

const HeaderChip: React.FC<{ chip: BarChip; chips: boolean; current?: 'page' | 'true' }> = ({ chip, chips, current }) => {
    const { t } = useCommerceSite();
    return (
        // data-chip finds the active chip for centring.
        <li className="cmx-catbar__item" data-chip={chip.key}>
            <ShopLink to={chip.to} className={chips ? 'cmx-hbar__chip' : 'cmx-catbar__link'} aria-current={current}>
                {chips ? <span className="cmx-hbar__pill">{chip.label}</span> : chip.label}
                {chip.children.length > 0 && <CaretDown size={12} aria-hidden="true" className="cmx-hbar__caret hidden lg:inline" />}
            </ShopLink>
            {chip.children.length > 0 && (
                <ul className="cmx-catbar__menu" aria-label={t('nav.more', { name: chip.label })}>
                    {chip.children.map((child) => (
                        <li key={child.slug}>
                            <ShopLink to={`c/${child.slug}`}>{child.label}</ShopLink>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
};

/** The photos load first for the tiles a phone shows at once; the rest when scrolled to. */
const EAGER_PHOTOS = 5;
/** The photo's box (56px on a phone, 64px from 768px; the attributes give the shape before it loads). */
const PHOTO_SIZE = 64;

/**
 * One tile of the photo row: a round photo with the name under it, or, for a collection without a
 * photo, its name as a chip. "All" is a round tile with a grid mark.
 */
const PhotoTile: React.FC<{ chip: BarChip; index: number; current?: 'page' | 'true' }> = ({ chip, index, current }) => {
    const all = chip.slug === null && chip.to.toLowerCase() === 'shop';
    if (!chip.image && !all) {
        return (
            <li data-chip={chip.key}>
                <ShopLink to={chip.to} className="cmx-hbar__tile cmx-hbar__tile--text" aria-current={current}>
                    <span className="cmx-hbar__pill">{chip.label}</span>
                </ShopLink>
            </li>
        );
    }
    return (
        <li data-chip={chip.key}>
            <ShopLink to={chip.to} className="cmx-hbar__tile" aria-current={current}>
                <span className={cn('cmx-hbar__thumb', !chip.image && 'cmx-hbar__thumb--all')} aria-hidden="true">
                    {chip.image ? (
                        <img
                            src={chip.image}
                            alt=""
                            width={PHOTO_SIZE}
                            height={PHOTO_SIZE}
                            loading={index < EAGER_PHOTOS ? 'eager' : 'lazy'}
                            decoding="async"
                        />
                    ) : (
                        <SquaresFour size={26} weight="duotone" />
                    )}
                </span>
                <span className="cmx-hbar__label">{chip.label}</span>
            </ShopLink>
        </li>
    );
};

/**
 * The shop's categories as the second row of the fixed site header: one 48 px row that swipes
 * sideways on a phone, the active chip centred, a fade on the edge that has more. On phones and
 * tablets the logo row above it folds away on scroll-down (collapseHeaderOnScroll); the bar
 * itself never hides. Its height is the same while the categories load.
 *
 * The "image" style adds a photo row: at the top of the page a round photo of each category with
 * its name under it (96 px, the page reserves it), which folds into the chip row once the page
 * scrolls, so what stays pinned is the same 48 px row. The photo row hangs over the chip row and
 * below the header's box, and folds with opacity and a transform only: nothing is laid out again.
 */
export const CategoryHeaderRow: React.FC<{ menuOpen?: boolean }> = ({ menuOpen = false }) => {
    const { t, siteT, config, tagName, locale } = useCommerceSite();
    const bar = config.categoryBar;
    const preset = usePresetClass();
    const themeVars = useCommerceThemeVars();
    const pathname = useLocation({ select: (l) => l.pathname });
    const segments = useMemo(() => siteSegments(pathname, RouteMatcher.basePath(tagName), tagName), [pathname, tagName]);
    const route = parseCommerceRoute(segments);
    const pageKey = commercePageKey(segments);
    const tree = useCategoryTree();
    // On a product page the product is already in the cache (the page asked for it): its category.
    const product = useProduct(route?.kind === 'product' ? route.slug : '');
    const productCategory = (product.data?.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY')?.slug || null;
    const menu = useMemo(() => menuCategories(tree.data?.data, config.minInStock), [tree.data, config.minInStock]);
    const chips = useMemo(
        () => (bar ? barChips(bar, menu, { all: t('nav.all'), translate: (text) => siteT(text) }, tree.data?.data) : []),
        [bar, menu, t, siteT, tree.data]
    );
    const active = activeBarChip(
        chips,
        { key: pageKey, slug: route?.kind === 'collection' ? route.slug : null, productCategory },
        tree.data?.data
    );
    const chipsSignature = chips.map((chip) => `${chip.key}\u0000${chip.label}`).join('\u0001');
    const rowRef = useRef<HTMLUListElement>(null);
    const tilesRef = useRef<HTMLUListElement>(null);
    const navRef = useRef<HTMLElement>(null);
    const [fade, setFade] = useState({ start: false, end: false, over: false });
    // Style "image": the photo row on the pages the site picked (all of the bar's pages by default).
    const photos = categoryBarPhotosOn(config, pageKey);
    // The photo row is open at the first paint at the top of the page (the hook keeps it after).
    const [openAtFirstPaint] = useState(() => photos && (typeof window === 'undefined' || window.scrollY < PHOTO_ROW_COLLAPSE_Y));
    useHeaderFold(navRef, !!bar?.collapseHeaderOnScroll, menuOpen, photos);

    const loading = tree.isLoading && bar?.items === 'auto';
    // Centre the active chip (and its photo) in its row (the row scrolls, never the page).
    useLayoutEffect(() => {
        for (const row of [rowRef.current, tilesRef.current]) {
            if (!row) continue;
            const chip = active ? Array.from(row.querySelectorAll<HTMLElement>('[data-chip]')).find((el) => el.dataset.chip === active.key) : null;
            if (chip) row.scrollLeft = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2);
            else row.scrollLeft = 0;
        }
        // Centred once per page and when the chips arrive, not on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.key, loading]);
    useEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        const update = () => {
            const max = row.scrollWidth - row.clientWidth;
            const start = Math.abs(row.scrollLeft) > 2;
            const end = max - Math.abs(row.scrollLeft) > 2;
            const over = max > 2;
            setFade((prev) => (prev.start === start && prev.end === end && prev.over === over ? prev : { start, end, over }));
        };
        update();
        row.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        // A web font arriving widens the chips without a resize.
        // The over state never changes a chip's width (a hidden caret keeps its room), so this
        // cannot feed itself.
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
        if (observer) Array.from(row.children).forEach((chip) => observer.observe(chip));
        return () => {
            row.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            observer?.disconnect();
        };
        // Re-attached whenever the chips change (new labels after a language switch are new chips).
    }, [chipsSignature, loading]);

    if (!bar) return null;
    const pills = bar.style !== 'tabs';
    return (
        <nav
            ref={navRef}
            className={cn(
                'cmx cmx-hbar',
                pills ? 'cmx-hbar--chips' : 'cmx-hbar--tabs',
                photos && 'cmx-hbar--image',
                preset,
                fade.start && 'cmx-hbar--fade-start',
                fade.end && 'cmx-hbar--fade-end',
                // More chips than a desktop row holds: it scrolls, without the hover menus it would clip.
                fade.over && 'cmx-hbar--over'
            )}
            aria-label={t('nav.categories')}
            lang={locale}
            style={themeVars}
            data-cmx-expanded={openAtFirstPaint ? '' : undefined}
        >
            <div className="cmx-shell">
                <ul ref={rowRef} className="cmx-hbar__row">
                    {loading
                        ? Array.from({ length: 5 }, (_, i) => (
                              <li key={i} className="cmx-catbar__item" aria-hidden="true">
                                  <span className={pills ? 'cmx-hbar__chip' : 'cmx-catbar__link'}>
                                      <span className="cmx-skel cmx-hbar__skel" />
                                  </span>
                              </li>
                          ))
                        : chips.map((chip) => (
                              <HeaderChip key={chip.key} chip={chip} chips={pills} current={active?.key === chip.key ? active.current : undefined} />
                          ))}
                </ul>
            </div>
            {photos && (
                <div className="cmx-hbar__panel">
                    <div className="cmx-shell">
                        <ul ref={tilesRef} className="cmx-hbar__tiles">
                            {loading
                                ? Array.from({ length: 5 }, (_, i) => (
                                      <li key={i} aria-hidden="true">
                                          <span className="cmx-hbar__tile">
                                              <span className="cmx-skel cmx-hbar__thumb" />
                                              <span className="cmx-skel cmx-hbar__skel cmx-hbar__skel--label" />
                                          </span>
                                      </li>
                                  ))
                                : chips.map((chip, i) => (
                                      <PhotoTile key={chip.key} chip={chip} index={i} current={active?.key === chip.key ? active.current : undefined} />
                                  ))}
                        </ul>
                    </div>
                </div>
            )}
        </nav>
    );
};

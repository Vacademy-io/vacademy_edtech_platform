/**
 * commerceNewsCarousel: news and events as cards (photo, date, title, a three-line excerpt and
 * "Read more"), `perView` cards at a time (1 on a phone, 2 on a tablet, 3 on a desktop by
 * default). Swipe, arrows and dots move it; it moves by itself only when the page turns
 * `autoplay` on, and then stops while the pointer or focus is in it, after any tap or click in
 * it, while the tab is hidden, after its pause button, and always under reduced motion.
 *
 * Each card links to a page of the site, usually the news page at the story's anchor
 * ("news#<id>"), where the full story is an ordinary authored section; or to an outside page.
 * With `source: "blog"` the cards are the platform blog's newest posts (Manage Pages → Blog),
 * each opening on the site's blog page, where the catalogue's `blog` section draws it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Pause, Play } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { BlogService } from '../../../-services/blog-service';
import { str, type Props } from '../logic/content';
import { formatNewsDate, readNews, type NewsItem, type NewsRatio, type NewsSettings } from '../logic/news';
import { ActionLink, Img, Intro } from './ContentSections';
import { usePageHidden, useReducedMotion } from './hooks';
import { useCommerceSite } from './site';
import { useText } from './text';

/** The photo's intrinsic size for each card shape (the box is set by CSS; these stop a shift). */
const SIZE: Record<NewsRatio, [number, number]> = { '4:3': [800, 600], '3:2': [900, 600], '16:9': [960, 540], '1:1': [800, 800], '4:5': [800, 1000] };

/** Geometry of the row as laid out: card step (width + gap), cards in view, start positions. */
const geometry = (track: HTMLElement | null, count: number) => {
    const first = track?.firstElementChild as HTMLElement | null;
    const gap = track ? parseFloat(window.getComputedStyle(track).columnGap) || 0 : 0;
    const step = first ? first.offsetWidth + gap : 0;
    if (!track || step <= 0) return { step: 0, inView: count, positions: 1, at: 0 };
    const inView = Math.max(1, Math.min(count, Math.round((track.clientWidth + gap) / step)));
    const positions = Math.max(1, count - inView + 1);
    const at = Math.max(0, Math.min(positions - 1, Math.round(Math.abs(track.scrollLeft) / step)));
    return { step, inView, positions, at };
};

const NewsRow: React.FC<{ props: Props; settings: NewsSettings; items: NewsItem[]; loading?: boolean }> = ({ props, settings, items, loading }) => {
    const { t, locale } = useCommerceSite();
    const tx = useText();
    const reduced = useReducedMotion();
    const hidden = usePageHidden();
    const track = useRef<HTMLUListElement>(null);
    const [view, setView] = useState({ positions: 1, at: 0, inView: items.length });
    const [hover, setHover] = useState(false);
    const [focus, setFocus] = useState(false);
    // Any tap, swipe or click in the row hands it to the visitor: it no longer moves by itself.
    const [handled, setHandled] = useState(false);
    const [stopped, setStopped] = useState(false);

    const measure = useCallback(() => {
        const g = geometry(track.current, items.length);
        setView((prev) => (prev.positions === g.positions && prev.at === g.at && prev.inView === g.inView ? prev : { positions: g.positions, at: g.at, inView: g.inView }));
    }, [items.length]);

    useEffect(() => {
        const el = track.current;
        if (!el) return;
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        observer?.observe(el);
        window.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [measure, loading]);

    const go = useCallback(
        (to: number) => {
            const el = track.current;
            const g = geometry(el, items.length);
            if (!el || g.step <= 0) return;
            // Round the ring: after the last position comes the first, and the other way.
            const target = to < 0 ? g.positions - 1 : to >= g.positions ? 0 : to;
            const left = target * g.step;
            if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
            else el.scrollLeft = left;
            setView((prev) => ({ ...prev, at: target }));
        },
        [items.length, reduced]
    );

    const auto = settings.autoplay && !reduced && items.length > view.inView && view.positions > 1;
    const paused = !auto || stopped || handled || hidden || focus || (settings.pauseOnHover && hover);
    useEffect(() => {
        if (paused) return;
        const timer = window.setTimeout(() => go(view.at + 1), settings.intervalMs);
        return () => window.clearTimeout(timer);
    }, [paused, view.at, settings.intervalMs, go]);

    const [w, h] = SIZE[settings.imageRatio];
    const ratioKey = settings.imageRatio.replace(':', '-');
    const label = tx(props.title, 200) || t('news.label');
    const readMore = tx(props.readMoreLabel, 40) || t('news.readMore');
    const { phone, tablet, desktop } = settings.perView;
    const userMoves = (to: number) => {
        setHandled(true);
        go(to);
    };

    return (
        <div
            className="cmx-newsx"
            role="region"
            aria-roledescription={t('news.carousel')}
            aria-label={label}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
            onFocus={() => setFocus(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
            }}
        >
            <div className="cmx-news__head">
                <Intro props={props} />
                {view.positions > 1 && (
                    <div className="cmx-news__nav">
                        {/* Only while it can still move by itself: after the visitor moves it, it stays put. */}
                        {auto && !handled && (
                            <button type="button" className="cmx-icon-btn cmx-news__btn" onClick={() => setStopped((s) => !s)} aria-label={stopped ? t('news.play') : t('news.pause')}>
                                {stopped ? <Play size={18} weight="fill" aria-hidden="true" /> : <Pause size={18} weight="fill" aria-hidden="true" />}
                            </button>
                        )}
                        <button type="button" className="cmx-icon-btn cmx-news__btn" onClick={() => userMoves(view.at - 1)} aria-label={t('news.prev')}>
                            <CaretLeft size={20} aria-hidden="true" />
                        </button>
                        <button type="button" className="cmx-icon-btn cmx-news__btn" onClick={() => userMoves(view.at + 1)} aria-label={t('news.next')}>
                            <CaretRight size={20} aria-hidden="true" />
                        </button>
                    </div>
                )}
            </div>
            <ul
                ref={track}
                className={cn('cmx-news', `cmx-news--p${phone}`, `cmx-news--t${tablet}`, `cmx-news--d${desktop}`, `cmx-news--r-${ratioKey}`)}
                aria-hidden={loading || undefined}
                onScroll={measure}
                onTouchStart={() => setHandled(true)}
                onPointerDown={() => setHandled(true)}
            >
                {loading
                    ? Array.from({ length: Math.max(phone, tablet, desktop) }, (_, i) => (
                          <li key={i} className="cmx-news__item">
                              <div className="cmx-panel cmx-panel--media">
                                  <div className="cmx-img cmx-news__img cmx-skel" />
                                  <div className="cmx-panel__body">
                                      <div className="cmx-skel h-4 w-1/3" />
                                      <div className="cmx-skel h-5 w-11/12" />
                                      <div className="cmx-skel h-4 w-full" />
                                  </div>
                              </div>
                          </li>
                      ))
                    : items.map((item) => {
                          const date = settings.showDate ? formatNewsDate(item.date, locale) : '';
                          const title = tx(item.title, 200);
                          return (
                              <li key={item.id} className="cmx-news__item">
                                  <article className="cmx-panel cmx-panel--media cmx-news__card">
                                      <div
                                          className={cn('cmx-img cmx-news__img', item.imageFit === 'contain' && 'cmx-news__img--contain')}
                                          // The photo's focal point is the item's own value (checked: percentages and keywords only).
                                          style={item.imagePosition ? { ['--cmx-news-pos' as string]: item.imagePosition } : undefined} // design-lint-ignore
                                      >
                                          {item.image && <Img src={item.image} alt={tx(item.imageAlt, 200)} width={w} height={h} />}
                                      </div>
                                      <div className="cmx-panel__body">
                                          {date && (
                                              <time dateTime={item.date || undefined} className="cmx-meta">
                                                  {date}
                                              </time>
                                          )}
                                          <h3 className="cmx-h3 cmx-clamp cmx-clamp--2">{title}</h3>
                                          {item.excerpt && <p className="cmx-p cmx-small cmx-clamp m-0">{tx(item.excerpt, 300)}</p>}
                                          {/* One link per card; its box covers the card, so the whole card is the tap target. */}
                                          <ActionLink to={item.route} className="cmx-link cmx-tap cmx-news__more mt-auto inline-flex items-center self-start font-semibold">
                                              {readMore}
                                              <span className="cmx-sr">: {title}</span>
                                          </ActionLink>
                                      </div>
                                  </article>
                              </li>
                          );
                      })}
            </ul>
            {view.positions > 1 && (
                <ul className="cmx-bx__dots cmx-news__dots">
                    {Array.from({ length: view.positions }, (_, i) => (
                        <li key={i}>
                            <button
                                type="button"
                                className="cmx-bx__dot"
                                aria-label={t('news.goTo', { n: i + 1, count: view.positions })}
                                aria-current={i === view.at || undefined}
                                onClick={() => userMoves(i)}
                            >
                                <span aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

/** The platform blog's newest posts as items; each opens on the site's blog page (`blogPage`, "blog" by default). */
const BlogNews: React.FC<{ props: Props; settings: NewsSettings }> = ({ props, settings }) => {
    const { instituteId } = useCommerceSite();
    const category = str(props.blogCategory, 80);
    const blogPage = str(props.blogPage, 120).replace(/^\/+|\/+$/g, '') || 'blog';
    const limit = Math.max(1, Math.min(12, Math.round(Number(props.limit)) || 6));
    const query = useQuery({
        queryKey: ['commerce', instituteId, 'news-blog', category, limit],
        queryFn: () => BlogService.listPosts(instituteId, { size: limit, category: category || undefined }),
        staleTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
    });
    const items = useMemo(
        () =>
            (query.data?.content || []).slice(0, limit).map(
                (post): NewsItem => ({
                    id: post.id || post.slug,
                    title: post.title,
                    // The whole instant: its day is the reader's own (IST for this shop's visitors), not UTC's.
                    date: post.published_at || '',
                    excerpt: (post.excerpt || '').slice(0, 300),
                    image: post.cover_image_url || '',
                    imageAlt: '',
                    imageFit: 'cover',
                    imagePosition: '',
                    route: blogPage === 'home' || blogPage === 'homepage' ? `?post=${encodeURIComponent(post.slug)}` : `${blogPage}/${encodeURIComponent(post.slug)}`,
                })
            ),
        [query.data, limit, blogPage]
    );
    if (query.isError || (!query.isPending && items.length === 0)) return null;
    return <NewsRow props={props} settings={settings} items={items} loading={query.isPending} />;
};

/**
 * commerceNewsCarousel: { eyebrow, title, text, cta, readMoreLabel, autoplay, intervalMs,
 * pauseOnHover, perView { phone, tablet, desktop }, imageRatio, showDate, items [{ id, date,
 * title, excerpt, image, imageAlt, imageFit, imagePosition, route, startDate, endDate }],
 * source: "blog", blogCategory, blogPage, limit }.
 */
export const NewsCarousel: React.FC<{ props: Props }> = ({ props }) => {
    const settings = useMemo(() => readNews(props), [props]);
    if (str(props.source) === 'blog') return <BlogNews props={props} settings={settings} />;
    if (settings.items.length === 0) return null;
    return <NewsRow props={props} settings={settings} items={settings.items} />;
};

/**
 * commerceBannerCarousel: rotating banners for the top of a shop page. A slide is a picture
 * (separate files for a phone and for English visitors when the words are in the picture), with
 * optional live words, a button, or a link on the whole picture.
 *
 * Motion: it moves on by itself every `intervalMs` (`intervalMsPhone` below 640px), by a slide
 * or a fade, and stops while the pointer is over it, while anything in it has focus, while a
 * finger is on it, while the tab is hidden, after its pause button, and always for a visitor who
 * asked for reduced motion. Swipe, dots, arrows and the arrow keys move it by hand.
 *
 * Layout: the box keeps one aspect ratio per breakpoint (`ratioPhone` below 640px, never taller
 * than 4:5; `ratio` above), so nothing under it moves; slides move by transform or opacity,
 * never by layout. Only the first picture loads at once (fetchpriority high); each other one
 * when it is next.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Pause, Play } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { str, type Props } from '../logic/content';
import { ratioCss, readBanner, slidePictures, stepIndex, type BannerSlide } from '../logic/banner';
import { ActionLink } from './ContentSections';
import { useMediaQuery, usePageHidden, useReducedMotion } from './hooks';
import { useCommerceSite } from './site';
import { useText } from './text';

/** A horizontal swipe longer than this (px) changes the slide. */
const SWIPE_PX = 40;
const PHONE = '(max-width: 639.98px)';

const SlidePicture: React.FC<{ slide: BannerSlide; locale: string; alt: string; eager: boolean }> = ({ slide, locale, alt, eager }) => {
    const { desktop, phone } = slidePictures(slide, locale);
    const img = (
        <img
            src={desktop}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding={eager ? 'sync' : 'async'}
            width={1600}
            height={850}
            {...(eager ? ({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>) : {})}
        />
    );
    if (!phone) return img;
    return (
        <picture>
            <source media={PHONE} srcSet={phone} />
            {img}
        </picture>
    );
};

export const BannerCarousel: React.FC<{ props: Props }> = ({ props }) => {
    const { t, locale } = useCommerceSite();
    const tx = useText();
    const banner = useMemo(() => readBanner(props), [props]);
    const { slides, transition } = banner;
    const count = slides.length;
    const reduced = useReducedMotion();
    const hidden = usePageHidden();
    const phone = useMediaQuery(PHONE);
    const [index, setIndex] = useState(0);
    const [stopped, setStopped] = useState(false);
    const [hover, setHover] = useState(false);
    const [focus, setFocus] = useState(false);
    const [touch, setTouch] = useState(false);
    // Pictures asked for so far: the first at once, then each slide as it becomes the next one.
    const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set([0]));
    const startX = useRef<number | null>(null);
    const startY = useRef(0);

    const intervalMs = phone ? banner.intervalMsPhone : banner.intervalMs;
    const auto = banner.autoplay && count > 1 && !reduced;
    const paused = !auto || stopped || (banner.pauseOnHover && hover) || focus || touch || hidden;

    useEffect(() => {
        if (paused) return;
        const timer = window.setTimeout(() => setIndex((i) => stepIndex(i, 1, count)), intervalMs);
        return () => window.clearTimeout(timer);
    }, [paused, index, intervalMs, count]);

    // The current slide and the one after it have their pictures; after the first paint, so the
    // first picture is the only request at load.
    useEffect(() => {
        if (count < 2) return;
        const next = stepIndex(index, 1, count);
        setLoaded((prev) => (prev.has(index) && prev.has(next) ? prev : new Set([...prev, index, next])));
    }, [index, count]);

    // Fewer slides after a date ends: stay inside the ring.
    useEffect(() => {
        if (index >= count && count > 0) setIndex(0);
    }, [index, count]);

    if (count === 0) return null;
    const label = tx(props.title, 120) || t('banner.label');
    const go = (to: number) => setIndex(stepIndex(to, 0, count));
    const fade = transition === 'fade';

    return (
        <div
            className={cn('cmx-bx', fade ? 'cmx-bx--fade' : 'cmx-bx--slide')}
            // The box's shapes and the transition time are this section's own props.
            style={{ ['--cmx-bx-m' as string]: ratioCss(banner.ratioPhone), ['--cmx-bx-d' as string]: ratioCss(banner.ratio), ['--cmx-bx-ms' as string]: `${banner.transitionMs}ms` }} // design-lint-ignore
            role="region"
            aria-roledescription={t('banner.carousel')}
            aria-label={label}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
            onFocus={() => setFocus(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
            }}
            onTouchStart={(e) => {
                const point = e.touches[0];
                startX.current = point ? point.clientX : null;
                startY.current = point ? point.clientY : 0;
                setTouch(true);
            }}
            onTouchEnd={(e) => {
                const point = e.changedTouches[0];
                const dx = point && startX.current !== null ? point.clientX - startX.current : 0;
                const dy = point ? point.clientY - startY.current : 0;
                startX.current = null;
                // Mostly sideways and long enough: a swipe. A vertical one is the page scrolling.
                if (count > 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) setIndex((i) => stepIndex(i, dx < 0 ? 1 : -1, count));
                setTouch(false);
            }}
            onTouchCancel={() => {
                startX.current = null;
                setTouch(false);
            }}
            onKeyDown={(e) => {
                // From the dots and arrows only: a key pressed on a slide's own link would hide
                // that slide (inert) and drop the visitor's focus to the page.
                if (count < 2 || (e.target as Element | null)?.closest?.('.cmx-bx__slide')) return;
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setIndex((i) => stepIndex(i, e.key === 'ArrowRight' ? 1 : -1, count));
                }
            }}
        >
            <div className="cmx-bx__view">
                {/* Announced as it changes only when it is not moving by itself. */}
                <ul
                    className={cn('cmx-bx__track', reduced && 'cmx-bx__track--still')}
                    aria-live={paused ? 'polite' : 'off'}
                    // The offset of the current slide (slide mode): a transform, so nothing is laid out again.
                    style={fade ? undefined : { transform: `translate3d(${-index * 100}%, 0, 0)` }} // design-lint-ignore
                >
                    {slides.map((slide, i) => {
                        const current = i === index;
                        const alt = tx(slide.alt, 200);
                        const headline = tx(slide.headline, 120);
                        const text = tx(slide.text, 300);
                        const words = !!(headline || text || slide.cta);
                        // A picture that is not due yet has no address at all, so the browser cannot fetch it early.
                        const picture = i === 0 || loaded.has(i) ? <SlidePicture slide={slide} locale={locale} alt={alt} eager={i === 0} /> : null;
                        return (
                            <li
                                key={i}
                                className={cn('cmx-bx__slide', current && 'cmx-bx__slide--on')}
                                role="group"
                                aria-roledescription={t('banner.slide')}
                                aria-label={t('banner.slideOf', { n: i + 1, count })}
                                aria-hidden={!current || undefined}
                                {...({ inert: !current || undefined } as React.HTMLAttributes<HTMLLIElement>)}
                            >
                                {!slide.cta && slide.route ? (
                                    <ActionLink to={slide.route} className="cmx-bx__media" label={alt || headline || t('banner.openSlide', { n: i + 1, count })}>
                                        {picture}
                                    </ActionLink>
                                ) : (
                                    <div className="cmx-bx__media">{picture}</div>
                                )}
                                {words && (
                                    <div
                                        className={cn(
                                            'cmx-bx__copy',
                                            `cmx-bx__copy--${slide.textPosition}`,
                                            slide.textTone === 'dark' && 'cmx-bx__copy--dark',
                                            !slide.cta && slide.route && 'pointer-events-none'
                                        )}
                                    >
                                        {headline && <h2 className="cmx-bx__headline">{headline}</h2>}
                                        {text && <p className="cmx-bx__text">{text}</p>}
                                        {slide.cta && (
                                            <ActionLink to={slide.cta.route} className="cmx-btn cmx-btn--primary">
                                                {tx(slide.cta.label, 60)}
                                            </ActionLink>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
                {count > 1 && banner.showArrows && (
                    <>
                        <button type="button" className="cmx-bx__arrow cmx-bx__arrow--prev" onClick={() => go(index - 1)} aria-label={t('banner.prev')}>
                            <CaretLeft size={22} aria-hidden="true" />
                        </button>
                        <button type="button" className="cmx-bx__arrow cmx-bx__arrow--next" onClick={() => go(index + 1)} aria-label={t('banner.next')}>
                            <CaretRight size={22} aria-hidden="true" />
                        </button>
                    </>
                )}
            </div>
            {count > 1 && (banner.showDots || banner.autoplay) && (
                <div className="cmx-bx__bar">
                    {banner.showDots && (
                        <ul className="cmx-bx__dots">
                            {slides.map((_, i) => (
                                <li key={i}>
                                    <button
                                        type="button"
                                        className="cmx-bx__dot"
                                        aria-label={t('banner.goTo', { n: i + 1, count })}
                                        aria-current={i === index || undefined}
                                        onClick={() => go(i)}
                                    >
                                        <span aria-hidden="true" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {/* Moving content needs a way to stop it (WCAG 2.2.2). */}
                    {auto && (
                        <button
                            type="button"
                            className="cmx-icon-btn cmx-bx__toggle"
                            onClick={() => setStopped((s) => !s)}
                            aria-label={stopped ? t('banner.play') : t('banner.pause')}
                        >
                            {stopped ? <Play size={18} weight="fill" aria-hidden="true" /> : <Pause size={18} weight="fill" aria-hidden="true" />}
                        </button>
                    )}
                </div>
            )}
            {str(props.note) && <p className="cmx-meta mt-2">{tx(props.note, 200)}</p>}
        </div>
    );
};

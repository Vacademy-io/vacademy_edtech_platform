/**
 * commerceGallery: swipe with a counter on a phone, thumbnails on a
 * desktop, a zoom view with pinch, pan and double-tap handled here (the app's viewport turns
 * the browser's own pinch zoom off), a chip per tagged image, video as a poster until tapped.
 * Boxes are reserved in the shop's ratio and only image 1 loads eagerly.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus, Play } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Media } from '../api/types';
import { IMAGE_SIZES, imageSource, largestSource, mediaChip } from '../logic/media';
import { ZOOM_RESET, clampZoom, distance, midpoint, panBy, toggleZoom, zoomAround, type ZoomState } from '../logic/zoom';
import { Layer, ProductImage } from './primitives';
import { useCommerceSite } from './site';

const isVideo = (media: Media) => (media.kind || '').toUpperCase() === 'VIDEO';

/** The still a video shows before it plays: its own poster, else the product's first photo. */
const posterOf = (media: Media, fallback: Media | undefined): string => media.poster_url || imageSource(fallback)?.src || '';

const VideoSlide: React.FC<{ media: Media; label: string; fallback: Media | undefined }> = ({ media, label, fallback }) => {
    const [playing, setPlaying] = useState(false);
    const poster = posterOf(media, fallback);
    if (playing) {
        return (
            <div className="cmx-img">
                {/* Started by the shopper's tap; never autoplays on its own. */}
                <video src={media.url || undefined} poster={poster || undefined} controls autoPlay playsInline className="absolute inset-0 size-full object-contain" />
            </div>
        );
    }
    return (
        <button type="button" className="cmx-gallery__slide" onClick={() => setPlaying(true)} aria-label={label}>
            <div className="cmx-img">
                {poster && <img src={poster} alt="" loading="lazy" decoding="async" />}
                <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white">
                        <Play size={22} weight="fill" aria-hidden="true" />
                    </span>
                </span>
            </div>
        </button>
    );
};

/**
 * One picture in the zoom view. Two fingers pinch (1x to 4x) around the point between them,
 * one finger pans a zoomed picture, a double tap or a click zooms in on the tapped point and
 * back out, and a trackpad pinch (ctrl + wheel) zooms on a desktop. The transform is written
 * straight to the element, so a gesture does not re-render the gallery.
 */
const ZoomView: React.FC<{ src: string; alt: string; toggleSignal: number; onZoomed(zoomed: boolean): void }> = ({
    src,
    alt,
    toggleSignal,
    onZoomed,
}) => {
    const boxRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const zoom = useRef<ZoomState>(ZOOM_RESET);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const pinch = useRef<{ distance: number; scale: number } | null>(null);
    const gesture = useRef({ moved: false, lastTap: 0, lastTapX: 0, lastTapY: 0 });

    const boxOf = () => {
        const rect = boxRef.current?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : { width: 1, height: 1, left: 0, top: 0 };
    };
    /** A viewport point measured from the centre of the box. */
    const focalOf = (point: { x: number; y: number }) => {
        const box = boxOf();
        return { x: point.x - box.left - box.width / 2, y: point.y - box.top - box.height / 2 };
    };
    const apply = useCallback(
        (next: ZoomState, animate = false) => {
            const was = zoom.current.scale > 1.01;
            zoom.current = next;
            const img = imgRef.current;
            if (img) {
                img.classList.toggle('cmx-zoom__img--settle', animate);
                img.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
            }
            const now = next.scale > 1.01;
            boxRef.current?.classList.toggle('cmx-zoom--in', now);
            if (was !== now) onZoomed(now);
        },
        [onZoomed]
    );

    // The header's zoom button.
    const firstSignal = useRef(toggleSignal);
    useEffect(() => {
        if (toggleSignal === firstSignal.current) return;
        firstSignal.current = toggleSignal;
        apply(toggleZoom(zoom.current, { x: 0, y: 0 }, boxOf()), true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toggleSignal]);

    // ctrl + wheel is how a trackpad reports a pinch; it must not zoom the page instead.
    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && zoom.current.scale <= 1.01) return;
            event.preventDefault();
            if (event.ctrlKey) {
                apply(zoomAround(zoom.current, zoom.current.scale * Math.exp(-event.deltaY / 120), focalOf({ x: event.clientX, y: event.clientY }), boxOf()));
            } else {
                apply(panBy(zoom.current, -event.deltaX, -event.deltaY, boxOf()));
            }
        };
        box.addEventListener('wheel', onWheel, { passive: false });
        return () => box.removeEventListener('wheel', onWheel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apply]);

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        gesture.current.moved = false;
        if (pointers.current.size === 2) {
            const [a, b] = Array.from(pointers.current.values()) as [{ x: number; y: number }, { x: number; y: number }];
            pinch.current = { distance: Math.max(1, distance(a, b)), scale: zoom.current.scale };
        }
    };
    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const before = pointers.current.get(event.pointerId);
        if (!before) return;
        const point = { x: event.clientX, y: event.clientY };
        pointers.current.set(event.pointerId, point);
        if (Math.abs(point.x - before.x) + Math.abs(point.y - before.y) > 0) gesture.current.moved = gesture.current.moved || distance(point, before) > 2;
        if (pointers.current.size >= 2 && pinch.current) {
            const [a, b] = Array.from(pointers.current.values()) as [{ x: number; y: number }, { x: number; y: number }];
            gesture.current.moved = true;
            apply(zoomAround(zoom.current, (pinch.current.scale * distance(a, b)) / pinch.current.distance, focalOf(midpoint(a, b)), boxOf()));
        } else if (zoom.current.scale > 1.01) {
            apply(panBy(zoom.current, point.x - before.x, point.y - before.y, boxOf()));
        }
    };
    const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) {
            if (pinch.current) {
                pinch.current = null;
                // A pinch that ends close to 1x snaps back to the whole picture.
                apply(zoom.current.scale < 1.08 ? ZOOM_RESET : clampZoom(zoom.current, boxOf()), true);
                return;
            }
        }
        if (event.type !== 'pointerup' || gesture.current.moved || pointers.current.size > 0) return;
        const point = { x: event.clientX, y: event.clientY };
        const now = Date.now();
        const tap = gesture.current;
        const double = now - tap.lastTap < 320 && distance(point, { x: tap.lastTapX, y: tap.lastTapY }) < 32;
        // A mouse click toggles at once; a finger needs a double tap (one tap is too easy to do by accident).
        if (event.pointerType === 'mouse' || double) {
            tap.lastTap = 0;
            apply(toggleZoom(zoom.current, focalOf(point), boxOf()), true);
        } else {
            tap.lastTap = now;
            tap.lastTapX = point.x;
            tap.lastTapY = point.y;
        }
    };

    return (
        <div
            ref={boxRef}
            className="cmx-zoom"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
        >
            <img ref={imgRef} src={src} alt={alt} draggable={false} />
        </div>
    );
};

export const Gallery: React.FC<{ media: readonly Media[]; name: string; resetKey: string }> = ({ media, name, resetKey }) => {
    const { t, config, siteT } = useCommerceSite();
    const trackRef = useRef<HTMLDivElement>(null);
    const [index, setIndex] = useState(0);
    const [zoomAt, setZoomAt] = useState<number | null>(null);
    const [zoomed, setZoomed] = useState(false);
    const [zoomToggle, setZoomToggle] = useState(0);
    const total = media.length;

    const scrollTo = useCallback((next: number, smooth = true) => {
        const track = trackRef.current;
        if (!track) return;
        const clamped = Math.max(0, Math.min(total - 1, next));
        const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const left = clamped * track.clientWidth;
        if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: smooth && !reduce ? 'smooth' : 'auto' });
        else track.scrollLeft = left;
        setIndex(clamped);
    }, [total]);

    // A different variant (or product) starts again at its first picture.
    useEffect(() => {
        scrollTo(0, false);
    }, [resetKey, scrollTo]);

    const onScroll = () => {
        const track = trackRef.current;
        if (!track || !track.clientWidth) return;
        const next = Math.round(Math.abs(track.scrollLeft) / track.clientWidth);
        if (next !== index) setIndex(next);
    };
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            scrollTo(index + 1);
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            scrollTo(index - 1);
        }
    };
    const altOf = (item: Media, i: number) => item.alt || `${name} – ${t('gallery.image', { n: i + 1, total })}`;
    const zoomMedia = zoomAt !== null ? media[zoomAt] : undefined;
    const images = media.map((m, i) => ({ m, i })).filter(({ m }) => !isVideo(m));
    const stepZoom = (delta: number) => {
        if (zoomAt === null || images.length === 0) return;
        const at = images.findIndex(({ i }) => i === zoomAt);
        const next = images[(at + delta + images.length) % images.length];
        if (next) {
            setZoomAt(next.i);
            setZoomed(false);
        }
    };

    if (total === 0) return <div className="cmx-img" role="img" aria-label={name} />;

    return (
        <section className="cmx-gallery" aria-label={t('gallery.label')} aria-roledescription="carousel">
            <div className="cmx-gallery__stage">
                <div ref={trackRef} className="cmx-gallery__track" onScroll={onScroll} onKeyDown={onKeyDown}>
                    {media.map((item, i) => {
                        const chipLabel = mediaChip(item, config.media.leadTag, config.media.tagLabels);
                        const chip = chipLabel ? siteT(chipLabel) : null;
                        const label = t('gallery.image', { n: i + 1, total });
                        return (
                            <div key={`${item.url}-${i}`} className="cmx-gallery__slide" role="group" aria-roledescription="slide" aria-label={label}>
                                {isVideo(item) ? (
                                    <VideoSlide media={item} label={t('gallery.video')} fallback={images[0]?.m} />
                                ) : (
                                    <button
                                        type="button"
                                        className="cmx-gallery__slide w-full"
                                        onClick={() => {
                                            setZoomAt(i);
                                            setZoomed(false);
                                        }}
                                        aria-label={`${t('gallery.zoom')}: ${label}`}
                                    >
                                        <ProductImage media={item} alt={altOf(item, i)} sizes={IMAGE_SIZES.gallery} eager={i === 0}>
                                            {chip && <span className="cmx-media-chip">{chip}</span>}
                                        </ProductImage>
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
                {total > 1 && (
                    <>
                        <span className="cmx-gallery__counter" aria-hidden="true">
                            {t('gallery.counter', { n: index + 1, total })}
                        </span>
                        <button type="button" className="cmx-icon-btn cmx-gallery__nav cmx-gallery__nav--prev" onClick={() => scrollTo(index - 1)} disabled={index === 0} aria-label={t('gallery.prev')}>
                            <CaretLeft size={18} aria-hidden="true" />
                        </button>
                        <button type="button" className="cmx-icon-btn cmx-gallery__nav cmx-gallery__nav--next" onClick={() => scrollTo(index + 1)} disabled={index === total - 1} aria-label={t('gallery.next')}>
                            <CaretRight size={18} aria-hidden="true" />
                        </button>
                    </>
                )}
            </div>
            {total > 1 && (
                <ul className="cmx-gallery__thumbs">
                    {media.map((item, i) => {
                        const source = imageSource(item);
                        return (
                            <li key={`${item.url}-${i}`}>
                                <button type="button" className="cmx-gallery__thumb" onClick={() => scrollTo(i)} aria-current={i === index} aria-label={t('gallery.thumb', { n: i + 1 })}>
                                    <span className="cmx-img">
                                        {isVideo(item) ? (
                                            <>
                                                {posterOf(item, images[0]?.m) && <img src={posterOf(item, images[0]?.m)} alt="" loading="lazy" decoding="async" />}
                                                <span className="absolute inset-0 flex items-center justify-center">
                                                    <span className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white">
                                                        <Play size={14} weight="fill" aria-hidden="true" />
                                                    </span>
                                                </span>
                                            </>
                                        ) : (
                                            source && <img src={source.src} srcSet={source.srcSet} sizes={IMAGE_SIZES.thumb} alt="" loading="lazy" decoding="async" />
                                        )}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <Layer
                open={!!zoomMedia}
                onClose={() => setZoomAt(null)}
                side="full"
                dark
                title={zoomMedia && zoomAt !== null ? altOf(zoomMedia, zoomAt) : t('gallery.zoom')}
                header={
                    <span className="flex flex-1 items-center gap-1">
                        {images.length > 1 && (
                            <>
                                <button type="button" className="cmx-icon-btn" onClick={() => stepZoom(-1)} aria-label={t('gallery.prev')}>
                                    <CaretLeft size={20} aria-hidden="true" />
                                </button>
                                <button type="button" className="cmx-icon-btn" onClick={() => stepZoom(1)} aria-label={t('gallery.next')}>
                                    <CaretRight size={20} aria-hidden="true" />
                                </button>
                            </>
                        )}
                        <button type="button" className="cmx-icon-btn" onClick={() => setZoomToggle((n) => n + 1)} aria-label={zoomed ? t('gallery.zoomOut') : t('gallery.zoomIn')} aria-pressed={zoomed}>
                            {zoomed ? <MagnifyingGlassMinus size={20} aria-hidden="true" /> : <MagnifyingGlassPlus size={20} aria-hidden="true" />}
                        </button>
                    </span>
                }
            >
                {zoomMedia && zoomAt !== null && (
                    <>
                        {/* A new picture starts again at 1x (the key remounts the view). */}
                        <ZoomView
                            key={zoomAt}
                            src={largestSource(zoomMedia)}
                            alt={altOf(zoomMedia, zoomAt)}
                            toggleSignal={zoomToggle}
                            onZoomed={setZoomed}
                        />
                        <p className={cn('cmx-zoom__hint', zoomed && 'cmx-zoom__hint--off')}>{t('gallery.zoomHint')}</p>
                    </>
                )}
            </Layer>
        </section>
    );
};

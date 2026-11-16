/**
 * Content blocks for a shop's authored pages: the story, people, places, trust and contact
 * parts of a storefront site, each configured entirely by its props (see logic/content.ts for
 * how props are read). Nothing here knows about any one seller: the words, photos, numbers and
 * links all come from the page JSON, in the site's base language, translated by the site
 * dictionary like every other section.
 */
import React, { useEffect, useRef, useState } from 'react';
import { CaretDown, EnvelopeSimple, MagnifyingGlass, MapPin, Phone, Play, Storefront, WhatsappLogo } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { isSpamSubmission, submitWebsiteLead } from '../../../-utils/website-lead';
import { submitPhoneOnlyLead } from '../api/lead';
import { findCategory } from '../edge/commerce-edge';
import { withinDates } from '../logic/dates';
import { sendCommerceEvent } from '../logic/events';
import {
    anchorId,
    cta as readCta,
    groupBy,
    leadFields,
    linkKind,
    mapsHref,
    normalizeMobile,
    records,
    siteRoute,
    str,
    strings,
    telHref,
    validateLead,
    type Cta,
    type LeadErrors,
    type LeadField,
    type Props,
} from '../logic/content';
import type { MessageKey } from '../i18n';
import { ShopHead } from './Head';
import { useCategoryTree } from './queries';
import { ShopLink, useCommerceSite, useShopNavigate, whatsappLink } from './site';

type Section = React.FC<{ props: Props }>;

/** Authored text in the visitor's language. */
const useText = () => {
    const { siteT } = useCommerceSite();
    return (value: unknown, max?: number) => siteT(str(value, max));
};

const contact = (method: 'whatsapp' | 'call' | 'email' | 'directions', placement: string) => () =>
    sendCommerceEvent({ name: 'contact', method, placement });

/** A link from page data: a page of this site, an anchor, or an outside address (new tab). */
export const ActionLink: React.FC<{ to: string; className?: string; children: React.ReactNode; onClick?: () => void }> = ({
    to,
    className,
    children,
    onClick,
}) => {
    const kind = linkKind(to);
    if (kind === 'invalid') return null;
    if (kind === 'site') {
        return (
            <ShopLink to={siteRoute(to)} className={className} onClick={onClick}>
                {children}
            </ShopLink>
        );
    }
    const web = /^https?:/i.test(to);
    return (
        <a href={to} className={className} onClick={onClick} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {children}
        </a>
    );
};

const CtaButton: React.FC<{ value: Cta | null; primary?: boolean; className?: string }> = ({ value, primary, className }) => {
    const tx = useText();
    if (!value) return null;
    return (
        <ActionLink to={value.route} className={cn('cmx-btn cmx-btn--lg', primary ? 'cmx-btn--primary' : 'cmx-btn--outline', className)}>
            {tx(value.label, 80)}
        </ActionLink>
    );
};

/** Eyebrow, heading, intro and a "see all" link, as every block opens. */
const Intro: React.FC<{ props: Props; level?: 1 | 2; center?: boolean; link?: boolean }> = ({ props, level = 2, center, link = true }) => {
    const tx = useText();
    const eyebrow = tx(props.eyebrow, 80);
    const title = tx(props.title, 200);
    const text = tx(props.text, 1200);
    const more = link ? readCta(props.cta) : null;
    if (!eyebrow && !title && !text && !more) return null;
    const Heading = level === 1 ? 'h1' : 'h2';
    return (
        <div className={cn('cmx-intro', center && 'cmx-intro--center')}>
            {eyebrow && <span className="cmx-eyebrow">{eyebrow}</span>}
            {title && <Heading className={level === 1 ? 'cmx-h1' : 'cmx-h2'}>{title}</Heading>}
            {text && <p className="cmx-lead whitespace-pre-line">{text}</p>}
            {more && (
                <ActionLink to={more.route} className="cmx-link cmx-tap inline-flex items-center self-start font-semibold">
                    {tx(more.label, 80)}
                </ActionLink>
            )}
        </div>
    );
};

const Img: React.FC<{ src: string; alt?: string; className?: string; eager?: boolean; width?: number; height?: number }> = ({
    src,
    alt = '',
    className,
    eager,
    width = 800,
    height = 1000,
}) =>
    /^https?:\/\//i.test(src) || (src.startsWith('/') && !src.startsWith('//')) ? (
        <img
            src={src}
            alt={alt}
            className={className}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            width={width}
            height={height}
            {...(eager ? ({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>) : {})}
        />
    ) : null;

/* ── announcement bar ─────────────────────────────────────────────── */

/** commerceAnnouncementBar: { text, route, startDate, endDate }. A slim strip; no section padding. */
export const AnnouncementBar: React.FC<{ props: Props }> = ({ props }) => {
    const tx = useText();
    const text = tx(props.text, 200);
    if (!text || !withinDates(Date.now(), str(props.startDate), str(props.endDate))) return null;
    const route = str(props.route, 300);
    // One line of fixed height (ellipsis on a phone): a late web font cannot re-wrap it and push
    // the page down. With a link, the whole strip is the tap target.
    const line = <span className="cmx-announce__text">{text}</span>;
    return (
        <div className="cmx-announce">
            {route && linkKind(route) !== 'invalid' ? (
                <ActionLink to={route} className="cmx-announce__in cmx-announce__link">
                    {line}
                </ActionLink>
            ) : (
                <p className="cmx-announce__in m-0">{line}</p>
            )}
        </div>
    );
};

/* ── hero ─────────────────────────────────────────────────────────── */

/**
 * commerceHero: { eyebrow, title, text, image, imageAlt, caption, primary {label, route},
 * secondary {label, route}, stats [{ value, label }], compactOnPhone }. The page's one H1; the photo
 * loads first. compactOnPhone (default off): on a phone a wide 16:9 photo and no figures row, so the
 * first products follow on the first screen.
 */
const Hero: Section = ({ props }) => {
    const tx = useText();
    const title = tx(props.title, 200);
    if (!title) return null;
    const image = str(props.image, 600);
    const stats = records(props.stats, 4).filter((s) => str(s.value) && str(s.label));
    return (
        <div className={cn('cmx-hero', props.compactOnPhone === true && 'cmx-hero--compact')}>
            {image && (
                <div className="cmx-hero__media">
                    <Img src={image} alt={tx(props.imageAlt, 200)} eager width={1200} height={900} />
                    {str(props.caption) && <span className="cmx-hero__caption">{tx(props.caption, 120)}</span>}
                </div>
            )}
            <div className="cmx-hero__body">
                {str(props.eyebrow) && <span className="cmx-eyebrow">{tx(props.eyebrow, 80)}</span>}
                <h1 className="cmx-h1">{title}</h1>
                {str(props.text) && <p className="cmx-lead">{tx(props.text, 600)}</p>}
                <div className="cmx-actions">
                    <CtaButton value={readCta(props.primary)} primary />
                    <CtaButton value={readCta(props.secondary)} />
                </div>
                {stats.length > 0 && (
                    <ul className="cmx-stats">
                        {stats.map((stat, i) => (
                            <li key={i} className="cmx-stat">
                                <span className="cmx-stat__value">{tx(stat.value, 20)}</span>
                                <span className="cmx-stat__label">{tx(stat.label, 60)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

/* ── impact band ──────────────────────────────────────────────────── */

/**
 * commerceImpactBand: { eyebrow, title, text, items [{ value, label, text }], updatedNote, cta }.
 * Figures are plain text written by the seller, never counted up from zero; `updatedNote` says
 * when they were last checked ("Figures as of Nov 2026").
 */
const ImpactBand: Section = ({ props }) => {
    const tx = useText();
    const items = records(props.items, 6).filter((item) => str(item.value) && str(item.label));
    if (items.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            <ul className={cn('cmx-impact', items.length === 4 && 'cmx-impact--4', items.length === 2 && 'cmx-impact--2')}>
                {items.map((item, i) => (
                    <li key={i} className="cmx-impact__item cmx-stat">
                        <span className="cmx-stat__value">{tx(item.value, 20)}</span>
                        <span className="font-semibold">{tx(item.label, 80)}</span>
                        {str(item.text) && <span className="cmx-meta">{tx(item.text, 200)}</span>}
                    </li>
                ))}
            </ul>
            {str(props.updatedNote) && <p className="cmx-meta mt-3">{tx(props.updatedNote, 120)}</p>}
        </>
    );
};

/* ── story (maker) cards ──────────────────────────────────────────── */

/**
 * commerceStoryCards: { eyebrow, title, text, cta, items [{ image, imageAlt, name, place, craft,
 * quote, route, routeLabel, shopRoute, shopLabel }] }. The photo stays next to its name.
 */
const StoryCards: Section = ({ props }) => {
    const tx = useText();
    const items = records(props.items, 12).filter((item) => str(item.name));
    if (items.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            <ul className={cn('cmx-cards cmx-cards--rail', items.length >= 4 ? 'cmx-cards--4' : 'cmx-cards--3')}>
                {items.map((item, i) => {
                    const image = str(item.image, 600);
                    const story = str(item.route, 300);
                    const shop = str(item.shopRoute, 300);
                    return (
                        <li key={i}>
                            <article className="cmx-panel cmx-panel--media">
                                {image && (
                                    <div className="cmx-img cmx-panel__img">
                                        <Img src={image} alt={tx(item.imageAlt, 200) || tx(item.name, 80)} width={600} height={750} />
                                    </div>
                                )}
                                <div className="cmx-panel__body">
                                    <h3 className="cmx-h3">{tx(item.name, 80)}</h3>
                                    {(str(item.place) || str(item.craft)) && (
                                        <p className="cmx-meta m-0">{[tx(item.place, 80), tx(item.craft, 80)].filter(Boolean).join(' · ')}</p>
                                    )}
                                    {str(item.quote) && <p className="cmx-quote">“{tx(item.quote, 400)}”</p>}
                                    <div className="mt-auto flex flex-wrap gap-x-4">
                                        {story && str(item.routeLabel) && (
                                            <ActionLink to={story} className="cmx-link cmx-tap inline-flex items-center">
                                                {tx(item.routeLabel, 60)}
                                            </ActionLink>
                                        )}
                                        {shop && str(item.shopLabel) && (
                                            <ActionLink to={shop} className="cmx-link cmx-tap inline-flex items-center font-semibold">
                                                {tx(item.shopLabel, 60)}
                                            </ActionLink>
                                        )}
                                    </div>
                                </div>
                            </article>
                        </li>
                    );
                })}
            </ul>
        </>
    );
};

/* ── location cards ───────────────────────────────────────────────── */

/**
 * commerceLocationCards: { eyebrow, title, text, cta, layout: "chips" | "cards", items [{ name,
 * region, address, phone, whatsapp, mapUrl, shopRoute, note }] }. "chips" lists the names (with
 * `cta` to the full page); "cards" groups them by region, each with Call, WhatsApp, Directions
 * and Shop where the data exists.
 */
const LocationCards: Section = ({ props }) => {
    const { t, config } = useCommerceSite();
    const tx = useText();
    const items = records(props.items, 60).filter((item) => str(item.name));
    if (items.length === 0) return null;
    if (str(props.layout) === 'chips') {
        return (
            <>
                <Intro props={props} />
                <ul className="cmx-pills">
                    {items.map((item, i) => (
                        <li key={i} className="cmx-chip cursor-default">
                            <MapPin size={16} aria-hidden="true" />
                            {tx(item.name, 80)}
                        </li>
                    ))}
                </ul>
            </>
        );
    }
    const groups = groupBy(items, 'region');
    const card = (item: Record<string, unknown>, i: number) => {
        const name = tx(item.name, 80);
        const tel = telHref(str(item.phone, 30));
        const wa = whatsappLink(str(item.whatsapp, 30) || config.whatsappNumber, t('content.whatsappCentre', { name }));
        const map = mapsHref(str(item.mapUrl, 600), str(item.address, 300));
        const shop = str(item.shopRoute, 300);
        return (
            <li key={i}>
                <article className="cmx-panel">
                    <h3 className="cmx-h3">{name}</h3>
                    {str(item.address) && <p className="cmx-p cmx-small">{tx(item.address, 300)}</p>}
                    {str(item.note) && <p className="cmx-meta m-0">{tx(item.note, 200)}</p>}
                    <div className="cmx-loc__actions">
                        {tel && (
                            <a href={tel} className="cmx-btn cmx-btn--outline" onClick={contact('call', 'location')}>
                                <Phone size={18} aria-hidden="true" />
                                {t('content.call')}
                            </a>
                        )}
                        {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--outline" onClick={contact('whatsapp', 'location')}>
                                <WhatsappLogo size={18} aria-hidden="true" />
                                {t('content.whatsapp')}
                            </a>
                        )}
                        {map && (
                            <a href={map} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--outline" onClick={contact('directions', 'location')}>
                                <MapPin size={18} aria-hidden="true" />
                                {t('content.directions')}
                            </a>
                        )}
                        {shop && (
                            <ActionLink to={shop} className="cmx-btn cmx-btn--outline">
                                <Storefront size={18} aria-hidden="true" />
                                {t('content.shopHere')}
                            </ActionLink>
                        )}
                    </div>
                </article>
            </li>
        );
    };
    return (
        <>
            <Intro props={props} />
            {groups.length === 1 && !groups[0]!.name ? (
                <ul className="cmx-region__list">{groups[0]!.items.map(card)}</ul>
            ) : (
                groups.map((group, g) => (
                    <details key={group.name || g} className="cmx-region" open={g === 0}>
                        <summary>
                            <span>
                                {tx(group.name, 80)} <span className="cmx-muted font-normal">({group.items.length})</span>
                            </span>
                            <CaretDown size={18} aria-hidden="true" className="cmx-caret" />
                        </summary>
                        <ul className="cmx-region__list">{group.items.map(card)}</ul>
                    </details>
                ))
            )}
        </>
    );
};

/* ── recognition strip ────────────────────────────────────────────── */

/**
 * commerceRecognitionStrip: { eyebrow, title, cta, items [{ image, text, date }], outlets [],
 * note }. Editorial only: visits and press, kept away from prices and buy buttons.
 */
const RecognitionStrip: Section = ({ props }) => {
    const tx = useText();
    const items = records(props.items, 9).filter((item) => str(item.text));
    const outlets = strings(props.outlets, 12);
    if (items.length === 0 && outlets.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            {items.length > 0 && (
                <ul className="cmx-press">
                    {items.map((item, i) => (
                        <li key={i} className="cmx-press__item">
                            {str(item.image) && (
                                <div className="cmx-img cmx-press__img">
                                    <Img src={str(item.image, 600)} width={200} height={200} />
                                </div>
                            )}
                            <div className="flex flex-col gap-1">
                                {str(item.date) && <span className="cmx-meta">{str(item.date, 30)}</span>}
                                <p className="m-0">{tx(item.text, 300)}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {outlets.length > 0 && (
                <p className="cmx-sources">
                    {outlets.map((outlet, i) => (
                        <span key={i}>{tx(outlet, 60)}</span>
                    ))}
                </p>
            )}
            {str(props.note) && <p className="cmx-meta mt-2">{tx(props.note, 300)}</p>}
        </>
    );
};

/* ── feature (story, promise, tribute) ────────────────────────────── */

/**
 * commerceFeature: { eyebrow, title, text, note, image, imageAlt, mediaPosition: "start" | "end",
 * quote, quoteBy, cta, secondary, videoUrl, videoLabel }. A video is a link over the photo that
 * opens the video when tapped: nothing plays or loads before that.
 */
const Feature: Section = ({ props }) => {
    const { t } = useCommerceSite();
    const tx = useText();
    const title = tx(props.title, 200);
    const quote = tx(props.quote, 400);
    if (!title && !quote) return null;
    const image = str(props.image, 600);
    const video = str(props.videoUrl, 600);
    const videoLabel = tx(props.videoLabel, 80);
    return (
        <div className={cn('cmx-feature', str(props.mediaPosition) === 'end' && 'cmx-feature--end')}>
            {image && (
                <div className="cmx-feature__media">
                    <Img src={image} alt={tx(props.imageAlt, 200)} width={1000} height={750} />
                    {video && linkKind(video) === 'external' && (
                        <a href={video} target="_blank" rel="noopener noreferrer" className="cmx-play" aria-label={t('content.playVideo', { label: videoLabel || title })}>
                            <Play size={18} weight="fill" aria-hidden="true" />
                            {videoLabel}
                        </a>
                    )}
                </div>
            )}
            <div className="cmx-stack">
                {str(props.eyebrow) && <span className="cmx-eyebrow">{tx(props.eyebrow, 80)}</span>}
                {title && <h2 className="cmx-h2">{title}</h2>}
                {str(props.text) && <p className="cmx-p">{tx(props.text, 2000)}</p>}
                {quote && (
                    <blockquote className="cmx-blockquote">
                        {quote}
                        {str(props.quoteBy) && <footer className="cmx-meta mt-1 font-normal">{tx(props.quoteBy, 120)}</footer>}
                    </blockquote>
                )}
                {str(props.note) && <p className="cmx-meta m-0">{tx(props.note, 300)}</p>}
                <div className="cmx-actions">
                    <CtaButton value={readCta(props.cta)} primary />
                    <CtaButton value={readCta(props.secondary)} />
                </div>
            </div>
        </div>
    );
};

/* ── cards: partner tracks, steps, reviews ────────────────────────── */

/**
 * commercePartnerTracks: { eyebrow, title, text, items [{ anchor, title, text, points [],
 * ctaLabel, ctaRoute }] }. Each card can be linked to as #<anchor>.
 */
const PartnerTracks: Section = ({ props }) => {
    const tx = useText();
    const items = records(props.items, 6).filter((item) => str(item.title));
    if (items.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            <ul className={cn('cmx-cards', items.length >= 3 && 'cmx-cards--3')}>
                {items.map((item, i) => {
                    const id = anchorId(item.anchor);
                    const action = readCta({ label: item.ctaLabel, route: item.ctaRoute });
                    return (
                        <li key={i} id={id || undefined}>
                            <article className="cmx-panel">
                                <h3 className="cmx-h3 text-lg">{tx(item.title, 120)}</h3>
                                {str(item.text) && <p className="cmx-p">{tx(item.text, 600)}</p>}
                                {strings(item.points, 8).length > 0 && (
                                    <ul className="cmx-points">
                                        {strings(item.points, 8).map((point, p) => (
                                            <li key={p}>{tx(point, 200)}</li>
                                        ))}
                                    </ul>
                                )}
                                {action && (
                                    <div className="mt-auto pt-2">
                                        <CtaButton value={action} primary className="cmx-btn--block" />
                                    </div>
                                )}
                            </article>
                        </li>
                    );
                })}
            </ul>
        </>
    );
};

/** commerceSteps: { eyebrow, title, text, items [{ title, text }] }. Numbered, in order. */
const Steps: Section = ({ props }) => {
    const tx = useText();
    const items = records(props.items, 8).filter((item) => str(item.title));
    if (items.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            <ol className={cn('cmx-cards', items.length >= 4 ? 'cmx-cards--4' : 'cmx-cards--3')}>
                {items.map((item, i) => (
                    <li key={i} className="cmx-panel">
                        <span className="cmx-step__num" aria-hidden="true">
                            {i + 1}
                        </span>
                        <h3 className="cmx-h3">{tx(item.title, 120)}</h3>
                        {str(item.text) && <p className="cmx-p cmx-small">{tx(item.text, 400)}</p>}
                    </li>
                ))}
            </ol>
        </>
    );
};

/** commerceReviews: { eyebrow, title, text, items [{ quote, name, product, rating }], note }. */
const Reviews: Section = ({ props }) => {
    const { t } = useCommerceSite();
    const tx = useText();
    const items = records(props.items, 6).filter((item) => str(item.quote));
    if (items.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            <ul className="cmx-cards cmx-cards--rail cmx-cards--3">
                {items.map((item, i) => {
                    const rating = Math.round(Number(item.rating));
                    return (
                        <li key={i}>
                            <figure className="cmx-panel m-0">
                                {rating >= 1 && rating <= 5 && (
                                    <span className="cmx-stars" role="img" aria-label={t('content.rating', { count: rating })}>
                                        {'★'.repeat(rating)}
                                    </span>
                                )}
                                <blockquote className="cmx-quote">“{tx(item.quote, 600)}”</blockquote>
                                <figcaption className="cmx-meta mt-auto">
                                    {[tx(item.name, 60), tx(item.product, 80)].filter(Boolean).join(' · ')}
                                </figcaption>
                            </figure>
                        </li>
                    );
                })}
            </ul>
            {str(props.note) && <p className="cmx-meta mt-3">{tx(props.note, 300)}</p>}
        </>
    );
};

/* ── FAQ, text ────────────────────────────────────────────────────── */

/** commerceFaq: { eyebrow, title, text, items [{ question, answer }] }. Native disclosure. */
const Faq: Section = ({ props }) => {
    const tx = useText();
    const items = records(props.items, 30).filter((item) => str(item.question) && str(item.answer));
    if (items.length === 0) return null;
    return (
        <>
            <Intro props={props} />
            <div className="cmx-faq">
                {items.map((item, i) => (
                    <details key={i}>
                        <summary>
                            <span>{tx(item.question, 300)}</span>
                            <CaretDown size={18} aria-hidden="true" className="cmx-caret" />
                        </summary>
                        <p className="cmx-p cmx-faq__a">{tx(item.answer, 2000)}</p>
                    </details>
                ))}
            </div>
        </>
    );
};

/**
 * commerceTextBlock: { eyebrow, title, text, level: 1 | 2, sections [{ heading, text, items [] }],
 * table { caption, head [], rows [[]] }, updatedNote }. Policy and help pages, as plain text.
 */
const TextBlock: Section = ({ props }) => {
    const tx = useText();
    const sections = records(props.sections, 20);
    const table = props.table && typeof props.table === 'object' ? (props.table as Record<string, unknown>) : null;
    const head = table ? strings(table.head, 6) : [];
    const rows = table && Array.isArray(table.rows) ? (table.rows as unknown[]).slice(0, 30).map((row) => strings(row, 6)) : [];
    return (
        <div className="cmx-text">
            <Intro props={props} level={Number(props.level) === 1 ? 1 : 2} />
            {head.length > 0 && rows.length > 0 && (
                <div className="cmx-table-wrap">
                    <table className="cmx-table">
                        {str(table?.caption) && <caption className="cmx-meta pb-2 text-start">{tx(table?.caption, 200)}</caption>}
                        <thead>
                            <tr>
                                {head.map((cell, i) => (
                                    <th key={i} scope="col">
                                        {tx(cell, 120)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, r) => (
                                <tr key={r}>
                                    {row.map((cell, c) => (
                                        <td key={c}>{tx(cell, 300)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {sections.map((section, i) => (
                <section key={i} className="cmx-stack" id={anchorId(section.anchor) || undefined}>
                    {str(section.heading) && <h3 className="cmx-h3 text-lg">{tx(section.heading, 200)}</h3>}
                    {str(section.text) && <p className="cmx-p">{tx(section.text, 3000)}</p>}
                    {strings(section.items, 20).length > 0 && (
                        <ul className="cmx-points">
                            {strings(section.items, 20).map((item, j) => (
                                <li key={j}>{tx(item, 400)}</li>
                            ))}
                        </ul>
                    )}
                </section>
            ))}
            {str(props.updatedNote) && <p className="cmx-meta m-0">{tx(props.updatedNote, 120)}</p>}
        </div>
    );
};

/* ── contact panel ────────────────────────────────────────────────── */

/**
 * commerceContactPanel: { eyebrow, title, level: 1 | 2, text, phone, email, whatsappMessage, hours, rows
 * [{ label, text, route }], details [{ label, value }], address, mapUrl }. WhatsApp uses the
 * shop's number (globalSettings.commerce.whatsappNumber).
 */
const ContactPanel: Section = ({ props }) => {
    const { t, config } = useCommerceSite();
    const tx = useText();
    const wa = whatsappLink(config.whatsappNumber, tx(props.whatsappMessage, 300) || 'Namaste');
    const tel = telHref(str(props.phone, 30));
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(props.email, 120)) ? str(props.email, 120) : '';
    const rows = records(props.rows, 10).filter((row) => str(row.label));
    const details = records(props.details, 12).filter((row) => str(row.label) && str(row.value));
    const map = mapsHref(str(props.mapUrl, 600), str(props.address, 300));
    return (
        <div className="flex flex-col gap-6">
            <Intro props={props} level={Number(props.level) === 1 ? 1 : 2} link={false} />
            <div className="cmx-contact">
                {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--lg cmx-btn--wa" onClick={contact('whatsapp', 'contact')}>
                        <WhatsappLogo size={22} aria-hidden="true" />
                        {t('content.chat')}
                    </a>
                )}
                {tel && (
                    <a href={tel} className="cmx-btn cmx-btn--lg cmx-btn--outline" onClick={contact('call', 'contact')}>
                        <Phone size={20} aria-hidden="true" />
                        {t('content.call')} {str(props.phone, 30)}
                    </a>
                )}
                {email && (
                    <a href={`mailto:${email}`} className="cmx-btn cmx-btn--lg cmx-btn--outline" onClick={contact('email', 'contact')}>
                        <EnvelopeSimple size={20} aria-hidden="true" />
                        {email}
                    </a>
                )}
            </div>
            {str(props.hours) && <p className="cmx-meta m-0">{tx(props.hours, 200)}</p>}
            {rows.length > 0 && (
                <ul className="cmx-cards cmx-cards--3">
                    {rows.map((row, i) => (
                        <li key={i} className="cmx-panel">
                            <h3 className="cmx-h3">{tx(row.label, 80)}</h3>
                            {str(row.text) && <p className="cmx-p cmx-small">{tx(row.text, 300)}</p>}
                            {str(row.route) && str(row.linkLabel) && (
                                <ActionLink to={str(row.route, 300)} className="cmx-link cmx-tap mt-auto inline-flex items-center">
                                    {tx(row.linkLabel, 60)}
                                </ActionLink>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {(str(props.address) || details.length > 0) && (
                <div className="cmx-panel">
                    {str(props.address) && <p className="cmx-p">{tx(props.address, 300)}</p>}
                    {map && (
                        <a href={map} target="_blank" rel="noopener noreferrer" className="cmx-link cmx-tap inline-flex items-center gap-2 self-start" onClick={contact('directions', 'contact')}>
                            <MapPin size={18} aria-hidden="true" />
                            {t('content.directions')}
                        </a>
                    )}
                    {details.length > 0 && (
                        <dl className="cmx-dl">
                            {details.map((row, i) => (
                                <React.Fragment key={i}>
                                    <dt>{tx(row.label, 60)}</dt>
                                    <dd>{tx(row.value, 200)}</dd>
                                </React.Fragment>
                            ))}
                        </dl>
                    )}
                </div>
            )}
        </div>
    );
};

/* ── lead form ────────────────────────────────────────────────────── */

const ERROR_KEYS: Record<NonNullable<LeadErrors[LeadField]>, MessageKey> = {
    required: 'lead.required',
    phoneInvalid: 'lead.phoneInvalid',
    emailInvalid: 'lead.emailInvalid',
};

const FIELD_LABELS: Record<LeadField, MessageKey> = {
    name: 'lead.name',
    phone: 'lead.phone',
    email: 'lead.email',
    city: 'lead.city',
    organisation: 'lead.organisation',
    quantity: 'lead.quantity',
    message: 'lead.message',
};

/** The CRM field names of the extra answers: the same in every language, so leads group together. */
const CRM_LABELS = { role: 'I am a', city: 'City', organisation: 'Organisation', quantity: 'Quantity', message: 'Message' } as const;

/**
 * commerceLeadForm: { anchor, eyebrow, title, text, audienceId, variant: "card" | "inline",
 * fields ["email", "city", "organisation", "quantity", "message"], roles [], submitLabel,
 * successText, consentText, sourceKey }. The e-mail is optional when the form names a campaign
 * (`audienceId`): a lead with an e-mail goes through the site's lead pipeline (website-lead), a
 * lead with only a phone through the campaign route (api/lead.ts), which needs that campaign.
 * Without a campaign the e-mail is asked for and required, and leads land in the site's default
 * list. "inline" asks for the phone only (an opt-in), plus the e-mail without a campaign. No
 * identity documents are ever asked for.
 */
const LeadForm: Section = ({ props }) => {
    const { t, instituteId, tagName } = useCommerceSite();
    const tx = useText();
    const inline = str(props.variant) === 'inline';
    const audienceId = str(props.audienceId, 60);
    // A lead with a phone and no e-mail can be saved only into a named campaign.
    const phoneOnlyOk = !!audienceId;
    const asked: LeadField[] = inline ? ['phone'] : leadFields(props.fields);
    const fields: LeadField[] = phoneOnlyOk || asked.includes('email') ? asked : inline ? ['phone', 'email'] : leadFields([...strings(props.fields), 'email']);
    const roles = strings(props.roles, 8);
    const [values, setValues] = useState<Partial<Record<LeadField, string>>>({});
    const [role, setRole] = useState('');
    const [errors, setErrors] = useState<LeadErrors>({});
    const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
    const honeypot = useRef<HTMLInputElement>(null);
    const mountedAt = useRef(Date.now());
    const formId = anchorId(props.anchor) || `lead-${anchorId(props.sourceKey) || 'form'}`;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found = validateLead(values, fields, { emailRequired: !phoneOnlyOk });
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        // A bot sees the usual thank-you and nothing is sent.
        if (isSpamSubmission(honeypot.current?.value || '', mountedAt.current)) {
            setState('sent');
            return;
        }
        setState('sending');
        const extra: Record<string, string> = {};
        if (role) extra[CRM_LABELS.role] = role;
        for (const field of ['city', 'organisation', 'quantity', 'message'] as const) {
            const value = (values[field] || '').trim();
            if (value) extra[CRM_LABELS[field]] = value.slice(0, 1000);
        }
        const email = (values.email || '').trim();
        const lead = {
            instituteId,
            fullName: (values.name || '').trim(),
            mobileNumber: normalizeMobile(values.phone || '') || '',
            sourceType: 'WEBSITE_FORM',
            sourceId: `${tagName}:${anchorId(props.sourceKey) || 'shop-lead-form'}`,
        };
        try {
            if (email || !phoneOnlyOk) {
                await submitWebsiteLead({ ...lead, audienceId: audienceId || undefined, email, customFieldValues: extra });
            } else {
                await submitPhoneOnlyLead({ ...lead, audienceId });
            }
            setState('sent');
        } catch {
            setState('failed');
        }
    };

    const fieldLabel = (field: LeadField): MessageKey => (field === 'email' && !phoneOnlyOk ? 'lead.emailRequired' : FIELD_LABELS[field]);

    const input = (field: LeadField) => {
        const id = `${formId}-${field}`;
        const error = errors[field];
        const common = {
            id,
            name: field,
            value: values[field] || '',
            className: 'cmx-input',
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? `${id}-error` : undefined,
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [field]: e.target.value })),
        };
        return (
            <div key={field} className="cmx-field">
                <label htmlFor={id} className={inline ? 'cmx-sr' : undefined}>
                    {t(fieldLabel(field))}
                </label>
                {field === 'message' ? (
                    <textarea {...common} rows={3} maxLength={1000} />
                ) : (
                    <input
                        {...common}
                        type={field === 'phone' ? 'tel' : field === 'email' ? 'email' : field === 'quantity' ? 'number' : 'text'}
                        inputMode={field === 'phone' || field === 'quantity' ? 'numeric' : undefined}
                        autoComplete={field === 'phone' ? 'tel-national' : field === 'name' ? 'name' : field === 'email' ? 'email' : field === 'city' ? 'address-level2' : 'off'}
                        placeholder={inline ? t(fieldLabel(field)) : undefined}
                        maxLength={field === 'phone' ? 16 : 120}
                        min={field === 'quantity' ? 1 : undefined}
                    />
                )}
                {error && (
                    <span id={`${id}-error`} role="alert" className="cmx-field__error">
                        {t(ERROR_KEYS[error])}
                    </span>
                )}
            </div>
        );
    };

    return (
        <div id={formId} className="flex flex-col gap-4">
            <Intro props={props} link={false} />
            {state === 'sent' ? (
                <p className="cmx-note cmx-ok" role="status">
                    {tx(props.successText, 300) || t('lead.sent')}
                </p>
            ) : (
                <form className={cn('cmx-form', inline && 'cmx-form--inline')} onSubmit={submit} noValidate>
                    {roles.length > 0 && !inline && (
                        <fieldset className="cmx-field m-0 border-0 p-0">
                            <legend className="mb-2 font-semibold">{t('lead.role')}</legend>
                            <div className="cmx-pills" role="radiogroup">
                                {roles.map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        role="radio"
                                        aria-checked={role === r}
                                        className="cmx-chip"
                                        onClick={() => setRole(role === r ? '' : r)}
                                    >
                                        {tx(r, 60)}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                    )}
                    {fields.map(input)}
                    <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" className="cmx-hp" aria-hidden="true" />
                    <button type="submit" className="cmx-btn cmx-btn--primary cmx-btn--lg" disabled={state === 'sending'}>
                        {state === 'sending' ? t('lead.sending') : tx(props.submitLabel, 40) || t('lead.submit')}
                    </button>
                    {str(props.consentText) && <p className={cn('cmx-meta m-0', inline && 'col-span-2')}>{tx(props.consentText, 300)}</p>}
                    {state === 'failed' && (
                        <p className={cn('cmx-note cmx-note--error m-0', inline && 'col-span-2')} role="alert">
                            {t('lead.failed')}
                        </p>
                    )}
                </form>
            )}
        </div>
    );
};

/* ── floating WhatsApp, not found ─────────────────────────────────── */

/** commerceWhatsAppButton: { message }. A round button at the bottom corner; no section of its own. */
/** What the floating button must never sit on: anything a shopper taps. */
const TAPPABLE = 'button, select, input, textarea, .cmx-btn, .cmx-chip, [role="button"]';

/**
 * The floating button steps aside while the page scrolls down and whenever a button, a field or
 * a chip is under it (a card's "Add to cart" in the right column); it comes back on scroll-up or
 * at rest when nothing is beneath it.
 */
const useFabAway = (ref: React.RefObject<HTMLElement | null>, on: boolean): boolean => {
    const [away, setAway] = useState(false);
    useEffect(() => {
        if (!on || typeof window === 'undefined' || typeof document.elementsFromPoint !== 'function') return;
        let lastY = window.scrollY;
        let frame = 0;
        let rest = 0;
        const covers = (): boolean => {
            const fab = ref.current;
            if (!fab) return false;
            // Hidden, the button only fades: its box is where it shows.
            const box = fab.getBoundingClientRect();
            const size = box.width || 48;
            const right = box.right;
            const bottom = box.bottom;
            const points: Array<[number, number]> = [
                [right - size / 2, bottom - size / 2],
                [right - 4, bottom - 4],
                [right - size + 4, bottom - 4],
                [right - 4, bottom - size + 4],
                [right - size + 4, bottom - size + 4],
            ];
            return points.some(([x, y]) =>
                document.elementsFromPoint(x, y).some((el) => !fab.contains(el) && (el as Element).matches?.(TAPPABLE))
            );
        };
        const settle = () => setAway(covers());
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const y = window.scrollY;
                const down = y > lastY && y > 120;
                lastY = y;
                if (down) setAway(true);
                else setAway(covers());
                window.clearTimeout(rest);
                rest = window.setTimeout(settle, 180);
            });
        };
        settle();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', settle);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.clearTimeout(rest);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', settle);
        };
    }, [ref, on]);
    return away;
};

export const WhatsAppButton: React.FC<{ props: Props }> = ({ props }) => {
    const { t, config } = useCommerceSite();
    const tx = useText();
    const href = whatsappLink(config.whatsappNumber, tx(props.message, 300) || 'Namaste');
    const ref = useRef<HTMLAnchorElement>(null);
    const away = useFabAway(ref, !!href);
    if (!href) return null;
    return (
        <a
            ref={ref}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('cmx-fab', away && 'cmx-fab--away')}
            aria-label={t('content.chat')}
            aria-hidden={away || undefined}
            tabIndex={away ? -1 : undefined}
            onClick={contact('whatsapp', 'floating')}
        >
            <WhatsappLogo size={30} weight="fill" aria-hidden="true" />
        </a>
    );
};

/**
 * commerceNotFound: { eyebrow, title, text, image, collectionIds [], whatsappMessage, whatsappLabel }.
 * The site's "page not found": search, a few categories and a WhatsApp line. Put it on a page
 * with the route "404" (or "not-found"), which the site shows for an address it has no page for.
 */
const NotFound: Section = ({ props }) => {
    const { t, config } = useCommerceSite();
    const tx = useText();
    const navigate = useShopNavigate();
    const [q, setQ] = useState('');
    const slugs = strings(props.collectionIds, 8);
    const tree = useCategoryTree(slugs.length > 0).data?.data;
    const chips = slugs.map((slug) => findCategory(tree, slug)?.node).filter((node): node is NonNullable<typeof node> => !!node);
    const image = str(props.image, 600);
    const wa = whatsappLink(config.whatsappNumber, tx(props.whatsappMessage, 300));
    return (
        <div className="cmx-404">
            <ShopHead title={tx(props.title, 120) || t('notFound.searchLabel')} noindex />
            {image && (
                <div className="cmx-img cmx-404__art">
                    <Img src={image} width={560} height={560} />
                </div>
            )}
            <Intro props={props} level={1} center link={false} />
            <form
                role="search"
                onSubmit={(e) => {
                    e.preventDefault();
                    const term = q.trim();
                    if (term) void navigate(`search?q=${encodeURIComponent(term)}`);
                }}
            >
                <label htmlFor="cmx-404-q" className="cmx-sr">
                    {t('notFound.searchLabel')}
                </label>
                <input id="cmx-404-q" type="search" className="cmx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('notFound.searchLabel')} />
                <button type="submit" className="cmx-btn cmx-btn--primary" aria-label={t('notFound.search')}>
                    <MagnifyingGlass size={20} aria-hidden="true" />
                </button>
            </form>
            {chips.length > 0 && (
                <ul className="cmx-pills justify-center">
                    {chips.map((node) => (
                        <li key={node.slug}>
                            <ShopLink to={`c/${node.slug}`} className="cmx-chip">
                                {node.name || node.slug}
                            </ShopLink>
                        </li>
                    ))}
                </ul>
            )}
            {wa && str(props.whatsappLabel) && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--outline cmx-btn--lg" onClick={contact('whatsapp', 'not-found')}>
                    <WhatsappLogo size={20} aria-hidden="true" />
                    {tx(props.whatsappLabel, 80)}
                </a>
            )}
        </div>
    );
};

/** The content blocks by section type; the shop's product blocks live in Sections.tsx. */
export const CONTENT_SECTIONS: Record<string, Section> = {
    commerceHero: Hero,
    commerceImpactBand: ImpactBand,
    commerceStoryCards: StoryCards,
    commerceLocationCards: LocationCards,
    commerceRecognitionStrip: RecognitionStrip,
    commerceFeature: Feature,
    commercePartnerTracks: PartnerTracks,
    commerceSteps: Steps,
    commerceReviews: Reviews,
    commerceFaq: Faq,
    commerceTextBlock: TextBlock,
    commerceContactPanel: ContactPanel,
    commerceLeadForm: LeadForm,
    commerceNotFound: NotFound,
};

/** Blocks drawn without the section's padding and width (a strip, a floating button). */
export const BARE_SECTIONS: Record<string, Section> = {
    commerceAnnouncementBar: AnnouncementBar,
    commerceWhatsAppButton: WhatsAppButton,
};

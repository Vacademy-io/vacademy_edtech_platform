import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CaretLeft, CaretRight, Pause, Play } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CatalogueLink } from "../../CatalogueLink";
import { openComingSoonForm } from "../../../-utils/coming-soon";
import { resolveCoursePageRoute } from "../../../-utils/course-page-routing";
import { getOpenEnrollInvite } from "../../../-services/course-levels-service";
import { RouteMatcher } from "../../../-services/route-matcher";
import type { CatalogCourseRow } from "../CourseCatalogComponent";
import { COLUMN_SECTION_TITLE } from "./ColumnSectionHeader";
import {
  fillPrice,
  inviteAmount,
  rowAmount,
  spotlightEyebrowParts,
  spotlightPrice,
  spotlightRow,
  wrapIndex,
  type ResolvedSpotlightSection,
  type ResolvedSpotlightSlide,
  type ResolvedSpotlightStep,
} from "./catalog-column-sections";
import type { CatalogSlotContext } from "./slots/catalog-slot-types";

/*
 * Figma "Courses" 1:298 (Learning path card · Slide 1). Exact values that the
 * token scale lacks live in these constants (design-lint-ignore per line).
 */
const PANEL =
  "flex flex-col gap-[18px] overflow-hidden rounded-2xl bg-palette-sand p-5 sm:rounded-[20px] sm:p-7"; // design-lint-ignore: Figma radius 20, gap 18
const EYEBROW =
  "m-0 whitespace-pre-wrap text-[11px] leading-4 font-bold uppercase tracking-[1.3px] text-palette-gold"; // design-lint-ignore: Figma 11/16, tracking 1.3px
const CTA_BUTTON =
  "inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-[8px] bg-palette-primary px-[22px] py-3 text-sm font-normal text-white no-underline transition-colors hover:bg-palette-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 md:w-auto"; // design-lint-ignore: Figma radius 8, px 22
const STEP_CARD =
  "flex min-w-0 flex-row items-center gap-3 rounded-[12px] border border-palette-border bg-catalogue-bg-elevated p-3 text-start sm:flex-col sm:items-start sm:gap-1.5"; // design-lint-ignore: Figma radius 12
const STEP_CIRCLE =
  "flex size-[26px] shrink-0 items-center justify-center rounded-full border text-xs leading-[14px] font-bold"; // design-lint-ignore: Figma 26px circle, 12/14
const STEP_TITLE = "m-0 text-[13px] leading-[18px] font-bold text-palette-text"; // design-lint-ignore: Figma 13/18
const SLIDE = "flex w-full shrink-0 flex-col gap-[18px]"; // design-lint-ignore: Figma gap 18
const STEP_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};
const SWIPE_PX = 40;
/** Room for a focus ring (ring 2 + offset 2) inside the clipping track wrapper. */
const TRACK_CLIP = "-m-1 overflow-hidden p-1";
/** Slides sit this far apart, so a neighbour never shows inside that room. */
const SLIDE_GAP_PX = 8;

/** Inline colour only when the site authored one (hex validated by the resolver). */
const colorStyle = (prop: "backgroundColor" | "borderColor" | "color", value: string | null | undefined) =>
  value ? ({ [prop]: value } as React.CSSProperties) : undefined;

export interface SpotlightCarouselProps {
  section: ResolvedSpotlightSection;
  /** The slides this view shows (spotlightSlidesFor). */
  slides: ResolvedSpotlightSlide[];
  ctx: CatalogSlotContext;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The flagship programme panel: eyebrow, title (+ Devanagari title), text,
 * a CTA with the live price, numbered step cards; with more than one slide,
 * dots, "1 / 2" and previous/next (wrapping), swipe and arrow keys.
 */
export const SpotlightCarousel: React.FC<SpotlightCarouselProps> = ({ section, slides, ctx }) => {
  const { t } = ctx;
  const count = slides.length;
  const [index, setIndex] = useState(0);
  // Autoplay stops while the pointer is over the panel, while focus is inside
  // it, and after the visitor presses pause (WCAG 2.2.2).
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [stopped, setStopped] = useState(false);
  const paused = hovered || focusWithin || stopped;
  const touchX = useRef<number | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const slideKey = slides.map((s) => s.id).join("|");
  // A different slide set (stream tab) starts at its first slide.
  useEffect(() => setIndex(0), [slideKey]);
  const current = wrapIndex(index, count);

  useEffect(() => {
    if (!section.autoplayMs || count < 2 || paused || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setIndex((i) => wrapIndex(i + 1, count)), section.autoplayMs);
    return () => window.clearInterval(timer);
  }, [section.autoplayMs, count, paused]);

  if (!count) return null;
  const go = (next: number) => setIndex(wrapIndex(next, count));
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (count < 2) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Only from the carousel controls: an arrow on a slide's own link would
    // make the slide holding focus inert and drop focus to <body>.
    if (!controlsRef.current?.contains(e.target as Node)) return;
    const forward = (e.key === "ArrowRight") !== rtl;
    e.preventDefault();
    go(current + (forward ? 1 : -1));
  };
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start === null || end === undefined || count < 2) return;
    const dx = end - start;
    if (Math.abs(dx) < SWIPE_PX) return;
    go(current + ((dx < 0) !== rtl ? 1 : -1));
  };

  const label = section.title || t("catalogSections.carouselLabel", "Featured programmes");

  return (
    <section
      className={PANEL}
      style={colorStyle("backgroundColor", section.colors.panelColor)}
      aria-label={label}
      aria-roledescription={count > 1 ? t("catalogSections.carouselRole", "carousel") : undefined}
      data-column-section={section.id}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* One slide: nothing moves, nothing clips (focus rings stay whole). */}
      <div className={count > 1 ? TRACK_CLIP : undefined}>
        <div
          className="flex items-start transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={
            count > 1
              ? {
                  gap: SLIDE_GAP_PX,
                  transform: `translateX(calc(${(rtl ? 1 : -1) * current} * (100% + ${SLIDE_GAP_PX}px)))`,
                }
              : undefined
          }
          aria-live={count > 1 && !section.autoplayMs ? "polite" : undefined}
        >
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className={SLIDE}
              role={count > 1 ? "group" : undefined}
              aria-roledescription={count > 1 ? t("catalogSections.slideRole", "slide") : undefined}
              aria-label={count > 1 ? t("catalogSections.slideOf", { n: i + 1, total: count, defaultValue: "{{n}} / {{total}}" }) : undefined}
              aria-hidden={i === current ? undefined : true}
              // React 19 renders a boolean `inert`; @types/react 18 does not declare it yet.
              {...(i === current ? {} : ({ inert: true } as Record<string, unknown>))}
            >
              <SpotlightSlide slide={slide} section={section} ctx={ctx} />
            </div>
          ))}
        </div>
      </div>

      {count > 1 && (
        <div ref={controlsRef} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => go(i)}
                aria-label={t("catalogSections.goToSlide", { n: i + 1, defaultValue: "Go to slide {{n}}" })}
                aria-current={i === current ? "true" : undefined}
                className={cn(
                  "relative h-2.5 rounded-full transition-all duration-300 after:absolute after:-inset-2 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                  i === current ? "w-7 bg-palette-primary" : "w-2.5 bg-palette-muted2", // muted2: >= 3:1 on the panel
                )}
                style={i === current ? undefined : colorStyle("backgroundColor", section.colors.dotColor)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {section.autoplayMs ? (
              <button
                type="button"
                onClick={() => setStopped((v) => !v)}
                aria-label={
                  stopped
                    ? t("catalogSections.playSlides", "Play slides")
                    : t("catalogSections.pauseSlides", "Pause slides")
                }
                data-carousel-autoplay=""
                className="flex size-7 items-center justify-center rounded-full border border-palette-border-strong bg-catalogue-bg-elevated text-palette-text transition-colors hover:bg-palette-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                style={colorStyle("borderColor", section.colors.ringColor)}
              >
                {stopped ? (
                  <Play size={12} weight="fill" aria-hidden="true" />
                ) : (
                  <Pause size={12} weight="fill" aria-hidden="true" />
                )}
              </button>
            ) : null}
            <p className="m-0 text-xs font-bold text-palette-muted" aria-hidden="true">
              {t("catalogSections.slideOf", { n: current + 1, total: count, defaultValue: "{{n}} / {{total}}" })}
            </p>
            <button
              type="button"
              onClick={() => go(current - 1)}
              aria-label={t("catalogSections.previousSlide", "Previous slide")}
              className="flex size-7 items-center justify-center rounded-full border border-palette-border-strong bg-catalogue-bg-elevated text-palette-text transition-colors hover:bg-palette-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              style={colorStyle("borderColor", section.colors.ringColor)}
            >
              <CaretLeft size={14} weight="bold" aria-hidden="true" className="rtl:-scale-x-100" />
            </button>
            <button
              type="button"
              onClick={() => go(current + 1)}
              aria-label={t("catalogSections.nextSlide", "Next slide")}
              className="flex size-7 items-center justify-center rounded-full bg-palette-primary text-white transition-colors hover:bg-palette-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <CaretRight size={14} weight="bold" aria-hidden="true" className="rtl:-scale-x-100" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const SpotlightSlide: React.FC<{
  slide: ResolvedSpotlightSlide;
  section: ResolvedSpotlightSection;
  ctx: CatalogSlotContext;
}> = ({ slide, section, ctx }) => {
  const { siteT, t } = ctx;
  const navigate = useNavigate();
  const stream = slide.streamSlug
    ? ctx.streamList.find((s) => s.slug.toLowerCase() === slide.streamSlug.toLowerCase()) ?? null
    : null;
  const eyebrow = spotlightEyebrowParts(slide, stream, siteT).join("  ·  ");
  const row = spotlightRow(slide.cta, ctx.courses);
  // A course outside the catalogue rows (not published to it): the live price
  // is its invite's plan — never the authored mock price while that can be read.
  const inviteId = !row && slide.cta?.enrollInviteId ? slide.cta.enrollInviteId : "";
  const inviteQuery = useQuery({
    queryKey: ["catalog-spotlight-invite", ctx.instituteId, inviteId],
    queryFn: () => getOpenEnrollInvite(ctx.instituteId, inviteId),
    enabled: !!inviteId && !!ctx.instituteId,
    staleTime: 5 * 60_000,
  });
  const invitePending = !!inviteId && !!ctx.instituteId && inviteQuery.isPending;
  const live = row ? rowAmount(row) : inviteId ? inviteAmount(inviteQuery.data, slide.cta?.packageSessionId) : null;
  const priced = spotlightPrice(slide.cta, live, ctx.siteLocale, t("catalogSections.freeBadge", "Free"));
  // Until the invite answers there is no price to show (rather than a wrong one).
  const price = invitePending ? null : priced.value;
  // The translated title can already be the Devanagari one: say it once.
  const native =
    slide.titleNative && slide.titleNative.trim() !== slide.title.trim() ? slide.titleNative : "";
  const accent = section.colors.accentColor ?? stream?.accentColor ?? null;

  const cta = slide.cta;
  const ctaText = cta ? fillPrice(cta.label, priced.free ? null : price) : "";
  const ctaInner = (
    <>
      {ctaText}
      <ArrowRight size={14} aria-hidden="true" className="rtl:-scale-x-100" />
    </>
  );
  let ctaNode: React.ReactNode = null;
  if (cta?.action === "navigate" && cta.route) {
    ctaNode = (
      <CatalogueLink to={cta.route} className={CTA_BUTTON}>
        {ctaInner}
      </CatalogueLink>
    );
  } else if (cta?.action === "product-page" && cta.productPageCode) {
    const code = cta.productPageCode;
    ctaNode = (
      <a
        href={`/product-pages/${encodeURIComponent(code)}`}
        className={CTA_BUTTON}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          void navigate({ to: "/product-pages/$productPageCode", params: { productPageCode: code } });
        }}
      >
        {ctaInner}
      </a>
    );
  } else if (cta) {
    ctaNode = (
      <button
        type="button"
        className={CTA_BUTTON}
        onClick={() => {
          if (cta.action === "open-form") {
            openComingSoonForm({ enabled: true, audienceId: cta.audienceId }, cta.formTitle || slide.title);
            return;
          }
          if (!row && cta.courseId && cta.productPageCode) {
            // Not in the catalogue: its details page opens only for a product
            // page that sells it, so the page goes along (as a product page's
            // own "View course" does).
            const route = resolveCoursePageRoute(ctx.globalSettings, {
              courseId: cta.courseId,
              packageSessionId: cta.packageSessionId,
            });
            void navigate({
              to: `${RouteMatcher.basePath(ctx.tagName)}/${route ?? cta.courseId}`,
              search: {
                enrollInviteId: cta.enrollInviteId,
                packageSessionId: cta.packageSessionId,
                productPageCode: cta.productPageCode,
              },
            } as unknown as Parameters<typeof navigate>[0]);
            return;
          }
          ctx.handleCourseClick(
            row ??
              ({
                id: cta.courseId,
                enrollInviteId: cta.enrollInviteId,
                packageSessionId: cta.packageSessionId,
              } as unknown as CatalogCourseRow),
          );
        }}
      >
        {ctaInner}
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p className={EYEBROW}>{eyebrow}</p> : null}
          <h2 className={cn(COLUMN_SECTION_TITLE, "flex flex-wrap items-baseline gap-x-3")}>
            <span>{slide.title}</span>
            {native ? (
              <span className="text-palette-primary" lang="hi">
                {native}
              </span>
            ) : null}
          </h2>
          {slide.description ? <p className="m-0 text-sm text-palette-body">{slide.description}</p> : null}
        </div>
        {ctaNode}
      </div>

      {slide.steps.length > 0 && (
        <ol className={cn("m-0 grid list-none grid-cols-1 gap-1.5 p-0", STEP_COLUMNS[slide.steps.length])}>
          {slide.steps.map((step, i) => (
            <li key={`${i}-${step.title}`} className="flex min-w-0">
              <SpotlightStep
                step={step}
                number={i + 1}
                meta={step.meta ? fillPrice(step.meta, price) : ""}
                accent={accent}
                section={section}
                slideTitle={slide.title}
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
};

const SpotlightStep: React.FC<{
  step: ResolvedSpotlightStep;
  number: number;
  meta: string;
  accent: string | null;
  section: ResolvedSpotlightSection;
  slideTitle: string;
}> = ({ step, number, meta, accent, section, slideTitle }) => {
  const isAccent = step.tone === "accent";
  const { colors } = section;
  const circle = (
    <span
      aria-hidden="true"
      className={cn(
        STEP_CIRCLE,
        isAccent
          ? "border-palette-olive bg-palette-olive text-white"
          : "border-palette-border-strong bg-palette-cream text-palette-primary",
      )}
      style={
        isAccent
          ? accent
            ? { backgroundColor: accent, borderColor: accent }
            : undefined
          : colorStyle("borderColor", colors.ringColor)
      }
    >
      {number}
    </span>
  );
  const body = (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className={STEP_TITLE}>{step.title}</span>
      {meta ? (
        <span
          className={cn("text-xs", isAccent ? "font-bold text-palette-text" : "font-normal text-palette-muted")}
          style={isAccent ? colorStyle("color", colors.accentInkColor) : undefined}
        >
          {meta}
        </span>
      ) : null}
    </span>
  );
  const interactive = "w-full transition-colors hover:border-palette-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400";
  if (step.route) {
    return (
      <CatalogueLink to={step.route} className={cn(STEP_CARD, interactive, "no-underline")}>
        {circle}
        {body}
      </CatalogueLink>
    );
  }
  if (step.audienceId) {
    return (
      <button
        type="button"
        className={cn(STEP_CARD, interactive)}
        onClick={() => openComingSoonForm({ enabled: true, audienceId: step.audienceId }, `${slideTitle} · ${step.title}`)}
      >
        {circle}
        {body}
      </button>
    );
  }
  return (
    <div className={cn(STEP_CARD, "w-full")}>
      {circle}
      {body}
    </div>
  );
};

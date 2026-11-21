import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { CaretLeft, CaretRight, Pause, Play } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { BannerCarouselConfig, BannerSlide, HomePlacement } from "@/types/learner-home";
import {
  ROTATE_MS,
  autoplayReducer,
  initialAutoplay,
  nextIndex,
  prevIndex,
  type HoldReason,
} from "../carousel-autoplay";
import { useHomeBuilder } from "../home-context";
import { navigationHref, toNavigation } from "../link-target";
import { altOf, srcSetOf } from "../image-sources";
import { VIEW_DWELL_MS } from "../use-home-analytics";

/**
 * Banner carousel (spec 7.4.1). Native CSS scroll-snap does the swiping, so
 * touch, trackpad and keyboard scrolling work without a library. Autoplay is a
 * pure state machine (carousel-autoplay.ts): every 6 s, held while hovered,
 * focused, touched, off screen or in a hidden tab, stopped for this page view
 * once the learner takes control, never with prefers-reduced-motion. A visible
 * pause/play button is the first control (WCAG 2.2.2).
 */
export function BannerCarouselBlock({
  blockKey,
  config,
  placement,
}: {
  blockKey: string;
  config: BannerCarouselConfig;
  placement: HomePlacement;
}) {
  const { t } = useTranslation("learnerHome");
  const { analytics, openLink, linkContext, preview } = useHomeBuilder();
  const slides = config.slides;
  const count = slides.length;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [model, dispatch] = useReducer(
    autoplayReducer,
    { slides: count, autoRotate: config.auto_rotate !== false, reducedMotion },
    initialAutoplay
  );
  const [active, setActive] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Scrolls the code started itself; a scroll outside this window is the learner's.
  const programmaticUntil = useRef(0);
  const touching = useRef(false);

  const multi = count > 1;
  const playing = multi && model.state === "PLAYING" && !reducedMotion;
  const userPaused = model.state === "PAUSED_USER" || reducedMotion;

  const hold = useCallback((reason: HoldReason) => dispatch({ type: "HOLD", reason }), []);
  const release = useCallback((reason: HoldReason) => dispatch({ type: "RELEASE", reason }), []);

  const isRtl = () => {
    const el = trackRef.current;
    return !!el && getComputedStyle(el).direction === "rtl";
  };

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const width = track.clientWidth;
      programmaticUntil.current = Date.now() + 900;
      const left = (isRtl() ? -1 : 1) * index * width;
      if (typeof track.scrollTo === "function") {
        track.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
      } else {
        track.scrollLeft = left;
      }
      setActive(index);
    },
    [reducedMotion]
  );

  // The active slide follows the scroll position (swipe, trackpad, keyboard).
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !multi || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const index = slideRefs.current.indexOf(entry.target as HTMLDivElement);
            if (index >= 0) setActive(index);
          }
        }
      },
      { root: track, threshold: [0.6] }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [multi, count]);

  // Off screen = held still (and slide views are not counted).
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = !!entry && entry.isIntersecting && entry.intersectionRatio >= 0.5;
        setOnScreen(visible);
        if (visible) release("offscreen");
        else hold("offscreen");
      },
      { threshold: [0, 0.5] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hold, release]);

  // A hidden tab holds it still.
  useEffect(() => {
    const onVisibility = () => (document.hidden ? hold("hidden") : release("hidden"));
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [hold, release]);

  // Rotation.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => goTo(nextIndex(activeRef.current, count)), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [playing, count, goTo]);

  // A slide counts as viewed after a second as the active, visible slide.
  const activeSlide = slides[active];
  useEffect(() => {
    if (!onScreen || !activeSlide || preview) return;
    const timer = window.setTimeout(() => analytics.view(blockKey, activeSlide.key), VIEW_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [onScreen, activeSlide, analytics, blockKey, preview]);

  const takeControl = () => dispatch({ type: "USER_CONTROL" });

  const onTrackScroll = () => {
    // A scroll the code did not start, while a finger is down, is a swipe.
    if (Date.now() > programmaticUntil.current && touching.current) takeControl();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!multi) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    takeControl();
    const forward = (e.key === "ArrowRight") !== isRtl();
    goTo(forward ? nextIndex(active, count) : prevIndex(active, count));
  };

  // A linked slide always has a name, also when its image is decorative (empty alt).
  const slideLinkLabel = (slide: BannerSlide, index: number) =>
    altOf(slide.image) || altOf(slide.desktop_image) || t("carousel.openSlide", { n: index + 1, count });

  const hrefFor = (slide: BannerSlide) => {
    const nav = slide.link ? toNavigation(slide.link, linkContext) : null;
    return nav ? navigationHref(nav) : undefined;
  };

  const title = (config.title ?? "").trim();
  const desktopRatio = placement !== "RAIL";

  return (
    <section
      ref={sectionRef}
      aria-roledescription={t("carousel.roleCarousel")}
      aria-label={title || t("carousel.label")}
      className="group/carousel relative"
      onMouseEnter={() => hold("hover")}
      onMouseLeave={() => release("hover")}
      onFocus={() => hold("focus")}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release("focus");
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") {
          touching.current = true;
          hold("touch");
        }
      }}
      onPointerUp={() => {
        touching.current = false;
        release("touch");
      }}
      onPointerCancel={() => {
        touching.current = false;
        release("touch");
      }}
    >
      {title ? <h2 className="sr-only">{title}</h2> : null}

      {/* The slide area: the pause button and the arrows sit on the image, not on the dots row. */}
      <div className="relative">
        {/* The pause/play control comes first in the tab order (WAI carousel pattern). */}
        {multi && (
          <button
            type="button"
            onClick={() => dispatch(userPaused ? { type: "PLAY" } : { type: "USER_CONTROL" })}
            aria-label={userPaused ? t("carousel.play") : t("carousel.pause")}
            className={cn(
              "absolute bottom-2 end-2 z-20 flex size-11 items-center justify-center rounded-full",
              "bg-black/60 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/75",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/60",
              reducedMotion && "hidden"
            )}
          >
            {userPaused ? <Play size={18} weight="fill" aria-hidden /> : <Pause size={18} weight="fill" aria-hidden />}
          </button>
        )}

        <div
          ref={trackRef}
          tabIndex={multi ? 0 : undefined}
          onKeyDown={onKeyDown}
          onScroll={onTrackScroll}
          onWheel={(e) => {
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) takeControl();
          }}
          aria-live={playing ? "off" : "polite"}
          className={cn(
            "flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
            "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card"
          )}
        >
          {slides.map((slide, index) => (
            <div
              key={slide.key}
              ref={(el) => {
                slideRefs.current[index] = el;
              }}
              role="group"
              aria-roledescription={t("carousel.roleSlide")}
              aria-label={t("carousel.slideOf", { n: index + 1, count })}
              // Slides off screen are out of the tab order and the accessibility
              // tree. (React 19 renders `inert`; the installed types predate it.)
              {...((multi && index !== active ? { inert: true } : {}) as Record<string, unknown>)}
              className="w-full shrink-0 snap-start snap-always"
            >
              <SlideBody
                slide={slide}
                index={index}
                linkLabel={slideLinkLabel(slide, index)}
                desktopRatio={desktopRatio}
                onOpen={() => {
                  if (slide.link) openLink(slide.link, blockKey, slide.key);
                }}
                href={hrefFor(slide)}
              />
            </div>
          ))}
        </div>

        {multi && (
          <>
            <button
              type="button"
              aria-label={t("carousel.previous")}
              onClick={() => {
                takeControl();
                goTo(prevIndex(active, count));
              }}
              className={cn(
                "absolute start-2 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full",
                "bg-card/90 text-foreground shadow-md transition-opacity lg:flex",
                "opacity-0 group-hover/carousel:opacity-100 group-focus-within/carousel:opacity-100 focus-visible:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              )}
            >
              <CaretLeft size={18} weight="bold" aria-hidden className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              aria-label={t("carousel.next")}
              onClick={() => {
                takeControl();
                goTo(nextIndex(active, count));
              }}
              className={cn(
                "absolute end-2 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full",
                "bg-card/90 text-foreground shadow-md transition-opacity lg:flex",
                "opacity-0 group-hover/carousel:opacity-100 group-focus-within/carousel:opacity-100 focus-visible:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              )}
            >
              <CaretRight size={18} weight="bold" aria-hidden className="rtl:rotate-180" />
            </button>

          </>
        )}
      </div>
      {multi && (
        <div className="mt-1 flex justify-center" role="group" aria-label={t("carousel.chooseSlide")}>
          {slides.map((slide, index) => (
            <button
              key={slide.key}
              type="button"
              aria-label={t("carousel.showSlide", { n: index + 1, count })}
              aria-current={index === active ? "true" : undefined}
              onClick={() => {
                takeControl();
                goTo(index);
              }}
              className="group/dot flex size-6 items-center justify-center rounded-full mx-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span
                aria-hidden
                className={cn(
                  "block h-2 rounded-full transition-all",
                  index === active ? "w-5 bg-primary-500" : "w-2 bg-neutral-300 group-hover/dot:bg-neutral-400"
                )}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SlideBody({
  slide,
  index,
  linkLabel,
  desktopRatio,
  onOpen,
  href,
}: {
  slide: BannerSlide;
  index: number;
  linkLabel: string;
  desktopRatio: boolean;
  onOpen: () => void;
  href?: string;
}) {
  const hasDesktop = desktopRatio && !!slide.desktop_image?.url;
  const image = (
    <picture>
      {hasDesktop && slide.desktop_image && (
        <source
          media="(min-width: 1024px)"
          srcSet={srcSetOf(slide.desktop_image) || slide.desktop_image.url}
          sizes="66vw"
        />
      )}
      <img
        src={slide.image.url}
        srcSet={srcSetOf(slide.image) || undefined}
        sizes="(max-width: 1023px) 100vw, 66vw"
        alt={altOf(hasDesktop ? (slide.desktop_image ?? slide.image) : slide.image)}
        loading={index === 0 ? "eager" : "lazy"}
        fetchPriority={index === 0 ? "high" : undefined}
        decoding="async"
        draggable={false}
        className="block size-full object-cover"
      />
    </picture>
  );
  const box = cn(
    "block w-full overflow-hidden bg-muted",
    "aspect-[2/1]",
    hasDesktop ? "lg:aspect-[4/1]" : desktopRatio && "lg:max-h-reg-280"
  );
  if (!slide.link) return <div className={box}>{image}</div>;
  return (
    <a
      href={href || undefined}
      aria-label={linkLabel}
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
      className={cn(box, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500")}
    >
      {image}
    </a>
  );
}

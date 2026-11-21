import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CaretLeft,
  CaretRight,
  CornersIn,
  CornersOut,
  Spinner,
  WarningCircle,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";

/**
 * DeckPlayer — plays a .pptx converted to build-step snapshot images
 * (ai_service render_worker /pptx-anim-jobs). Each original slide is a group of
 * ordered step images; advancing WITHIN a slide cross-fades (so an entrance
 * animation replays as a real fade), while moving to a new slide is a hard cut.
 *
 * `baseUrl` is the deck prefix (e.g. "https://cdn/decks/123/"); the manifest is
 * fetched from `<baseUrl>manifest.json` and image paths in it are relative.
 */
/** An animated GIF re-overlaid on the snapshot; rect is a fraction of the slide. */
interface DeckOverlay {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DeckManifest {
  slides: string[][];
  steps_per_slide?: number[];
  /** Real slide size (EMU). Older decks omit it — default 16:9. */
  aspect?: { w: number; h: number };
  /** [slide][step][] — GIFs visible at that build step. Older decks omit it. */
  overlays?: DeckOverlay[][][];
}

interface FlatStep {
  url: string;
  slideIndex: number;
  isSlideStart: boolean;
  overlays: DeckOverlay[];
}

interface DeckPlayerProps {
  baseUrl: string;
}

export default function DeckPlayer({ baseUrl }: DeckPlayerProps) {
  const { t } = useTranslation("libraryCommonA");
  const [steps, setSteps] = useState<FlatStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [aspect, setAspect] = useState(16 / 9);
  // Rect of the letterboxed snapshot inside the stage. GIF overlays are fractions
  // of the SLIDE, so they must be placed against the contained image box — not the
  // stage — or they drift whenever the stage isn't exactly the slide's ratio.
  const [fit, setFit] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  // Load + flatten the manifest into an ordered list of build-step images.
  useEffect(() => {
    let cancelled = false;
    setSteps(null);
    setError(null);
    setIndex(0);

    fetch(`${base}manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json();
      })
      .then((m: DeckManifest) => {
        if (cancelled) return;
        if (m.aspect?.w && m.aspect?.h) setAspect(m.aspect.w / m.aspect.h);
        const flat: FlatStep[] = [];
        (m.slides || []).forEach((group, si) => {
          group.forEach((path, gi) => {
            flat.push({
              url: base + path,
              slideIndex: si,
              isSlideStart: gi === 0,
              overlays: (m.overlays?.[si]?.[gi] || []).map((o) => ({
                ...o,
                url: base + o.url,
              })),
            });
          });
        });
        if (!flat.length) {
          setError(t("deckPlayer.noSlides"));
          return;
        }
        setSteps(flat);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(t("deckPlayer.loadFailed"));
        console.error("[DeckPlayer] manifest load failed", e);
      });

    return () => {
      cancelled = true;
    };
  }, [base]);

  const total = steps?.length ?? 0;
  const current = steps?.[index];
  const prev = index > 0 ? steps?.[index - 1] : undefined;
  // Cross-fade only when revealing the next build step of the SAME slide.
  const fade =
    !!current &&
    !current.isSlideStart &&
    !!prev &&
    prev.slideIndex === current.slideIndex;

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + delta))),
    [total]
  );

  // Reveal the controls, then auto-hide them after a short idle.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);
  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [revealControls, index]);

  // Arrow/space navigation — only while presenting (fullscreen), so it never
  // hijacks the keys during normal browsing of the chapter.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, go]);

  useEffect(() => {
    const onFs = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Track where object-contain actually lands the snapshot inside the stage, so
  // GIF overlays sit exactly on top of their baked-in first frame at any size.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const h = Math.min(ch, cw / aspect);
      const w = h * aspect;
      setFit({ l: (cw - w) / 2, t: (ch - h) / 2, w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, steps]);

  // Preload neighbouring step images so the cross-fade is instant.
  useEffect(() => {
    if (!steps) return;
    [index + 1, index + 2, index - 1].forEach((i) => {
      const step = steps[i];
      if (step) {
        const img = new Image();
        img.src = step.url;
      }
    });
  }, [index, steps]);

  const toggleFullscreen = useCallback(() => {
    // Both APIs return a Promise that rejects (with a TypeError) when the browser
    // refuses the request — e.g. fullscreen blocked by Permissions Policy in an
    // embedded/iframe context, or without a qualifying user gesture. A denied
    // fullscreen is benign here, so swallow the rejection instead of letting it
    // bubble up as an unhandled promise rejection (surfaced to Sentry).
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  if (error) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg bg-neutral-900 text-neutral-300">
        <WarningCircle size={32} className="text-danger-500" />
        <p className="text-body">{error}</p>
      </div>
    );
  }

  if (!steps) {
    return (
      <div className="flex size-full items-center justify-center rounded-lg bg-neutral-900 text-neutral-400">
        <Spinner size={28} className="animate-spin" />
      </div>
    );
  }

  const slideCount = (steps[steps.length - 1]?.slideIndex ?? 0) + 1;
  const currentSlideNo = current ? current.slideIndex + 1 : 0;
  const atStart = index === 0;
  const atEnd = index >= total - 1;
  // Width tracks position through the deck — a genuinely dynamic value, so it
  // rides an inline style (kept out of the className per the design system).
  const progressStyle = { width: `${total > 1 ? (index / (total - 1)) * 100 : 100}%` };

  return (
    <div
      ref={containerRef}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      className={cn(
        "relative flex size-full items-center justify-center overflow-hidden rounded-lg bg-neutral-900",
        isFullscreen && "fixed inset-0 z-50 rounded-none"
      )}
    >
      <div ref={stageRef} className="relative size-full">
        {fade && prev && (
          <img
            src={prev.url}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-contain"
          />
        )}
        {current && (
          <img
            key={index}
            src={current.url}
            alt={t("deckPlayer.slideAlt", { number: currentSlideNo })}
            className={cn(
              "absolute inset-0 size-full object-contain",
              fade && "animate-in fade-in duration-300"
            )}
          />
        )}
        {/* Animated GIFs: LibreOffice can only bake their first frame into the
            snapshot, so play the real .gif on top of that frame. */}
        {fit &&
          current?.overlays.map((o, i) => (
            <img
              key={`${index}-${i}`}
              src={o.url}
              alt=""
              aria-hidden
              className="pointer-events-none absolute"
              style={{
                left: fit.l + o.x * fit.w,
                top: fit.t + o.y * fit.h,
                width: o.w * fit.w,
                height: o.h * fit.h,
              }}
            />
          ))}
      </div>

      {/* Deck progress */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-neutral-50/15">
        <div className="h-full bg-primary-500 transition-all duration-300" style={progressStyle} />
      </div>

      {/* Floating control pill — auto-hides on idle, reappears on mouse move */}
      <div
        onMouseEnter={revealControls}
        className={cn(
          "absolute bottom-4 start-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900/70 px-2 py-1 shadow-lg backdrop-blur-sm transition-opacity duration-300",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <MyButton
          layoutVariant="icon"
          scale="medium"
          buttonType="text"
          className="rounded-full hover:bg-neutral-50/10"
          onClick={() => go(-1)}
          disable={atStart}
          aria-label={t("deckPlayer.previous")}
        >
          <CaretLeft size={18} className={atStart ? "text-neutral-50/30" : "text-neutral-50"} />
        </MyButton>
        <span className="w-16 text-center text-caption font-semibold tabular-nums text-neutral-50">
          {currentSlideNo} / {slideCount}
        </span>
        <MyButton
          layoutVariant="icon"
          scale="medium"
          buttonType="text"
          className="rounded-full hover:bg-neutral-50/10"
          onClick={() => go(1)}
          disable={atEnd}
          aria-label={t("deckPlayer.next")}
        >
          <CaretRight size={18} className={atEnd ? "text-neutral-50/30" : "text-neutral-50"} />
        </MyButton>
        <span className="mx-1 h-5 w-px bg-neutral-50/25" aria-hidden />
        <MyButton
          layoutVariant="icon"
          scale="medium"
          buttonType="text"
          className="rounded-full hover:bg-neutral-50/10"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? t("videoPlayer.exitFullScreen") : t("deckPlayer.playFullScreen")}
        >
          {isFullscreen ? (
            <CornersIn size={18} className="text-neutral-50" />
          ) : (
            <CornersOut size={18} className="text-neutral-50" />
          )}
        </MyButton>
      </div>
    </div>
  );
}

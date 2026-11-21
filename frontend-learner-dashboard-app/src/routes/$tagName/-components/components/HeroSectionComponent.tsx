import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { useTranslation } from "react-i18next";
import { CaretLeft, CaretRight, Clock, ChalkboardTeacher, Star } from "@phosphor-icons/react";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import {
  isYouTubeUrl,
  isVimeoUrl,
  convertToYouTubeEmbedUrl,
  convertToVimeoEmbedUrl,
  isValidVideoUrl,
} from "../../-utils/video-url";
import { cn } from "@/lib/utils";
import { isHexDark } from "../../-utils/catalogue-style-engine";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { HeroEditorial } from "./HeroEditorial";
import type { BreadcrumbItem } from "./catalog/Breadcrumb";

interface HeroSectionProps {
  layout: "split" | "centered";
  /**
   * "editorial" (opt-in): breadcrumb, ruled eyebrow, two-tone title, check
   * bullets, unframed media in the site's content column (HeroEditorial).
   * Absent / "default": the hero below, unchanged.
   */
  variant?: "default" | "editorial";
  /** Editorial only: "Home / Learning Paths" trail (last item = current page). */
  breadcrumb?: BreadcrumbItem[];
  /** Editorial only: media column width in px (default 500). */
  mediaWidth?: number;
  /** Editorial only: border of the outline button (hex). */
  outlineColor?: string;
  backgroundImage?: string;
  backgroundColor?: string;
  /** Small accent label above the title (e.g. "COHORT 4 · STARTS JULY"). */
  eyebrow?: {
    text: string;
    style?: "badge" | "plain";
  };
  /** Stat chip row under the CTAs (e.g. 20,000+ / Engineers taught). */
  statChips?: Array<{ value: string; label: string }>;
  /** Avatar-stack trust chip (avatars optional; rating 1–5 optional). */
  trust?: {
    avatars?: string[];
    rating?: number;
    text?: string;
  };
  left?: {
    title?: string;
    /** Editorial only: second title line in the accent colour. */
    titleAccent?: string;
    /** Editorial only: check bullets under the lead. */
    checklist?: string[];
    description?: string;
    button?: {
      text: string;
      action: string;
      target: string;
      enabled?: boolean;
      backgroundColor?: string;
    };
    /** Multi-CTA row; when present it supersedes the single `button`. */
    buttons?: Array<{
      text: string;
      action?: string;
      target?: string;
      variant?: "primary" | "secondary";
    }>;
  };
  right?: {
    image?: string;
    alt?: string;
    /** Video for the hero media slot. Accepts a YouTube or Vimeo link (any of
     *  the usual shapes — watch?v=, youtu.be, /embed/), a direct file URL, or
     *  a media_service fileId for an uploaded video. When set and valid it
     *  takes precedence over `image`/`images`. */
    video?: string;
    /** Poster frame for an uploaded video (fileId or URL). Ignored for
     *  YouTube/Vimeo, which supply their own thumbnail. */
    videoPoster?: string;
    /** Optional extra images. When 2+ are provided, the hero media area
     *  renders an auto-advancing carousel instead of a single image.
     *  (1 image → single image; 0 → nothing.) Backward compatible: if this
     *  is empty the single `image` above is used. */
    images?: Array<{ image?: string; alt?: string }>;
  };
  styles?: {
    padding?: string;
    backgroundColor?: string;
    roundedEdges?: boolean;
    textAlign?: "left" | "center" | "right";
  };
  courseData?: {
    title?: string;
    description?: string | null;
    previewImage?: string;
    bannerImage?: string;
    duration?: string;
    instructor?: string;
    tags?: string[];
  };
}

// Small pill row rendered above the hero title. Kept as a local helper so
// both the placeholder and image-backed hero variants style tags identically.
const HeroTags: React.FC<{ tags?: string[]; textAlign: "left" | "center" | "right" }> = ({
  tags,
  textAlign,
}) => {
  if (!tags || tags.length === 0) return null;
  const justify =
    textAlign === "center"
      ? "justify-center"
      : textAlign === "right"
      ? "justify-end"
      : "justify-start";
  return (
    <div className={`flex flex-wrap gap-2 ${justify}`}>
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center rounded-full bg-primary-50 border border-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-500"
        >
          {tag}
        </span>
      ))}
    </div>
  );
};

// Hero description with a built-in "View more / View less" toggle. The
// description can be long HTML; we clamp at 4 lines by default and only
// surface the toggle once the content is tall enough to actually be cut off
// (measured via scrollHeight vs clientHeight). Used by both the placeholder
// and state-backed hero variants so behavior stays consistent.
const HeroDescription: React.FC<{ html: string }> = ({ html }) => {
  const { t } = useTranslation("coursePlayerB");
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [html, expanded]);

  if (!html) return null;
  return (
    <div>
      <div
        ref={ref}
        className={`text-lg sm:text-xl text-catalogue-text-secondary leading-relaxed ${
          expanded ? "" : "line-clamp-4"
        }`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-semibold text-primary-500 hover:underline focus:outline-none"
        >
          {expanded ? t("common.viewLess") : t("common.viewMore")}
        </button>
      )}
    </div>
  );
};

// Small "meta" row: duration + instructor. Renders only when at least one value
// is present. Keeps styling light so it doesn't compete with the title.
const HeroMeta: React.FC<{ duration?: string; instructor?: string }> = ({
  duration,
  instructor,
}) => {
  if (!duration && !instructor) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-subtitle text-muted-foreground">
      {duration && (
        <span className="flex items-center gap-1.5">
          <Clock size={16} weight="regular" className="shrink-0 text-primary-400" />
          {duration}
        </span>
      )}
      {instructor && (
        <span className="flex items-center gap-1.5">
          <ChalkboardTeacher size={16} weight="regular" className="shrink-0 text-primary-400" />
          {instructor}
        </span>
      )}
    </div>
  );
};

// Eyebrow — accent label above the title. "badge" = pill with live dot.
const HeroEyebrow: React.FC<{
  eyebrow?: HeroSectionProps["eyebrow"];
  textAlign: "left" | "center" | "right";
}> = ({ eyebrow, textAlign }) => {
  if (!eyebrow?.text) return null;
  const justify =
    textAlign === "center" ? "justify-center" : textAlign === "right" ? "justify-end" : "justify-start";
  if (eyebrow.style === "plain") {
    return (
      <div className={`flex ${justify}`}>
        <span className="catalogue-eyebrow">{eyebrow.text}</span>
      </div>
    );
  }
  return (
    <div className={`flex ${justify}`}>
      <span className="inline-flex items-center gap-2 rounded-full border border-catalogue-border bg-catalogue-bg-subtle px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-catalogue-text-secondary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary-500" aria-hidden="true" />
        {eyebrow.text}
      </span>
    </div>
  );
};

// Multi-CTA row. Falls back to nothing — callers keep the legacy single
// button path when `buttons` is absent.
const HeroButtons: React.FC<{
  buttons?: NonNullable<HeroSectionProps["left"]>["buttons"];
  textAlign: "left" | "center" | "right";
  onAction: (b: { action?: string; target?: string }) => void;
}> = ({ buttons, textAlign, onAction }) => {
  const visible = (buttons || []).filter((b) => b.text?.trim());
  if (!visible.length) return null;
  const justify =
    textAlign === "center" ? "justify-center" : textAlign === "right" ? "justify-end" : "justify-start";
  return (
    <div className={`flex flex-wrap items-center gap-3 pt-2 ${justify}`}>
      {visible.slice(0, 3).map((b, i) => (
        <button
          key={`${b.text}-${i}`}
          type="button"
          onClick={() => onAction(b)}
          className={
            (b.variant ?? (i === 0 ? "primary" : "secondary")) === "primary"
              ? "catalogue-btn catalogue-btn-primary catalogue-btn-lg shadow-md"
              : "catalogue-btn catalogue-btn-secondary catalogue-btn-lg"
          }
        >
          {b.text}
        </button>
      ))}
    </div>
  );
};

// Stat chip row (value + label pairs) under the CTAs.
const HeroStatChips: React.FC<{
  chips?: HeroSectionProps["statChips"];
  textAlign: "left" | "center" | "right";
}> = ({ chips, textAlign }) => {
  const visibleChips = (chips || []).filter((c) => c.value?.trim() || c.label?.trim());
  if (!visibleChips.length) return null;
  const justify =
    textAlign === "center" ? "justify-center" : textAlign === "right" ? "justify-end" : "justify-start";
  return (
    <div className={`flex flex-wrap gap-3 pt-3 ${justify}`}>
      {visibleChips.slice(0, 4).map((c, i) => (
        <div
          key={`${c.label}-${i}`}
          className="rounded-catalogue-lg border border-catalogue-border-subtle bg-catalogue-bg px-4 py-2.5 text-center shadow-sm"
        >
          <div className="text-lg font-bold leading-tight text-catalogue-text-primary">{c.value}</div>
          <div className="text-xs text-catalogue-text-secondary">{c.label}</div>
        </div>
      ))}
    </div>
  );
};

// Avatar-stack trust chip (avatars + star rating + text), all parts optional.
const HeroTrust: React.FC<{
  trust?: HeroSectionProps["trust"];
  textAlign: "left" | "center" | "right";
}> = ({ trust, textAlign }) => {
  if (!trust || (!trust.text && !trust.rating && !trust.avatars?.length)) return null;
  const justify =
    textAlign === "center" ? "justify-center" : textAlign === "right" ? "justify-end" : "justify-start";
  const rating = trust.rating ? Math.max(0, Math.min(5, trust.rating)) : 0;
  return (
    <div className={`flex ${justify} pt-3`}>
      <div className="inline-flex items-center gap-3 rounded-full border border-catalogue-border-subtle bg-catalogue-bg-subtle py-1.5 ps-2 pe-4">
        {!!trust.avatars?.length && (
          <div className="flex -space-x-2">
            {trust.avatars.slice(0, 4).map((src, i) => (
              <img
                key={`${src}-${i}`}
                src={src}
                alt=""
                aria-hidden="true"
                className="h-7 w-7 rounded-full border-2 border-catalogue-bg object-cover"
              />
            ))}
          </div>
        )}
        {rating > 0 && (
          <span className="flex items-center gap-1 text-sm font-semibold text-catalogue-text-primary">
            <Star size={14} weight="fill" className="text-warning-500" aria-hidden="true" />
            {rating.toFixed(1)}
          </span>
        )}
        {trust.text && <span className="text-sm text-catalogue-text-secondary">{trust.text}</span>}
      </div>
    </div>
  );
};

// True when the multi-CTA row has at least one non-blank button — a freshly
// added empty repeater row must NOT suppress the legacy single button.
const hasVisibleHeroButtons = (left?: HeroSectionProps["left"]) =>
  !!(left?.buttons || []).some((b) => b.text?.trim());

// Centralized enabled check - defaults to false if not provided
const isHeroButtonEnabled = (button?: { enabled?: boolean | string | number }) => {
  if (!button) return false;
  const { enabled } = button;
  if (enabled === undefined || enabled === null) return false;
  if (typeof enabled === "string") return enabled.toLowerCase() === "true";
  if (typeof enabled === "number") return enabled !== 0;
  return enabled === true;
};

// Check if image URL is a placeholder or invalid
const isPlaceholderImage = (imageUrl?: string | null): boolean => {
  if (!imageUrl) return true;
  const trimmed = imageUrl.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return true;
  if (trimmed.includes('/api/placeholder/')) return true;
  // Starter-template defaults ("/assets/hero-bg.jpg", "/assets/logo.png", …).
  // Every catalogue seeded from the default template ships these, but nothing is
  // served under /assets/ in this app — they 404. Treating them as unset stops an
  // image that can never load from suppressing the authored background color.
  if (trimmed.startsWith('/assets/')) return true;
  if (['course_banner_media_id', 'course_preview_image_media_id', 'thumbnail_file_id'].includes(trimmed)) return true;
  // Raw media ID check (contains underscores, no http/https, no slashes)
  if (trimmed.includes('_') && !trimmed.includes('http') && !trimmed.includes('/')) return true;
  return false;
};

// JSON templates sometimes ship raw field-name tokens (e.g. "about_the_course_html")
// as placeholder text that should be swapped out with backend content. When the
// backend value is missing we must not render the raw token to the user.
const PLACEHOLDER_TEXT_TOKENS = new Set([
  "about_the_course",
  "about_the_course_html",
  "course_html_description",
  "course_html_description_html",
  "who_should_learn",
  "why_learn",
  "package_name",
  "course_name",
  "course_title",
  "title",
  "description",
]);

const sanitizePlaceholderText = (text?: string | null): string => {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (PLACEHOLDER_TEXT_TOKENS.has(trimmed)) return "";
  // Catch untagged snake_case / SCREAMING_SNAKE_CASE tokens that look like
  // raw field identifiers (e.g. "SOME_HTML_FIELD") with no spaces and underscores.
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(trimmed) && !/\s/.test(trimmed)) {
    return "";
  }
  return trimmed;
};

export const HeroSectionComponent: React.FC<HeroSectionProps> = (props) =>
  props.variant === "editorial" ? <HeroEditorial {...props} /> : <HeroSectionDefault {...props} />;

const HeroSectionDefault: React.FC<HeroSectionProps> = ({
  layout,
  backgroundImage,
  backgroundColor,
  eyebrow,
  statChips,
  trust,
  left,
  right,
  styles = {},
  courseData,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const { roundedEdges = false, textAlign = "left" } = styles;

  return useMemo(() => {
    const sanitizedCourseTitle = sanitizePlaceholderText(courseData?.title);
    const sanitizedLeftTitle = sanitizePlaceholderText(left?.title);
    const heroTitle = sanitizedCourseTitle || sanitizedLeftTitle || "";

    const sanitizedCourseDescription = sanitizePlaceholderText(courseData?.description ?? undefined);
    const sanitizedLeftDescription = sanitizePlaceholderText(left?.description);
    const heroDescription = sanitizedCourseDescription || sanitizedLeftDescription || "";

    const heroImage = courseData?.previewImage || courseData?.bannerImage || right?.image || "";
    const heroImageAlt =
      right?.alt ||
      sanitizedCourseTitle ||
      t("heroSection.defaultAlt", {
        course: getTerminology(ContentTerms.Course, SystemTerms.Course),
      });
    const isHeroImagePlaceholder = isPlaceholderImage(heroImage);
    const isBackgroundImagePlaceholder = isPlaceholderImage(backgroundImage);
    // Carousel images can carry the hero media even when no single image is set.
    const hasCarouselImages = (right?.images || []).some(
      (im) => im?.image && !isPlaceholderImage(im.image),
    );

    const commonProps = {
      layout,
      left,
      right,
      courseData,
      heroTitle,
      heroDescription,
      heroImageAlt,
      roundedEdges,
      textAlign,
      backgroundColor,
      eyebrow,
      statChips,
      trust,
    };

    if (isHeroImagePlaceholder && !hasCarouselImages) {
      return <HeroSectionPlaceholder {...commonProps} />;
    }

    return (
      <HeroSectionWithState 
        {...commonProps}
        heroImage={heroImage}
        heroBackgroundImage={backgroundImage}
        isHeroImagePlaceholder={isHeroImagePlaceholder}
        isBackgroundImagePlaceholder={isBackgroundImagePlaceholder}
      />
    );
  }, [layout, backgroundImage, left, right, courseData, roundedEdges, textAlign, eyebrow, statChips, trust, t]);
};

// Placeholder component - no state management
const HeroSectionPlaceholder: React.FC<{
  layout: "split" | "centered";
  left?: HeroSectionProps['left'];
  heroTitle: string;
  heroDescription: string;
  heroImageAlt: string;
  roundedEdges: boolean;
  textAlign: "left" | "center" | "right";
  right?: HeroSectionProps['right'];
  courseData?: HeroSectionProps['courseData'];
  backgroundColor?: string;
  eyebrow?: HeroSectionProps['eyebrow'];
  statChips?: HeroSectionProps['statChips'];
  trust?: HeroSectionProps['trust'];
}> = ({
  layout,
  left,
  courseData,
  eyebrow,
  statChips,
  trust,
  heroTitle,
  heroDescription,
  roundedEdges,
  textAlign,
  backgroundColor,
}) => {
  const siteNavigate = useSiteNavigate();

  const handleButtonClick = (button: { action?: string; target?: string; audienceId?: string; text?: string }) => {
    if (button.action === "navigate" && button.target) {
      // A bare "#anchor" target is an in-page jump, not a route. navigate()
      // pushes it as a PATH, so the URL gains the hash and the visitor stays
      // exactly where they were — which is what made the hero's "Explore our
      // courses" button appear to do nothing. Scroll it ourselves, the same
      // way CatalogueLink handles a pure anchor. Fall through to navigate()
      // when the element is absent, so a real route still routes.
      const target = button.target.trim();
      if (target.startsWith("#")) {
        const el = document.getElementById(target.slice(1));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      void siteNavigate(target);
    } else if (button.action === "openForm" && (button.audienceId || '').trim()) {
      // Campaign-bound popup: opens the audience list's form (AudienceFormModal).
      window.dispatchEvent(new CustomEvent('openAudienceForm', {
        detail: { audienceId: (button.audienceId || '').trim(), title: button.text },
      }));
    } else if (button.action === "openLeadCollection") {
      window.dispatchEvent(new CustomEvent('openLeadCollection', { detail: { source: 'heroSection' } }));
    }
  };

  return (
    <section
      // A dark author colour flips the band's tokens to light ink (`dark`):
      // the title/description are painted with token classes that no
      // props.textColor can override, so without this a navy hero renders
      // its headline navy-on-navy.
      className={cn("catalogue-hero-surface w-full pt-8 pb-10 md:pt-12 md:pb-14 overflow-hidden", roundedEdges && "rounded-catalogue-lg", isHexDark(backgroundColor) && "dark")}
      // Author-painted color must beat the token hero surface: the class's
      // opaque gradient stack would otherwise cover the inline color.
      style={{ textAlign, backgroundColor: backgroundColor || undefined, ...(backgroundColor ? { backgroundImage: 'none' } : {}) }} // design-lint-ignore: page-builder background color
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {layout === "split" ? (
          /* No media in placeholder — span content full width, centered for balance */
          <div className="mx-auto max-w-3xl space-y-4">
            {(left || courseData) && (
              <>
                <HeroEyebrow eyebrow={eyebrow} textAlign={textAlign} />
                <HeroTags tags={courseData?.tags} textAlign={textAlign} />
                {heroTitle && (
                  <h1 className="catalogue-h1 text-foreground">
                    {heroTitle}
                  </h1>
                )}
                <HeroMeta duration={courseData?.duration} instructor={courseData?.instructor} />
                <HeroDescription html={heroDescription} />
                {hasVisibleHeroButtons(left) ? (
                  <HeroButtons buttons={left.buttons} textAlign={textAlign} onAction={handleButtonClick} />
                ) : (
                  isHeroButtonEnabled(left?.button) && left?.button && (
                    <button
                      onClick={() => handleButtonClick(left.button!)}
                      className="mt-2 px-8 py-3 rounded-catalogue-md text-base font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md"
                      style={{ backgroundColor: left.button.backgroundColor }} // design-lint-ignore: page-builder dynamic button color
                    >
                      {left.button.text}
                    </button>
                  )
                )}
                <HeroStatChips chips={statChips} textAlign={textAlign} />
                <HeroTrust trust={trust} textAlign={textAlign} />
              </>
            )}
          </div>
        ) : (
          /* Centered Layout */
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            {(left || courseData) && (
              <>
                <HeroEyebrow eyebrow={eyebrow} textAlign={textAlign} />
                <HeroTags tags={courseData?.tags} textAlign={textAlign} />
                {heroTitle && (
                  <h1 className="catalogue-h1 text-foreground">
                    {heroTitle}
                  </h1>
                )}
                <HeroMeta duration={courseData?.duration} instructor={courseData?.instructor} />
                <HeroDescription html={heroDescription} />
                {hasVisibleHeroButtons(left) ? (
                  <HeroButtons buttons={left.buttons} textAlign={textAlign} onAction={handleButtonClick} />
                ) : (
                  isHeroButtonEnabled(left?.button) && left?.button && (
                    <button
                      onClick={() => handleButtonClick(left.button!)}
                      className="mt-2 px-8 py-3 rounded-catalogue-md text-base font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md"
                      style={{ backgroundColor: left.button.backgroundColor }} // design-lint-ignore: page-builder dynamic button color
                    >
                      {left.button.text}
                    </button>
                  )
                )}
                <HeroStatChips chips={statChips} textAlign={textAlign} />
                <HeroTrust trust={trust} textAlign={textAlign} />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

// Hero media — renders a single image, or an auto-advancing carousel when 2+
// images are configured. Resolves media IDs (non-http strings) to public URLs.
/**
 * Hero media slot rendered as a video. YouTube/Vimeo links become a 16:9
 * iframe; anything else (an uploaded fileId or a direct .mp4/.webm URL) is
 * resolved through media-service and played with native controls.
 */
const HeroVideo: React.FC<{ src: string; poster?: string; title?: string }> = ({
  src,
  poster,
  title,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [resolved, setResolved] = useState<string>("");
  const [resolvedPoster, setResolvedPoster] = useState<string>("");

  useEffect(() => {
    let active = true;
    // Same resolution rule as the image path: pass http(s) through, otherwise
    // treat the value as a media_service fileId.
    const resolveOne = async (value: string) => {
      if (!value || value.startsWith("http")) return value;
      try {
        return await getPublicUrlWithoutLogin(value);
      } catch {
        return value;
      }
    };
    resolveOne(src).then((u) => active && setResolved(u));
    if (poster) resolveOne(poster).then((u) => active && setResolvedPoster(u));
    return () => {
      active = false;
    };
  }, [src, poster]);

  if (!isValidVideoUrl(src)) return null;

  // Embeds keep the original (unresolved) value: a YouTube/Vimeo link is
  // already a URL and must not be sent through media-service.
  const embedUrl = isYouTubeUrl(src)
    ? convertToYouTubeEmbedUrl(src)
    : isVimeoUrl(src)
      ? convertToVimeoEmbedUrl(src)
      : null;

  return (
    <div className="relative w-full overflow-hidden rounded-catalogue-lg shadow-md">
      {embedUrl ? (
        <div className="relative w-full aspect-video">
          <iframe
            src={embedUrl}
            title={title || t("heroSection.defaultVideoTitle")}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            loading="lazy"
          />
        </div>
      ) : resolved ? (
        <video
          src={resolved}
          poster={resolvedPoster || undefined}
          controls
          playsInline
          preload="metadata"
          // Marketing video on a public page: strip the overflow menu's
          // Download / Picture-in-Picture / playback-speed entries, and block
          // the right-click "Save video as…" shortcut. Play/pause, seek and
          // volume stay.
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          className="h-auto max-h-96 w-full bg-black object-contain" // design-lint-ignore: video letterbox fill
        />
      ) : null}
    </div>
  );
};

const HeroCarousel: React.FC<{
  images: Array<{ src: string; alt: string }>;
}> = ({ images }) => {
  const { t } = useTranslation("coursePlayerB");
  const [resolved, setResolved] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const resolveOne = async (src: string) => {
      if (!src || src.includes("/api/placeholder/") || src.startsWith("http")) {
        return src;
      }
      try {
        return await getPublicUrlWithoutLogin(src);
      } catch {
        return src;
      }
    };
    Promise.all(images.map((i) => resolveOne(i.src))).then((urls) => {
      if (active) setResolved(urls);
    });
    return () => {
      active = false;
    };
  }, [images]);

  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (images.length <= 1 || reduceMotion) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % images.length),
      4500,
    );
    return () => clearInterval(id);
  }, [images.length, reduceMotion]);

  if (images.length === 0) return null;
  const srcs = images.map((img, i) => resolved[i] || img.src);

  if (images.length === 1) {
    return (
      <img
        src={srcs[0]}
        alt={images[0].alt}
        className="h-auto max-h-96 w-full rounded-catalogue-lg object-contain shadow-md"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return (
    <div className="group relative w-full overflow-hidden rounded-catalogue-lg shadow-md">
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }} // design-lint-ignore: dynamic carousel offset
      >
        {srcs.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={images[i].alt}
            className="h-auto max-h-96 w-full shrink-0 object-contain"
          />
        ))}
      </div>

      {/* Dots */}
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={t("heroSection.goToSlide", { number: i + 1 })}
            className={cn(
              "h-2 rounded-full bg-white transition-all duration-300",
              i === index ? "w-5" : "w-2 bg-white/60 hover:bg-white/80",
            )}
          />
        ))}
      </div>

      {/* Arrows (appear on hover) */}
      <button
        type="button"
        onClick={() =>
          setIndex((i) => (i - 1 + images.length) % images.length)
        }
        aria-label={t("common.previousSlide")}
        className="absolute start-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-gray-700 opacity-0 shadow-sm transition hover:bg-white group-hover:opacity-100"
      >
        <CaretLeft size={16} weight="bold" />
      </button>
      <button
        type="button"
        onClick={() => setIndex((i) => (i + 1) % images.length)}
        aria-label={t("common.nextSlide")}
        className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-gray-700 opacity-0 shadow-sm transition hover:bg-white group-hover:opacity-100"
      >
        <CaretRight size={16} weight="bold" />
      </button>
    </div>
  );
};

// State management component - for valid images
const HeroSectionWithState: React.FC<{
  layout: "split" | "centered";
  eyebrow?: HeroSectionProps['eyebrow'];
  statChips?: HeroSectionProps['statChips'];
  trust?: HeroSectionProps['trust'];
  left?: HeroSectionProps['left'];
  right?: HeroSectionProps['right'];
  courseData?: HeroSectionProps['courseData'];
  heroImage: string;
  heroImageAlt: string;
  heroBackgroundImage?: string;
  isHeroImagePlaceholder: boolean;
  isBackgroundImagePlaceholder: boolean;
  roundedEdges: boolean;
  textAlign: "left" | "center" | "right";
  heroTitle: string;
  heroDescription: string;
  backgroundColor?: string;
}> = ({
  layout,
  left,
  right,
  courseData,
  heroImage,
  heroImageAlt,
  isHeroImagePlaceholder,
  isBackgroundImagePlaceholder,
  heroBackgroundImage,
  roundedEdges,
  textAlign,
  heroTitle,
  heroDescription,
  backgroundColor,
  eyebrow,
  statChips,
  trust,
}) => {
  const siteNavigate = useSiteNavigate();
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string>(heroImage);
  const [resolvedBgUrl, setResolvedBgUrl] = useState<string | null>(heroBackgroundImage || null);
  const [bgLoadFailed, setBgLoadFailed] = useState(false);

  // Resolve image URLs
  useEffect(() => {
    if (isHeroImagePlaceholder && isBackgroundImagePlaceholder) return;

    let isMounted = true;
    
    const resolveImageUrl = async (imageUrl: string) => {
      if (!imageUrl || imageUrl.includes('/api/placeholder/') || imageUrl.includes('http')) {
        return imageUrl;
      }
      try {
        const resolvedUrl = await getPublicUrlWithoutLogin(imageUrl);
        return resolvedUrl || imageUrl;
      } catch {
        return imageUrl;
      }
    };

    const loadImages = async () => {
      if (!isHeroImagePlaceholder) {
        const resolvedUrl = await resolveImageUrl(heroImage);
        if (isMounted) setResolvedImageUrl(resolvedUrl);
      }
      if (!isBackgroundImagePlaceholder && heroBackgroundImage) {
        const resolvedBg = await resolveImageUrl(heroBackgroundImage);
        if (isMounted) setResolvedBgUrl(resolvedBg);
      }
    };

    loadImages();
    return () => { isMounted = false; };
  }, [heroImage, heroBackgroundImage, isHeroImagePlaceholder, isBackgroundImagePlaceholder]);

  // A background image that fails to load must not swallow the authored color:
  // url() paints nothing when the request 404s, so the section drops back to the
  // token surface while the color has already been discarded — the author sees
  // neither. Probe the resolved url and treat a failure as "no background image"
  // so the color takes over.
  useEffect(() => {
    if (!resolvedBgUrl || isBackgroundImagePlaceholder) {
      setBgLoadFailed(false);
      return;
    }
    let cancelled = false;
    setBgLoadFailed(false);
    const probe = new Image();
    probe.onerror = () => {
      if (!cancelled) setBgLoadFailed(true);
    };
    probe.src = resolvedBgUrl;
    return () => { cancelled = true; };
  }, [resolvedBgUrl, isBackgroundImagePlaceholder]);

  const handleButtonClick = (button: { action?: string; target?: string; audienceId?: string; text?: string }) => {
    if (button.action === "navigate" && button.target) {
      // A bare "#anchor" target is an in-page jump, not a route. navigate()
      // pushes it as a PATH, so the URL gains the hash and the visitor stays
      // exactly where they were — which is what made the hero's "Explore our
      // courses" button appear to do nothing. Scroll it ourselves, the same
      // way CatalogueLink handles a pure anchor. Fall through to navigate()
      // when the element is absent, so a real route still routes.
      const target = button.target.trim();
      if (target.startsWith("#")) {
        const el = document.getElementById(target.slice(1));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      void siteNavigate(target);
    } else if (button.action === "openForm" && (button.audienceId || '').trim()) {
      // Campaign-bound popup: opens the audience list's form (AudienceFormModal).
      window.dispatchEvent(new CustomEvent('openAudienceForm', {
        detail: { audienceId: (button.audienceId || '').trim(), title: button.text },
      }));
    } else if (button.action === "openLeadCollection") {
      window.dispatchEvent(new CustomEvent('openLeadCollection', { detail: { source: 'heroSection' } }));
    }
  };

  const hasBgImage = !!(resolvedBgUrl && !isBackgroundImagePlaceholder && !bgLoadFailed);

  // Build the hero media list: explicit carousel images (2+ → carousel) or
  // fall back to the single resolved image. 0 → no media slot.
  const carouselImages = (right?.images || [])
    .map((im) => ({ src: im.image || "", alt: im.alt || heroImageAlt }))
    .filter((im) => im.src && !isPlaceholderImage(im.src));
  const heroMedia =
    carouselImages.length > 0
      ? carouselImages
      : heroImage && !isHeroImagePlaceholder
        ? [{ src: resolvedImageUrl || heroImage, alt: heroImageAlt }]
        : [];

  // A configured video wins the media slot over image/carousel.
  const heroVideo = right?.video && isValidVideoUrl(right.video) ? right.video : "";
  const hasHeroMedia = !!heroVideo || heroMedia.length > 0;

  // Course-details hero (gets courseData) uses the new wider 5/7 split + bigger
  // title + meta. The homepage / landing hero (no courseData) keeps the
  // original 50/50 split and title.
  const isCourseDetail = !!courseData;
  const titleClass = isCourseDetail
    ? "catalogue-h1 text-foreground"
    : "catalogue-h1 text-catalogue-text-primary";

  return (
    <section
      // Same dark-band flip as the placeholder variant; a background IMAGE
      // keeps the token ink, since its brightness is unknown.
      className={cn("catalogue-hero-surface w-full pt-8 pb-10 md:pt-12 md:pb-14 overflow-hidden", roundedEdges && "rounded-catalogue-lg", !hasBgImage && isHexDark(backgroundColor) && "dark")}
      style={{
        textAlign,
        backgroundColor: hasBgImage ? undefined : (backgroundColor || undefined), // design-lint-ignore: page-builder background color
        // Author color beats the token hero-surface gradient stack.
        ...(!hasBgImage && backgroundColor ? { backgroundImage: 'none' } : {}),
        ...(hasBgImage ? {
          backgroundImage: `url(${resolvedBgUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : {}),
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {layout === "split" ? (
          /* Course-details: 12-col grid (content 5 / banner 7). Homepage: 50/50.
             With NO media the split columns are dropped entirely: the right
             column is gated on hasHeroMedia, so a 2-col grid left the copy
             squeezed into half the fold with dead space beside it (live on
             book-store /homepage and /videos). Falling back to one column and a
             reading measure matches how the placeholder variant above handles
             the same case. */
          <div
            className={cn(
              "grid grid-cols-1 gap-8 lg:gap-12 items-center",
              hasHeroMedia && (isCourseDetail ? "lg:grid-cols-12" : "lg:grid-cols-2"),
            )}
          >
            {/* Left Content — 5/12 on desktop */}
            {(left || courseData) && (
              <div
                className={cn(
                  "space-y-4",
                  isCourseDetail && hasHeroMedia && "lg:col-span-5",
                  !hasHeroMedia && "mx-auto w-full max-w-3xl",
                )}
              >
                <HeroEyebrow eyebrow={eyebrow} textAlign={textAlign} />
                <HeroTags tags={courseData?.tags} textAlign={textAlign} />
                {heroTitle && (
                  <h1 className={titleClass}>
                    {heroTitle}
                  </h1>
                )}
                <HeroMeta duration={courseData?.duration} instructor={courseData?.instructor} />
                <HeroDescription html={heroDescription} />
                {hasVisibleHeroButtons(left) ? (
                  <HeroButtons buttons={left.buttons} textAlign={textAlign} onAction={handleButtonClick} />
                ) : (
                  isHeroButtonEnabled(left?.button) && left?.button && (
                    <button
                      onClick={() => handleButtonClick(left.button!)}
                      className="mt-2 px-8 py-3 rounded-catalogue-md text-base font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md"
                      style={{ backgroundColor: left.button.backgroundColor }} // design-lint-ignore: page-builder dynamic button color
                    >
                      {left.button.text}
                    </button>
                  )
                )}
                <HeroStatChips chips={statChips} textAlign={textAlign} />
                <HeroTrust trust={trust} textAlign={textAlign} />
              </div>
            )}

            {/* Right Content — 7/12 on desktop: wider column gives the banner more room */}
            {hasHeroMedia && (
              <div className={cn("flex w-full items-center justify-center lg:justify-end", isCourseDetail && "lg:col-span-7")}>
                {heroVideo ? (
                  <HeroVideo src={heroVideo} poster={right?.videoPoster} title={heroImageAlt} />
                ) : (
                  <HeroCarousel images={heroMedia} />
                )}
              </div>
            )}
          </div>
        ) : (
          /* Centered Layout */
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            {(left || courseData) && (
              <>
                <HeroEyebrow eyebrow={eyebrow} textAlign={textAlign} />
                <HeroTags tags={courseData?.tags} textAlign={textAlign} />
                {heroTitle && (
                  <h1 className="catalogue-h1 text-foreground">
                    {heroTitle}
                  </h1>
                )}
                <HeroMeta duration={courseData?.duration} instructor={courseData?.instructor} />
                <HeroDescription html={heroDescription} />
                {hasVisibleHeroButtons(left) ? (
                  <HeroButtons buttons={left.buttons} textAlign={textAlign} onAction={handleButtonClick} />
                ) : (
                  isHeroButtonEnabled(left?.button) && left?.button && (
                    <button
                      onClick={() => handleButtonClick(left.button!)}
                      className="mt-2 px-8 py-3 rounded-catalogue-md text-base font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md"
                      style={{ backgroundColor: left.button.backgroundColor }} // design-lint-ignore: page-builder dynamic button color
                    >
                      {left.button.text}
                    </button>
                  )
                )}
                <HeroStatChips chips={statChips} textAlign={textAlign} />
                <HeroTrust trust={trust} textAlign={textAlign} />
              </>
            )}
            {/* Centered media — image or carousel below the text */}
            {hasHeroMedia && (
              <div className="mx-auto mt-8 w-full max-w-2xl">
                {heroVideo ? (
                  <HeroVideo src={heroVideo} poster={right?.videoPoster} title={heroImageAlt} />
                ) : (
                  <HeroCarousel images={heroMedia} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

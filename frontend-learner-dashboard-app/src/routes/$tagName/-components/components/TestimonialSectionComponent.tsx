import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CaretLeft, CaretRight, Star } from "@phosphor-icons/react";

interface Testimonial {
  name: string;
  role: string;
  feedback: string;
  text?: string;
  quote?: string;
  avatar: string;
  /** 1–5 star rating rendered above the quote. */
  rating?: number;
  /** Featured card treatment (primary ring). */
  highlight?: boolean;
}

interface TestimonialSectionProps {
  headerText: string;
  description: string;
  layout: "grid" | "grid-scroll" | "carousel";
  testimonials: Testimonial[];
  /** Carousel only: cards in view on desktop (1–4, default 1). Tablet shows at most 2, mobile 1. */
  cardsPerView?: number;
  /** Carousel only: advance one card on a timer; pauses on hover/focus and under reduced motion. */
  autoplay?: boolean;
  autoplayIntervalMs?: number;
  styles?: {
    backgroundColor?: string;
    roundedEdges?: boolean;
    cardHoverEffect?: "lift" | "scale" | "shadow" | "none";
    scrollEnabled?: boolean;
  };
}

const TestimonialCard: React.FC<{ testimonial: Testimonial; hoverEffect?: string; fillHeight?: boolean }> = ({
  testimonial,
  hoverEffect = "none",
  fillHeight = false,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadAvatar = async () => {
      if (!testimonial.avatar || testimonial.avatar.trim() === '' ||
          testimonial.avatar === 'null' || testimonial.avatar === 'undefined' ||
          testimonial.avatar.includes('/api/placeholder/')) {
        return;
      }

      if (testimonial.avatar.startsWith('http://') || testimonial.avatar.startsWith('https://')) {
        if (isMounted) setAvatarUrl(testimonial.avatar);
        return;
      }

      try {
        const url = await getPublicUrlWithoutLogin(testimonial.avatar);
        if (isMounted && url) setAvatarUrl(url);
      } catch {
        // Silently fail
      }
    };

    loadAvatar();
    return () => { isMounted = false; };
  }, [testimonial.avatar]);

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // "content" included: the AI composer emits it, and the admin preview
  // already accepts it — the learner must render the same keys (field bug:
  // published testimonials showed empty quotes).
  const feedbackText =
    testimonial.feedback || testimonial.text || testimonial.quote || (testimonial as { content?: string }).content || "";

  const hoverClass =
    hoverEffect === "lift" ? "hover:-translate-y-1 hover:shadow-lg" :
    hoverEffect === "scale" ? "hover:scale-[1.02] hover:shadow-lg" :
    hoverEffect === "shadow" ? "hover:shadow-lg" : "";

  const stars = testimonial.rating ? Math.max(0, Math.min(5, Math.round(testimonial.rating))) : 0;

  return (
    <div className={`${fillHeight ? 'h-full flex flex-col ' : ''}bg-catalogue-bg border rounded-catalogue-lg p-6 sm:p-7 transition-all duration-200 ${hoverClass} ${
      testimonial.highlight ? 'border-primary-200 shadow-md ring-1 ring-primary-200' : 'border-catalogue-border-subtle'
    }`}>
      {/* Rating */}
      {stars > 0 && (
        <div className="mb-3 flex items-center gap-0.5" aria-label={t("testimonial.ratedOutOf5", { stars })}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={14}
              weight={i < stars ? 'fill' : 'regular'}
              className={i < stars ? 'text-warning-500' : 'text-catalogue-text-muted'}
              aria-hidden="true"
            />
          ))}
        </div>
      )}
      {/* Quote */}
      {/* fillHeight: equal-height cards in a row keep the author pinned to the bottom edge */}
      <blockquote className={`text-sm sm:text-base text-catalogue-text-secondary leading-relaxed mb-5 ${fillHeight ? 'flex-1' : ''}`}>
        &ldquo;{feedbackText}&rdquo;
      </blockquote>

      {/* Author */}
      <div className="flex items-center gap-3">
        {avatarUrl && !hasError ? (
          <img
            src={avatarUrl}
            alt={testimonial.name}
            className="w-11 h-11 rounded-full object-cover"
            onError={() => setHasError(true)}
          />
        ) : (
          <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-primary-500">
              {getInitials(testimonial.name)}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-catalogue-text-primary">{testimonial.name}</div>
          {testimonial.role && (
            <div className="text-xs text-catalogue-text-muted whitespace-pre-line">{testimonial.role}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export const TestimonialSectionComponent: React.FC<TestimonialSectionProps> = ({
  headerText,
  description,
  layout,
  testimonials,
  cardsPerView = 1,
  autoplay = false,
  autoplayIntervalMs = 5000,
  styles = {},
}) => {
  const { t } = useTranslation("coursePlayerB");
  const { backgroundColor, cardHoverEffect = "none" } = styles;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Cards in view: the authored count on desktop, at most 2 on tablet, 1 on mobile.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 640px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const desktopCount = Math.max(1, Math.min(4, Math.round(Number(cardsPerView) || 1)));
  const visible = Math.min(
    testimonials.length || 1,
    isDesktop ? desktopCount : isTablet ? Math.min(2, desktopCount) : 1
  );
  const multi = desktopCount > 1;
  // Last index that still fills the view — sliding past it would leave empty slots.
  const maxIndex = Math.max(0, testimonials.length - visible);

  useEffect(() => {
    setCurrentIndex((prev) => Math.min(prev, maxIndex));
  }, [maxIndex]);

  const nextTestimonial = () => setCurrentIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
  const prevTestimonial = () => setCurrentIndex((prev) => (prev <= 0 ? maxIndex : prev - 1));

  const autoplayOn = layout === "carousel" && autoplay && !paused && !reducedMotion && maxIndex > 0;
  useEffect(() => {
    if (!autoplayOn) return;
    const id = window.setInterval(
      () => setCurrentIndex((prev) => (prev >= maxIndex ? 0 : prev + 1)),
      Math.max(1500, Number(autoplayIntervalMs) || 5000)
    );
    return () => window.clearInterval(id);
  }, [autoplayOn, maxIndex, autoplayIntervalMs]);

  // Carousel Layout
  if (layout === "carousel") {
    return (
      <section className="w-full catalogue-section" style={{ backgroundColor: backgroundColor || '#f8fafc' }}>{/* design-lint-ignore: page-builder default color */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-catalogue-text-primary mb-2">{headerText}</h2>
            {description && <p className="text-base sm:text-lg text-catalogue-text-secondary max-w-2xl mx-auto">{description}</p>}
          </div>

          <div
            className={`relative mx-auto ${multi ? "" : "max-w-2xl"}`}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
          >
            <div className="overflow-hidden">
              <div
                className={`flex transition-transform duration-300 ease-out ${multi ? "items-stretch" : ""}`}
                style={{ transform: `translateX(-${(currentIndex * 100) / visible}%)` }}
              >
                {testimonials.map((testimonial, index) => (
                  <div
                    key={index}
                    className="flex-shrink-0 px-2"
                    style={{ width: `${100 / visible}%` }}
                  >
                    <TestimonialCard testimonial={testimonial} hoverEffect={cardHoverEffect} fillHeight={multi} />
                  </div>
                ))}
              </div>
            </div>

            {maxIndex > 0 && (
              <>
                <button
                  onClick={prevTestimonial}
                  className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-4 bg-catalogue-bg border border-catalogue-border text-catalogue-text-secondary p-2 rounded-full hover:text-catalogue-text-primary hover:shadow-md transition-all"
                  aria-label={t("testimonial.previous")}
                >
                  <CaretLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={nextTestimonial}
                  className="absolute end-0 top-1/2 -translate-y-1/2 translate-x-4 bg-catalogue-bg border border-catalogue-border text-catalogue-text-secondary p-2 rounded-full hover:text-catalogue-text-primary hover:shadow-md transition-all"
                  aria-label={t("testimonial.next")}
                >
                  <CaretRight className="w-5 h-5" />
                </button>
              </>
            )}

            {maxIndex > 0 && (
              <div className="flex justify-center mt-6 gap-2">
                {Array.from({ length: maxIndex + 1 }, (_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentIndex(index)}
                    className={`h-2 rounded-full transition-all ${
                      index === currentIndex ? "bg-primary-500 w-6" : "bg-gray-300 w-2"
                    }`}
                    aria-label={t("testimonial.goToTestimonial", { number: index + 1 })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Grid / Grid-Scroll Layout
  return (
    <section className="w-full catalogue-section" style={{ backgroundColor: backgroundColor || '#f8fafc' }}>{/* design-lint-ignore: page-builder default color */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-catalogue-text-primary mb-2">{headerText}</h2>
          {description && <p className="text-base sm:text-lg text-catalogue-text-secondary max-w-2xl mx-auto">{description}</p>}
        </div>

        <div className={`grid gap-5 sm:gap-6 ${
          testimonials.length === 1 ? 'grid-cols-1 max-w-xl mx-auto' :
          testimonials.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto' :
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        } ${layout === "grid-scroll" ? "overflow-x-auto scrollbar-hide" : ""}`}>
          {testimonials.map((testimonial, index) => (
            <TestimonialCard key={index} testimonial={testimonial} hoverEffect={cardHoverEffect} />
          ))}
        </div>
      </div>
    </section>
  );
};

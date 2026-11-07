import React, { useState, useEffect ,useMemo} from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { useTranslation } from "react-i18next";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { Play, Pause } from "@phosphor-icons/react";
import {
  isYouTubeUrl,
  isVimeoUrl,
  convertToVimeoEmbedUrl,
  convertToYouTubeEmbedUrl,
  isValidVideoUrl,
} from "../../-utils/video-url";

interface MediaItem {
  type: "image" | "video";
  url: string;
  caption: string;
}

interface Slide {
  backgroundImage: string;
  heading: string;
  description: string;
  button?: {
    enabled: boolean;
    text: string;
    action: "navigate" | "enroll" | "openLeadCollection";
    target: string;
    backgroundColor?: string;
  };
}

interface MediaItemComponentProps {
  item: MediaItem;
  roundedEdges: boolean;
}

const MediaItemComponent: React.FC<MediaItemComponentProps> = ({ item, roundedEdges }) => {
  const { t } = useTranslation("coursePlayerB");
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const [hasTriedLoading, setHasTriedLoading] = useState(false);
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (hasTriedLoading) return;

    const loadUrl = async () => {
      // Check if it's a YouTube or Vimeo URL first - use it directly
      if (item.url && (isYouTubeUrl(item.url) || isVimeoUrl(item.url))) {
        if (isMounted) {
          setResolvedUrl(item.url);
          setHasTriedLoading(true);
          setIsLoading(false);
        }
        return;
      }

      // Check if URL is invalid
      if (!item.url ||
        item.url === null ||
        item.url === undefined ||
        item.url.includes('/api/placeholder/') ||
        item.url.trim() === '' ||
        item.url === 'null' ||
        item.url === 'undefined') {
        if (isMounted) {
          setResolvedUrl("");
          setHasTriedLoading(true);
          setIsLoading(false);
          setVideoLoadError(true);
        }
        return;
      }

      // Check if it's already a full URL
      if (item.url.startsWith('http://') || item.url.startsWith('https://')) {
        if (isMounted) {
          setResolvedUrl(item.url);
          setHasTriedLoading(true);
          setIsLoading(false);
        }
        return;
      }

      // Resolve file ID or relative path to URL via S3
      try {
        const url = await getPublicUrlWithoutLogin(item.url);
        if (isMounted) {
          if (url && isValidVideoUrl(url)) {
            setResolvedUrl(url);
          } else {
            setVideoLoadError(true);
          }
          setHasTriedLoading(true);
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Error loading media URL:", error);
        if (isMounted) {
          setResolvedUrl("");
          setHasTriedLoading(true);
          setIsLoading(false);
          setVideoLoadError(true);
        }
      }
    };

    loadUrl();
    return () => { isMounted = false; };
  }, [item.url, hasTriedLoading]);

  // Render YouTube video player
  const renderYouTubePlayer = () => {
    const embedUrl = convertToYouTubeEmbedUrl(resolvedUrl);
    return (
      <div className={`relative w-full aspect-video bg-black overflow-hidden ${roundedEdges ? 'rounded-catalogue-md' : 'rounded-none'}`}>
        <iframe
          src={embedUrl}
          title={item.caption || t("mediaShowcase.defaultVideoTitle")}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
          loading="lazy"
        />
      </div>
    );
  };

  // Render Vimeo video player
  const renderVimeoPlayer = () => {
    const embedUrl = convertToVimeoEmbedUrl(resolvedUrl);
    return (
      <div className={`relative w-full aspect-video bg-black overflow-hidden ${roundedEdges ? 'rounded-catalogue-md' : 'rounded-none'}`}>
        <iframe
          src={embedUrl}
          title={item.caption || t("mediaShowcase.defaultVideoTitle")}
          frameBorder="0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
          loading="lazy"
        />
      </div>
    );
  };

  // Render native video player for uploaded videos
  const renderNativeVideoPlayer = () => {
    return (
      <div className={`relative w-full aspect-video bg-black overflow-hidden ${roundedEdges ? 'rounded-catalogue-md' : 'rounded-none'}`}>
        <video
          src={resolvedUrl}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          className="w-full h-full object-contain"
          onError={() => {
            console.warn("Native video failed to load:", resolvedUrl);
            setVideoLoadError(true);
          }}
          onLoadedData={() => {
            setVideoLoadError(false);
          }}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    );
  };

  // Render video fallback (placeholder with play icon)
  const renderVideoFallback = () => {
    return (
      <div className={`relative w-full aspect-video bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center ${roundedEdges ? 'rounded-catalogue-md' : 'rounded-none'}`}>
        <div className="flex flex-col items-center justify-center text-white/70 gap-2">
          <Play className="w-16 h-16 opacity-50" />
          <p className="text-sm">{t("mediaShowcase.videoUnavailable")}</p>
        </div>
      </div>
    );
  };

  // Render image
  const renderImage = () => {
    const imageSrc = resolvedUrl || "/api/placeholder/400/300";
    return (
      <FitImage
        src={imageSrc}
        alt={item.caption}
        className={`w-full aspect-video shadow-lg ${roundedEdges ? 'rounded-catalogue-md' : 'rounded-none'}`}
        onError={(e) => {
          if (!hasTriedLoading) {
            e.currentTarget.src = "/api/placeholder/400/300";
          }
        }}
        onLoad={() => {
          setHasTriedLoading(true);
        }}
      />
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={`relative w-full aspect-video max-w-4xl mx-auto bg-gray-200 animate-pulse flex items-center justify-center ${roundedEdges ? 'rounded-catalogue-md' : 'rounded-none'}`}>
        <div className="text-gray-400 text-sm">{t("mediaShowcase.loading")}</div>
      </div>
    );
  }

  return (
    <div className="relative group max-w-4xl mx-auto">
      {item.type === "video" ? (
        <>
          {/* Check if it's a YouTube or Vimeo URL */}
          {resolvedUrl && isYouTubeUrl(resolvedUrl) ? (
            renderYouTubePlayer()
          ) : resolvedUrl && isVimeoUrl(resolvedUrl) ? (
            renderVimeoPlayer()
          ) : resolvedUrl && !videoLoadError ? (
            renderNativeVideoPlayer()
          ) : (
            renderVideoFallback()
          )}
        </>
      ) : (
        renderImage()
      )}
      <div className={`absolute bottom-0 start-0 end-0 bg-black bg-opacity-50 text-white p-4 ${roundedEdges ? 'rounded-b-catalogue-md' : 'rounded-b-none'
        }`}>
        <p className="text-sm font-medium">{item.caption}</p>
      </div>
    </div>
  );
};

interface MediaShowcaseProps {
  // Legacy props for backward compatibility
  headerText?: string;
  description?: string;
  media?: MediaItem[];
  layout?: "carousel" | "grid" | "slider";
  styles?: {
    backgroundColor?: string;
    roundedEdges?: boolean;
  };
  // New slider props
  slides?: Slide[];
  autoplay?: boolean;
  autoplayInterval?: number;
}

export const MediaShowcaseComponent: React.FC<MediaShowcaseProps> = ({
  headerText,
  description,
  media,
  layout = "carousel",
  styles = {},
  slides,
  autoplay = false,
  autoplayInterval = 3000,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setPrefersReducedMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const siteNavigate = useSiteNavigate();
  const domainRouting = useDomainRouting();
  const { roundedEdges = true } = styles;

  // Determine which format to use
  const isSliderFormat = layout === "slider" && slides && slides.length > 0;
  const mediaToUse = !isSliderFormat && media ? media : [];

  // Debug logging
  useEffect(() => {
    console.log("[MediaShowcaseComponent] Component mounted/updated:", {
      layout,
      slidesLength: slides?.length,
      isSliderFormat,
      autoplay,
      autoplayInterval,
      hasSlides: !!slides,
      slidesArray: slides
    });
  }, [layout, slides, isSliderFormat, autoplay, autoplayInterval]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolvedSlideImages, setResolvedSlideImages] = useState<{ [key: number]: string }>({});

  // Reset currentIndex when slides change
  useEffect(() => {
    if (isSliderFormat && slides && slides.length > 0) {
      setCurrentIndex(0);
    }
  }, [isSliderFormat, slides?.length]);

  // Resolve slide background images in parallel for better performance
  useEffect(() => {
    if (!isSliderFormat || !slides || slides.length === 0) return;

    const resolveImages = async () => {
      const resolved: { [key: number]: string } = {};
      
      // Load all images in parallel instead of sequentially
      const imagePromises = slides.map(async (slide, i) => {
        if (!slide.backgroundImage) return { index: i, url: null };

        // Check if it's already a URL
        if (slide.backgroundImage.startsWith('http://') || slide.backgroundImage.startsWith('https://')) {
          return { index: i, url: slide.backgroundImage };
        }

        // Resolve file ID to URL
        try {
          const url = await getPublicUrlWithoutLogin(slide.backgroundImage);
          return { index: i, url };
        } catch (error) {
          console.error(`Error loading slide ${i} image:`, error);
          return { index: i, url: slide.backgroundImage }; // Fallback to original
        }
      });

      // Wait for all images to resolve in parallel
      const results = await Promise.all(imagePromises);
      results.forEach(({ index, url }) => {
        if (url) {
          resolved[index] = url;
        }
      });
      
      setResolvedSlideImages(resolved);

      // Preload images into browser cache for smoother transitions
      results.forEach(({ url }) => {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          const img = new Image();
          img.src = url;
        }
      });
    };

    resolveImages();
  }, [isSliderFormat, slides]);

  // Preload adjacent slide images for smoother transitions
  useEffect(() => {
    if (!isSliderFormat || !slides || slides.length === 0 || Object.keys(resolvedSlideImages).length === 0) return;

    // Preload next and previous slide images
    const preloadImage = (url: string) => {
      if (!url || url.includes('/api/placeholder/')) return;
      const img = new Image();
      img.src = url;
    };

    const nextIndex = (currentIndex + 1) % slides.length;
    const prevIndex = (currentIndex - 1 + slides.length) % slides.length;

    // Preload next slide
    if (resolvedSlideImages[nextIndex]) {
      preloadImage(resolvedSlideImages[nextIndex]);
    }

    // Preload previous slide
    if (resolvedSlideImages[prevIndex]) {
      preloadImage(resolvedSlideImages[prevIndex]);
    }
  }, [currentIndex, resolvedSlideImages, isSliderFormat, slides?.length]);

  // Autoplay functionality
  useEffect(() => {
    // WCAG 2.2.2: auto-advancing content must be pausable, and must not
    // auto-advance at all for users who asked for reduced motion.
    if (!isSliderFormat || !autoplay || !slides || slides.length <= 1 || isPaused || isHovered || prefersReducedMotion) {
      return;
    }

    console.log("[MediaShowcaseComponent] Starting autoplay:", {
      autoplay,
      autoplayInterval,
      slidesLength: slides.length,
      resolvedImagesCount: Object.keys(resolvedSlideImages).length
    });

    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = (prev + 1) % slides.length;
        console.log("[MediaShowcaseComponent] Autoplay advancing:", { prev, next });
        return next;
      });
    }, autoplayInterval);

    return () => {
      console.log("[MediaShowcaseComponent] Clearing autoplay interval");
      clearInterval(interval);
    };
  }, [isSliderFormat, autoplay, autoplayInterval, slides?.length, isPaused, isHovered, prefersReducedMotion]);

  const nextSlide = () => {
    if (isSliderFormat && slides) {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
    } else {
      setCurrentIndex((prev) => (prev + 1) % mediaToUse.length);
    }
  };

  const prevSlide = () => {
    if (isSliderFormat && slides) {
      setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
    } else {
      setCurrentIndex((prev) => (prev - 1 + mediaToUse.length) % mediaToUse.length);
    }
  };

  const handleButtonClick = (button: Slide['button']) => {
    if (!button || !button.enabled) return;

    switch (button.action) {
      case "navigate":
        if (button.target) {
          void siteNavigate(button.target);
        }
        break;
      case "openLeadCollection":
        window.dispatchEvent(new CustomEvent('openLeadCollection'));
        break;
      case "enroll":
        // Handle enroll action if needed
        console.log("Enroll action triggered");
        break;
      default:
        break;
    }
  };

  const renderMediaItem = (item: MediaItem, index: number) => {
    return (
      <MediaItemComponent 
        key={index} 
        item={item} 
        roundedEdges={roundedEdges} 
      />
    );
  };

  // Compute slider style unconditionally (Rules of Hooks: no hooks inside conditionals)
  const slideCount = isSliderFormat && slides ? slides.length : 1;
  const slideWidthPercent = 100 / slideCount;
  const transformPercent = currentIndex * slideWidthPercent;
  const sliderStyle = useMemo((): React.CSSProperties => ({
    transform: `translateX(-${transformPercent}%)`,
    width: `${slideCount * 100}%`,
    display: 'flex',
    transition: 'transform 500ms cubic-bezier(0.4, 0, 0.2, 1)',
    willChange: 'transform',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    perspective: '1000px'
  }), [currentIndex, slideCount, transformPercent]);

  // Render slider format
  if (isSliderFormat && slides && slides.length > 0) {
    console.log("[MediaShowcaseComponent] ✅ Rendering SLIDER format:", {
      currentIndex,
      slidesLength: slides.length,
      resolvedImagesCount: Object.keys(resolvedSlideImages).length,
      slideWidthPercent: slideWidthPercent.toFixed(2),
      transformPercent: transformPercent.toFixed(2),
      transform: `translateX(-${transformPercent.toFixed(2)}%)`,
      containerWidth: `${slides.length * 100}%`,
      slideWidth: `${slideWidthPercent.toFixed(2)}%`,
      slides: slides.map((s, i) => ({
        index: i,
        heading: s.heading,
        hasBackground: !!s.backgroundImage,
        resolvedUrl: resolvedSlideImages[i] || s.backgroundImage
      }))
    });
    
    
    return (
      <section
        className="w-full relative"
        style={{ width: '100%', overflow: 'hidden' }}
        aria-roledescription="carousel"
        aria-label={t("mediaShowcase.highlightsAriaLabel")}
        // Pause while the visitor is actually reading/interacting; focusin
        // covers keyboard users, who cannot hover.
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
      >
        <div 
          className="relative overflow-hidden h-72 sm:h-blob-lg"
          style={{
            width: "100%",
            position: 'relative',
            willChange: 'contents',
            transform: 'translateZ(0)'
          }}
        >
         <div className="flex h-full" style={sliderStyle}>

            {slides.map((slide, index) => {
              const backgroundUrl = resolvedSlideImages[index] || slide.backgroundImage || "/api/placeholder/1920/500";
              
              return (
                <div
                  key={index}
                  className="flex-shrink-0 h-full relative overflow-hidden"
                  style={{
                    width: `calc(100% / ${slides.length})`,
                    minWidth: `calc(100% / ${slides.length})`,
                    maxWidth: `calc(100% / ${slides.length})`,
                    flexBasis: `calc(100% / ${slides.length})`,
                    backgroundColor: '#1f2937', // design-lint-ignore: page-builder default color
                    position: 'relative'
                  }}
                >
                  {/* Use actual img tag for better performance and preloading */}
                  <img
                    src={backgroundUrl}
                    alt={slide.heading || t("mediaShowcase.slideAlt", { number: index + 1 })}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                      objectFit: 'cover',
                      objectPosition: 'center',
                      willChange: 'transform',
                      backfaceVisibility: 'hidden',
                      transform: 'translateZ(0)' // Force GPU acceleration
                    }}
                    loading={index === 0 ? "eager" : "lazy"} // Eager load first slide, lazy load others
                    onError={(e) => {
                      e.currentTarget.src = "/api/placeholder/1920/500";
                    }}
                  />
                  {/* Overlay for better text readability */}
                  <div 
                    className="absolute inset-0" 
                    style={{ 
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      zIndex: 1,
                      pointerEvents: 'none'
                    }}
                  ></div>
                  
                  {/* Content */}
                  <div 
                    className="absolute inset-0 h-full w-full flex flex-col items-center justify-center text-center px-4 sm:px-6 lg:px-8"
                    style={{ 
                      zIndex: 10,
                      pointerEvents: 'auto'
                    }}
                  >
                    {slide.heading && (
                      <h2
                        className="text-xl sm:text-4xl lg:text-5xl font-bold text-white mb-2 sm:mb-4 max-w-4xl"
                        style={{ 
                          textShadow: '2px 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.5)',
                          lineHeight: '1.2'
                        }}
                      >
                        {slide.heading}
                      </h2>
                    )}
                    {slide.description && (
                      <p
                        className="text-sm sm:text-xl text-white mb-3 sm:mb-6 max-w-2xl"
                        style={{ 
                          textShadow: '1px 1px 6px rgba(0,0,0,0.9), 0 0 15px rgba(0,0,0,0.5)',
                          lineHeight: '1.6'
                        }}
                      >
                        {slide.description}
                      </p>
                    )}
                    {slide.button && slide.button.enabled && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleButtonClick(slide.button);
                        }}
                        className="px-4 py-2 sm:px-8 sm:py-4 text-sm sm:text-lg font-semibold text-white rounded-catalogue-sm hover:opacity-90 transition-opacity shadow-lg cursor-pointer"
                        style={{
                          backgroundColor: slide.button.backgroundColor || (domainRouting.instituteThemeCode ? `hsl(var(--primary))` : "#2563eb"), // design-lint-ignore: page-builder default color
                          zIndex: 20,
                          position: 'relative'
                        }}
                      >
                        {slide.button.text}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Navigation Buttons */}
          {slides.length > 1 && (
            <>
              <button
                onClick={prevSlide}
                className="absolute start-4 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-80 hover:bg-opacity-100 text-gray-800 p-2 sm:p-3 rounded-full shadow-lg transition-all z-20"
                aria-label={t("common.previousSlide")}
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={nextSlide}
                className="absolute end-4 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-80 hover:bg-opacity-100 text-gray-800 p-2 sm:p-3 rounded-full shadow-lg transition-all z-20"
                aria-label={t("common.nextSlide")}
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Dots Indicator */}
          {slides.length > 1 && (
            <div className="absolute bottom-4 start-1/2 transform -translate-x-1/2 flex items-center space-x-2 z-20">
              {slides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  aria-current={index === currentIndex}
                  className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full transition-all ${
                    index === currentIndex
                      ? "bg-white"
                      : "bg-white bg-opacity-50 hover:bg-opacity-75"
                  }`}
                  aria-label={t("mediaShowcase.goToSlide", { number: index + 1 })}
                />
              ))}
              {/* WCAG 2.2.2 — auto-advancing content needs a pause control.
                  Hidden when autoplay is off or the OS asks for reduced
                  motion (in which case nothing is moving to pause). */}
              {autoplay && !prefersReducedMotion && (
                <button
                  type="button"
                  onClick={() => setIsPaused((v) => !v)}
                  aria-label={isPaused ? t("mediaShowcase.resumeSlideshow") : t("mediaShowcase.pauseSlideshow")}
                  className="ms-2 inline-flex size-7 items-center justify-center rounded-full bg-white/25 text-white backdrop-blur-sm transition-colors hover:bg-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {isPaused
                    ? <Play size={13} weight="fill" aria-hidden="true" />
                    : <Pause size={13} weight="fill" aria-hidden="true" />}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  // Render legacy format (carousel/grid)
  console.log("[MediaShowcaseComponent] ⚠️ Rendering LEGACY format (not slider):", {
    layout,
    isSliderFormat,
    hasSlides: !!slides,
    slidesLength: slides?.length,
    hasMedia: !!media,
    mediaLength: media?.length
  });
  
  return (
    <section
      className={`w-full py-6 sm:py-8 ${roundedEdges ? "rounded-catalogue-md" : ""} bg-catalogue-bg-subtle`}
    >
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Header */}
        {headerText && (
          <div className="text-center mb-6">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-catalogue-text-primary mb-2">
              {headerText}
            </h2>
            {description && (
              <p className="text-sm text-catalogue-text-secondary max-w-2xl mx-auto">
                {description}
              </p>
            )}
          </div>
        )}

        {/* Media Content */}
        {layout === "carousel" ? (
          <div className="relative">
            <div className="overflow-hidden">
              <div
                className="flex transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(-${currentIndex * 100}%)` }}
              >
                {mediaToUse.map((item, index) => (
                  <div key={index} className="w-full flex-shrink-0 px-2">
                    {renderMediaItem(item, index)}
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation Buttons */}
            {mediaToUse.length > 1 && (
              <>
                <button
                  onClick={prevSlide}
                  className="absolute start-2 top-1/2 -translate-y-1/2 bg-white border border-catalogue-border text-catalogue-text-secondary p-1.5 rounded-full hover:bg-catalogue-interactive-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={nextSlide}
                  className="absolute end-2 top-1/2 -translate-y-1/2 bg-white border border-catalogue-border text-catalogue-text-secondary p-1.5 rounded-full hover:bg-catalogue-interactive-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}

            {/* Dots Indicator */}
            {mediaToUse.length > 1 && (
              <div className="flex justify-center mt-4 gap-1.5">
                {mediaToUse.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentIndex(index)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      index === currentIndex
                        ? "bg-primary-500 w-4"
                        : "bg-catalogue-border"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Grid Layout */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mediaToUse.map((item, index) => renderMediaItem(item, index))}
          </div>
        )}
      </div>
    </section>
  );
};

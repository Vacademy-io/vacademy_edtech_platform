import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_MAX_CROP, resolveFit, type ImageFit, type Size } from "./fit-mode";

/**
 * The site's default for every FitImage below it: "auto" unless the site
 * opts out (globalSettings.images.fit = "cover" keeps every image filling its
 * box, as before FitImage existed). A section's own fit prop still wins.
 */
const ImageFitContext = createContext<ImageFit>("auto");

export const ImageFitProvider: React.FC<{ fit?: unknown; children: React.ReactNode }> = ({
  fit,
  children,
}) => (
  <ImageFitContext.Provider value={fit === "cover" || fit === "contain" ? fit : "auto"}>
    {children}
  </ImageFitContext.Provider>
);

/** globalSettings.images.fit, read defensively (any other value is "auto"). */
export const siteImageFit = (globalSettings: unknown): unknown =>
  (globalSettings as { images?: { fit?: unknown } } | null | undefined)?.images?.fit;

export interface FitImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "className" | "style"> {
  src: string;
  alt: string;
  /**
   * The BOX: its size, position, rounding and hover motion — the classes the
   * section used to put on its <img>. It must have a size of its own (from
   * its parent, `absolute inset-0`, a height or an aspect class): the image
   * inside is absolutely positioned and does not size it.
   */
  className?: string;
  style?: React.CSSProperties;
  /** Extra classes for the image itself. */
  imgClassName?: string;
  /** "auto" (default: the site's setting), or force "cover" / "contain". */
  fit?: ImageFit;
  /** For "auto": the share of the image filling may cut off (default 0.3). */
  maxCrop?: number;
}

/**
 * A content image that always looks finished, whatever shape it was uploaded
 * in: it fills its box while that cuts little, and otherwise shows whole,
 * centred over a soft blurred copy of itself — never cut, never bare bars
 * (see fit-mode). Until the image has loaded it fills the box, as every
 * section did before, so a well-shaped image renders exactly as it did.
 *
 * For images in a box (cards, tiles, covers). Backgrounds behind text,
 * avatars and logos keep their own <img>.
 */
export const FitImage: React.FC<FitImageProps> = ({
  src,
  alt,
  className,
  style,
  imgClassName,
  fit,
  maxCrop = DEFAULT_MAX_CROP,
  onLoad,
  ...imgProps
}) => {
  const siteFit = useContext(ImageFitContext);
  const mode = fit ?? siteFit;
  const boxRef = useRef<HTMLSpanElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [box, setBox] = useState<Size | null>(null);

  const measureImage = useCallback(() => {
    const img = imgRef.current;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNatural({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, []);

  // A new image: forget the old one's shape (and pick up one already cached).
  useEffect(() => {
    setNatural(null);
    if (imgRef.current?.complete) measureImage();
  }, [src, measureImage]);

  // The box can change shape with the layout (a breakpoint, a resized
  // column); only "auto" needs to know. Without ResizeObserver it is
  // measured once.
  useEffect(() => {
    if (mode !== "auto") return;
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const resolved = resolveFit(mode, natural, box, maxCrop);
  const fitted = resolved === "contain";
  // The blurred backdrop belongs to the automatic rule only: a section that
  // asks for "contain" keeps the plain fit (and its own surface) it always had.
  const backdrop = fitted && mode === "auto";

  return (
    <span
      ref={boxRef}
      className={cn("relative block overflow-hidden", className)}
      style={style}
      data-fit={mode === "auto" ? resolved : undefined}
    >
      {backdrop && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-80 blur-xl"
        />
      )}
      <img
        {...imgProps}
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={(e) => {
          measureImage();
          onLoad?.(e);
        }}
        className={cn(
          "absolute inset-0 size-full",
          fitted ? "object-contain" : "object-cover",
          imgClassName,
        )}
      />
    </span>
  );
};

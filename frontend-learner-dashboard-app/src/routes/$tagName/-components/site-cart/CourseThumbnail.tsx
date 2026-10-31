import React, { useEffect, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { BookOpen } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";

/**
 * A course's artwork from a media id or a URL (cart items and product-page
 * mappings carry either). Falls back to a brand-tinted tile, never to a broken
 * image, and reserves its box so rows do not reflow when the image resolves.
 */
export const CourseThumbnail: React.FC<{
  image?: string | null;
  className?: string;
}> = ({ image, className }) => {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl("");
    setFailed(false);
    if (!image) return;
    getPublicUrlWithoutLogin(image)
      .then((resolved) => {
        if (alive && resolved) setUrl(resolved);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [image]);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-catalogue-md bg-gradient-to-br from-primary-100 to-primary-50",
        className,
      )}
      aria-hidden="true"
    >
      {url && !failed ? (
        <FitImage
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-catalogue-brand-ink">
          <BookOpen className="size-5 opacity-70" weight="duotone" />
        </span>
      )}
    </div>
  );
};

export default CourseThumbnail;

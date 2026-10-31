import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import type { CourseAuthor } from "../../-utils/course-authors";

// Profile photo resolved through the public media endpoint (no login on this
// page); the author's initial stands in while it loads or when there is none.
export const AuthorAvatar: React.FC<{ author: CourseAuthor; sizeClass: string }> = ({
  author,
  sizeClass,
}) => {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    setUrl("");
    if (!author.profilePicId) return;
    getPublicUrlWithoutLogin(author.profilePicId)
      .then((resolved) => {
        if (!cancelled && resolved) setUrl(resolved);
      })
      .catch(() => {
        /* fall back to the initial */
      });
    return () => {
      cancelled = true;
    };
  }, [author.profilePicId]);
  const initial = author.name ? author.name.charAt(0).toUpperCase() : "I";
  return url ? (
    <img
      src={url}
      alt={author.name}
      className={cn(
        "shrink-0 rounded-full object-cover bg-catalogue-bg-subtle",
        sizeClass,
      )}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-500 text-xs font-semibold text-white",
        sizeClass,
      )}
    >
      {initial}
    </span>
  );
};

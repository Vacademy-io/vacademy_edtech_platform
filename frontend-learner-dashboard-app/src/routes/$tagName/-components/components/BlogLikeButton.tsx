import React from "react";
import { useTranslation } from "react-i18next";
import { Heart } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useBlogLike } from "../../-utils/blog-likes";

/**
 * The heart + count on a blog card ("compact") and under an article
 * ("button"). Shown only when the blog section's `allowLikes` is on; the
 * caller decides that.
 */

export interface BlogLikeButtonProps {
  postId: string;
  instituteId: string;
  likeCount?: number | null;
  variant: "compact" | "button";
  /** Page editor preview: visible, but never writes a like. */
  disabled?: boolean;
}

export const BlogLikeButton: React.FC<BlogLikeButtonProps> = ({
  postId, instituteId, likeCount, variant, disabled = false,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const { liked, count, busy, toggle } = useBlogLike(postId, instituteId, likeCount, disabled);

  const icon = (
    <Heart
      size={variant === "compact" ? 14 : 16}
      weight={liked ? "fill" : "regular"}
      className={cn(liked && "text-danger-500")}
      aria-hidden="true"
    />
  );

  return (
    <button
      type="button"
      onClick={(e) => {
        // A card is a link target all over; the heart must not open the post.
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      aria-pressed={liked}
      aria-label={liked ? t("blog.unlike") : t("blog.like")}
      title={liked ? t("blog.unlike") : t("blog.like")}
      aria-busy={busy || undefined}
      className={cn(
        variant === "compact"
          ? "inline-flex shrink-0 items-center gap-1 rounded-catalogue-sm px-1 py-0.5 text-xs text-catalogue-text-muted transition-colors hover:text-catalogue-text-primary"
          : "catalogue-btn catalogue-btn-secondary catalogue-btn-sm",
        disabled && "cursor-default"
      )}
    >
      {icon}
      {variant === "button" ? (
        <span>{count > 0 ? t("blog.likeCount", { count }) : t("blog.like")}</span>
      ) : (
        <span>{count}</span>
      )}
    </button>
  );
};

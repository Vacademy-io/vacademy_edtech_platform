import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, CalendarBlank, Clock, UserCircle } from "@phosphor-icons/react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import type { BlogPostSummary } from "../../-services/blog-service";

/** One post as a card — the blog list, and "Related posts" under a Magazine article. */

export const formatDate = (iso: string | null | undefined, locale: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
};

/* ─── Card ─────────────────────────────────────────────────────────────── */

export interface BlogCardProps {
  post: BlogPostSummary;
  horizontal: boolean;
  href: string;
  onOpen: () => void;
  showCoverImage: boolean;
  showExcerpt: boolean;
  showDate: boolean;
  showAuthor: boolean;
  showCategory: boolean;
  showReadingTime: boolean;
  readMoreLabel: string;
  locale: string;
}

export const BlogCard: React.FC<BlogCardProps> = ({
  post, horizontal, href, onOpen, showCoverImage, showExcerpt, showDate, showAuthor, showCategory,
  showReadingTime, readMoreLabel, locale,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const excerpt = post.excerpt || "";
  const date = showDate ? formatDate(post.published_at, locale) : "";
  const cover = showCoverImage && post.cover_image_url;

  return (
    <article
      className={`catalogue-card-elevated group flex overflow-hidden ${horizontal ? "flex-col sm:flex-row" : "flex-col"}`}
    >
      {cover && (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
          className={`catalogue-img-zoom block shrink-0 overflow-hidden ${horizontal ? "sm:w-2/5" : "w-full"}`}
          tabIndex={-1}
          aria-hidden="true"
        >
          <FitImage
            src={post.cover_image_url as string}
            alt=""
            loading="lazy"
            className={`h-full w-full ${horizontal ? "aspect-video sm:aspect-auto" : "aspect-video"}`}
          />
        </a>
      )}
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {(showCategory && post.category) || date ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-catalogue-text-muted">
            {showCategory && post.category && <span className="catalogue-badge catalogue-badge-primary">{post.category}</span>}
            {date && (
              <time dateTime={post.published_at || undefined} className="inline-flex items-center gap-1">
                <CalendarBlank size={13} aria-hidden="true" /> {date}
              </time>
            )}
          </div>
        ) : null}
        <h3 className="catalogue-blog-card-title catalogue-h3 text-catalogue-text-primary">
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            className="hover:underline"
          >
            {post.title}
          </a>
        </h3>
        {showExcerpt && excerpt && (
          <p className="catalogue-blog-card-excerpt mt-2 text-sm leading-relaxed text-catalogue-text-secondary">{excerpt}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-catalogue-text-muted">
          <span className="inline-flex min-w-0 items-center gap-3">
            {showAuthor && post.author_name && (
              <span className="inline-flex items-center gap-1 truncate">
                <UserCircle size={14} aria-hidden="true" /> {post.author_name}
              </span>
            )}
            {showReadingTime && post.reading_minutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden="true" /> {t("blog.minRead", { minutes: post.reading_minutes })}
              </span>
            ) : null}
          </span>
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            className="catalogue-link inline-flex shrink-0 items-center gap-1 font-medium"
          >
            {readMoreLabel} <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
};

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { RouteMatcher } from "../../-services/route-matcher";
import { BlogService, type BlogPostPage } from "../../-services/blog-service";
import { blogPostSlugFor, isHomeRoute } from "../../-utils/blog-route";
import { BlogCard } from "./BlogCard";
import { BlogArticle } from "./BlogArticle";
import "./catalogue-blog.css";

/**
 * Blog — the catalogue section that shows an institute's blog posts.
 *
 * Posts are NOT in catalogue_json: they are rows an admin writes in Manage
 * Pages → Blog (or an AI app writes over MCP), read live here, so publishing
 * an article never means republishing the site. This one component renders
 * both faces of a blog:
 *
 *   list   — /<site>/<page>            cards, newest first, category chips
 *   post   — /<site>/<page>/<slug>     the article, with its own SEO tags
 *
 * Which face shows is decided from the URL, not from props, so the same
 * section on the same page serves both without the admin wiring anything.
 * The slug is read from the path segment after this page's route; `?post=`
 * is accepted too, for a blog placed on the home page where a trailing
 * segment would collide with page and course routes.
 *
 * Bodies are authored HTML and render on the learner domain, so they pass
 * through sanitizeBlogHtml at render time — the only line of defence for
 * HTML an admin pasted by hand.
 *
 * `gateAudienceId` puts articles behind that Audience list's form: the article
 * shows its title, cover and excerpt with the form, and the body once the
 * visitor has submitted it. The unlock is shared with gated resource cards
 * (-utils/resource-unlock.ts), so one submission opens both.
 */

export interface BlogComponentProps {
  heading?: string;
  subheading?: string;
  layout?: "grid" | "list";
  columns?: 2 | 3;
  pageSize?: number;
  /** '' = every category. */
  category?: string;
  showCoverImage?: boolean;
  showExcerpt?: boolean;
  showDate?: boolean;
  showAuthor?: boolean;
  showCategory?: boolean;
  showReadingTime?: boolean;
  showCategoryFilter?: boolean;
  readMoreLabel?: string;
  backLabel?: string;
  emptyMessage?: string;
  backgroundColor?: string;
  textColor?: string;
  /** Audience list whose form must be filled before an article opens. */
  gateAudienceId?: string;
  /** Heading above that form. */
  gateTitle?: string;
  /**
   * Teaser mode, e.g. a "Blog & News" strip on the home page: the first
   * `pageSize` posts with no pager, a "View more" button to this page route,
   * and every article opening on that page instead of this one.
   */
  viewMoreRoute?: string;
  viewMoreLabel?: string;
  /* injected by the renderer */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalSettings?: any;
  instituteId: string;
  tagName: string;
  pageRoute: string;
  isPreviewMode?: boolean;
}


export const BlogComponent: React.FC<BlogComponentProps> = ({
  heading,
  subheading,
  layout = "grid",
  columns = 3,
  pageSize = 9,
  category = "",
  showCoverImage = true,
  showExcerpt = true,
  showDate = true,
  showAuthor = true,
  showCategory = true,
  showReadingTime = true,
  showCategoryFilter = true,
  readMoreLabel,
  backLabel,
  emptyMessage,
  backgroundColor,
  textColor,
  gateAudienceId = "",
  gateTitle,
  viewMoreRoute,
  viewMoreLabel,
  globalSettings,
  instituteId,
  tagName,
  pageRoute,
  isPreviewMode = false,
}) => {
  const { t, i18n } = useTranslation("coursePlayerB");
  const location = useLocation();
  const navigate = useNavigate();

  const onHome = isHomeRoute(pageRoute);

  /** The post slug this URL addresses, if any. */
  const postSlug = useMemo(
    () => blogPostSlugFor(location.pathname, location.searchStr || "", tagName, pageRoute),
    [location.pathname, location.searchStr, pageRoute, tagName]
  );

  const listPath = RouteMatcher.pagePath(tagName, pageRoute);
  // A teaser opens its articles on the full blog page it points to.
  const teaserRoute = String(viewMoreRoute || "").trim();
  const articleRoute = teaserRoute || pageRoute;
  const articlesOnHome = isHomeRoute(articleRoute);
  const articleListPath = teaserRoute ? RouteMatcher.pagePath(tagName, teaserRoute) : listPath;
  const postPath = (slug: string) =>
    articlesOnHome
      ? `${articleListPath}?post=${encodeURIComponent(slug)}`
      : `${articleListPath}/${encodeURIComponent(slug)}`;

  const sectionStyle: React.CSSProperties | undefined =
    backgroundColor || textColor ? { backgroundColor: backgroundColor || undefined, color: textColor || undefined } : undefined;

  const openPost = (slug: string) => {
    // pagePath() already applied the root-mount rule. The home-page form is a
    // search param, which the router wants as an object, not in `to`.
    if (articlesOnHome) {
      navigate({ to: articleListPath as never, search: { post: slug } as never });
      return;
    }
    navigate({ to: postPath(slug) as never });
  };

  if (postSlug) {
    return (
      <BlogArticle
        slug={postSlug}
        instituteId={instituteId}
        tagName={tagName}
        globalSettings={globalSettings}
        listPath={listPath}
        postPath={postPath}
        onOpenPost={openPost}
        readMoreLabel={readMoreLabel || t("blog.readMore")}
        backLabel={backLabel || t("blog.backToList")}
        showDate={showDate}
        showAuthor={showAuthor}
        showCategory={showCategory}
        showReadingTime={showReadingTime}
        sectionStyle={sectionStyle}
        locale={i18n.language}
        onBack={() => navigate({ to: listPath as never })}
        gateAudienceId={String(gateAudienceId || "").trim()}
        gateTitle={gateTitle}
      />
    );
  }

  return (
    <BlogList
      heading={heading}
      subheading={subheading}
      layout={layout}
      columns={columns}
      pageSize={pageSize}
      category={category}
      showCoverImage={showCoverImage}
      showExcerpt={showExcerpt}
      showDate={showDate}
      showAuthor={showAuthor}
      showCategory={showCategory}
      showReadingTime={showReadingTime}
      showCategoryFilter={showCategoryFilter}
      readMoreLabel={readMoreLabel || t("blog.readMore")}
      emptyMessage={emptyMessage || t("blog.empty")}
      sectionStyle={sectionStyle}
      instituteId={instituteId}
      postPath={postPath}
      onOpenPost={openPost}
      isPreviewMode={isPreviewMode}
      onHome={onHome && !teaserRoute}
      locale={i18n.language}
      viewMore={
        teaserRoute
          ? {
              href: articleListPath,
              label: viewMoreLabel || t("blog.viewMore"),
              onOpen: () => navigate({ to: articleListPath as never }),
            }
          : undefined
      }
    />
  );
};

/* ─── List ─────────────────────────────────────────────────────────────── */

interface BlogListProps {
  heading?: string;
  subheading?: string;
  layout: "grid" | "list";
  columns: 2 | 3;
  pageSize: number;
  category: string;
  showCoverImage: boolean;
  showExcerpt: boolean;
  showDate: boolean;
  showAuthor: boolean;
  showCategory: boolean;
  showReadingTime: boolean;
  showCategoryFilter: boolean;
  readMoreLabel: string;
  emptyMessage: string;
  sectionStyle?: React.CSSProperties;
  instituteId: string;
  postPath: (slug: string) => string;
  onOpenPost: (slug: string) => void;
  isPreviewMode: boolean;
  onHome: boolean;
  locale: string;
  /** Teaser mode: no pager, this button instead. */
  viewMore?: { href: string; label: string; onOpen: () => void };
}

const BlogList: React.FC<BlogListProps> = ({
  heading, subheading, layout, columns, pageSize, category,
  showCoverImage, showExcerpt, showDate, showAuthor, showCategory, showReadingTime, showCategoryFilter,
  readMoreLabel, emptyMessage, sectionStyle, instituteId, postPath, onOpenPost, isPreviewMode, onHome, locale,
  viewMore,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [page, setPage] = useState(0);
  // The chip a visitor picked; the authored `category` prop is the fixed
  // filter underneath it (a chip list only appears when the prop is empty).
  const [pickedCategory, setPickedCategory] = useState("");
  const [data, setData] = useState<BlogPostPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const effectiveCategory = category || pickedCategory;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    BlogService.listPosts(instituteId, { page, size: pageSize, category: effectiveCategory })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instituteId, page, pageSize, effectiveCategory]);

  const posts = data?.content || [];
  const totalPages = data?.total_pages || 0;
  const categories = data?.categories || [];

  const gridClass =
    layout === "list"
      ? "flex flex-col gap-6"
      : columns === 2
        ? "grid grid-cols-1 gap-6 sm:grid-cols-2"
        : "catalogue-grid-cards";

  return (
    <section className="catalogue-section bg-catalogue-bg" style={sectionStyle} data-blog-section>
      <div className="catalogue-shell">
        {(heading || subheading) && (
          <div className="catalogue-section-header text-center">
            {heading && <h2 className="catalogue-h2 text-catalogue-text-primary">{heading}</h2>}
            {subheading && (
              <p className="catalogue-lead catalogue-measure text-catalogue-text-muted">{subheading}</p>
            )}
          </div>
        )}

        {isPreviewMode && onHome && (
          <p className="mb-6 rounded-catalogue-md border border-dashed border-warning-400 bg-warning-50 px-4 py-3 text-center text-xs text-catalogue-text-secondary">
            {t("blog.homePageHint")}
          </p>
        )}

        {showCategoryFilter && !category && categories.length > 1 && (
          <div className="mb-8 flex flex-wrap justify-center gap-2" role="tablist" aria-label={t("blog.categories")}>
            {["", ...categories].map((c) => {
              const active = c === pickedCategory;
              return (
                <button
                  key={c || "__all"}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setPickedCategory(c);
                    setPage(0);
                  }}
                  className={`catalogue-btn catalogue-btn-sm ${active ? "catalogue-btn-primary" : "catalogue-btn-secondary"}`}
                >
                  {c || t("blog.allCategories")}
                </button>
              );
            })}
          </div>
        )}

        {loading && !data ? (
          <div className={gridClass} aria-busy="true">
            {Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => (
              <div key={i} className="catalogue-card overflow-hidden">
                {showCoverImage && <div className="catalogue-skeleton catalogue-aspect-video w-full rounded-none" />}
                <div className="space-y-3 p-5">
                  <div className="catalogue-skeleton catalogue-skeleton-title w-3/4" />
                  <div className="catalogue-skeleton catalogue-skeleton-text w-full" />
                  <div className="catalogue-skeleton catalogue-skeleton-text w-5/6" />
                </div>
              </div>
            ))}
          </div>
        ) : failed ? (
          <p className="text-center text-sm text-catalogue-text-muted">{t("blog.loadFailed")}</p>
        ) : posts.length === 0 ? (
          <div className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
            {isPreviewMode ? t("blog.emptyGuidance") : emptyMessage}
          </div>
        ) : (
          <div className={gridClass}>
            {posts.map((post) => (
              <BlogCard
                key={post.id}
                post={post}
                horizontal={layout === "list"}
                href={postPath(post.slug)}
                onOpen={() => onOpenPost(post.slug)}
                showCoverImage={showCoverImage}
                showExcerpt={showExcerpt}
                showDate={showDate}
                showAuthor={showAuthor}
                showCategory={showCategory}
                showReadingTime={showReadingTime}
                readMoreLabel={readMoreLabel}
                locale={locale}
              />
            ))}
          </div>
        )}

        {viewMore && posts.length > 0 && (
          <div className="mt-10 flex justify-center">
            <a
              href={viewMore.href}
              className="catalogue-btn catalogue-btn-secondary"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                viewMore.onOpen();
              }}
            >
              {viewMore.label} <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        )}

        {!viewMore && totalPages > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-3" aria-label={t("blog.pagination")}>
            <button
              type="button"
              className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ArrowLeft size={14} aria-hidden="true" /> {t("blog.newer")}
            </button>
            <span className="text-xs text-catalogue-text-muted">
              {t("blog.pageOf", { page: page + 1, total: totalPages })}
            </span>
            <button
              type="button"
              className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              {t("blog.older")} <ArrowRight size={14} aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </section>
  );
};

export default BlogComponent;

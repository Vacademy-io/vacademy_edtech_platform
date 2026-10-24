import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet";
import {
  ArrowLeft,
  CalendarBlank,
  CaretDown,
  Clock,
  FacebookLogo,
  LinkedinLogo,
  LinkSimple,
  ListBullets,
  UserCircle,
  WhatsappLogo,
  XLogo,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { BlogService, type BlogPostSummary, type BlogTemplate } from "../../-services/blog-service";
import { blogPlainText, sanitizeBlogArticle, type BlogHeading } from "../../-utils/blog-html";
import { markResourceUnlocked, rememberResourceIdentity, useResourceUnlocked } from "../../-utils/resource-unlock";
import { useCourseTerms } from "../../-utils/catalogue-naming";
import { LeadFormComponent } from "./LeadFormComponent";
import { CourseShowcaseComponent } from "./CourseShowcaseComponent";
import { BlogCard, formatDate } from "./BlogCard";

/**
 * One blog article, laid out by the post's own `template` (picked in the post
 * editor):
 *
 *   CLASSIC      one centred column — the layout every post had before templates
 *   SIDEBAR_TOC  contents on the left, fixed while the article scrolls, with the
 *                current heading highlighted and a progress rail
 *   MAGAZINE     full-width cover with the title over it; related posts after
 *   FOCUS        narrow column, reading-progress bar, floating share buttons
 *
 * Every layout is the same parts in a different arrangement — meta line, body
 * (or the gate form), recommended courses, tags, back/copy-link footer — so the
 * gate, SEO tags and course band behave identically whichever one a post uses.
 */

export interface BlogArticleProps {
  slug: string;
  instituteId: string;
  tagName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalSettings?: any;
  listPath: string;
  postPath: (slug: string) => string;
  onOpenPost: (slug: string) => void;
  readMoreLabel: string;
  backLabel: string;
  showDate: boolean;
  showAuthor: boolean;
  showCategory: boolean;
  showReadingTime: boolean;
  sectionStyle?: React.CSSProperties;
  locale: string;
  onBack: () => void;
  gateAudienceId: string;
  gateTitle?: string;
}

/** A sidebar of contents needs something to list; with fewer headings the post reads as Classic. */
const MIN_TOC_HEADINGS = 2;

const TEMPLATES: BlogTemplate[] = ["CLASSIC", "SIDEBAR_TOC", "MAGAZINE", "FOCUS"];
const readTemplate = (raw: unknown): BlogTemplate =>
  TEMPLATES.includes(raw as BlogTemplate) ? (raw as BlogTemplate) : "CLASSIC";

/* ─── Scroll tracking ──────────────────────────────────────────────────── */

/** 0…1 — how far the reader has scrolled through `ref`'s element. */
function useReadingProgress(ref: React.RefObject<HTMLElement>, enabled: boolean): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const next = travel <= 0 ? (rect.bottom <= window.innerHeight ? 1 : 0) : -rect.top / travel;
      setProgress(Math.min(1, Math.max(0, next)));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
  return progress;
}

/** Below the sticky site header: a heading counts as reached once its top passes this line. */
const ACTIVE_LINE_PX = 140;

/** Index of the last heading the reader has scrolled past (-1 = still above the first). */
function useActiveHeading(headings: BlogHeading[]): number {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (!headings.length || typeof window === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = -1;
      headings.forEach((h, i) => {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= ACTIVE_LINE_PX) current = i;
      });
      // At the very bottom the last short section can never reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = headings.length - 1;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [headings]);
  return active;
}

const scrollToHeading = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

/* ─── Article ──────────────────────────────────────────────────────────── */

export const BlogArticle: React.FC<BlogArticleProps> = ({
  slug, instituteId, tagName, globalSettings, listPath, postPath, onOpenPost, readMoreLabel, backLabel,
  showDate, showAuthor, showCategory, showReadingTime, sectionStyle, locale, onBack, gateAudienceId, gateTitle,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const unlocked = useResourceUnlocked(gateAudienceId);
  const locked = !!gateAudienceId && !unlocked;
  const [post, setPost] = useState<BlogPostSummary | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPost(undefined);
    BlogService.getPost(instituteId, slug)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch(() => {
        if (!cancelled) setPost(null);
      });
    return () => {
      cancelled = true;
    };
  }, [instituteId, slug]);

  // A fresh article starts at the top, not wherever the list was scrolled to.
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [slug]);

  const outline = useMemo(
    () => (post?.content_html ? sanitizeBlogArticle(post.content_html) : { html: "", headings: [] as BlogHeading[] }),
    [post?.content_html]
  );

  let template = readTemplate(post?.template);
  // A gated article has no body on screen to list or track.
  const headings = locked ? [] : outline.headings;
  if (template === "SIDEBAR_TOC" && headings.length < MIN_TOC_HEADINGS) template = "CLASSIC";

  const tracksProgress = !!post && !locked && (template === "SIDEBAR_TOC" || template === "FOCUS");
  const progress = useReadingProgress(bodyRef, tracksProgress);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  };

  const back = (tone: "default" | "inverse" = "default") => (
    <a
      href={listPath}
      onClick={(e) => {
        e.preventDefault();
        onBack();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        tone === "inverse" ? "text-white/90 hover:text-white hover:underline" : "catalogue-link"
      )}
    >
      <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
    </a>
  );

  if (post === undefined) {
    return (
      <section className="catalogue-section bg-catalogue-bg" style={sectionStyle} aria-busy="true">
        <div className="catalogue-shell-prose space-y-4">
          <div className="catalogue-skeleton h-4 w-24" />
          <div className="catalogue-skeleton catalogue-skeleton-title w-3/4" />
          <div className="catalogue-skeleton catalogue-aspect-video w-full" />
          <div className="catalogue-skeleton catalogue-skeleton-text w-full" />
          <div className="catalogue-skeleton catalogue-skeleton-text w-11/12" />
          <div className="catalogue-skeleton catalogue-skeleton-text w-4/5" />
        </div>
      </section>
    );
  }

  if (post === null) {
    return (
      <section className="catalogue-section bg-catalogue-bg" style={sectionStyle}>
        <div className="catalogue-shell-prose text-center">
          <h1 className="catalogue-h2 text-catalogue-text-primary">{t("blog.notFoundTitle")}</h1>
          <p className="mt-2 text-sm text-catalogue-text-muted">{t("blog.notFoundBody")}</p>
          <div className="mt-6">{back()}</div>
        </div>
      </section>
    );
  }

  const date = showDate ? formatDate(post.published_at, locale) : "";
  const description = post.seo_description || post.excerpt || blogPlainText(post.content_html || "", 160);
  const courseIds = (post.recommended_course_ids || []).filter(Boolean);

  const seo = (
    <Helmet>
      <title>{post.seo_title || post.title}</title>
      <meta name="description" content={description} />
      <meta property="og:type" content="article" />
      <meta property="og:title" content={post.seo_title || post.title} />
      <meta property="og:description" content={description} />
      {post.cover_image_url && <meta property="og:image" content={post.cover_image_url} />}
      {post.published_at && <meta property="article:published_time" content={post.published_at} />}
    </Helmet>
  );

  const meta = (tone: "default" | "inverse" = "default", centered = false) =>
    (showAuthor && post.author_name) || date || (showReadingTime && post.reading_minutes) ? (
      <div
        className={cn(
          "mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm",
          tone === "inverse" ? "text-white/85" : "text-catalogue-text-muted",
          centered && "justify-center"
        )}
      >
        {showAuthor && post.author_name && (
          <span className="inline-flex items-center gap-1.5">
            <UserCircle size={16} aria-hidden="true" /> {post.author_name}
          </span>
        )}
        {date && (
          <time dateTime={post.published_at || undefined} className="inline-flex items-center gap-1.5">
            <CalendarBlank size={16} aria-hidden="true" /> {date}
          </time>
        )}
        {showReadingTime && post.reading_minutes ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock size={16} aria-hidden="true" /> {t("blog.minRead", { minutes: post.reading_minutes })}
          </span>
        ) : null}
      </div>
    ) : null;

  const eyebrow = (tone: "default" | "inverse" = "default") =>
    showCategory && post.category ? (
      <p className={cn("catalogue-eyebrow mb-3", tone === "inverse" && "text-white/90")}>{post.category}</p>
    ) : null;

  const cover = post.cover_image_url ? (
    <img src={post.cover_image_url} alt="" className="mb-8 w-full rounded-catalogue-lg object-cover" />
  ) : null;

  const body = (variant?: "magazine" | "focus") =>
    locked ? (
      <div className="space-y-6">
        {description && <p className="catalogue-lead text-catalogue-text-secondary">{description}</p>}
        <LeadFormComponent
          audienceId={gateAudienceId}
          instituteId={instituteId}
          title={gateTitle || t("blog.gateTitle")}
          subtitle={t("blog.gateSubtitle")}
          variant="embedded"
          layout="card"
          onSubmitted={(identity) => {
            // Same browser identity as the resource cards, so files this reader
            // opens next are credited to them.
            rememberResourceIdentity(identity);
            markResourceUnlocked(gateAudienceId);
          }}
        />
      </div>
    ) : (
      <div
        ref={bodyRef}
        className={cn(
          "catalogue-rich-text catalogue-blog-article",
          variant === "magazine" && "catalogue-blog-article--magazine",
          variant === "focus" && "catalogue-blog-article--focus"
        )}
        dangerouslySetInnerHTML={{ __html: outline.html }}
      />
    );

  const courses = (
    <RecommendedCourses ids={courseIds} instituteId={instituteId} tagName={tagName} globalSettings={globalSettings} />
  );

  const tags =
    !locked && post.tags && post.tags.length > 0 ? (
      <ul className="mt-10 flex flex-wrap gap-2" aria-label={t("blog.tags")}>
        {post.tags.map((tag) => (
          <li key={tag} className="catalogue-badge">
            #{tag}
          </li>
        ))}
      </ul>
    ) : null;

  const footer = (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-catalogue-border pt-6">
      {back()}
      <button type="button" onClick={copyLink} className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm">
        <LinkSimple size={14} aria-hidden="true" /> {copied ? t("blog.linkCopied") : t("blog.copyLink")}
      </button>
    </footer>
  );

  if (template === "SIDEBAR_TOC") {
    return (
      <article className="catalogue-section bg-catalogue-bg" style={sectionStyle}>
        {seo}
        <ProgressBar progress={progress} className="lg:hidden" />
        <div className="catalogue-shell">
          <div className="mb-6">{back()}</div>
          <div className="lg:grid lg:grid-cols-12 lg:gap-12">
            <aside className="hidden lg:col-span-4 lg:block xl:col-span-3">
              <div className="catalogue-blog-toc">
                <TableOfContents headings={headings} progress={progress} />
              </div>
            </aside>
            <div className="min-w-0 lg:col-span-8 xl:col-span-9">
              <div className="catalogue-blog-measure">
                <header className="mb-8">
                  {eyebrow()}
                  <h1 className="catalogue-h1 text-catalogue-text-primary">{post.title}</h1>
                  {meta()}
                </header>
                {cover}
                <MobileContents headings={headings} />
                {body()}
              </div>
              {courses}
              <div className="catalogue-blog-measure">
                {tags}
                {footer}
              </div>
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (template === "MAGAZINE") {
    return (
      <article className="bg-catalogue-bg" style={sectionStyle}>
        {seo}
        <header
          className={cn(
            "catalogue-blog-hero relative isolate flex items-end overflow-hidden",
            !post.cover_image_url && "catalogue-blog-hero--plain"
          )}
        >
          {post.cover_image_url && (
            <>
              <img src={post.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="catalogue-blog-hero-scrim absolute inset-0" aria-hidden="true" />
            </>
          )}
          <div className="catalogue-shell-prose relative w-full py-12 sm:py-16">
            <div className="mb-8">{back("inverse")}</div>
            {eyebrow("inverse")}
            <h1 className="catalogue-h1 text-white">{post.title}</h1>
            {post.excerpt && <p className="catalogue-lead mt-4 text-white/90">{post.excerpt}</p>}
            {meta("inverse")}
          </div>
        </header>
        <div className="catalogue-section">
          <div className="catalogue-shell-prose">{body("magazine")}</div>
          <div className="catalogue-shell">{courses}</div>
          <div className="catalogue-shell-prose">
            {tags}
            {footer}
          </div>
          <RelatedPosts
            current={post}
            instituteId={instituteId}
            postPath={postPath}
            onOpenPost={onOpenPost}
            readMoreLabel={readMoreLabel}
            locale={locale}
          />
        </div>
      </article>
    );
  }

  if (template === "FOCUS") {
    return (
      <article className="catalogue-section bg-catalogue-bg" style={sectionStyle}>
        {seo}
        {!locked && <ProgressBar progress={progress} />}
        <ShareRail title={post.title} copied={copied} onCopy={copyLink} variant="rail" />
        <div className="catalogue-blog-focus">
          <div className="mb-8">{back()}</div>
          <header className="mb-10 text-center">
            {eyebrow()}
            <h1 className="catalogue-h1 text-catalogue-text-primary">{post.title}</h1>
            {meta("default", true)}
          </header>
          {cover}
          {body("focus")}
          <ShareRail title={post.title} copied={copied} onCopy={copyLink} variant="inline" />
        </div>
        <div className="catalogue-shell">{courses}</div>
        <div className="catalogue-blog-focus">
          {tags}
          {footer}
        </div>
      </article>
    );
  }

  return (
    <article className="catalogue-section bg-catalogue-bg" style={sectionStyle}>
      {seo}
      <div className="catalogue-shell-prose">
        <div className="mb-6">{back()}</div>
        <header className="mb-8">
          {eyebrow()}
          <h1 className="catalogue-h1 text-catalogue-text-primary">{post.title}</h1>
          {meta()}
        </header>
        {cover}
        {body()}
      </div>
      <div className="catalogue-shell">{courses}</div>
      <div className="catalogue-shell-prose">
        {tags}
        {footer}
      </div>
    </article>
  );
};

/* ─── Parts ────────────────────────────────────────────────────────────── */

const ProgressBar: React.FC<{ progress: number; className?: string }> = ({ progress, className }) => {
  const { t } = useTranslation("coursePlayerB");
  const percent = Math.round(progress * 100);
  return (
    <div
      className={cn("catalogue-blog-progress", className)}
      role="progressbar"
      aria-label={t("blog.readingProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="catalogue-blog-progress-fill" style={{ transform: `scaleX(${progress})` }} /* design-lint-ignore: live scroll position */ />
    </div>
  );
};

const TableOfContents: React.FC<{ headings: BlogHeading[]; progress: number }> = ({ headings, progress }) => {
  const { t } = useTranslation("coursePlayerB");
  const active = useActiveHeading(headings);
  return (
    <nav aria-label={t("blog.contents")}>
      <p className="catalogue-eyebrow mb-4">{t("blog.contents")}</p>
      <div className="relative ps-5">
        <div className="catalogue-blog-toc-rail" aria-hidden="true">
          <div className="catalogue-blog-toc-rail-fill" style={{ transform: `scaleY(${progress})` }} /* design-lint-ignore: live scroll position */ />
        </div>
        <ol className="space-y-1">
          {headings.map((h, i) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToHeading(h.id);
                }}
                aria-current={i === active ? "location" : undefined}
                className={cn(
                  "catalogue-blog-toc-link",
                  h.level === 3 && "ps-3 text-xs",
                  i < active && "is-read",
                  i === active && "is-active"
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-5 text-xs text-catalogue-text-muted">
        {t("blog.percentRead", { percent: Math.round(progress * 100) })}
      </p>
    </nav>
  );
};

/** Phones and tablets: the sidebar would squeeze the article, so contents fold into a list above it. */
const MobileContents: React.FC<{ headings: BlogHeading[] }> = ({ headings }) => {
  const { t } = useTranslation("coursePlayerB");
  if (!headings.length) return null;
  return (
    <details className="catalogue-blog-mobile-toc mb-8 lg:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-catalogue-text-primary">
        <span className="inline-flex items-center gap-2">
          <ListBullets size={16} aria-hidden="true" /> {t("blog.contents")}
        </span>
        <CaretDown size={14} aria-hidden="true" className="catalogue-blog-mobile-toc-caret" />
      </summary>
      <ol className="space-y-1 px-4 pb-4">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                scrollToHeading(h.id);
              }}
              className={cn("catalogue-blog-toc-link", h.level === 3 && "ps-3 text-xs")}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
};

const shareLinks = (title: string, url: string) => {
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(title);
  return [
    { key: "whatsapp", label: "WhatsApp", Icon: WhatsappLogo, href: `https://wa.me/?text=${text}%20${u}` },
    { key: "x", label: "X", Icon: XLogo, href: `https://twitter.com/intent/tweet?url=${u}&text=${text}` },
    { key: "linkedin", label: "LinkedIn", Icon: LinkedinLogo, href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: "facebook", label: "Facebook", Icon: FacebookLogo, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  ];
};

/** Focus layout's share buttons: a rail fixed beside the column on wide screens, a row after the article. */
const ShareRail: React.FC<{ title: string; copied: boolean; onCopy: () => void; variant: "rail" | "inline" }> = ({
  title, copied, onCopy, variant,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const url = typeof window !== "undefined" ? window.location.href : "";
  const links = shareLinks(title, url);
  const btn =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-secondary transition-colors hover:border-primary-300 hover:text-primary-500";
  return (
    <div
      className={cn(variant === "rail" ? "catalogue-blog-share-rail" : "mt-10 flex flex-wrap items-center gap-2")}
      aria-label={t("blog.share")}
      role="group"
    >
      {variant === "inline" && <span className="me-1 text-sm font-medium text-catalogue-text-muted">{t("blog.share")}</span>}
      {links.map(({ key, label, Icon, href }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={btn}
          aria-label={t("blog.shareOn", { network: label })}
          title={label}
        >
          <Icon size={18} aria-hidden="true" />
        </a>
      ))}
      <button
        type="button"
        onClick={onCopy}
        className={btn}
        aria-label={copied ? t("blog.linkCopied") : t("blog.copyLink")}
        title={copied ? t("blog.linkCopied") : t("blog.copyLink")}
      >
        <LinkSimple size={18} aria-hidden="true" />
      </button>
    </div>
  );
};

/**
 * The courses the author picked for this post, as course cards right after the
 * article. The cards are Course Showcase's hand-picked strip, so a click opens
 * the course page exactly as it does from any other strip on the site. Courses
 * no longer in the catalogue drop out; with none left the band is not drawn.
 */
const RecommendedCourses: React.FC<{
  ids: string[];
  instituteId: string;
  tagName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalSettings?: any;
}> = ({ ids, instituteId, tagName, globalSettings }) => {
  const { t } = useTranslation("coursePlayerB");
  const { courses } = useCourseTerms();
  if (!ids.length) return null;
  return (
    <CourseShowcaseComponent
      source="picked"
      courseIds={ids}
      limit={ids.length}
      layout="row"
      instituteId={instituteId}
      tagName={tagName}
      globalSettings={globalSettings}
      sectionClassName="mt-12 border-t border-catalogue-border pt-10"
      shellClassName=""
      header={
        <h2 className="catalogue-h3 mb-6 text-catalogue-text-primary">
          {t("blog.recommendedCourses", { courses })}
        </h2>
      }
    />
  );
};

/** Magazine: up to three more posts, same category first, so the read does not dead-end. */
const RelatedPosts: React.FC<{
  current: BlogPostSummary;
  instituteId: string;
  postPath: (slug: string) => string;
  onOpenPost: (slug: string) => void;
  readMoreLabel: string;
  locale: string;
}> = ({ current, instituteId, postPath, onOpenPost, readMoreLabel, locale }) => {
  const { t } = useTranslation("coursePlayerB");
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const others = (list: BlogPostSummary[]) => list.filter((p) => p.slug !== current.slug);
    (async () => {
      try {
        let picked: BlogPostSummary[] = [];
        if (current.category) {
          picked = others((await BlogService.listPosts(instituteId, { size: 4, category: current.category })).content);
        }
        if (picked.length < 3) {
          const more = others((await BlogService.listPosts(instituteId, { size: 6 })).content).filter(
            (p) => !picked.some((x) => x.slug === p.slug)
          );
          picked = [...picked, ...more];
        }
        if (!cancelled) setPosts(picked.slice(0, 3));
      } catch {
        /* related posts are a nicety — the article stands without them */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instituteId, current.slug, current.category]);

  if (!posts.length) return null;
  return (
    <section className="catalogue-shell mt-16 border-t border-catalogue-border pt-10" aria-labelledby="blog-related-heading">
      <h2 id="blog-related-heading" className="catalogue-h3 mb-6 text-catalogue-text-primary">
        {t("blog.relatedPosts")}
      </h2>
      <div className="catalogue-grid-cards">
        {posts.map((p) => (
          <BlogCard
            key={p.id}
            post={p}
            horizontal={false}
            href={postPath(p.slug)}
            onOpen={() => onOpenPost(p.slug)}
            showCoverImage
            showExcerpt
            showDate
            showAuthor={false}
            showCategory
            showReadingTime
            readMoreLabel={readMoreLabel}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
};

export default BlogArticle;

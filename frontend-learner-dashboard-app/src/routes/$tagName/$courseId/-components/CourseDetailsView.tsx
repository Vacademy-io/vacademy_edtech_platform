import React, { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, Play, X } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, sanitizeHtml } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { RouteMatcher } from "../../-services/route-matcher";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { useSiteT } from "../../-utils/catalogue-locale";
import type { CourseAuthor } from "../../-utils/course-authors";
import { sharedAuthorRole } from "@/lib/course-author-role";
import type { CoursePageContext } from "../-utils/course-page-context";
import { coursePageTrail, plainText } from "../-utils/course-page-context";
import { embedUrlOf, seriesWindow, type CourseFaq, type PreviewVideo } from "../-utils/course-page-content";
import type { CourseSeries, SeriesStep } from "../-hooks/use-course-series";
import { AuthorAvatar } from "./AuthorAvatar";

/**
 * The course page's default layout (the "Course page – E-learning" and
 * "Course page – E-book" designs): breadcrumb, a hero with the course's
 * media, eyebrow, title, subtitle, facts strip, price box and series chips;
 * sticky tabs with one panel visible at a time (#hash deep links); a sticky
 * enrol card; "You may also like"; the site's app banner.
 *
 * Colours are the site palette (globalSettings.theme.palette → palette-*,
 * each falling back to the site's catalogue tokens), so a site without a
 * palette gets its own theme. The purchase actions, outline, related strip
 * and dialogs stay in CourseDetailsPage and come in as nodes, so this view
 * never forks the enrol / cart / payment flow.
 */

// Figma measures (1440 frame) with no Tailwind step of their own.
const HERO_MEDIA = "w-full lg:w-[520px] lg:shrink-0 rounded-[24px]"; // design-lint-ignore: Figma course hero media 520, radius 24
const TITLE = "text-3xl font-bold leading-tight text-palette-text sm:text-4xl lg:text-[40px] lg:leading-[48px]"; // design-lint-ignore: Figma course title 40/48
const SUBTITLE = "text-base font-medium leading-7 text-palette-body sm:text-lg"; // Figma 18/28
const EYEBROW = "text-xs font-bold uppercase leading-4 tracking-[1.3px] text-palette-gold"; // design-lint-ignore: Figma eyebrow tracking 1.3
const LABEL_CAPS = "text-[11px] font-bold uppercase leading-4 tracking-[1.2px] text-palette-gold"; // design-lint-ignore: Figma section label 11, tracking 1.2
const PILL = "rounded-xl border border-palette-border bg-white px-2.5 py-1 text-[11px] font-bold leading-[14px] text-palette-text"; // design-lint-ignore: Figma format pill 11/14
const FACTS_BOX = "rounded-[14px] border border-palette-border bg-white"; // design-lint-ignore: Figma facts radius 14
const FACT_LABEL = "text-[11px] leading-[14px] text-palette-muted"; // design-lint-ignore: Figma fact label 11/14
const PRICE_BOX = "rounded-2xl border-[1.5px] border-palette-accent bg-white px-5 py-[18px]"; // design-lint-ignore: Figma price box border 1.5, py 18
const PRICE = "text-[30px] font-bold leading-9"; // design-lint-ignore: Figma price 30/36
const CHIP = "rounded-[18px] px-3.5 py-2 text-[13px] leading-[18px] no-underline transition-colors"; // design-lint-ignore: Figma series chip 13/18, radius 18
const TAB = "shrink-0 border-b-[3px] px-4 pb-4 pt-[18px] text-[15px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary"; // design-lint-ignore: Figma tab 15/20, active rule 3
const ENROL_CARD = "flex w-full flex-col gap-3.5 rounded-[20px] border border-palette-border bg-palette-canvas p-6 shadow-[0_8px_24px_0_rgba(26,20,5,0.08)] lg:w-[340px]"; // design-lint-ignore: Figma enrol card 340, radius 20, shadow
const BODY = "course-richtext richtext-content text-base leading-[27px] text-palette-body"; // design-lint-ignore: Figma body 16/27
const SECTION_TITLE = "text-2xl font-bold leading-8 text-palette-text"; // Figma 24/32
const RELATED_TITLE = "text-3xl font-bold text-palette-text sm:text-[36px] sm:leading-[44px]"; // design-lint-ignore: Figma section title 36/44
const BREADCRUMB = "flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-palette-muted"; // design-lint-ignore: Figma breadcrumb 13/20
const WATCH = "absolute bottom-5 start-5 inline-flex items-center gap-2 rounded-3xl bg-palette-text/80 py-2.5 pe-4 ps-3.5 text-[13px] font-bold leading-[18px] text-white backdrop-blur-sm transition-colors hover:bg-palette-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"; // design-lint-ignore: Figma watch preview 13/18
const SHELL = "mx-auto w-full max-w-6xl px-4 sm:px-6 xl:px-0";

const PLACEHOLDER = "/api/placeholder";

/** The first of the course's images that resolves (card image, preview, banner…). */
const useCourseImage = (candidates: Array<string | null | undefined>) => {
  const ids = candidates.filter(
    (c): c is string => typeof c === "string" && !!c.trim() && !c.startsWith(PLACEHOLDER) && c !== "null",
  );
  const key = ids.join("|");
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    setUrl("");
    (async () => {
      for (const id of ids) {
        if (/^https?:\/\//i.test(id)) {
          if (alive) setUrl(id);
          return;
        }
        try {
          const resolved = await getPublicUrlWithoutLogin(id);
          if (resolved) {
            if (alive) setUrl(resolved);
            return;
          }
        } catch {
          /* try the next image */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `key` stands for `ids`, whose array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
};

/**
 * The hero's media keeps the image's own shape (a 3:2 cover with text at its
 * edges must not be cropped to the design's square), between portrait (4:5)
 * and 16:9; square until it has loaded.
 */
export const clampRatio = (w: number, h: number) => Math.min(16 / 9, Math.max(4 / 5, w / h));

const HeroMedia: React.FC<{
  url: string;
  alt: string;
  isBook: boolean;
  preview: PreviewVideo | null;
  onPreview: () => void;
}> = ({ url, alt, isBook, preview, onPreview }) => {
  const { t } = useTranslation("coursePlayerB");
  const [ratio, setRatio] = useState(1);
  return (
    <div
      className={cn(HERO_MEDIA, "relative overflow-hidden bg-palette-sand")}
      style={{ aspectRatio: String(ratio) }} // design-lint-ignore: the image's own shape (dynamic)
    >
      <img
        src={url}
        alt={alt}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) setRatio(clampRatio(img.naturalWidth, img.naturalHeight));
        }}
        className={cn(
          "absolute inset-0 size-full",
          // E-book covers sit on the cream sand, their white page blending in.
          isBook ? "object-contain mix-blend-multiply" : "object-cover",
        )}
      />
      {preview && (
        <button type="button" onClick={onPreview} className={WATCH}>
          <Play size={12} weight="fill" aria-hidden />
          {t("courseDetails.page.watchPreview", "Watch preview")}
        </button>
      )}
    </div>
  );
};

/** The preview video in a modal (YouTube / Vimeo embedded, a file or URL in <video>). */
const PreviewDialog: React.FC<{
  video: PreviewVideo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}> = ({ video, open, onOpenChange, title }) => {
  const { t } = useTranslation("coursePlayerB");
  const [fileUrl, setFileUrl] = useState("");
  useEffect(() => {
    let alive = true;
    setFileUrl("");
    if (!open || !video) return;
    if (video.kind === "url") setFileUrl(video.url);
    if (video.kind === "file") {
      getPublicUrlWithoutLogin(video.id)
        .then((u) => {
          if (alive && u) setFileUrl(u);
        })
        .catch(() => {
          /* nothing to play */
        });
    }
    return () => {
      alive = false;
    };
  }, [open, video]);
  if (!video) return null;
  const embed = embedUrlOf(video);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-hidden border-0 bg-black p-0">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative aspect-video w-full">
          {open && embed && (
            <iframe
              src={embed}
              title={title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="absolute inset-0 size-full"
            />
          )}
          {open && !embed && fileUrl && <video src={fileUrl} controls autoPlay className="absolute inset-0 size-full" />}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t("courseDetails.page.closePreview", "Close preview")}
          className="absolute end-3 top-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
        >
          <X size={16} aria-hidden />
        </button>
      </DialogContent>
    </Dialog>
  );
};

export interface CourseFact {
  label: string;
  value: string;
}

export interface CoursePriceView {
  /** False when the site hides prices (payment off): the box keeps its action. */
  show: boolean;
  pending: boolean;
  free: boolean;
  /** "Free" or "₹551", formatted by the page. */
  text: string;
  /** The struck-through price, formatted; empty for none. */
  mrpText: string;
  /** The line under the price. */
  hint: string;
}

export type CourseTabId = "description" | "content" | "audience" | "language" | "faq" | "instructor";
const TAB_IDS: CourseTabId[] = ["description", "content", "audience", "language", "faq", "instructor"];

export interface CourseDetailsViewProps {
  /** In the visitor's language. */
  title: string;
  /** The line under the title (the course's short description). */
  subtitle: string;
  aboutHtml: string;
  whyLearnHtml: string;
  whoShouldLearnHtml: string;
  /** The course's images, best first (media ids or URLs). */
  imageCandidates: Array<string | null | undefined>;
  previewVideo: PreviewVideo | null;
  /** The E-book variant: its labels (Table of Contents, About the Author…) and cover treatment. */
  isBook: boolean;
  /** False when the site renders its own course header ("details" page). */
  showHeader: boolean;
  context: CoursePageContext;
  /** The facts strip under the subtitle (Mode, Language, Format, Duration…). */
  facts: CourseFact[];
  /** "This course includes" rows of the enrol card. */
  includes: CourseFact[];
  /** Visible authors, in the visitor's language. */
  authors: CourseAuthor[];
  faqs: CourseFaq[];
  /** The course's language and, when it has versions, the picker. */
  languageLabel: string | null;
  languagePicker?: React.ReactNode;
  price: CoursePriceView;
  /** The purchase action(s), built by the page (the enrol card; the hero too unless heroActions). */
  actions: React.ReactNode;
  /** The hero price box's action(s), when they lay out differently there (cart buttons side by side). */
  heroActions?: React.ReactNode;
  series: CourseSeries | null;
  /** At most this many "Part of" chips, around the current course (globalSettings.courseDetails.seriesLimit). Default: all. */
  seriesLimit?: unknown;
  /** A series step's price ("₹551", "Free"), or "". */
  formatStepPrice: (step: SeriesStep) => string;
  /** A series step's format label ("E-Learning"), or "". */
  stepFormat: (step: SeriesStep) => string;
  outline: React.ReactNode;
  /** False: no Course content / Table of Contents tab (globalSettings.courseDetails.content). Default true. */
  showContent?: boolean;
  /** "You may also like" (a course strip that brings its own section), or null. */
  related: React.ReactNode;
  /** The site's app banner, or null. */
  closingBanner: React.ReactNode;
  tagName: string;
}

/** A course page link for a series step (the search the course cards use). */
export const stepHref = (tagName: string, step: Pick<SeriesStep, "courseId" | "enrollInviteId" | "packageSessionId">) => {
  const q = new URLSearchParams();
  if (step.enrollInviteId) q.set("enrollInviteId", step.enrollInviteId);
  if (step.packageSessionId) q.set("packageSessionId", step.packageSessionId);
  const qs = q.toString();
  return `${RouteMatcher.basePath(tagName)}/${step.courseId}${qs ? `?${qs}` : ""}`;
};

const hashTab = (): CourseTabId | null => {
  const h = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  return (TAB_IDS as string[]).includes(h) ? (h as CourseTabId) : null;
};

export const CourseDetailsView: React.FC<CourseDetailsViewProps> = (props) => {
  const {
    title,
    subtitle,
    aboutHtml,
    whyLearnHtml,
    whoShouldLearnHtml,
    imageCandidates,
    previewVideo,
    isBook,
    showHeader,
    context,
    facts,
    includes,
    authors,
    faqs,
    languageLabel,
    languagePicker,
    price,
    actions,
    heroActions,
    series,
    seriesLimit,
    formatStepPrice,
    stepFormat,
    outline,
    showContent = true,
    related,
    closingBanner,
    tagName,
  } = props;
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const siteNavigate = useSiteNavigate();
  const imageUrl = useCourseImage(showHeader ? imageCandidates : []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const baseId = useId();

  // The tab says which course this is (restored when the page goes).
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);

  const hasAbout = !!plainText(aboutHtml) || !!plainText(whyLearnHtml);
  const hasAudience = !!plainText(whoShouldLearnHtml);
  const hasLanguage = !!languageLabel || !!languagePicker;
  // Each author's role, joined so the tab memo below keys on a string.
  const authorRoleKey = authors.map((a) => a.role ?? "").join("\u0000");
  const authorRoles = useMemo(() => (authorRoleKey ? authorRoleKey.split("\u0000") : []), [authorRoleKey]);
  const tabs = useMemo(() => {
    const list: Array<{ id: CourseTabId; label: string }> = [];
    if (hasAbout) list.push({ id: "description", label: t("courseDetails.page.tabDescription", "Description") });
    if (showContent) {
      list.push({
        id: "content",
        label: isBook ? t("courseDetails.page.tabToc", "Table of Contents") : t("courseDetails.page.tabContent", "Course content"),
      });
    }
    if (hasAudience) list.push({ id: "audience", label: t("courseDetails.page.tabAudience", "Who should do this course") });
    if (hasLanguage) list.push({ id: "language", label: t("courseDetails.page.tabLanguage", "Language") });
    if (faqs.length) list.push({ id: "faq", label: t("courseDetails.page.tabFaq", "FAQ") });
    if (authors.length) {
      list.push({
        id: "instructor",
        // The admin's role word (e.g. "Acharya") when every author shares one.
        label: sharedAuthorRole(
          authorRoles,
          isBook ? t("courseDetails.page.tabAuthor", "About the Author") : t("courseDetails.page.tabInstructor", "About the Instructor"),
        ),
      });
    }
    return list;
  }, [hasAbout, hasAudience, hasLanguage, isBook, showContent, faqs.length, authors.length, authorRoles, t]);

  // One panel at a time; #content, #faq… open (and are kept in) the address.
  const [active, setActive] = useState<CourseTabId | null>(hashTab);
  const current: CourseTabId | null =
    tabs.find((tab) => tab.id === active)?.id ?? tabs[0]?.id ?? (showContent ? "content" : null);
  useEffect(() => {
    const onHash = () => {
      const h = hashTab();
      if (h) setActive(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const openTab = (id: CourseTabId) => {
    setActive(id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
  };
  const onTabKey = (event: React.KeyboardEvent, index: number) => {
    const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const delta = event.key === forward ? 1 : event.key === back ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) {
      openTab(next.id);
      document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
    }
  };

  const crumbs = [
    { key: "home", label: t("courseDetails.page.home", "Home"), href: RouteMatcher.pagePath(tagName) },
    // Home / stream / category / course, or Home / Courses / course outside any stream.
    ...coursePageTrail(context.breadcrumb).map((c, i) => {
      const query = c.search ? `?${new URLSearchParams(c.search).toString()}` : "";
      return {
        key: `${c.route}-${i}`,
        label: c.label ? siteT(c.label) : t("courseDetails.page.courses", "Courses"),
        href: `${RouteMatcher.pagePath(tagName, c.route)}${query}`,
      };
    }),
  ];
  const go = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void siteNavigate(href);
  };

  const stream = context.stream;
  const formatPill = context.formatLabels[0] ? siteT(context.formatLabels[0]) : "";
  const next = series?.next ?? null;

  const priceBlock = (withHint: boolean) =>
    price.show ? (
      <div className="min-w-0 flex-1">
        {price.pending ? (
          <span role="status" className="block h-9 w-24 animate-pulse rounded-md bg-palette-sand">
            <span className="sr-only">{t("courseDetails.priceLoading", "Loading price")}</span>
          </span>
        ) : (
          <p className="flex flex-wrap items-baseline gap-2">
            <span className={cn(PRICE, price.free ? "text-palette-olive" : "text-palette-text")}>{price.text}</span>
            {price.mrpText && <s className="text-sm text-palette-muted">{price.mrpText}</s>}
          </p>
        )}
        {withHint && price.hint && <p className="text-xs leading-4 text-palette-muted">{price.hint}</p>}
      </div>
    ) : null;

  const panel = (() => {
    switch (current) {
      case "description":
        return (
          <div className="flex flex-col gap-11">
            {plainText(aboutHtml) && (
              <div className="flex flex-col gap-3.5">
                <h2 className={SECTION_TITLE}>
                  {isBook ? t("courseDetails.page.aboutBook", "About this E-book") : t("courseDetails.page.aboutCourse", "About this course")}
                </h2>
                <div className={BODY} dangerouslySetInnerHTML={{ __html: sanitizeHtml(aboutHtml) }} />
              </div>
            )}
            {plainText(whyLearnHtml) && (
              <div className="flex flex-col gap-3.5">
                <h2 className={SECTION_TITLE}>{t("courseDetails.accordion.whatYoullLearn")}</h2>
                <div className={BODY} dangerouslySetInnerHTML={{ __html: sanitizeHtml(whyLearnHtml) }} />
              </div>
            )}
          </div>
        );
      case "content":
        return outline;
      case "audience":
        return (
          <div className="flex flex-col gap-3.5">
            <h2 className={SECTION_TITLE}>{t("courseDetails.page.tabAudience", "Who should do this course")}</h2>
            <div className={BODY} dangerouslySetInnerHTML={{ __html: sanitizeHtml(whoShouldLearnHtml) }} />
          </div>
        );
      case "language":
        return (
          <div className="flex flex-col gap-3.5">
            <h2 className={SECTION_TITLE}>{t("courseDetails.page.tabLanguage", "Language")}</h2>
            {languageLabel && (
              <p className={BODY}>
                {isBook
                  ? t("courseDetails.page.languageBook", { language: languageLabel, defaultValue: "This E-book is in {{language}}." })
                  : t("courseDetails.page.languageCourse", { language: languageLabel, defaultValue: "This course is in {{language}}." })}
              </p>
            )}
          </div>
        );
      case "faq":
        return (
          <div className="flex flex-col gap-3.5">
            <h2 className={SECTION_TITLE}>{t("courseDetails.page.faqTitle", "Frequently asked questions")}</h2>
            <div className="divide-y divide-palette-border rounded-2xl border border-palette-border bg-white">
              {faqs.map((f, i) => (
                <details key={`${i}-${f.q}`} className="group px-5 py-4" open={i === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-palette-text">
                    {siteT(f.q)}
                    <CaretDown
                      size={16}
                      weight="bold"
                      aria-hidden
                      className="shrink-0 text-palette-muted transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className={cn(BODY, "mt-2")} dangerouslySetInnerHTML={{ __html: sanitizeHtml(siteT(f.a)) }} />
                </details>
              ))}
            </div>
          </div>
        );
      case "instructor":
        return (
          <div className="flex flex-col gap-6">
            {authors.map((a, i) => (
              <div key={`${a.id}-${i}`} className="flex items-start gap-4">
                <AuthorAvatar author={a} sizeClass="size-14" />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-palette-text">{a.name}</h2>
                  {a.role && <p className="text-sm font-medium text-palette-muted">{a.role}</p>}
                  {a.subtitle && <p className="text-sm text-palette-muted">{a.subtitle}</p>}
                  {a.description && plainText(a.description) && (
                    <div className={cn(BODY, "mt-2")} dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.description) }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="w-full bg-white pb-20 lg:pb-0">
      {showHeader && (
        <>
          <nav aria-label={t("courseDetails.page.breadcrumb", "Breadcrumb")} className="bg-palette-cream pt-5">
            <ol className={cn(SHELL, BREADCRUMB)}>
              {crumbs.map((c) => (
                <li key={c.key} className="flex items-center gap-2">
                  <a href={c.href} onClick={(e) => go(e, c.href)} className="no-underline hover:text-palette-primary hover:underline">
                    {c.label}
                  </a>
                  <span aria-hidden>/</span>
                </li>
              ))}
              <li aria-current="page" className="line-clamp-1">
                {title}
              </li>
            </ol>
          </nav>

          <section className="bg-palette-cream pb-14 pt-8">
            <div className={cn(SHELL, "flex flex-col items-center gap-8 lg:flex-row lg:gap-14")}>
              {imageUrl && (
                <HeroMedia url={imageUrl} alt={title} isBook={isBook} preview={previewVideo} onPreview={() => setPreviewOpen(true)} />
              )}
              <div className="flex w-full min-w-0 flex-1 flex-col items-start gap-4">
                {(stream || formatPill) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {stream?.imageUrl && (
                      <span
                        className="relative size-7 shrink-0 overflow-hidden rounded-full bg-palette-olive"
                        style={stream.accentColor ? { backgroundColor: stream.accentColor } : undefined} // design-lint-ignore: stream accent colour is folder data
                      >
                        <img src={stream.imageUrl} alt="" className="absolute inset-0 size-full object-contain p-0.5" />
                      </span>
                    )}
                    {stream && <span className={EYEBROW}>{siteT(stream.label)}</span>}
                    {formatPill && <span className={PILL}>{formatPill}</span>}
                  </div>
                )}
                <h1 className={TITLE}>{title}</h1>
                {subtitle && <p className={SUBTITLE}>{subtitle}</p>}
                {facts.length > 1 && (
                  <dl className={cn(FACTS_BOX, "grid w-full grid-cols-2 overflow-hidden sm:flex")}>
                    {facts.map((f, i) => (
                      <div
                        key={f.label}
                        className={cn(
                          "flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3",
                          i % 2 === 1 && "border-s border-palette-border",
                          i > 0 && i % 2 === 0 && "sm:border-s sm:border-palette-border",
                          i >= 2 && "border-t border-palette-border sm:border-t-0",
                        )}
                      >
                        <dt className={FACT_LABEL}>{f.label}</dt>
                        <dd className="text-sm font-bold leading-5 text-palette-text">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className={cn(PRICE_BOX, "flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:gap-5")}>
                  {priceBlock(true)}
                  <div className="w-full shrink-0 sm:w-auto">{heroActions ?? actions}</div>
                </div>
                {series && (
                  <div className="flex w-full flex-col gap-2.5 pt-1">
                    <p className={LABEL_CAPS}>
                      {t("courseDetails.page.partOf", { name: siteT(series.name), defaultValue: "Part of {{name}}" })}
                    </p>
                    <ol className="flex flex-wrap gap-2">
                      {seriesWindow(series.steps, seriesLimit).map(({ step, number }) => {
                        const href = stepHref(tagName, step);
                        return (
                          <li key={step.key}>
                            {step.current ? (
                              <span aria-current="step" className={cn(CHIP, "inline-block bg-palette-primary font-bold text-white")}>
                                {number}&nbsp;&nbsp;{siteT(step.label)}
                              </span>
                            ) : (
                              <a
                                href={href}
                                onClick={(e) => go(e, href)}
                                title={siteT(step.title)}
                                className={cn(
                                  CHIP,
                                  "inline-block border border-palette-outline bg-white font-medium text-palette-text hover:border-palette-primary hover:text-palette-primary",
                                )}
                              >
                                {number}&nbsp;&nbsp;{siteT(step.label)}
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Tabs stick under the header only while the course details are on screen. */}
      <div>
      {/* No tabs at all (every part off): no empty bar. */}
      {tabs.length > 0 && (
      <div className="sticky top-16 z-30 border-b border-palette-border bg-white md:top-20">
        <div role="tablist" aria-label={title} className={cn(SHELL, "catalogue-no-scrollbar flex gap-1 overflow-x-auto")}>
          {tabs.map((tab, i) => {
            const selected = tab.id === current;
            return (
              <button
                key={tab.id}
                id={`${baseId}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => openTab(tab.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn(
                  TAB,
                  selected
                    ? "border-palette-primary font-bold text-palette-primary"
                    : "border-transparent font-medium text-palette-text hover:text-palette-primary",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      )}

      <section className="pb-20 pt-10 lg:pt-14">
        <div className={cn(SHELL, "flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-14")}>
          <div id={`${baseId}-panel`} role={current ? "tabpanel" : undefined} aria-labelledby={current ? `${baseId}-tab-${current}` : undefined} className="min-w-0 flex-1">
            {panel}
          </div>
          <aside className="w-full lg:sticky lg:top-40 lg:w-auto">
            <div className={ENROL_CARD}>
              {priceBlock(false)}
              {/* The version picker decides what is bought: beside the price, always. */}
              {languagePicker}
              {actions}
              {includes.length > 0 && (
                <>
                  <div className="h-px w-full bg-palette-border" />
                  <p className={LABEL_CAPS}>
                    {isBook ? t("courseDetails.page.bookIncludes", "This E-book includes") : t("courseDetails.page.courseIncludes", "This course includes")}
                  </p>
                  <dl className="flex flex-col gap-3.5">
                    {includes.map((row) => (
                      <div key={row.label} className="flex items-start justify-between gap-4 text-sm leading-5">
                        <dt className="text-palette-muted">{row.label}</dt>
                        <dd className="text-end font-semibold text-palette-text">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {next && !isBook && (
                <a
                  href={stepHref(tagName, next)}
                  onClick={(e) => go(e, stepHref(tagName, next))}
                  className="flex flex-col gap-1 rounded-xl bg-palette-cream p-3.5 no-underline transition-colors hover:bg-palette-sand"
                >
                  <span className={LABEL_CAPS}>{t("courseDetails.page.nextInSeries", "Next in the series")}</span>
                  <span className="text-sm font-bold leading-5 text-palette-text">{siteT(next.title)}</span>
                  <span className="text-xs leading-4 text-palette-primary">
                    {[stepFormat(next), formatStepPrice(next), `${t("courseDetails.page.view", "View")}  →`].filter(Boolean).join("  ·  ")}
                  </span>
                </a>
              )}
            </div>
          </aside>
        </div>
      </section>

      </div>

      {related}
      {closingBanner}

      <PreviewDialog video={previewVideo} open={previewOpen} onOpenChange={setPreviewOpen} title={title} />
    </div>
  );
};

/** The "You may also like" header: title, and "View all courses" to the Courses page. */
export const RelatedHeader: React.FC<{ allHref: string | null }> = ({ allHref }) => {
  const { t } = useTranslation("coursePlayerB");
  const siteNavigate = useSiteNavigate();
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 className={RELATED_TITLE}>{t("courseDetails.page.youMayAlsoLike", "You may also like")}</h2>
      {allHref && (
        <a
          href={allHref}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            void siteNavigate(allHref);
          }}
          className="shrink-0 text-sm font-bold leading-5 text-palette-primary no-underline hover:underline"
        >
          {t("courseDetails.page.viewAllCourses", "View all courses")}&nbsp;&nbsp;→
        </a>
      )}
    </div>
  );
};

/** "You may also like" band: the cream section the strip sits in. */
export const RELATED_SECTION_CLASS = "bg-palette-cream pb-24 pt-16";
export const RELATED_SHELL_CLASS = SHELL;

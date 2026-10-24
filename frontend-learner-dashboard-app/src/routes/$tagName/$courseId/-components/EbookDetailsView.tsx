import React, { useEffect, useMemo, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useTranslation } from "react-i18next";
import { BookOpen, CaretRight, CheckCircle, FilePdf, Lightning } from "@phosphor-icons/react";
import { PriceWithMrp } from "@/components/common/price-with-mrp";
import { cn, sanitizeHtml } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { CourseShowcaseComponent } from "../../-components/components/CourseShowcaseComponent";
import { RouteMatcher } from "../../-services/route-matcher";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { useSiteT } from "../../-utils/catalogue-locale";
import type { FolderCrumb } from "../-utils/folder-trail";

/**
 * The course page as a single-file product ("ebook" layout, opt-in per site
 * through catalogue globalSettings.courseDetails.layout = "ebook", or per
 * institute through Student Display Settings -> courseDetails.layout).
 *
 * An institute that sells individual PDFs has nothing to show in the course
 * outline, level, rating or duration rows; what a visitor needs is the cover,
 * the folder it sits in, the price and the buy actions. The purchase actions
 * and every dialog stay in CourseDetailsPage, which passes them in as `actions`
 * so this view never forks the enrol / cart / payment flow.
 */
export interface EbookDetailsViewProps {
  title: string;
  /** Media-service file id or a direct URL. */
  coverFileId?: string | null;
  aboutHtml?: string | null;
  /** The course's "why learn" field: what a reader gets from this PDF. */
  learnHtml?: string | null;
  /** The course's "who should learn" field. */
  audienceHtml?: string | null;
  /** Course tags; the institute files each PDF under its folder names. */
  tags?: string[];
  /**
   * The folders above this PDF, each linking to the page that shows it (see
   * folder-trail). Absent: the tags, as plain text.
   */
  crumbs?: FolderCrumb[] | null;
  price?: number | null;
  elevatedPrice?: number | null;
  currency?: string | null;
  pricePending?: boolean;
  /** False when the site hides prices (payment switched off). */
  showPrice?: boolean;
  /** Buy / add-to-cart / enrol buttons, rendered by the parent page. */
  actions: React.ReactNode;
  instituteId: string;
  tagName: string;
  globalSettings?: unknown;
}

const PLACEHOLDER_PREFIX = "/api/placeholder";

const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Sanitised HTML, or "" when it carries no visible text. */
const cleanHtml = (html?: string | null) => {
  if (!html?.trim()) return "";
  const safe = sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(safe, "text/html");
  return normalise(doc.body.textContent ?? "") ? safe : "";
};

/** Drops description paragraphs that only repeat the title shown above them. */
const withoutTitleRepeat = (html: string, title: string) => {
  const target = normalise(title);
  if (!target) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("p, h1, h2, h3").forEach((el) => {
    if (normalise(el.textContent ?? "") === target) el.remove();
  });
  return doc.body.innerHTML.trim();
};

const useResolvedCover = (fileId?: string | null) => {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl("");
    setFailed(false);
    if (!fileId || fileId.startsWith(PLACEHOLDER_PREFIX)) {
      setFailed(true);
      return;
    }
    getPublicUrlWithoutLogin(fileId)
      .then((u) => {
        if (!alive) return;
        if (u) setUrl(u);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [fileId]);
  return { url, failed };
};

export const EbookDetailsView: React.FC<EbookDetailsViewProps> = ({
  title,
  coverFileId,
  aboutHtml,
  learnHtml,
  audienceHtml,
  tags = [],
  crumbs,
  price,
  elevatedPrice,
  currency,
  pricePending = false,
  showPrice = true,
  actions,
  instituteId,
  tagName,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const { url: coverUrl, failed: coverFailed } = useResolvedCover(coverFileId);
  const siteT = useSiteT();
  const siteNavigate = useSiteNavigate();
  const trail: Array<{ key: string; label: string; href: string | null }> = crumbs?.length
    ? crumbs.map((c) => ({
        key: c.key,
        // Folder names are live library data, translated where shown (as the Folder Browser does).
        label: siteT(c.title),
        href:
          c.route === null
            ? null
            : `${RouteMatcher.pagePath(tagName, c.route)}${
                c.folderId ? `?folder=${encodeURIComponent(c.folderId)}` : ""
              }`,
      }))
    : tags.filter(Boolean).map((name, i) => ({ key: `${name}-${i}`, label: name, href: null }));
  const folders = tags.filter(Boolean);
  const folder = folders[folders.length - 1];
  const openCrumb = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    // A new tab / window keeps the browser's own behaviour.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void siteNavigate(href);
  };
  const about = useMemo(
    () => (aboutHtml?.trim() ? withoutTitleRepeat(sanitizeHtml(aboutHtml), title) : ""),
    [aboutHtml, title],
  );
  const learn = useMemo(() => cleanHtml(learnHtml), [learnHtml]);
  const audience = useMemo(() => cleanHtml(audienceHtml), [audienceHtml]);
  const detailCards = [
    { key: "learn", html: learn, title: t("courseDetails.ebook.learnTitle", "What you'll learn") },
    { key: "audience", html: audience, title: t("courseDetails.ebook.audienceTitle", "Who is this for") },
  ].filter((card) => card.html);

  const perks = [
    { icon: FilePdf, label: t("courseDetails.ebook.perkPdf", "PDF eBook") },
    { icon: Lightning, label: t("courseDetails.ebook.perkInstant", "Instant access after payment") },
    { icon: BookOpen, label: t("courseDetails.ebook.perkRead", "Read on the web and in the app") },
  ];

  return (
    <div className="w-full bg-catalogue-bg-subtle pb-24">
      <section className="w-full border-b border-catalogue-border bg-catalogue-bg">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {trail.length > 0 && (
            <nav
              aria-label={t("courseDetails.ebook.folderPath", "Folder")}
              className="mb-6 flex flex-wrap items-center gap-1 text-xs font-medium text-catalogue-text-muted"
            >
              {trail.map((crumb, i) => {
                const last = i === trail.length - 1;
                return (
                  <React.Fragment key={crumb.key}>
                    {i > 0 && <CaretRight size={12} weight="bold" aria-hidden />}
                    {crumb.href ? (
                      <a
                        href={crumb.href}
                        onClick={(event) => openCrumb(event, crumb.href!)}
                        className={cn(
                          "rounded-sm no-underline transition-colors hover:text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                          last && "text-primary-500",
                        )}
                      >
                        {crumb.label}
                      </a>
                    ) : (
                      <span className={cn(last && "text-primary-500")}>{crumb.label}</span>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>
          )}

          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-catalogue-border bg-catalogue-bg-muted shadow-lg">
                {coverUrl ? (
                  <FitImage src={coverUrl} alt={title} className="h-full w-full" />
                ) : coverFailed ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-catalogue-text-muted">
                    <FilePdf size={48} weight="duotone" className="text-primary-500" aria-hidden />
                    <span className="text-sm font-medium">{title}</span>
                  </div>
                ) : (
                  <div className="h-full w-full animate-pulse bg-catalogue-bg-muted" />
                )}
                <span className="absolute start-3 top-3 inline-flex items-center gap-1 rounded-full bg-catalogue-bg-elevated px-3 py-1 text-xs font-semibold text-primary-500 shadow-sm">
                  <FilePdf size={14} weight="fill" aria-hidden />
                  {t("courseDetails.ebook.badge", "PDF")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-5 lg:col-span-5">
              <h1 className="text-2xl font-bold leading-tight text-catalogue-text-primary sm:text-3xl">
                {title}
              </h1>

              {showPrice && (
                <div className="flex items-end gap-3">
                  {pricePending ? (
                    <div
                      className="h-9 w-28 animate-pulse rounded-catalogue-md bg-catalogue-bg-muted"
                      aria-label={t("courseDetails.priceLoading", "Loading price")}
                    />
                  ) : (
                    <PriceWithMrp
                      actual={price ?? 0}
                      elevated={elevatedPrice}
                      currency={currency}
                      size="xl"
                    />
                  )}
                </div>
              )}

              <div className="space-y-2">{actions}</div>

              <ul className="space-y-2 rounded-catalogue-md border border-catalogue-border bg-catalogue-bg-subtle p-4">
                {perks.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-3 text-sm text-catalogue-text-secondary">
                    <CheckCircle size={18} weight="fill" className="shrink-0 text-primary-500" aria-hidden />
                    <span className="flex items-center gap-2">
                      <Icon size={16} weight="duotone" className="text-catalogue-text-muted" aria-hidden />
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {about && (
        <section className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-catalogue-border bg-catalogue-bg p-6 sm:p-8">
            <h2 className="mb-4 text-lg font-semibold text-catalogue-text-primary">
              {t("courseDetails.ebook.aboutTitle", "About this PDF")}
            </h2>
            <div
              className="richtext-content text-sm leading-relaxed text-catalogue-text-secondary"
              dangerouslySetInnerHTML={{ __html: about }}
            />
          </div>
        </section>
      )}

      {detailCards.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
          <div className={cn("grid grid-cols-1 gap-4", detailCards.length > 1 && "md:grid-cols-2")}>
            {detailCards.map((card) => (
              <div
                key={card.key}
                className="rounded-2xl border border-catalogue-border bg-catalogue-bg p-6 sm:p-8"
              >
                <h2 className="mb-4 text-lg font-semibold text-catalogue-text-primary">{card.title}</h2>
                <div
                  className="richtext-content text-sm leading-relaxed text-catalogue-text-secondary"
                  dangerouslySetInnerHTML={{ __html: card.html }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {folder && (
        <section className="mx-auto w-full max-w-6xl pt-4">
          <CourseShowcaseComponent
            title={t("courseDetails.ebook.moreFrom", {
              defaultValue: "More from {{folder}}",
              folder,
            })}
            source="tag"
            tag={folder}
            limit={4}
            layout="row"
            instituteId={instituteId}
            tagName={tagName}
            globalSettings={globalSettings as never}
          />
        </section>
      )}
    </div>
  );
};

export default EbookDetailsView;

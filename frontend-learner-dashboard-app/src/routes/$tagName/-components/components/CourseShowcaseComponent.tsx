import React, { useEffect, useMemo, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { RouteMatcher } from "../../-services/route-matcher";
import axios from "axios";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { urlCourseDetails } from "@/constants/urls";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { OfferBadge, PriceWithMrp } from "@/components/common/price-with-mrp";
import { cn } from "@/lib/utils";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
    type ComingSoonInfo,
    formatLaunchDate,
    openComingSoonForm,
    readComingSoon,
} from "../../-utils/coming-soon";
import { ComingSoonRibbon } from "./ComingSoonRibbon";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import type { CatalogEditorialCardConfig } from "../../-types/catalog-cards-types";
import { EditorialShowcaseGrid } from "./catalog/EditorialShowcaseGrid";

/**
 * A CURATED strip of courses — "new", "on sale", one tag, or a hand-picked
 * list — for promoting a few courses on a landing page.
 *
 * This is deliberately not `productCourseGrid`: that component renders the
 * WHOLE catalogue with search, sort and a filter sidebar, and has no way to
 * limit or curate what it shows. Pricing and the discount ribbon reuse the
 * shared PriceWithMrp/OfferBadge so a promoted card matches a catalogue card
 * exactly, including reader-mode hiding and the FREE ribbon.
 */

/** Where the strip's courses come from. "comingSoon" = every course the admin
 *  has switched to Coming Soon, newest first. */
export type CourseShowcaseSource = "newest" | "onSale" | "tag" | "picked" | "comingSoon";

/** Ribbon palette. Every class here is a real built utility — an invented
 *  colour name compiles fine and renders an unstyled pill. */
export type CourseShowcaseBadgeTone = "hot" | "new" | "limited" | "neutral";

const BADGE_TONE: Record<CourseShowcaseBadgeTone, string> = {
    hot: "bg-danger-500 text-white",
    new: "bg-success-600 text-white",
    limited: "bg-warning-500 text-white",
    neutral: "bg-neutral-800 text-white",
};

interface ShowcaseCourse {
    id: string;
    title: string;
    description: string;
    thumbnailId: string;
    price: number;
    elevatedPrice?: number;
    currency?: string;
    tags: string[];
    level?: string;
    enrollInviteId?: string;
    packageSessionId?: string;
    comingSoon: ComingSoonInfo | null;
    /** Raw search fields, read only by the editorial card (cardStyle "editorial"). */
    tagsRaw?: string | null;
    comingSoonRaw?: unknown;
    availability?: string | null;
}

export interface CourseShowcaseProps {
    title?: string;
    subtitle?: string;
    source?: CourseShowcaseSource;
    /** Tag to match when source is "tag" (case-insensitive). */
    tag?: string;
    /** Course ids to show, in order, when source is "picked". */
    courseIds?: string[];
    /** Courses never listed (the course page's own course, in its "More in …" strip). */
    excludeCourseIds?: string[];
    /** Titles never listed, ignoring case and spacing (the same book's other listings). */
    excludeTitles?: string[];
    limit?: number;
    layout?: "row" | "grid";
    /** Optional ribbon on each card — "Hot", "Only 5 seats", anything. */
    badgeText?: string;
    /** Ribbon colour. Free text still works; this only picks the palette. */
    badgeTone?: CourseShowcaseBadgeTone;
    /** Per-course overrides, keyed by course id. A hand-picked strip usually
     *  wants a different ribbon per card ("Exclusive" vs "Latest"), so these
     *  win over the section-wide badgeText/badgeTone above. */
    courseBadges?: Record<string, { text?: string; tone?: CourseShowcaseBadgeTone }>;
    backgroundColor?: string;
    /**
     * A strip placed inside another page section (the course page's "You may
     * also like"): this header replaces the centred title and subtitle, and
     * the band takes `sectionClassName` / `shellClassName` instead of the
     * catalogue section's. The whole band, header included, still hides when
     * nothing is left to show.
     */
    header?: React.ReactNode;
    sectionClassName?: string;
    shellClassName?: string;
    /** Editorial cards per row on large screens (default 3). */
    columns?: 3 | 4;
    /** "editorial" = the catalogue's editorial course card (opt-in; absent = this strip's own card). */
    cardStyle?: "default" | "editorial";
    /** Editorial card options — same shape as courseCatalog render.card. */
    card?: CatalogEditorialCardConfig;
    /** Folder library of the stream line on editorial cards (the catalogue's streams library). */
    streamsLibraryId?: string;
    instituteId?: string;
    tagName?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalSettings?: any;
}

const splitTags = (raw: unknown): string[] =>
    typeof raw === "string"
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : Array.isArray(raw)
          ? (raw as unknown[]).map((s) => String(s).trim()).filter(Boolean)
          : [];

/** Resolves a media-service file id to a URL; a direct URL passes through. */
const ShowcaseImage: React.FC<{ fileId: string; alt: string }> = ({ fileId, alt }) => {
    const [url, setUrl] = useState("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        if (!fileId) {
            setFailed(true);
            return;
        }
        getPublicUrlWithoutLogin(fileId)
            .then((u) => alive && (u ? setUrl(u) : setFailed(true)))
            .catch(() => alive && setFailed(true));
        return () => {
            alive = false;
        };
    }, [fileId]);

    if (failed) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-catalogue-bg-muted px-4 text-center text-sm font-medium text-catalogue-text-muted">
                {alt}
            </div>
        );
    }
    if (!url) return <div className="h-full w-full animate-pulse bg-catalogue-bg-muted" />;
    return <FitImage src={url} alt={alt} loading="lazy" className="h-full w-full" />;
};

export const CourseShowcaseComponent: React.FC<CourseShowcaseProps> = ({
    title,
    subtitle,
    source = "newest",
    tag,
    courseIds,
    excludeCourseIds,
    excludeTitles,
    limit = 3,
    layout = "row",
    badgeText,
    badgeTone = "hot",
    courseBadges,
    backgroundColor,
    header,
    sectionClassName,
    shellClassName,
    columns,
    cardStyle,
    card,
    streamsLibraryId,
    instituteId,
    tagName,
    globalSettings,
}) => {
    const editorial = cardStyle === "editorial";
    const { t, i18n } = useTranslation("coursePlayerB");
    const navigate = useNavigate();
    // Course names are live data: translated where shown, never in the
    // filters (tag, picked ids) or the navigation below.
    const siteT = useSiteT();
    const siteLocale = useCatalogueLocale();
    const [courses, setCourses] = useState<ShowcaseCourse[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        if (!instituteId) {
            setLoading(false);
            return;
        }
        // Same open search endpoint the catalogue grid uses. `createdAt,desc`
        // is what makes "newest" simply the first N — no client-side date sort.
        axios
            .post(
                urlCourseDetails,
                {
                    status: [],
                    level_ids: [],
                    faculty_ids: [],
                    search_by_name: "",
                    tag: [],
                    min_percentage_completed: 0,
                    max_percentage_completed: 0,
                },
                {
                    params: { instituteId, page: 0, size: 200, sort: "createdAt,desc" },
                    headers: { "Content-Type": "application/json" },
                },
            )
            .then((res) => {
                if (!alive) return;
                const raw = res.data?.content || res.data || [];
                setCourses(
                    (raw as Array<Record<string, any>>).map((c) => ({
                        id: c.id || c.packageId,
                        title: c.package_name || "",
                        description: String(c.course_html_description_html || "")
                            .replace(/<[^>]*>/g, "")
                            .replace(/&nbsp;/g, " ")
                            .trim(),
                        thumbnailId:
                            c.course_preview_image_media_id ||
                            c.course_banner_media_id ||
                            c.thumbnail_file_id ||
                            "",
                        price: c.min_plan_actual_price || 0,
                        elevatedPrice:
                            typeof c.min_plan_elevated_price === "number"
                                ? c.min_plan_elevated_price
                                : undefined,
                        currency: c.currency,
                        tags: splitTags(c.comma_separeted_tags),
                        level: c.level_name,
                        enrollInviteId: c.enroll_invite_id,
                        packageSessionId: c.package_session_id,
                        comingSoon: readComingSoon(c.coming_soon),
                        tagsRaw: typeof c.comma_separeted_tags === "string" ? c.comma_separeted_tags : null,
                        comingSoonRaw: c.coming_soon,
                        availability: c.enroll_invite_availability ?? null,
                    })),
                );
            })
            .catch((e) => console.error("[CourseShowcase] fetch failed:", e))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [instituteId]);

    // Every course the source selects, in order (the editorial grid limits after folding language versions).
    const selected = useMemo(() => {
        let list = courses;
        if (source === "onSale") {
            list = list.filter(
                (c) => typeof c.elevatedPrice === "number" && c.elevatedPrice > c.price,
            );
        } else if (source === "tag") {
            const want = (tag || "").trim().toLowerCase();
            list = want
                ? list.filter((c) => c.tags.some((x) => x.toLowerCase() === want))
                : [];
        } else if (source === "comingSoon") {
            list = list.filter((c) => c.comingSoon);
        } else if (source === "picked") {
            const order = (courseIds || []).filter(Boolean);
            const byId = new Map(list.map((c) => [c.id, c]));
            list = order.map((id) => byId.get(id)).filter(Boolean) as ShowcaseCourse[];
        }
        if (excludeCourseIds?.length) {
            const skip = new Set(excludeCourseIds);
            list = list.filter((c) => !skip.has(c.id));
        }
        if (excludeTitles?.length) {
            const key = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
            const skip = new Set(excludeTitles.map(key).filter(Boolean));
            list = list.filter((c) => !skip.has(key(c.title)));
        }
        return list;
    }, [courses, source, tag, courseIds, excludeCourseIds, excludeTitles]);
    const shown = useMemo(() => selected.slice(0, Math.max(1, limit)), [selected, limit]);
    const [editorialCount, setEditorialCount] = useState<number | null>(null);
    const selectedIds = useMemo(() => selected.map((c) => c.id), [selected]);

    // A curated strip is often ONE or TWO courses. Left-aligning those in a
    // 3- or 4-up grid leaves the row visibly half-empty, so narrow the track
    // count to what is actually shown and centre it. Skeletons use `limit`
    // because `shown` is still empty while loading.
    const maxCols = layout === "grid" ? 4 : 3;
    const visibleCount = Math.min(
        Math.max(loading ? limit : shown.length, 1),
        maxCols,
    );
    const gridClass = cn(
        "grid gap-6 mx-auto",
        visibleCount === 1 && "max-w-sm grid-cols-1",
        visibleCount === 2 && "max-w-3xl grid-cols-1 sm:grid-cols-2",
        visibleCount === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        visibleCount >= 4 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    );

    const openCourse = (c: ShowcaseCourse) =>
        navigate({
            to: `${RouteMatcher.basePath(tagName ?? "")}/${c.id}`,
            search: {
                enrollInviteId: c.enrollInviteId,
                packageSessionId: c.packageSessionId,
                level: c.level,
                // The course page opens in the language the visitor is reading.
                ...(siteLocale.enabled && siteLocale.locale !== siteLocale.baseLocale
                    ? { lang: siteLocale.locale }
                    : {}),
            },
        });

    // An empty curated strip is a configuration mistake (a tag that matches
    // nothing, say) — render nothing rather than an empty titled band.
    if (!loading && shown.length === 0) return null;
    // Editorial cards fold language versions, so leaving a course out can
    // leave no card at all: the band then hides (only a strip that excludes).
    const emptyAfterExclusion = editorial && !!excludeCourseIds?.length && editorialCount === 0;

    return (
        <section
            hidden={emptyAfterExclusion || undefined}
            className={sectionClassName ?? "catalogue-section bg-catalogue-bg"}
            style={backgroundColor ? { backgroundColor } : undefined} // design-lint-ignore: author-picked page-builder color
        >
            <div className={shellClassName ?? "catalogue-shell"}>
                {header}
                {!header && title && (
                    <h2 className="catalogue-h2 mb-2 text-center text-catalogue-text-primary">{title}</h2>
                )}
                {!header && subtitle && (
                    <p className="catalogue-lead catalogue-measure mx-auto mb-10 text-center text-catalogue-text-muted">
                        {subtitle}
                    </p>
                )}

                {editorial ? (
                    <EditorialShowcaseGrid
                        courses={courses}
                        selectedIds={selectedIds}
                        limit={limit}
                        loading={loading}
                        excludeIds={excludeCourseIds}
                        onCardCount={setEditorialCount}
                        columns={columns}
                        card={card}
                        streamsLibraryId={streamsLibraryId}
                        globalSettings={globalSettings}
                        instituteId={instituteId}
                        onOpen={(c) => openCourse(c as ShowcaseCourse)}
                    />
                ) : (
                <div className={gridClass}>
                    {loading
                        ? Array.from({ length: visibleCount }).map((_, i) => (
                              <div
                                  key={i}
                                  className="h-80 animate-pulse rounded-catalogue-lg bg-catalogue-bg-muted"
                              />
                          ))
                        : shown.map((c) => {
                              if (c.comingSoon) {
                                  return (
                                      <ComingSoonShowcaseCard
                                          key={c.id}
                                          course={c}
                                          title={siteT(c.title)}
                                          info={c.comingSoon}
                                          locale={i18n.language}
                                          onOpen={() => openCourse(c)}
                                      />
                                  );
                              }
                              const override = courseBadges?.[c.id];
                              const ribbon = (override?.text ?? badgeText ?? "").trim();
                              const tone = override?.tone ?? badgeTone;
                              return (
                              <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => openCourse(c)}
                                  className="group flex flex-col overflow-hidden rounded-catalogue-lg border border-catalogue-border-subtle bg-catalogue-bg-elevated text-start shadow-sm transition-transform duration-300 ease-out hover:-translate-y-1"
                              >
                                  <div className="relative aspect-video w-full overflow-hidden bg-catalogue-bg-muted">
                                      <ShowcaseImage fileId={c.thumbnailId} alt={siteT(c.title)} />
                                      <div className="absolute start-3 top-3">
                                          <OfferBadge actual={c.price} elevated={c.elevatedPrice} />
                                      </div>
                                      {/* Ribbon sits on the END corner so it never
                                          collides with the discount badge. */}
                                      {ribbon && (
                                          <div className="absolute end-3 top-3">
                                              <span
                                                  className={cn(
                                                      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm",
                                                      BADGE_TONE[tone] || BADGE_TONE.hot,
                                                  )}
                                              >
                                                  {ribbon}
                                              </span>
                                          </div>
                                      )}
                                  </div>
                                  <div className="flex flex-1 flex-col gap-2 p-5">
                                      <h3 className="text-base font-semibold text-catalogue-text-primary">
                                          {siteT(c.title)}
                                      </h3>
                                      {c.description && (
                                          <p className="line-clamp-2 text-sm text-catalogue-text-muted">
                                              {c.description}
                                          </p>
                                      )}
                                      <div className="mt-auto pt-3">
                                          <PriceWithMrp
                                              actual={c.price}
                                              elevated={c.elevatedPrice}
                                              currency={c.currency}
                                              layout="inline"
                                          />
                                          <span className="catalogue-btn catalogue-btn-primary mt-3 w-full justify-center">
                                              {t("courseCatalog.viewCourse", { course: getTerminology(ContentTerms.Course, SystemTerms.Course) })}
                                          </span>
                                      </div>
                                  </div>
                                  </button>
                              );
                          })}
                </div>
                )}
            </div>
        </section>
    );
};

/**
 * A Coming Soon course in the strip. Not one big <button> like the regular
 * card: it needs two actions — the card opens the details page, "Notify me"
 * opens the course's lead form — and buttons cannot nest.
 */
const ComingSoonShowcaseCard: React.FC<{
    course: ShowcaseCourse;
    /** The course name as shown (in the visitor's language). */
    title: string;
    info: ComingSoonInfo;
    locale?: string;
    onOpen: () => void;
}> = ({ course, title, info, locale, onOpen }) => {
    const { t } = useTranslation("coursePlayerB");
    const launchLabel = formatLaunchDate(info.launchDate, locale);
    return (
        <div
            onClick={onOpen}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-catalogue-lg border border-catalogue-border-subtle bg-catalogue-bg-elevated text-start shadow-sm transition-transform duration-300 ease-out hover:-translate-y-1"
        >
            <div className="relative aspect-video w-full overflow-hidden bg-catalogue-bg-muted">
                <ShowcaseImage fileId={course.thumbnailId} alt={title} />
                <div className="absolute end-3 top-3">
                    <ComingSoonRibbon info={info} />
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
                <h3 className="text-base font-semibold text-catalogue-text-primary">{title}</h3>
                {course.description && (
                    <p className="line-clamp-2 text-sm text-catalogue-text-muted">{course.description}</p>
                )}
                <div className="mt-auto flex flex-col gap-2 pt-3">
                    <span className="text-sm font-semibold text-primary-500">
                        {launchLabel
                            ? t("comingSoon.launchingOn", { date: launchLabel })
                            : t("comingSoon.ribbon")}
                    </span>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!openComingSoonForm(info, t("comingSoon.notifyTitle", { title }))) {
                                onOpen();
                            }
                        }}
                        className="catalogue-btn catalogue-btn-primary w-full justify-center"
                    >
                        {info.buttonText || t("comingSoon.notifyMe")}
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpen();
                        }}
                        className="catalogue-btn catalogue-btn-secondary w-full justify-center"
                    >
                        {t("comingSoon.viewDetails")}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CourseShowcaseComponent;

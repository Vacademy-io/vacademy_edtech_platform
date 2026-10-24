import React, { useState, useEffect, useRef, useMemo } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import axios from "axios";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShoppingCart, CheckCircle, SlidersHorizontal, X, Star, CaretDown, BookOpen, Users, Lightbulb, MagnifyingGlass, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { BASE_URL } from "@/constants/urls";
import { useProductPageStore } from "../-stores/product-page-store";
import { pushCourseSelectionChanged } from "@/components/common/enroll-by-invite/-utils/gtm";
import { buildComponentStyle, getAnimationStyle } from "../-utils/component-style";
import { BasketSummaryBar } from "./BasketSummaryBar";
import { CourseStructureDetails } from "@/routes/$tagName/-components/CourseStructureDetails";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import type {
  PageJson,
  PageComponent,
  ProductPageData,
  ProductPageSettings,
  ProductPageMappingResponse,
} from "../-types/product-page-types";
import { authorRole, authorRoleTag, sharedAuthorRole } from "@/lib/course-author-role";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A logo value is either an http(s) URL — what the page builder's image upload
 * writes — or a file id, which is what the catalogue's own header stores. The
 * two have always been the same field name with different meanings, so a config
 * copied from one to the other rendered a broken image. Accept both.
 */
const looksLikeFileId = (value: string) =>
  !!value && !/^(https?:)?\/\//.test(value) && !value.startsWith("data:");

const useImageSrc = (value: string) => {
  const resolved = useFileUrl(looksLikeFileId(value) ? value : "");
  return looksLikeFileId(value) ? resolved : value;
};

/**
 * Resolves a media file id to a URL.
 *
 * The PUBLIC endpoint, not the authenticated one: a product page is a buying
 * surface for people who are not logged in, and getPublicUrl goes through
 * authenticatedAxiosInstance — so every logo and hero image configured by file
 * id failed for exactly the visitors the page exists to serve, and the catch
 * below turned that into a silently missing image. The catalogue's own header
 * has always used the public endpoint; this matches it.
 */
const useFileUrl = (fileId: string) => {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!fileId) {
      setUrl("");
      return;
    }
    let cancelled = false;
    getPublicUrlWithoutLogin(fileId)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return url;
};

function getDisplayParts(mapping: ProductPageMappingResponse, fallbackTitle: string) {
  if (mapping.package_name) {
    return {
      title: mapping.package_name,
      subtitle: [mapping.level_name, mapping.session_name]
        .filter(Boolean)
        .join(" · "),
    };
  }
  return {
    title: mapping.payment_plan?.name || fallbackTitle,
    subtitle: "",
  };
}

/** Tags arrive as one comma-separated string ("cbse, ncert"). */
function splitTags(raw?: string | null): string[] {
  return (raw || "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** "CBSE" and "cbse" are the same tag to a visitor — key on the lowercase form. */
function tagKey(tag: string) {
  return tag.toLowerCase();
}

/**
 * Tags across the page, most used first — "popular" is literally the tag the
 * most courses carry, so the quick-filter row is derived from the data, never
 * a hardcoded list.
 *
 * The label is the spelling the admins themselves used most often for that
 * tag (institutes mix "CBSE" and "cbse"). Deriving it beats a casing rule in
 * code, which would invent labels the admin never typed — "math" → "MATH".
 */
function popularTags(mappings: ProductPageMappingResponse[]) {
  const counts = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const m of mappings) {
    for (const raw of splitTags(m.tags)) {
      const key = tagKey(raw);
      const entry = counts.get(key) ?? { count: 0, spellings: new Map<string, number>() };
      entry.count += 1;
      entry.spellings.set(raw, (entry.spellings.get(raw) ?? 0) + 1);
      counts.set(key, entry);
    }
  }
  return [...counts.entries()]
    .map(([key, v]) => ({
      key,
      count: v.count,
      label: [...v.spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function colorLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getThumbnailStyle(primaryColor: string, selected: boolean) {
  const lum = primaryColor.startsWith('#') && primaryColor.length === 7
    ? colorLuminance(primaryColor) : 0.5;
  const isDark = lum < 0.25;

  if (isDark) {
    return {
      bg: selected ? '#1e293b' : '#f1f5f9', // design-lint-ignore: page-builder default color
      text: selected ? '#e2e8f0' : '#334155', // design-lint-ignore: page-builder default color
    };
  }
  return {
    bg: selected ? primaryColor : `${primaryColor}22`,
    text: selected ? 'white' : primaryColor,
  };
}

// ─── Full-width header ────────────────────────────────────────────────────────

export const HeaderBlock = ({
  props,
  primaryColor,
  pageName,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
  pageName: string;
}) => {
  const { t } = useTranslation("productPages");
  const logoFileId = (props.logoFileId as string) || "";
  const showLogo = props.showLogo !== false;
  const logoUrl = useFileUrl(logoFileId);
  // The logo IS the identity. Printing the page name beside it repeats the
  // brand twice in the same bar. Keyed off whether a logo is CONFIGURED, not
  // whether it has resolved yet, so the name does not flash in and out while
  // the file URL loads. An explicitly authored title always wins.
  const hasLogo = showLogo && !!logoFileId;
  const title = (props.title as string) || (hasLogo ? "" : pageName) || "";

  return (
    <header
      className="w-full px-6 py-4 shadow-sm"
      style={{ backgroundColor: primaryColor }}
    >
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
        {showLogo && logoUrl && (
          <img src={logoUrl} className="h-9 w-auto object-contain" alt={t("common.logoAlt")} />
        )}
        {title && <span className="text-lg font-bold text-white">{title}</span>}
      </div>
    </header>
  );
};

// ─── Hero banner (full-width, bottom-anchored text) ───────────────────────────

const HeroBannerBlock = ({
  props,
  primaryColor,
  pageName,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
  pageName: string;
}) => {
  const title = (props.title as string) || pageName || "";
  const subtitle = (props.subtitle as string) || "";
  const bgFileId = (props.backgroundImageFileId as string) || "";
  const bgUrl = useFileUrl(bgFileId);

  if (!title && !subtitle && !bgFileId) return null;
  const hasBg = !!bgUrl;

  return (
    <div
      className="relative flex min-h-56 items-end overflow-hidden px-8 pb-8 md:min-h-72"
      style={
        hasBg
          ? {
              backgroundImage: `url(${bgUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { backgroundColor: primaryColor }
      }
    >
      {hasBg && <div className="absolute inset-0 bg-black/50" />}
      {!hasBg && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
      )}
      <div className="relative z-10 max-w-2xl">
        {title && (
          <h1 className="text-3xl font-bold leading-tight text-white drop-shadow-sm md:text-4xl">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="mt-2 text-base text-white/90 drop-shadow-sm md:text-lg">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};

// ─── Text / image / HTML blocks ───────────────────────────────────────────────

const TextBlockComp = ({ props }: { props: Record<string, unknown> }) => {
  const content = (props.content as string) || "";
  if (!content) return null;
  const alignment = (props.alignment as string) || "left";
  const bg = (props.backgroundColor as string) || "";
  return (
    <div
      className="px-6 py-8 lg:px-8"
      style={{
        backgroundColor: bg || undefined,
        textAlign: alignment as "left" | "center" | "right",
      }}
    >
      <div
        style={{ maxWidth: (props.maxWidth as string) || "800px", margin: alignment === "center" ? "0 auto" : alignment === "right" ? "0 0 0 auto" : undefined }}
        className="prose prose-sm max-w-none text-gray-700 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mb-3 [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mb-1"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  );
};

const ImageBannerBlock = ({ props }: { props: Record<string, unknown> }) => {
  const fileId = (props.imageFileId as string) || "";
  const alt = (props.altText as string) || "";
  const link = (props.linkUrl as string) || "";
  const url = useFileUrl(fileId);
  if (!url) return null;
  const img = <img src={url} alt={alt} className="w-full object-cover" />;
  return (
    <div className="px-6 py-4 lg:px-8">
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer">
          {img}
        </a>
      ) : (
        img
      )}
    </div>
  );
};

const HtmlBlock = ({ props }: { props: Record<string, unknown> }) => {
  const html = (props.html as string) || "";
  if (!html) return null;
  return (
    <div
      className="px-6 py-4 lg:px-8"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export const FooterBlock = ({ props }: { props: Record<string, unknown> }) => {
  const text = (props.text as string) || "";
  if (!text) return null;
  return (
    <footer className="border-t border-gray-100 px-6 py-8 text-center text-xs text-gray-400">
      {text}
    </footer>
  );
};

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface FilterItem {
  key: string;
  label: string;
  type: "chips" | "dropdown";
}

const FilterBarBlock = ({
  props,
  mappings,
  activeFilters,
  onFilterChange,
}: {
  props: Record<string, unknown>;
  mappings: ProductPageMappingResponse[];
  activeFilters: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
}) => {
  const { t } = useTranslation("productPages");
  const filters = (props.filters as FilterItem[]) || [];
  if (filters.length === 0) return null;

  return (
    <div className="border-b border-gray-100 bg-white px-6 py-3 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <SlidersHorizontal className="size-3.5" />
          {t("pageRenderer.filterBar.filterLabel")}
        </div>
        {filters.map((filter) => {
          const values = Array.from(
            new Set(
              mappings
                .filter((m) => m.status === "ACTIVE")
                .map((m) => {
                  if (filter.key === "level") return m.level_name;
                  if (filter.key === "session") return m.session_name;
                  if (filter.key === "package") return m.package_name;
                  return undefined;
                })
                .filter(Boolean) as string[],
            ),
          );

          if (values.length === 0) return null;

          const activeValue = activeFilters[filter.key];

          return (
            <div
              key={filter.key}
              className="flex flex-wrap items-center gap-1.5"
            >
              <span className="text-xs text-gray-400">{filter.label}:</span>
              {values.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() =>
                    onFilterChange(filter.key, activeValue === val ? "" : val)
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    activeValue === val
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
                  )}
                >
                  {val}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Rich Course Detail Sheet ─────────────────────────────────────────────────

const HtmlViewMore: React.FC<{ html: string; lines?: number }> = ({ html, lines = 4 }) => {
  const { t } = useTranslation("productPages");
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const clampClass = lines === 3 ? "line-clamp-3" : lines === 5 ? "line-clamp-5" : "line-clamp-4";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 2);
  }, [html]);
  return (
    <div>
      <div ref={ref} className={cn("text-sm leading-relaxed text-gray-600 prose prose-sm max-w-none", !expanded && clampClass)} dangerouslySetInnerHTML={{ __html: html }} />
      {(clamped || expanded) && (
        <button type="button" onClick={() => setExpanded(v => !v)} className="mt-1 text-xs font-semibold text-primary-600 hover:underline">
          {expanded ? t("pageRenderer.courseDetailSheet.viewLess") : t("pageRenderer.courseDetailSheet.viewMore")}
        </button>
      )}
    </div>
  );
};

const HighlightAccordion: React.FC<{
  icon: React.ReactNode; title: string; children: React.ReactNode;
}> = ({ icon, title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-gray-50 transition-colors">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {icon}{title}
        </span>
        <CaretDown className={cn("size-4 text-gray-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/40">{children}</div>}
    </div>
  );
};

// Field names the backend echoes when a value is unset — treat as empty
const PLACEHOLDER_FIELD_NAMES = new Set([
  "about_the_course", "about_the_course_html",
  "course_html_description", "course_html_description_html",
  "who_should_learn", "why_learn",
  "course_preview_image_media_id", "course_banner_media_id", "thumbnail_file_id",
]);

function sanitizeHtml(val?: string | null): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (PLACEHOLDER_FIELD_NAMES.has(trimmed)) return "";
  return trimmed;
}

interface CourseInitData {
  course: {
    id: string;
    package_name?: string;
    course_depth: number;
    tags?: string;
    comma_separeted_tags?: string;
    course_html_description?: string;
    course_html_description_html?: string;
    why_learn?: string;
    about_the_course?: string;
    about_the_course_html?: string;
    who_should_learn?: string;
    course_preview_image_media_id?: string;
    course_banner_media_id?: string;
    thumbnail_file_id?: string;
    rating?: number;
    level_id?: string;
  };
  sessions?: Array<{
    level_with_details?: Array<{
      read_time_in_minutes?: number;
      instructors?: Array<{ full_name: string; email: string; role_label?: string | null }>;
    }>;
  }>;
}

const CourseDetailSheet = ({
  mapping, selected, canDeselect, currency, primaryColor, onToggle, onClose, instituteId,
}: {
  mapping: ProductPageMappingResponse; selected: boolean; canDeselect: boolean;
  currency: string; primaryColor: string; onToggle: () => void; onClose: () => void;
  instituteId: string;
}) => {
  const { t } = useTranslation("productPages");
  const [details, setDetails] = useState<CourseInitData | null>(null);
  const [loading, setLoading] = useState(true);
  const bannerUrl = useCourseImageUrl(mapping.course_preview_image_media_id);
  const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const { title, subtitle } = getDisplayParts(
    mapping,
    t("common.courseFallbackWithIndex", { course: courseTerm, index: mapping.display_order + 1 })
  );
  const plan = mapping.payment_plan;
  const isFree = !plan?.actual_price || plan.actual_price === 0;

  useEffect(() => {
    if (!mapping.package_id || !instituteId) { setLoading(false); return; }
    axios.get(`${BASE_URL}/admin-core-service/open/v1/learner-study-library/course-init`, {
      params: { instituteId, courseId: mapping.package_id },
    }).then(res => {
      const d = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
      setDetails(d);
    }).catch(() => setDetails(null)).finally(() => setLoading(false));
  }, [mapping.package_session_id, instituteId]);

  const course = details?.course;
  const levelWithDetails = details?.sessions?.[0]?.level_with_details?.[0];
  const levelId = course?.level_id;
  const rawInstructors = levelWithDetails?.instructors || [];
  const instructors = rawInstructors.map(i => ({ name: i.full_name, email: i.email, role: authorRole(i) }));
  // "Acharya" when every author is one; otherwise the institute term + a role line each.
  const instructorsHeading = sharedAuthorRole(
    instructors.map((i) => i.role),
    getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher),
  );
  const tagStr = course?.tags || course?.comma_separeted_tags || "";
  const tags = tagStr.split(",").map(t => t.trim()).filter(Boolean);
  const description = sanitizeHtml(course?.course_html_description) || sanitizeHtml(course?.course_html_description_html) || "";
  const whyLearn = sanitizeHtml(course?.why_learn);
  const aboutCourse = sanitizeHtml(course?.about_the_course) || sanitizeHtml(course?.about_the_course_html) || "";
  const whoShouldLearn = sanitizeHtml(course?.who_should_learn);
  const hasHighlights = !!(whyLearn || aboutCourse || whoShouldLearn || instructors.length > 0);
  const stripHtml = (h: string) => h.replace(/<[^>]+>/g, "").trim().length > 0;

  // Use image from course-init as fallback when mapping doesn't have one
  const courseInitImageId = !bannerUrl
    ? (course?.course_preview_image_media_id || course?.course_banner_media_id || course?.thumbnail_file_id)
    : undefined;
  const courseInitImageUrl = useCourseImageUrl(courseInitImageId);
  const resolvedBannerUrl = bannerUrl || courseInitImageUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="relative w-full max-h-screen-90 overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl sm:max-w-2xl" onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button type="button" onClick={onClose}
          className="absolute end-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60">
          <X className="size-4" />
        </button>

        {/* Banner */}
        {resolvedBannerUrl ? (
          <FitImage src={resolvedBannerUrl} alt={title} className="w-full aspect-video" />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center" style={{ backgroundColor: `${primaryColor}22` }}>
            <span className="text-5xl font-bold" style={{ color: primaryColor }}>{getInitials(title)}</span>
          </div>
        )}

        <div className="px-5 py-5 space-y-5">
          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-caption font-medium uppercase tracking-wider text-gray-500">{tag}</span>
              ))}
            </div>
          )}

          {/* Title + subtitle */}
          <div>
            <h2 className="text-xl font-bold leading-tight text-gray-900">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          </div>

          {/* Description */}
          {!loading && description && stripHtml(description) && (
            <HtmlViewMore html={description} lines={4} />
          )}

          {/* Overview row */}
          <div className="flex flex-wrap gap-4 rounded-xl bg-gray-50 px-4 py-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">{t("pageRenderer.courseDetailSheet.priceLabel")}</p>
              {isFree ? (
                <p className="font-bold text-green-600">{t("common.free")}</p>
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span className="font-bold" style={{ color: primaryColor }}>{currency} {plan!.actual_price.toLocaleString()}</span>
                  {plan!.elevated_price > plan!.actual_price && (
                    <span className="text-xs text-gray-400 line-through">{currency} {plan!.elevated_price.toLocaleString()}</span>
                  )}
                </div>
              )}
            </div>
            {(course?.rating ?? 0) > 0 && (
              <div>
                <p className="text-xs text-gray-400">{t("pageRenderer.courseDetailSheet.ratingLabel")}</p>
                <div className="flex items-center gap-1">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  <span className="font-semibold">{course!.rating!.toFixed(1)}</span>
                </div>
              </div>
            )}
            {mapping.level_name && (
              <div>
                <p className="text-xs text-gray-400">
                  {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                </p>
                <p className="font-medium text-gray-700">{mapping.level_name}</p>
              </div>
            )}
            {plan?.validity_in_days > 0 && (
              <div>
                <p className="text-xs text-gray-400">{t("pageRenderer.courseDetailSheet.accessLabel")}</p>
                <p className="font-medium text-gray-700">
                  {plan.validity_in_days === 365 ? t("pageRenderer.courseDetailSheet.oneYear") : plan.validity_in_days % 30 === 0 ? `${plan.validity_in_days / 30}mo` : `${plan.validity_in_days}d`}
                </p>
              </div>
            )}
          </div>

          {/* Highlights */}
          {!loading && hasHighlights && (
            <div className="space-y-2">
              {whyLearn && stripHtml(whyLearn) && (
                <HighlightAccordion icon={<BookOpen className="size-4 text-green-600" />} title={t("pageRenderer.courseDetailSheet.whatYoullLearn")}>
                  <HtmlViewMore html={whyLearn} />
                </HighlightAccordion>
              )}
              {aboutCourse && stripHtml(aboutCourse) && (
                <HighlightAccordion icon={<Lightbulb className="size-4 text-blue-600" />} title={t("pageRenderer.courseDetailSheet.aboutThisCourse", { course: courseTerm.toLocaleLowerCase() })}>
                  <HtmlViewMore html={aboutCourse} />
                </HighlightAccordion>
              )}
              {whoShouldLearn && stripHtml(whoShouldLearn) && (
                <HighlightAccordion icon={<Users className="size-4 text-purple-600" />} title={t("pageRenderer.courseDetailSheet.whoShouldJoin")}>
                  <HtmlViewMore html={whoShouldLearn} />
                </HighlightAccordion>
              )}
              {instructors.length > 0 && (
                <HighlightAccordion icon={<Users className="size-4 text-orange-600" />} title={instructorsHeading}>
                  <div className="space-y-2">
                    {instructors.map((inst, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg bg-white p-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600">
                          {inst.name?.charAt(0).toUpperCase() || "I"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{inst.name}</p>
                          {authorRoleTag(inst.role, instructorsHeading) && (
                            <p className="text-xs font-medium text-gray-500">{authorRoleTag(inst.role, instructorsHeading)}</p>
                          )}
                          {inst.email && <p className="text-xs text-gray-500">{inst.email}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </HighlightAccordion>
              )}
            </div>
          )}

          {/* Course structure */}
          {!loading && course && (
            <CourseStructureDetails
              courseDepth={course.course_depth || 1}
              courseId={mapping.package_session_id}
              instituteId={instituteId}
              packageSessionId={mapping.package_session_id}
              levelId={levelId}
            />
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="size-8 animate-spin rounded-full border-3 border-gray-200 border-t-primary-500" />
            </div>
          )}
        </div>

        {/* Sticky CTA */}
        <div className="sticky bottom-0 border-t border-gray-100 bg-white px-5 py-4">
          {selected ? (
            <button type="button" onClick={() => { if (canDeselect) { onToggle(); onClose(); } }} disabled={!canDeselect}
              className="w-full rounded-xl border border-red-300 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
              {t("pageRenderer.courseDetailSheet.removeFromCart")}
            </button>
          ) : (
            <button type="button" onClick={() => { onToggle(); onClose(); }}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: primaryColor }}>
              {t("common.addToCart")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Course Card & Grid ───────────────────────────────────────────────────────

const useCourseImageUrl = (mediaId?: string | null) => {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!mediaId) return;
    getPublicUrlWithoutLogin(mediaId).then(setUrl).catch(() => setUrl(""));
  }, [mediaId]);
  return url;
};

/** Courses per page when the block's `pageSize` prop is unset. */
const DEFAULT_PAGE_SIZE = 12;

/** Quick-filter chips shown above the grid; the rest live in the sidebar. */
const POPULAR_TAG_LIMIT = 6;

/** Tags shown inline on a card before the row rhythm breaks. */
const CARD_TAG_LIMIT = 1;

/** Below this a search box is noise rather than help. */
const SEARCH_MIN_COURSES = 8;

/**
 * Stable identity for the no-FilterBar case. A `= {}` default would mint a new
 * object every render, so the filtering useMemo below would never hit its cache
 * and would re-scan all 127 courses on every unrelated state change.
 */
const NO_ACTIVE_FILTERS: Record<string, string> = {};

/** Compact windowed pager: ‹ 1 … 4 5 6 … 20 › */
function buildPageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

const CourseCard = ({
  mapping,
  selected,
  canDeselect,
  currency,
  primaryColor,
  onToggle,
  instituteId,
  tagName,
  productPageCode,
}: {
  mapping: ProductPageMappingResponse;
  selected: boolean;
  canDeselect: boolean;
  currency: string;
  primaryColor: string;
  onToggle: () => void;
  instituteId: string;
  tagName?: string;
  productPageCode?: string;
}) => {
  const { t } = useTranslation("productPages");
  const [showDetail, setShowDetail] = useState(false);
  const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const { title } = getDisplayParts(
    mapping,
    t("common.courseFallbackWithIndex", { course: courseTerm, index: mapping.display_order + 1 })
  );
  const plan = mapping.payment_plan;
  const isFree = !plan?.actual_price || plan.actual_price === 0;
  const imageUrl = useCourseImageUrl(mapping.course_preview_image_media_id);
  // Same destination and search contract the catalogue offer card builds, so
  // both entry points land on an identically configured details page.
  // productPageCode is required, not optional: it is what lets the details
  // page authorise a course that is not published to the catalogue. Without
  // it "View course" would dead-end on "not available for public viewing"
  // for exactly the courses product pages usually sell.
  const detailsLink =
    tagName && productPageCode && mapping.package_id
      ? {
          to: "/$tagName/$courseId" as const,
          params: { tagName, courseId: mapping.package_id },
          search: {
            enrollInviteId: mapping.enroll_invite_id,
            packageSessionId: mapping.package_session_id,
            productPageCode,
            bannerImage: undefined,
            level: mapping.level_name,
            price: mapping.payment_plan?.actual_price?.toString(),
            available_slots: undefined,
          },
        }
      : null;
  const hasDiscount = !!(plan && plan.elevated_price > plan.actual_price);
  const discountPct = hasDiscount
    ? Math.round(((plan!.elevated_price - plan!.actual_price) / plan!.elevated_price) * 100)
    : 0;
  const rawDescription = mapping.about_the_course_html || plan?.description || "";
  const descriptionText = rawDescription.replace(/<[^>]+>/g, "").trim();
  const desc = descriptionText && descriptionText.toLowerCase() !== title.toLowerCase() && descriptionText.length > 4
    ? descriptionText : t("pageRenderer.courseCard.noDescriptionAvailable");

  return (
    <>
      <div
        onClick={() => setShowDetail(true)}
        className={cn(
          "group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white transition-all duration-200 hover:shadow-lg",
          selected ? "shadow-md" : "border-gray-200 shadow-sm",
        )}
        style={selected ? { borderColor: primaryColor, boxShadow: `0 0 0 2px ${primaryColor}40, 0 4px 16px ${primaryColor}18` } : {}}
      >
        {/* Thumbnail */}
        <div
          className="relative flex h-40 w-full items-center justify-center overflow-hidden"
          style={{ backgroundColor: `${primaryColor}12` }}
        >
          {imageUrl ? (
            <FitImage src={imageUrl} alt={title} className="h-full w-full" />
          ) : (
            <BookOpen className="size-10 transition-transform duration-200 group-hover:scale-110" style={{ color: primaryColor, opacity: 0.75 }} />
          )}
          {hasDiscount && discountPct > 0 && (
            <div className="absolute start-2.5 top-2.5 rounded-full bg-orange-500 px-2 py-0.5 text-caption font-bold text-white shadow">
              {t("pageRenderer.courseCard.percentOff", { percent: discountPct })}
            </div>
          )}
          {selected && (
            <div className="absolute end-2.5 top-2.5 flex size-6 items-center justify-center rounded-full shadow" style={{ backgroundColor: primaryColor }}>
              <CheckCircle className="size-3.5 text-white" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col p-3.5">
          <h3 className="mb-1 line-clamp-2 text-sm font-bold leading-snug text-gray-900">{title}</h3>
          <p className="mb-3 line-clamp-1 text-xs text-gray-400">{desc}</p>

          <div className="mt-auto flex items-end justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {mapping.level_name && (
                <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-caption font-medium text-gray-600">
                  {mapping.level_name}{mapping.session_name ? ` - ${mapping.session_name}` : ""}
                </span>
              )}
              {/* Rendered exactly as authored; the rest are filterable above. */}
              {splitTags(mapping.tags).slice(0, CARD_TAG_LIMIT).map((t) => (
                <span
                  key={t}
                  className="rounded-full px-2 py-0.5 text-caption font-medium"
                  style={{ backgroundColor: `${primaryColor}14`, color: primaryColor }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="shrink-0 text-end">
              {isFree ? (
                <span className="text-xs font-bold text-emerald-600">{t("common.free")}</span>
              ) : (
                <div>
                  <span className="text-xs font-bold" style={{ color: primaryColor }}>
                    {currency} {plan!.actual_price.toLocaleString()}
                  </span>
                  {hasDiscount && (
                    <span className="ms-1 text-caption text-gray-400 line-through">{plan!.elevated_price.toLocaleString()}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom bar. "View course" opens the full details page (same one the
            catalogue's offer cards link to, carrying productPageCode so its
            enrol CTA comes back to this checkout); the quick-look sheet stays
            on the card body. Only shown when the catalogue slug is known —
            the details page lives under /{tagName}/{courseId}. */}
        <div className="flex w-full">
          {detailsLink && (
            <Link
              {...detailsLink}
              onClick={(e) => e.stopPropagation()}
              className="flex flex-1 items-center justify-center gap-1.5 border-t border-gray-100 py-2.5 text-caption font-semibold no-underline transition-all duration-150 hover:bg-gray-50"
              style={{ color: primaryColor }}
            >
              {t("pageRenderer.courseCard.viewCourse")}
            </Link>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (selected) { if (canDeselect) onToggle(); } else onToggle(); }}
            disabled={selected && !canDeselect}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-caption font-semibold transition-all duration-150",
              selected
                ? "hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                : "text-white hover:opacity-90",
            )}
            style={selected ? { backgroundColor: `${primaryColor}10`, color: primaryColor } : { backgroundColor: primaryColor }}
          >
            {selected ? <><CheckCircle className="size-3" /> {t("pageRenderer.courseCard.addedToCart")}</> : <><ShoppingCart className="size-3" /> {t("common.addToCart")}</>}
          </button>
        </div>
      </div>

      {showDetail && (
        <CourseDetailSheet
          mapping={mapping} selected={selected} canDeselect={canDeselect}
          currency={currency} primaryColor={primaryColor} onToggle={onToggle}
          onClose={() => setShowDetail(false)} instituteId={instituteId}
        />
      )}
    </>
  );
};

// ─── Course Grid ──────────────────────────────────────────────────────────────

export const CourseGridBlock = ({
  props,
  pageData,
  settings,
  primaryColor,
  activeFilters = NO_ACTIVE_FILTERS,
  tagName,
  productPageCode,
  lockedLevels,
  lockedPackageSessionIds,
}: {
  props: Record<string, unknown>;
  pageData: ProductPageData;
  settings: ProductPageSettings;
  primaryColor: string;
  /** Set by a legacy FilterBar block above the grid, when the page has one. */
  activeFilters?: Record<string, string>;
  /** Catalogue slug — enables the per-card "View course" link. */
  tagName?: string;
  productPageCode?: string;
  /**
   * Comma-separated level names this grid is hard-restricted to, carried over
   * from the catalogue's Course Finder pick (?levels=). A restriction, not a
   * default: the visitor who chose "Class 6" must not be shown every other
   * level here, and cannot widen back out via the level facet.
   */
  lockedLevels?: string;
  /**
   * package_session_ids this grid is hard-restricted to, from the page's
   * Course Finder pick. Narrower than lockedLevels and applied after it: a
   * page whose classes all share one level cannot be split any other way.
   */
  lockedPackageSessionIds?: string[];
}) => {
  const { t } = useTranslation("productPages");
  const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const authoredColumns = (props.columns as number) || 3;
  const sectionTitle = props.title as string | undefined;
  const sectionSubtitle = props.subtitle as string | undefined;
  // Admin-set page size wins; the constant is only the fallback.
  const perPage = Number(props.pageSize) > 0 ? Math.floor(Number(props.pageSize)) : DEFAULT_PAGE_SIZE;
  const { selectedPsOptionIds, toggleSelection, totalPrice } = useProductPageStore();

  const activeMappings = useMemo(() => {
    const active = pageData.mappings.filter((m) => m.status === "ACTIVE");

    // The Course Finder's pick, applied first because it is exact: ids, not
    // names. An empty result means the chosen class lost its courses since the
    // pick was saved — falling back to everything is the same "a restriction
    // that matches nothing is a broken link" rule the level filter uses.
    const byId = lockedPackageSessionIds?.length
      ? active.filter((m) => lockedPackageSessionIds.includes(m.package_session_id))
      : active;
    const scoped = byId.length > 0 ? byId : active;

    const allowed = (lockedLevels || "")
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length === 0) return scoped;
    // Case-insensitive: levelGroups in catalogue JSON are hand-authored and
    // drift from the real level names ("Cyber Ai-" vs "Cyber AI-").
    const allowedSet = new Set(allowed);
    const narrowed = scoped.filter((m) =>
      allowedSet.has((m.level_name || "").trim().toLowerCase()),
    );
    // A restriction that matches nothing is a broken link, not an empty
    // catalogue — fall back to the full list rather than a dead page.
    return narrowed.length > 0 ? narrowed : scoped;
  }, [pageData.mappings, lockedLevels, lockedPackageSessionIds]);
  const currency = pageData.currency || activeMappings[0]?.payment_plan?.currency || "";

  // A Course Finder pick usually leaves one course. Rendering it into a 3-up
  // grid puts a third-width card alone on the left, which reads as a row that
  // failed to load rather than as the one offer for the class just chosen.
  // Only narrowed grids are adjusted — an ordinary page keeps its authored
  // column count whatever its course count.
  const columns = lockedPackageSessionIds?.length
    ? Math.min(authoredColumns, activeMappings.length || 1)
    : authoredColumns;

  // ── Filter / search state ──
  const [search, setSearch] = useState("");
  const [tagSel, setTagSel] = useState<string[]>([]);
  const [levelSel, setLevelSel] = useState<string[]>([]);
  const [sessionSel, setSessionSel] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");
  const [page, setPage] = useState(0);
  const [showMoreLevels, setShowMoreLevels] = useState(false);
  const [showMoreTags, setShowMoreTags] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Derived unique values
  const allTags = useMemo(() => popularTags(activeMappings), [activeMappings]);
  const allLevels = useMemo(
    () => [...new Set(activeMappings.map((m) => m.level_name).filter(Boolean) as string[])],
    [activeMappings],
  );
  const allSessions = useMemo(
    () => [...new Set(activeMappings.map((m) => m.session_name).filter(Boolean) as string[])],
    [activeMappings],
  );
  const maxPriceAll = useMemo(
    () => Math.max(0, ...activeMappings.map((m) => m.payment_plan?.actual_price || 0)),
    [activeMappings],
  );

  const toggleTag = (v: string) =>
    setTagSel((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const toggleLevel = (v: string) =>
    setLevelSel((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const toggleSession = (v: string) =>
    setSessionSel((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  const clearAll = () => { setSearch(""); setTagSel([]); setLevelSel([]); setSessionSel([]); setPriceMin(""); setPriceMax(""); setPage(0); };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const pMin = priceMin !== "" ? parseFloat(priceMin) : -Infinity;
    const pMax = priceMax !== "" ? parseFloat(priceMax) : Infinity;
    return activeMappings.filter((m) => {
      const tags = splitTags(m.tags).map(tagKey);
      // Search spans everything visible on the card, not just the title —
      // typing "cbse" or "2026-27" used to return nothing.
      if (
        q &&
        ![
          getDisplayParts(m, t("common.courseFallbackWithIndex", { course: courseTerm, index: m.display_order + 1 })).title,
          m.level_name,
          m.session_name,
          ...tags,
        ]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q))
      )
        return false;
      if (tagSel.length > 0 && !tagSel.some((t) => tags.includes(t))) return false;
      if (levelSel.length > 0 && !levelSel.includes(m.level_name!)) return false;
      if (sessionSel.length > 0 && !sessionSel.includes(m.session_name!)) return false;
      const price = m.payment_plan?.actual_price || 0;
      if (price < pMin || price > pMax) return false;
      // A FilterBar block's selections were previously accepted and then
      // ignored here, so those chips filtered nothing at all.
      for (const [key, val] of Object.entries(activeFilters)) {
        if (!val) continue;
        if (key === "level" && m.level_name !== val) return false;
        if (key === "session" && m.session_name !== val) return false;
        if (key === "package" && m.package_name !== val) return false;
      }
      return true;
    });
  }, [activeMappings, search, tagSel, levelSel, sessionSel, priceMin, priceMax, activeFilters]);

  const totalPages = Math.ceil(filtered.length / perPage);
  // Derived, not synced via an effect: a shrinking result set must never leave
  // the pager parked on a page that no longer exists (blank grid).
  const safePage = Math.min(page, Math.max(totalPages - 1, 0));
  const paginated = filtered.slice(safePage * perPage, (safePage + 1) * perPage);

  // A narrowed grid holding exactly one course is the answer to "which class?",
  // not a catalogue. Left-aligned in a 3-up grid it reads as a row that failed
  // to load; stretched full-width its banner is cropped to a strip of foreheads.
  // Centred at a readable width, it reads as the one offer it is.
  const soleOffer = !!lockedPackageSessionIds?.length && activeMappings.length === 1;

  const colClass =
    columns >= 4 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
    : columns === 3 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    : columns === 2 ? "grid-cols-1 sm:grid-cols-2"
    : "grid-cols-1";

  const hasActiveFilters =
    tagSel.length > 0 || levelSel.length > 0 || sessionSel.length > 0 || priceMin !== "" || priceMax !== "";
  const activeFilterCount = tagSel.length + levelSel.length + sessionSel.length;

  // A dimension is worth offering only if picking a value could actually
  // exclude something: either it holds more than one value, or some courses
  // carry no value at all. Every course sharing one identical value filters
  // nothing, and on a one- or two-course page that noise turns a simple offer
  // into a search interface. (The previous fallback used the same principle.)
  const partitions = (distinct: number, covered: number) =>
    distinct > 1 || (distinct === 1 && covered < activeMappings.length);
  const showTagFilter = partitions(
    allTags.length,
    activeMappings.filter((m) => splitTags(m.tags).length > 0).length,
  );
  const showLevelFilter = partitions(
    allLevels.length,
    activeMappings.filter((m) => m.level_name).length,
  );
  const showSessionFilter = partitions(
    allSessions.length,
    activeMappings.filter((m) => m.session_name).length,
  );
  const showPriceFilter = maxPriceAll > 0 && activeMappings.length > 1;
  const hasFilterUi = showTagFilter || showLevelFilter || showSessionFilter || showPriceFilter;
  const showSearch = activeMappings.length >= SEARCH_MIN_COURSES;

  // A plain element, NOT a nested component: declaring `const FilterSidebar =
  // () => …` inside the render remounts the whole subtree on every keystroke,
  // which made the price inputs lose focus after each character.
  const filterSidebar = (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">{t("pageRenderer.courseGrid.filtersTitle")}</span>
        {hasActiveFilters && (
          <button type="button" onClick={clearAll} className="text-caption font-medium text-gray-400 hover:text-gray-700">
            {t("pageRenderer.courseGrid.clearAll")}
          </button>
        )}
      </div>

      {/* Tags — the course's own labels (CBSE, ICSE …), most used first */}
      {showTagFilter && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {getTerminologyPlural(ContentTerms.PopularTag, SystemTerms.PopularTag)}
          </p>
          <div className="space-y-1.5">
            {(showMoreTags ? allTags : allTags.slice(0, 5)).map((t) => (
              <label key={t.key} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={tagSel.includes(t.key)}
                  onChange={() => { toggleTag(t.key); setPage(0); }}
                  className="size-3.5 rounded"
                  style={{ accentColor: primaryColor }}
                />
                <span className="flex-1 text-xs text-gray-700">{t.label}</span>
                <span className="text-caption text-gray-400">{t.count}</span>
              </label>
            ))}
          </div>
          {allTags.length > 5 && (
            <button type="button" onClick={() => setShowMoreTags((p) => !p)}
              className="mt-2 flex items-center gap-1 text-caption font-medium text-gray-400 hover:text-gray-700">
              <CaretDown className={cn("size-3 transition-transform", showMoreTags && "rotate-180")} />
              {showMoreTags ? t("pageRenderer.courseGrid.showLess") : t("pageRenderer.courseGrid.showMore", { count: allTags.length - 5 })}
            </button>
          )}
        </div>
      )}

      {/* Level */}
      {showLevelFilter && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {getTerminology(ContentTerms.Level, SystemTerms.Level)}
          </p>
          <div className="space-y-1.5">
            {(showMoreLevels ? allLevels : allLevels.slice(0, 4)).map((lvl) => (
              <label key={lvl} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={levelSel.includes(lvl)}
                  onChange={() => { toggleLevel(lvl); setPage(0); }}
                  className="size-3.5 rounded accent-current"
                  style={{ accentColor: primaryColor }}
                />
                <span className="text-xs text-gray-700">{lvl}</span>
              </label>
            ))}
          </div>
          {allLevels.length > 4 && (
            <button type="button" onClick={() => setShowMoreLevels((p) => !p)}
              className="mt-2 flex items-center gap-1 text-caption font-medium text-gray-400 hover:text-gray-700">
              <CaretDown className={cn("size-3 transition-transform", showMoreLevels && "rotate-180")} />
              {showMoreLevels ? t("pageRenderer.courseGrid.showLess") : t("pageRenderer.courseGrid.showMore", { count: allLevels.length - 4 })}
            </button>
          )}
        </div>
      )}

      {/* Session */}
      {showSessionFilter && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {getTerminology(ContentTerms.Batch, SystemTerms.Batch)} /{" "}
            {getTerminology(ContentTerms.Session, SystemTerms.Session)}
          </p>
          <div className="space-y-1.5">
            {allSessions.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={sessionSel.includes(s)}
                  onChange={() => { toggleSession(s); setPage(0); }}
                  className="size-3.5 rounded"
                  style={{ accentColor: primaryColor }}
                />
                <span className="text-xs text-gray-700">{s}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Price range */}
      {showPriceFilter && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("pageRenderer.courseGrid.priceRangeTitle")}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <p className="text-caption text-gray-400">{t("pageRenderer.courseGrid.min")}</p>
              <input
                type="number" min={0} value={priceMin} placeholder="0"
                onChange={(e) => { setPriceMin(e.target.value); setPage(0); }}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
              />
            </div>
            <span className="mt-4 text-xs text-gray-400">–</span>
            <div className="flex-1 space-y-1">
              <p className="text-caption text-gray-400">{t("pageRenderer.courseGrid.max")}</p>
              <input
                type="number" min={0} value={priceMax} placeholder={maxPriceAll.toString()}
                onChange={(e) => { setPriceMax(e.target.value); setPage(0); }}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="px-4 py-8 lg:px-8">
      {/* Section header */}
      {sectionTitle && (
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 lg:text-3xl">{sectionTitle}</h2>
          <div className="mt-1.5 h-1 w-10 rounded-full" style={{ backgroundColor: primaryColor }} />
          {sectionSubtitle && <p className="mt-2 max-w-2xl text-sm text-gray-500">{sectionSubtitle}</p>}
        </div>
      )}

      {/* Popular tags — one-tap filtering for the labels most courses carry.
          A sidebar checkbox list is where filters go to be ignored on a page
          with 100+ courses; these chips are the fast path to the same state. */}
      {showTagFilter && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("pageRenderer.courseGrid.popularLabel")}</span>
          {allTags.slice(0, POPULAR_TAG_LIMIT).map((t) => {
            const on = tagSel.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { toggleTag(t.key); setPage(0); }}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  on ? "text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
                )}
                style={on ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}
              >
                {t.label}
                <span className={cn("ms-1.5", on ? "opacity-80" : "text-gray-400")}>{t.count}</span>
              </button>
            );
          })}
          {hasActiveFilters && (
            <button type="button" onClick={clearAll} className="text-xs font-medium text-gray-400 hover:text-gray-700">
              {t("pageRenderer.courseGrid.clear")}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-6">
        {/* ── Desktop sidebar ── */}
        {hasFilterUi && (
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              {filterSidebar}
            </div>
          </aside>
        )}

        {/* ── Main area ── */}
        <div className="min-w-0 flex-1">
          {/* Search + filter toggle row — omitted entirely on a page small
              enough that neither helps. */}
          {(showSearch || hasFilterUi) && (
            <div className="mb-4 flex items-center gap-3">
              {showSearch && (
                <div className="relative flex-1">
                  <MagnifyingGlass className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    placeholder={t("pageRenderer.courseGrid.searchPlaceholder", { courses: coursesTerm.toLocaleLowerCase() })}
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 ps-9 pe-3 text-sm shadow-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                  />
                </div>
              )}
              {/* Mobile filter button */}
              {hasFilterUi && (
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen((p) => !p)}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-600 shadow-sm lg:hidden"
                >
                  <SlidersHorizontal className="size-4" />
                  {t("pageRenderer.courseGrid.filtersTitle")}
                  {activeFilterCount > 0 && <span className="flex size-4 items-center justify-center rounded-full text-caption font-bold text-white" style={{ backgroundColor: primaryColor }}>{activeFilterCount}</span>}
                </button>
              )}
            </div>
          )}

          {/* Mobile filters panel */}
          {mobileFiltersOpen && hasFilterUi && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 lg:hidden">
              {filterSidebar}
            </div>
          )}

          {/* Results count */}
          <p className="mb-3 text-xs text-gray-400" role="status" aria-live="polite">
            {(search || hasActiveFilters)
              ? t("pageRenderer.courseGrid.resultsFound", {
                  count: filtered.length,
                  course: (filtered.length === 1 ? courseTerm : coursesTerm).toLocaleLowerCase(),
                })
              : t("pageRenderer.courseGrid.resultsAvailable", {
                  count: filtered.length,
                  course: (filtered.length === 1 ? courseTerm : coursesTerm).toLocaleLowerCase(),
                })}
            {totalPages > 1 && t("pageRenderer.courseGrid.pageSuffix", { page: safePage + 1, total: totalPages })}
          </p>

          {/* Grid */}
          {paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center">
              <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-gray-100">
                <BookOpen className="size-7 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">{t("pageRenderer.courseGrid.noCoursesFound", { courses: coursesTerm.toLocaleLowerCase() })}</p>
              <button type="button" onClick={clearAll} className="mt-2 text-xs text-gray-400 hover:underline">{t("pageRenderer.courseGrid.clearFilters")}</button>
            </div>
          ) : (
            <div className={cn("grid gap-4", colClass, soleOffer && "mx-auto w-full max-w-xl")}>
              {paginated.map((mapping) => {
                const selected = selectedPsOptionIds.includes(mapping.ps_invite_payment_option_id);
                return (
                  <CourseCard
                    key={mapping.ps_invite_payment_option_id}
                    mapping={mapping}
                    selected={selected}
                    canDeselect={settings.allowCourseDeselection}
                    currency={currency}
                    primaryColor={primaryColor}
                    instituteId={pageData.institute_id}
                    tagName={tagName}
                    productPageCode={productPageCode}
                    onToggle={() => {
                      toggleSelection(mapping.ps_invite_payment_option_id);
                      const newCount = selected ? selectedPsOptionIds.length - 1 : selectedPsOptionIds.length + 1;
                      pushCourseSelectionChanged(newCount, totalPrice());
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="mt-6 flex flex-wrap items-center justify-center gap-2" aria-label={t("pageRenderer.courseGrid.coursePagesAriaLabel", { courses: coursesTerm.toLocaleLowerCase() })}>
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                aria-label={t("pageRenderer.courseGrid.previousPageAriaLabel")}
                className="flex size-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-30"
              >
                <CaretLeft className="size-4" />
              </button>
              <div className="flex items-center gap-1">
                {/* Windowed: a 127-course page is 13 pages, and printing every
                    number turns the pager into a wall of digits. */}
                {buildPageWindow(safePage + 1, totalPages).map((p, i) =>
                  p === "gap" ? (
                    <span key={`gap-${i}`} className="px-1 text-xs text-gray-400" aria-hidden="true">…</span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p - 1)}
                      aria-label={t("pageRenderer.courseGrid.pageAriaLabel", { page: p })}
                      aria-current={p === safePage + 1 ? "page" : undefined}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition-colors",
                        p === safePage + 1 ? "text-white shadow-sm" : "border border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                      )}
                      style={p === safePage + 1 ? { backgroundColor: primaryColor } : {}}
                    >
                      {p}
                    </button>
                  ),
                )}
              </div>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
                aria-label={t("pageRenderer.courseGrid.nextPageAriaLabel")}
                className="flex size-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-30"
              >
                <CaretRight className="size-4" />
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Sticky action bar (all screen sizes when selection > 0) ──────────────────

const StickyCartBar = ({
  pageData,
  onNext,
  primaryColor,
}: {
  pageData: ProductPageData;
  onNext: () => void;
  primaryColor: string;
}) => (
  // Shared with the plain-catalogue bar so the two cannot quote different
  // totals for the same basket — this one summed the card prices and ignored
  // basket pricing entirely, quoting the undiscounted figure right up to
  // checkout. The shared bar keeps this one's translations and institute
  // terminology.
  <BasketSummaryBar pageData={pageData} onNext={onNext} primaryColor={primaryColor} />
);

// ─── New catalogue-format blocks ─────────────────────────────────────────────

const HeroSectionBlock = ({
  props,
  primaryColor,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
}) => {
  const layout = (props.layout as string) || "split";
  const left = (props.left as Record<string, unknown>) || {};
  const right = (props.right as Record<string, unknown>) || {};
  const bg = (props.backgroundColor as string) || "#F8FAFC"; // design-lint-ignore: page-builder default color
  const fg = (props.textColor as string) || "#111827"; // design-lint-ignore: page-builder default color
  const backgroundImage = (props.backgroundImage as string) || "";
  const title = (left.title as string) || "";
  const subheading = (left.subheading as string) || "";
  const description = (left.description as string) || "";
  const tags = ((left.tags as string[]) || []).filter(Boolean);
  const button = (left.button as { enabled?: boolean; text?: string; target?: string; bgColor?: string; textColor?: string }) || {};
  const btnBg = button.bgColor || primaryColor;
  const btnFg = button.textColor || "white";
  const imageUrl = (right.image as string) || "";
  const collage = (Array.isArray(right.imageCollage)
    ? (right.imageCollage as string[])
    : []
  ).filter(Boolean);

  if (!title && !description && !subheading && !imageUrl && !collage.length) return null;

  const hasRightImage = layout === "split" && (collage.length > 0 || !!imageUrl);

  const textContent = (
    <div className={`space-y-4 ${layout === "centered" ? "max-w-3xl mx-auto text-center" : "flex-1"}`}>
      {tags.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${layout === "centered" ? "justify-center" : ""}`}>
          {tags.map((tag, i) => (
            <span
              key={i}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider shadow-sm"
              style={{ color: fg }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {title && (
        <h1 className="text-3xl font-bold leading-tight md:text-4xl lg:text-5xl" style={{ color: fg }}>
          {title}
        </h1>
      )}
      {subheading && (
        <p className="text-xl font-medium leading-snug" style={{ color: fg, opacity: 0.75 }}>{subheading}</p>
      )}
      {description && (
        <div
          className="prose prose-sm max-w-none [&_p]:leading-relaxed [&_ul]:mt-1"
          style={{ color: fg, opacity: 0.7 }}
          dangerouslySetInnerHTML={{ __html: description }}
        />
      )}
      {button.enabled && button.text && (
        <div className={`pt-2 ${layout === "centered" ? "flex justify-center" : ""}`}>
          <a
            href={button.target || "#courses"}
            className="inline-block rounded-xl px-7 py-3 text-sm font-semibold shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: btnBg, color: btnFg }}
          >
            {button.text}
          </a>
        </div>
      )}
    </div>
  );

  if (layout === "centered") {
    return (
      <div
        className="relative px-6 py-16 lg:px-8"
        style={{
          backgroundColor: bg,
          ...(backgroundImage ? { backgroundImage: `url(${backgroundImage})`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
        }}
      >
        {backgroundImage && <div className="absolute inset-0 bg-black/40" />}
        <div className={`relative mx-auto max-w-screen-xl ${backgroundImage ? "text-white" : ""}`}>
          {textContent}
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: bg }} className="px-6 py-12 lg:px-8">
      <div className={`mx-auto flex max-w-screen-xl gap-10 ${hasRightImage ? "flex-col lg:flex-row lg:items-center" : "flex-col"}`}>
        {textContent}

        {hasRightImage && (
          <div className="flex-1">
            {collage.length > 0 ? (
              <div
                className="overflow-hidden rounded-2xl shadow-md"
                style={{
                  display: "grid",
                  gridTemplateAreas: '"a b c" "a d e"',
                  gridTemplateColumns: "2fr 1fr 1fr",
                  gridTemplateRows: "160px 160px",
                  gap: 6,
                }}
              >
                {(["a", "b", "c", "d", "e"] as const).map((slot, i) => (
                  <div
                    key={slot}
                    style={{
                      gridArea: slot,
                      background: collage[i]
                        ? `url(${collage[i]}) center/cover`
                        : `${primaryColor}22`,
                    }}
                    className="overflow-hidden rounded-xl"
                  />
                ))}
              </div>
            ) : (
              <img
                src={imageUrl}
                alt=""
                className="w-full rounded-2xl object-cover shadow-md"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const NewHeaderBlock = ({
  props,
  primaryColor,
  pageName,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
  pageName: string;
}) => {
  const { t } = useTranslation("productPages");
  const logoRaw = (props.logo as string) || "";
  const logoUrl = useImageSrc(logoRaw);
  // See HeaderBlock: a logo already says who this is.
  const title = (props.title as string) || (logoRaw ? "" : pageName) || "";
  const navigation = (props.navigation as Array<{ label: string; url?: string; route?: string }>) || [];
  const ctaButton = (props.ctaButton as { enabled?: boolean; text?: string; url?: string; bgColor?: string; textColor?: string }) || {};
  const bg = (props.backgroundColor as string) || primaryColor;
  const fg = (props.textColor as string) || "white";
  const ctaBg = ctaButton.bgColor || "white";
  const ctaFg = ctaButton.textColor || bg;

  return (
    <header className="sticky top-0 z-40 w-full px-6 py-3 shadow-sm" style={{ backgroundColor: bg }}>
      <div className="mx-auto flex max-w-screen-xl items-center gap-4">
        <div className="flex shrink-0 items-center gap-3">
          {logoUrl && (
            <img src={logoUrl} className="h-9 w-auto object-contain" alt={t("common.logoAlt")} />
          )}
          {title && <span className="text-lg font-bold" style={{ color: fg }}>{title}</span>}
        </div>

        {navigation.length > 0 && (
          <nav className="ms-6 hidden items-center gap-6 md:flex">
            {navigation.map((nav, i) => (
              <a
                key={i}
                href={nav.url || nav.route || "#"}
                className="text-sm font-medium transition-opacity hover:opacity-100"
                style={{ color: fg, opacity: 0.8 }}
              >
                {nav.label}
              </a>
            ))}
          </nav>
        )}

        {ctaButton.enabled && ctaButton.text && (
          <div className="ms-auto shrink-0">
            <a
              href={ctaButton.url || "#"}
              className="inline-block rounded-lg px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: ctaBg, color: ctaFg }}
            >
              {ctaButton.text}
            </a>
          </div>
        )}
      </div>
    </header>
  );
};

export const NewFooterBlock = ({ props }: { props: Record<string, unknown> }) => {
  const left = (props.leftSection as Record<string, unknown>) || {};
  const bottomNote = (props.bottomNote as string) || (props.text as string) || "";
  const title = (left.title as string) || "";
  const bg = (props.backgroundColor as string) || "#F9FAFB"; // design-lint-ignore: page-builder default color
  const fg = (props.textColor as string) || "#374151"; // design-lint-ignore: page-builder default color

  // Collect right sections
  const rightCols: Array<{ title: string; links: Array<{ label: string; url: string }> }> = [];
  if (props.rightSection1) rightCols.push(props.rightSection1 as any);
  if (props.rightSection2) rightCols.push(props.rightSection2 as any);
  if (props.rightSection3) rightCols.push(props.rightSection3 as any);

  return (
    <footer className="border-t px-6 py-10 lg:px-8" style={{ backgroundColor: bg }}>
      <div className="mx-auto max-w-screen-xl">
        {(title || rightCols.length > 0) && (
          <div className={`mb-8 grid gap-8 ${rightCols.length === 0 ? '' : rightCols.length === 1 ? 'sm:grid-cols-2' : rightCols.length === 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
            <div>
              {title && <p className="mb-2 font-semibold" style={{ color: fg }}>{title}</p>}
              {(left.text as string) && <p className="text-sm" style={{ color: fg, opacity: 0.65 }}>{left.text as string}</p>}
            </div>
            {rightCols.map((sec, i) => (
              <div key={i}>
                <p className="mb-3 font-semibold text-sm" style={{ color: fg }}>{sec.title}</p>
                {(sec.links || []).map((l, j) => (
                  <a key={j} href={l.url || "#"} className="mb-1.5 block text-sm transition-opacity hover:opacity-80" style={{ color: fg, opacity: 0.65 }}>
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
        {bottomNote && (
          <p className="border-t pt-6 text-center text-xs" style={{ color: fg, opacity: 0.5, borderColor: `${fg}22` }}>
            {bottomNote}
          </p>
        )}
      </div>
    </footer>
  );
};

// ─── Stats / Social-proof blocks ──────────────────────────────────────────────

const StatsHighlightsBlock = ({
  props,
  primaryColor,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
}) => {
  const bg = (props.backgroundColor as string) || (props as any).styles?.backgroundColor || "white";
  const fg = (props.textColor as string) || (props as any).styles?.textColor || "#111827"; // design-lint-ignore: page-builder default color
  const stats: Array<{ label: string; value: string }> = (props.stats as any[]) || [];
  if (stats.length === 0 && !props.headerText) return null;
  return (
    <section className="py-14 px-6 lg:px-8" style={{ backgroundColor: bg }}>
      {props.headerText && (
        <h2 className="mb-2 text-center text-2xl font-bold md:text-3xl" style={{ color: fg }}>
          {props.headerText as string}
        </h2>
      )}
      {props.description && (
        <p className="mb-10 text-center text-sm" style={{ color: fg, opacity: 0.65 }}>
          {props.description as string}
        </p>
      )}
      <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-10 md:gap-16">
        {stats.map((s, i) => (
          <div key={i} className="text-center">
            <div className="text-4xl font-bold" style={{ color: primaryColor }}>{s.value}</div>
            <div className="mt-1 text-sm font-medium" style={{ color: fg, opacity: 0.7 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

const TestimonialSectionBlock = ({ props }: { props: Record<string, unknown> }) => {
  const bg = (props.backgroundColor as string) || "#F9FAFB"; // design-lint-ignore: page-builder default color
  const fg = (props.textColor as string) || "#111827"; // design-lint-ignore: page-builder default color
  const testimonials: Array<{ author?: string; name?: string; role?: string; content?: string; feedback?: string }> =
    (props.testimonials as any[]) || [];
  if (testimonials.length === 0 && !props.headerText) return null;
  return (
    <section className="py-14 px-6 lg:px-8" style={{ backgroundColor: bg }}>
      {props.headerText && (
        <h2 className="mb-10 text-center text-2xl font-bold md:text-3xl" style={{ color: fg }}>
          {props.headerText as string}
        </h2>
      )}
      <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t, i) => (
          <div key={i} className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-sm italic leading-relaxed text-gray-600">
              &ldquo;{t.content || t.feedback || ""}&rdquo;
            </p>
            <div className="mt-4">
              <p className="font-semibold text-gray-900">{t.author || t.name || ""}</p>
              {t.role && <p className="mt-0.5 text-xs text-gray-400">{t.role}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const FaqSectionBlock = ({ props }: { props: Record<string, unknown> }) => {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const bg = (props.backgroundColor as string) || "#F9FAFB"; // design-lint-ignore: page-builder default color
  const fg = (props.textColor as string) || "#111827"; // design-lint-ignore: page-builder default color
  const faqs: Array<{ question: string; answer: string }> = (props.faqs as any[]) || [];
  if (faqs.length === 0 && !props.headerText) return null;
  return (
    <section className="py-14 px-6 lg:px-8" style={{ backgroundColor: bg }}>
      {props.headerText && (
        <h2 className="mb-2 text-center text-2xl font-bold md:text-3xl" style={{ color: fg }}>
          {props.headerText as string}
        </h2>
      )}
      {props.subheading && (
        <p className="mb-10 text-center text-sm" style={{ color: fg, opacity: 0.65 }}>
          {props.subheading as string}
        </p>
      )}
      <div className="mx-auto max-w-3xl space-y-3">
        {faqs.map((faq, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="flex w-full items-center justify-between px-5 py-4 text-start hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-semibold" style={{ color: fg }}>{faq.question}</span>
              <CaretDown className={cn("size-4 shrink-0 text-gray-400 transition-transform", openIdx === i && "rotate-180")} />
            </button>
            {openIdx === i && (
              <div className="border-t border-gray-100 px-5 py-4 text-sm leading-relaxed text-gray-600">
                {faq.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

const CtaBannerBlock = ({ props }: { props: Record<string, unknown> }) => {
  const bg = (props.backgroundColor as string) || "#3B82F6"; // design-lint-ignore: page-builder default color
  const fg = (props.textColor as string) || "white";
  const btn = (props.button as { enabled?: boolean; text?: string; target?: string; url?: string }) || {};
  return (
    <section className="py-16 px-6 text-center" style={{ backgroundColor: bg }}>
      {props.heading && (
        <h2 className="text-2xl font-bold md:text-3xl" style={{ color: fg }}>
          {props.heading as string}
        </h2>
      )}
      {props.subheading && (
        <p className="mt-3 text-base" style={{ color: fg, opacity: 0.85 }}>
          {props.subheading as string}
        </p>
      )}
      {btn.enabled && btn.text && (
        <div className="mt-8">
          <a
            href={btn.target || btn.url || "#"}
            className="inline-block rounded-xl bg-white px-8 py-3.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ color: bg }}
          >
            {btn.text}
          </a>
        </div>
      )}
    </section>
  );
};

const FeatureGridBlock = ({
  props,
  primaryColor,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
}) => {
  const bg = (props.backgroundColor as string) || "white";
  const fg = (props.textColor as string) || "#111827"; // design-lint-ignore: page-builder default color
  const features: Array<{ icon?: string; title: string; description: string }> = (props.features as any[]) || [];
  const cols = (props.columns as number) || 3;
  const colClass = cols >= 4
    ? "sm:grid-cols-2 lg:grid-cols-4"
    : cols === 2
      ? "sm:grid-cols-2"
      : "sm:grid-cols-2 lg:grid-cols-3";
  if (features.length === 0 && !props.headerText) return null;
  return (
    <section className="py-14 px-6 lg:px-8" style={{ backgroundColor: bg }}>
      {props.headerText && (
        <h2 className="mb-2 text-center text-2xl font-bold md:text-3xl" style={{ color: fg }}>
          {props.headerText as string}
        </h2>
      )}
      {props.subheading && (
        <p className="mb-10 text-center text-sm" style={{ color: fg, opacity: 0.65 }}>
          {props.subheading as string}
        </p>
      )}
      <div className={`mx-auto grid max-w-5xl gap-6 ${colClass}`}>
        {features.map((f, i) => (
          <div
            key={i}
            className={
              props.style === "cards"
                ? "rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm"
                : "p-4 text-center"
            }
          >
            {f.icon && <div className="mb-3 text-3xl">{f.icon}</div>}
            <h4 className="mb-2 font-semibold" style={{ color: fg }}>{f.title}</h4>
            <p className="text-sm leading-relaxed" style={{ color: fg, opacity: 0.65 }}>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

const StepsProcessBlock = ({
  props,
  primaryColor,
}: {
  props: Record<string, unknown>;
  primaryColor: string;
}) => {
  const bg = (props.backgroundColor as string) || "white";
  const fg = (props.textColor as string) || "#111827"; // design-lint-ignore: page-builder default color
  const steps: Array<{ number?: string; title: string; description: string }> = (props.steps as any[]) || [];
  const isHorizontal = (props.layout as string) !== "vertical";
  if (steps.length === 0 && !props.headerText) return null;
  return (
    <section className="py-14 px-6 lg:px-8" style={{ backgroundColor: bg }}>
      {props.headerText && (
        <h2 className="mb-2 text-center text-2xl font-bold md:text-3xl" style={{ color: fg }}>
          {props.headerText as string}
        </h2>
      )}
      {props.subheading && (
        <p className="mb-10 text-center text-sm" style={{ color: fg, opacity: 0.65 }}>
          {props.subheading as string}
        </p>
      )}
      <div className={`mx-auto max-w-4xl ${isHorizontal ? "flex flex-col gap-8 sm:flex-row" : "flex flex-col gap-8"}`}>
        {steps.map((s, i) => (
          <div key={i} className={`flex ${isHorizontal ? "flex-1 flex-col items-center text-center" : "items-start gap-4"}`}>
            <div
              className="mb-3 flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
              style={{ backgroundColor: primaryColor }}
            >
              {s.number || String(i + 1)}
            </div>
            <div>
              <h4 className="font-semibold" style={{ color: fg }}>{s.title}</h4>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: fg, opacity: 0.65 }}>{s.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const VideoEmbedBlock = ({ props }: { props: Record<string, unknown> }) => {
  const { t } = useTranslation("productPages");
  const bg = (props.backgroundColor as string) || "black";
  const rawUrl = (props.url as string) || "";

  const getEmbedUrl = (url: string) => {
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
    return url;
  };

  const embedUrl = getEmbedUrl(rawUrl);
  const ar = ((props.aspectRatio as string) || "16:9").replace(":", "/");

  return (
    <section className="py-10 px-6 lg:px-8" style={{ backgroundColor: bg }}>
      {props.title && (
        <h2 className="mb-6 text-center text-2xl font-bold text-white">{props.title as string}</h2>
      )}
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-xl" style={{ aspectRatio: ar }}>
          {embedUrl ? (
            <iframe
              src={embedUrl}
              className="size-full"
              allowFullScreen
              title={(props.title as string) || t("pageRenderer.videoEmbed.defaultTitle")}
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-gray-800 text-center text-white/50">
              <div className="space-y-2">
                <div className="text-5xl">▶</div>
                <p className="text-sm">{t("pageRenderer.videoEmbed.addUrlPlaceholder")}</p>
              </div>
            </div>
          )}
        </div>
        {props.caption && (
          <p className="mt-3 text-center text-sm text-white/60">{props.caption as string}</p>
        )}
      </div>
    </section>
  );
};

const ImageBlockSection = ({ props }: { props: Record<string, unknown> }) => {
  const alignment = (props.alignment as string) || "center";
  const src = (props.src as string) || "";
  if (!src) return null;
  const img = (
    <img
      src={src}
      alt={(props.alt as string) || ""}
      style={{
        maxWidth: (props.maxWidth as string) || "100%",
        borderRadius: (props.borderRadius as string) || "8px",
        display: "inline-block",
      }}
      className="h-auto"
    />
  );
  return (
    <section
      className="py-6 px-6 lg:px-8"
      style={{ textAlign: alignment as "left" | "center" | "right" }}
    >
      {(props.linkUrl as string) ? (
        <a href={props.linkUrl as string} target={(props.linkTarget as string) || "_blank"} rel="noopener noreferrer">
          {img}
        </a>
      ) : img}
      {(props.caption as string) && (
        <p className="mt-2 text-center text-xs text-gray-400">{props.caption as string}</p>
      )}
    </section>
  );
};

const MARQUEE_SPEED = { slow: 40, medium: 25, fast: 14 } as const;

const MarqueeBlock = ({ props }: { props: Record<string, unknown> }) => {
  const items = (props.items as Array<{ icon: string; text: string }>) ?? [];
  const speed = MARQUEE_SPEED[(props.speed as keyof typeof MARQUEE_SPEED) ?? 'medium'] ?? 25;
  const direction = (props.direction as string) ?? 'left';
  const bg = (props.backgroundColor as string) ?? '#1e1b4b'; // design-lint-ignore: page-builder default color
  const fg = (props.textColor as string) ?? 'white';
  const iconColor = (props.iconColor as string) ?? '#facc15'; // design-lint-ignore: page-builder default color
  const pauseOnHover = props.pauseOnHover !== false;
  const fontSizeMap: Record<string, string> = { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px' };
  const fontSize = fontSizeMap[(props.fontSize as string) ?? 'sm'] ?? '14px';

  const keyframesId = 'marquee-keyframes';
  useEffect(() => {
    if (document.getElementById(keyframesId)) return;
    const style = document.createElement('style');
    style.id = keyframesId;
    style.textContent = `
      @keyframes marquee-left { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes marquee-right { from { transform: translateX(-50%); } to { transform: translateX(0); } }
    `;
    document.head.appendChild(style);
  }, []);

  if (items.length === 0) return null;

  const doubled = [...items, ...items];
  const animName = direction === 'right' ? 'marquee-right' : 'marquee-left';

  return (
    <div className="overflow-hidden" style={{ backgroundColor: bg }}>
      <div
        className="flex items-center gap-0"
        style={{
          display: 'flex',
          width: 'max-content',
          animation: `${animName} ${speed}s linear infinite`,
        }}
        onMouseEnter={(e) => { if (pauseOnHover) (e.currentTarget as HTMLDivElement).style.animationPlayState = 'paused'; }}
        onMouseLeave={(e) => { if (pauseOnHover) (e.currentTarget as HTMLDivElement).style.animationPlayState = 'running'; }}
      >
        {doubled.map((item, i) => (
          <span
            key={i}
            className="flex shrink-0 items-center whitespace-nowrap font-medium"
            style={{ color: fg, fontSize, padding: '12px 32px' }}
          >
            {item.icon && (
              <span className="me-2" style={{ color: iconColor }}>{item.icon}</span>
            )}
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── Main renderer ────────────────────────────────────────────────────────────

interface PageRendererProps {
  pageJson: PageJson;
  pageData: ProductPageData;
  settings: ProductPageSettings;
  /** Catalogue slug — enables the per-card "View course" link. */
  tagName?: string;
  productPageCode?: string;
  /** Course Finder level restriction, forwarded to every course grid. */
  lockedLevels?: string;
  /** Course Finder class pick (package_session_ids), same forwarding. */
  lockedPackageSessionIds?: string[];
  onNext: () => void;
}

const FULL_WIDTH_TYPES = new Set([
  "Header", "header",
  "Footer", "footer",
  "HeroBanner", "heroSection",
  "FilterBar",
]);

const FULL_WIDTH_BODY_TYPES = new Set(["marquee"]);

export const PageRenderer = ({
  pageJson,
  pageData,
  settings,
  tagName,
  productPageCode,
  lockedLevels,
  lockedPackageSessionIds,
  onNext,
}: PageRendererProps) => {
  const primaryColor = pageJson.globalSettings?.primaryColor || "#4F46E5"; // design-lint-ignore: page-builder default color
  const components = (pageJson.components || []).filter((c) => c.enabled);
  const pageName = pageData.name;

  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(
    {},
  );
  const onFilterChange = (key: string, value: string) =>
    setActiveFilters((prev) => ({ ...prev, [key]: value }));

  // Narrowed by the Course Finder pick as well, so a FilterBar above the grid
  // offers the classes' own levels and sessions rather than every one on the
  // page — chips that would filter courses the visitor cannot see.
  const allActive = pageData.mappings.filter((m) => m.status === "ACTIVE");
  const scopedActive = lockedPackageSessionIds?.length
    ? allActive.filter((m) => lockedPackageSessionIds.includes(m.package_session_id))
    : allActive;
  const activeMappings = scopedActive.length > 0 ? scopedActive : allActive;

  const wrapWithStyle = (node: React.ReactNode, component: PageComponent) => {
    const baseStyle = buildComponentStyle(component.style);
    const animStyle = getAnimationStyle(component.style);
    const combined = { ...baseStyle, ...animStyle };
    if (Object.keys(combined).length === 0) return node;
    return <div key={component.id} style={combined}>{node}</div>;
  };

  const renderComponent = (component: PageComponent) => {
    const rendered = (() => {
    switch (component.type) {
      // ── Legacy PascalCase types ─────────────────────────────────────────
      case "Header":
        return (
          <HeaderBlock key={component.id} props={component.props} primaryColor={primaryColor} pageName={pageName} />
        );
      case "HeroBanner":
        return (
          <HeroBannerBlock key={component.id} props={component.props} primaryColor={primaryColor} pageName={pageName} />
        );
      case "FilterBar":
        return (
          <FilterBarBlock key={component.id} props={component.props} mappings={activeMappings} activeFilters={activeFilters} onFilterChange={onFilterChange} />
        );
      case "CourseGrid":
        return (
          <CourseGridBlock key={component.id} props={component.props} pageData={pageData} settings={settings} primaryColor={primaryColor} activeFilters={activeFilters} tagName={tagName} productPageCode={productPageCode} lockedLevels={lockedLevels} lockedPackageSessionIds={lockedPackageSessionIds} />
        );
      case "TextBlock":
        return <TextBlockComp key={component.id} props={component.props} />;
      case "ImageBanner":
        return <ImageBannerBlock key={component.id} props={component.props} />;
      case "HTML":
        return <HtmlBlock key={component.id} props={component.props} />;
      case "Footer":
        return <FooterBlock key={component.id} props={component.props} />;

      // ── New catalogue camelCase types ───────────────────────────────────
      case "header":
        return (
          <NewHeaderBlock key={component.id} props={component.props} primaryColor={primaryColor} pageName={pageName} />
        );
      case "heroSection":
        return (
          <HeroSectionBlock key={component.id} props={component.props} primaryColor={primaryColor} />
        );
      case "productCourseGrid":
        return (
          <CourseGridBlock key={component.id} props={component.props} pageData={pageData} settings={settings} primaryColor={primaryColor} activeFilters={activeFilters} tagName={tagName} productPageCode={productPageCode} lockedLevels={lockedLevels} lockedPackageSessionIds={lockedPackageSessionIds} />
        );
      case "footer":
        return <NewFooterBlock key={component.id} props={component.props} />;
      case "textBlock":
        return <TextBlockComp key={component.id} props={component.props} />;
      case "htmlBlock":
        return <HtmlBlock key={component.id} props={component.props} />;
      case "imageBlock":
        return <ImageBlockSection key={component.id} props={component.props} />;
      case "statsHighlights":
        return <StatsHighlightsBlock key={component.id} props={component.props} primaryColor={primaryColor} />;
      case "testimonialSection":
        return <TestimonialSectionBlock key={component.id} props={component.props} />;
      case "faqSection":
        return <FaqSectionBlock key={component.id} props={component.props} />;
      case "ctaBanner":
        return <CtaBannerBlock key={component.id} props={component.props} />;
      case "featureGrid":
        return <FeatureGridBlock key={component.id} props={component.props} primaryColor={primaryColor} />;
      case "stepsProcess":
        return <StepsProcessBlock key={component.id} props={component.props} primaryColor={primaryColor} />;
      case "videoEmbed":
        return <VideoEmbedBlock key={component.id} props={component.props} />;
      case "marquee":
        return <MarqueeBlock key={component.id} props={component.props} />;

      default:
        return null;
    }
    })();
    return wrapWithStyle(rendered, component);
  };

  const headerComponents = components.filter(
    (c) => c.type === "Header" || c.type === "header",
  );
  const heroComponent = components.find(
    (c) => c.type === "HeroBanner" || c.type === "heroSection",
  );
  const footerComponent = components.find(
    (c) => c.type === "Footer" || c.type === "footer",
  );
  const bodyComponents = components.filter(
    (c) => !FULL_WIDTH_TYPES.has(c.type) && c.type !== "Footer" && c.type !== "footer",
  );

  const renderBodyComponent = (c: PageComponent) => {
    if (FULL_WIDTH_BODY_TYPES.has(c.type)) {
      return <div key={c.id}>{renderComponent(c)}</div>;
    }
    return renderComponent(c);
  };

  return (
    <div className="min-h-screen bg-white ">
      {/* Top header bar */}
      {headerComponents.map((c) => renderComponent(c))}

      {/* Hero (full-width) */}
      {heroComponent && renderComponent(heroComponent)}

      {/* Body content */}
      {!heroComponent && (
        <div className="mx-auto max-w-screen-2xl border-b border-gray-100 px-6 py-8 lg:px-8">
          <h1 className="text-3xl font-bold leading-tight text-gray-900 md:text-4xl">
            {pageName}
          </h1>
        </div>
      )}
      {bodyComponents.map((c) =>
        FULL_WIDTH_BODY_TYPES.has(c.type) ? (
          <div key={c.id}>{renderComponent(c)}</div>
        ) : (
          <div key={c.id} className="mx-auto max-w-screen-2xl">
            {renderBodyComponent(c)}
          </div>
        )
      )}

      {/* Footer */}
      {footerComponent && renderComponent(footerComponent)}

      {/* Sticky action bar */}
      <StickyCartBar
        pageData={pageData}
        onNext={onNext}
        primaryColor={primaryColor}
      />
    </div>
  );
};

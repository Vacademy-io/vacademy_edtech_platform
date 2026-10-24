import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageFitProvider, siteImageFit } from "@/components/common/fit-image/FitImage";
import { RouteMatcher } from "../../-services/route-matcher";
import { useTranslation } from "react-i18next";
import { DEVANAGARI_FALLBACK_FAMILY, withArabicFallback, withDevanagariFallback } from "@/utils/branding";
import { siteUsesDevanagari } from "../../-utils/catalogue-site-language";
import { collectConfigFontFamilies, ensureFontsLoaded } from "../../-utils/catalogue-fonts";
import { buildSiteThemeVars } from "../../-utils/catalogue-palette";
import { BASE_URL, GET_PRODUCT_PAGE_BY_CODE } from "@/constants/urls";
import { Capacitor } from "@capacitor/core";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { LeadCollectionModal } from "../../-components/LeadCollectionModal";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import axios from "axios";
import { JsonRenderer } from "../../-components/JsonRenderer";
import { OPEN_COURSE_ENROLLMENT_EVENT } from "../../-components/components/HtmlPageSection";
import { CourseCatalogueService } from "../../-services/course-catalogue-service";
import { CourseCatalogueData } from "../../-types/course-catalogue-types";
import { resolveCourseView } from "../../-utils/course-page-routing";
import { useInstituteNamingSettings } from "../../-utils/institute-naming-seed";
import {
  resolveLearnerStructureVariant,
  type LearnerCourseDetailsSettings,
} from "../../-utils/learner-course-details-settings";
import { CourseStructureDetails } from "../../-components/CourseStructureDetails"; // Course structure component
import { EnrollmentPaymentDialog } from "../../-components/EnrollmentPaymentDialog";
import { AudienceFormModal } from "../../-components/AudienceFormModal";
import {
  type ComingSoonInfo,
  formatLaunchDate,
  readComingSoon,
} from "../../-utils/coming-soon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InviteUnavailableMessage } from "@/components/common/enroll-by-invite/-components/InviteUnavailableMessage";
import {
  resolveInviteAvailability,
  extractUnavailableMessageHtml,
} from "@/lib/invite-availability";
import { getBackendCourseDuration } from "@/utils/courseTime";
import { PriceWithMrp } from "@/components/common/price-with-mrp";
import { formatAmountLabel } from "../../-components/components/catalog/catalog-format";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { cn, sanitizeHtml } from "@/lib/utils";
import { AuthorAvatar } from "./AuthorAvatar";
import { CourseDetailsView, RelatedHeader, RELATED_SECTION_CLASS, RELATED_SHELL_CLASS } from "./CourseDetailsView";
import { courseLanguageLabel, parseCoursePageJson, previewVideoOf } from "../-utils/course-page-content";
import { useCourseSeries } from "../-hooks/use-course-series";
import { courseFormatKeys, resolveCourseFormats } from "../../-utils/course-format";
import { CourseShowcaseComponent } from "../../-components/components/CourseShowcaseComponent";
import { coursePageContext, findAppBanner, findCatalogSection, findPathLibraryId, plainText, relatedCardStyle, showsDuration, summaryOf } from "../-utils/course-page-context";
import { resolveCatalogDiscovery } from "../../-components/components/catalog/catalog-config";
import { useCatalogStreams } from "../../-components/components/catalog/use-catalog-discovery";
import {
  type CourseAuthor as CourseInstructor,
  type RawCourseInstructor,
  mapCourseAuthors,
  visibleCourseAuthors,
} from "../../-utils/course-authors";
import { authorRoleTag, sharedAuthorRole } from "@/lib/course-author-role";
import {
  CatalogueLocaleProvider,
  useCatalogueLocale,
  useSiteT,
} from "../../-utils/catalogue-locale";
import { withSearchParams } from "../../-utils/catalogue-url-state";
import {
  courseLanguagesOf,
  languageOfLevel,
  preferredCourseLanguage,
} from "../../-utils/course-variants";
import { isSiteCartEnabled, type SiteCartItem } from "../../-utils/site-cart";
import { useSiteCartStore } from "../../-stores/site-cart-store";
import { SiteCartDrawer } from "../../-components/site-cart/SiteCartDrawer";
import { openSiteCartDrawer } from "../../-components/site-cart/site-cart-events";
import {
  useFallbackCartReopen,
  useHasSiteCartOpener,
} from "../../-components/site-cart/use-site-cart";
import { sameOffer, storeCartRoute, type StoreCartRoute } from "../../-components/site-cart/store-sale";
import { useStoreSale } from "../../-components/site-cart/use-store-sale";
import { useFolderTrail } from "../-hooks/use-folder-trail";
import {
  invitePaymentEntryFor,
  primeOpenEnrollInvite,
  primeProductPage,
  type CourseInitLike,
  type OpenInvitePaymentEntry,
} from "../../-services/course-levels-service";
import { useCourseVersions } from "../-hooks/use-course-versions";
import {
  SITE_CART_MAX_ITEMS,
  buildCourseCartItem,
  cartCanTake,
  keepsLinkInviteEnrolment,
  localizeCourseDisplay,
  resolveVersionOffer,
  searchText,
  versionOwnDetails,
  type SiteCartOpenDetail,
} from "../-utils/course-version-selection";
import { CourseLanguagePicker, CourseVersionPicker } from "./CourseLanguagePicker";
import { CourseCartActions, CourseCartPending } from "./CourseCartActions";
import { EbookDetailsView } from "./EbookDetailsView";
import { HostedSiteAssistant } from "@/components/site-assistant/HostedSiteAssistant";
import { headerOffsetClass } from "../../-components/header/header-chrome";
import {
  BookOpen,
  CaretDown,
  ChalkboardTeacher,
  Clock,
  File as FileIcon,
  GraduationCap,
  House,
  Info,
  Star,
  Tag,
} from "@phosphor-icons/react";

// Backend sometimes stores sentinel level names (e.g. "default") that must not
// surface in the course overview. Hide sentinels; show genuine values as-is.
const SENTINEL_LEVEL_NAMES = new Set([
  "default",
  "none",
  "null",
  "undefined",
  "",
]);
const displayLevelName = (raw?: string | null): string => {
  if (!raw) return "";
  // String(): the router parses search values as JSON, so ?level=10 can
  // arrive as a number.
  const trimmed = String(raw).trim();
  if (SENTINEL_LEVEL_NAMES.has(trimmed.toLowerCase())) return "";
  return trimmed;
};

// What storeCartRoute asks of a section's own checkout, for this page: its
// enrol flow (the version's invite) sells the version once, as it is. So a
// version goes to the site cart exactly when the store sells it as it is.
const enrolFlowSellsVersion = () => true;

// The default layout's primary action (Figma "Button / Primary": 15/23, px 28, py 14).
const FIGMA_CTA =
  "w-full rounded-lg bg-palette-primary px-7 py-3.5 text-[15px] font-medium leading-[23px] text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] sm:whitespace-nowrap"; // design-lint-ignore: Figma primary button 15/23
// Formats read as a book: the E-book design (Table of Contents, About the Author, "Order now").
const BOOK_FORMATS = new Set(["ebook", "e-book", "book", "pdf"]);
// A course's language when the site names none of its own (tags like "hindi").
const FALLBACK_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
];

// Helper function to check if HTML content has actual visible text
// Returns false for empty HTML like "<p></p>", "<p> </p>", or just whitespace

const hasContent = (htmlString: string | undefined | null): boolean => {
  if (!htmlString) return false;
  // Strip HTML tags and decode HTML entities
  const textContent = htmlString
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/gi, " ") // Replace &nbsp; with space
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
  return textContent.length > 0;
};

// HTML content block with a line-clamp + "View more / View less" toggle.
// The clamped flag is measured against scrollHeight so the toggle only
// appears when the content is actually tall enough to be cut off.
const HtmlWithViewMore: React.FC<{
  html: string;
  className?: string;
  clampLines?: number;
}> = ({ html, className, clampLines = 4 }) => {
  const { t } = useTranslation("coursePlayerB");
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const clampClass =
    clampLines === 3
      ? "line-clamp-3"
      : clampLines === 5
      ? "line-clamp-5"
      : clampLines === 6
      ? "line-clamp-6"
      : "line-clamp-4";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [html]);

  return (
    <div>
      <div
        ref={ref}
        className={cn("richtext-content", className, !expanded && clampClass)}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-sm font-medium text-primary-500 hover:underline focus:outline-none"
        >
          {expanded ? t("common.viewLess") : t("common.viewMore")}
        </button>
      )}
    </div>
  );
};

// Reusable card for each highlights section. Keeps the gradient-accent
// icon chip + hover overlay from the original scattered-card design so
// moving the sections into the accordion doesn't strip visual hierarchy.
const HighlightSectionCard: React.FC<{
  icon: React.ReactNode;
  iconBgClass: string;
  overlayClass: string;
  title: string;
  children: React.ReactNode;
}> = ({ icon, iconBgClass, overlayClass, title, children }) => (
  <div className="relative bg-catalogue-bg-elevated border border-catalogue-border rounded-catalogue-lg shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group">
    <div
      className={cn(
        "absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-catalogue-lg",
        overlayClass
      )}
    />
    <div className="relative">
      <div className="flex items-center space-x-2 mb-3">
        <div
          className={cn(
            "p-1.5 rounded-catalogue-md shadow-sm bg-gradient-to-br",
            iconBgClass
          )}
        >
          {icon}
        </div>
        <h2 className="text-base font-bold text-catalogue-text-primary">{title}</h2>
      </div>
      {children}
    </div>
  </div>
);

const CourseHighlightDialog: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const { t } = useTranslation("coursePlayerB");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mt-3 text-sm font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 rounded"
        >
          {t("common.viewMore")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" /* design-lint-ignore: pre-existing dialog height (whole-file gate) */>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
};

// Course highlights panel — collapsible accordion that wraps the
// "What you'll learn / About / Who should learn / Instructors" sections
// so they appear compactly at the top of the course page instead of
// stacking as separate cards below.
export const CourseHighlightsAccordion: React.FC<{
  whyLearn: string;
  aboutCourse: string | null;
  whoShouldLearn: string;
  instructors: Array<CourseInstructor>;
  showInstructors: boolean;
  primaryInstructor?: string | null;
}> = ({
  whyLearn,
  aboutCourse,
  whoShouldLearn,
  instructors,
  showInstructors,
  primaryInstructor,
}) => {
  const { t } = useTranslation("coursePlayerB");
  // Live course text in the visitor's site language (identity on a
  // single-language site). Display only: the props stay the base values.
  const siteT = useSiteT();
  const whyLearnText = siteT(whyLearn);
  const aboutCourseText = siteT(aboutCourse);
  const whoShouldLearnText = siteT(whoShouldLearn);
  const [open, setOpen] = useState(true);
  const hasWhy = hasContent(whyLearnText);
  const hasAbout = hasContent(aboutCourseText);
  const hasWho = hasContent(whoShouldLearnText);
  // Student Display Settings > "Show Teachers" decides whether the WHOLE
  // roster is listed. Off (the default) still shows the first author -- the
  // overview always has -- and now with the profile the admin wrote for them
  // (photo, subtitle, description), not just the bare name.
  const visibleInstructors = visibleCourseAuthors(
    instructors,
    showInstructors,
    primaryInstructor,
  ).map((inst) => ({
    ...inst,
    name: siteT(inst.name),
    subtitle: inst.subtitle ? siteT(inst.subtitle) : inst.subtitle,
    description: inst.description ? siteT(inst.description) : inst.description,
  }));
  const hasInstructors = visibleInstructors.length > 0;
  // "Acharya" when every listed author is one; otherwise the institute term,
  // with each author's own role printed under their name.
  const instructorsHeading = sharedAuthorRole(
    visibleInstructors.map((inst) => inst.role),
    getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher),
  );
  if (!hasWhy && !hasAbout && !hasWho && !hasInstructors) return null;

  return (
    <section className="rounded-catalogue-lg border border-catalogue-border bg-catalogue-bg-elevated shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-start hover:bg-catalogue-bg-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <span className="flex items-center gap-2 min-w-0">
          <div className="p-1 bg-primary-50 rounded-catalogue-sm">
            <Info className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" weight="bold" />
          </div>
          <span className="text-sm font-semibold truncate text-catalogue-text-primary">
            {t("courseDetails.accordion.highlightsTitle", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </span>
        </span>
        <CaretDown
          className={cn(
            "w-4 h-4 text-catalogue-text-muted flex-shrink-0 transition-transform duration-200",
            open ? "rotate-180" : "rotate-0"
          )}
          weight="bold"
        />
      </button>
      {open && (
        <div className="px-3 sm:px-4 pb-4 pt-3 space-y-3 border-t border-catalogue-border-subtle bg-catalogue-bg-subtle/50">
          {hasAbout && (
            <HighlightSectionCard
              title={t("courseDetails.accordion.aboutThisCourse", {
                course: getTerminology(ContentTerms.Course, SystemTerms.Course),
              })}
              icon={
                <FileIcon
                  size={18}
                  className="text-blue-600"
                  weight="duotone"
                />
              }
              iconBgClass="from-info-100 to-info-200"
              overlayClass="from-info-500/5 to-transparent"
            >
              <HtmlWithViewMore
                html={aboutCourseText || ""}
                className="text-sm text-catalogue-text-secondary leading-relaxed"
              />
              <CourseHighlightDialog
                title={t("courseDetails.accordion.aboutThisCourse", {
                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                })}
              >
                <div
                  className="richtext-content text-sm leading-relaxed text-catalogue-text-secondary"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(aboutCourseText || "") }}
                />
              </CourseHighlightDialog>
            </HighlightSectionCard>
          )}
          {hasWhy && (
            <HighlightSectionCard
              title={t("courseDetails.accordion.whatYoullLearn")}
              icon={
                <BookOpen
                  size={18}
                  className="text-success-600"
                  weight="duotone"
                />
              }
              iconBgClass="from-success-100 to-success-200"
              overlayClass="from-success-500/5 to-transparent"
            >
              <HtmlWithViewMore
                html={whyLearnText}
                className="text-sm text-catalogue-text-secondary leading-relaxed"
              />
              <CourseHighlightDialog title={t("courseDetails.accordion.whatYoullLearn")}>
                <div
                  className="richtext-content text-sm leading-relaxed text-catalogue-text-secondary"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(whyLearnText) }}
                />
              </CourseHighlightDialog>
            </HighlightSectionCard>
          )}
          {hasWho && (
            <HighlightSectionCard
              title={t("courseDetails.accordion.whoShouldJoin")}
              icon={
                <GraduationCap
                  size={18}
                  className="text-purple-600"
                  weight="duotone"
                />
              }
              iconBgClass="from-purple-100 to-purple-200"
              overlayClass="from-purple-500/5 to-transparent"
            >
              <HtmlWithViewMore
                html={whoShouldLearnText}
                className="text-sm text-catalogue-text-secondary leading-relaxed"
              />
              <CourseHighlightDialog title={t("courseDetails.accordion.whoShouldJoin")}>
                <div
                  className="richtext-content text-sm leading-relaxed text-catalogue-text-secondary"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(whoShouldLearnText) }}
                />
              </CourseHighlightDialog>
            </HighlightSectionCard>
          )}
          {hasInstructors && (
            <HighlightSectionCard
              title={instructorsHeading}
              icon={
                <ChalkboardTeacher
                  size={18}
                  className="text-orange-600"
                  weight="duotone"
                />
              }
              iconBgClass="from-primary-100 to-primary-200"
              overlayClass="from-primary-500/5 to-transparent"
            >
              <div className="space-y-2">
                {/* Name + subtitle inline, so an author is recognisable without
                    a click; the dialog below carries the full description. A
                    bare "1 teachers" count used to be all that showed here. */}
                <ul className="space-y-1.5">
                  {visibleInstructors.map((inst, idx) => (
                    <li
                      key={`${inst.id}-${idx}`}
                      className="flex items-center gap-2.5"
                    >
                      <AuthorAvatar author={inst} sizeClass="size-7" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-catalogue-text-primary">
                          {inst.name || getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)}
                        </span>
                        {authorRoleTag(inst.role, instructorsHeading) && (
                          <span className="block truncate text-xs font-medium text-catalogue-text-secondary">
                            {authorRoleTag(inst.role, instructorsHeading)}
                          </span>
                        )}
                        {inst.subtitle && (
                          <span className="block truncate text-xs text-catalogue-text-secondary">
                            {inst.subtitle}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <CourseHighlightDialog title={instructorsHeading}>
                  <div className="space-y-2">
                    {visibleInstructors.map((inst, idx) => (
                      <div
                        key={`${inst.id}-${idx}`}
                        className="flex items-start gap-3 rounded-catalogue-md bg-catalogue-bg-subtle/80 p-2.5"
                      >
                        <AuthorAvatar author={inst} sizeClass="size-10" />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-semibold text-catalogue-text-primary">
                            {inst.name || getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)}
                          </h4>
                          {authorRoleTag(inst.role, instructorsHeading) && (
                            <p className="text-xs font-medium text-catalogue-text-secondary">
                              {authorRoleTag(inst.role, instructorsHeading)}
                            </p>
                          )}
                          {inst.subtitle && (
                            <p className="text-xs text-catalogue-text-secondary">
                              {inst.subtitle}
                            </p>
                          )}
                          {/* The admin writes the bio in a rich-text editor,
                              so this is HTML: sanitise and render it, the way
                              the About / What-you'll-learn sections do. */}
                          {inst.description && (
                            <div
                              className="richtext-content mt-1 text-xs leading-relaxed text-catalogue-text-secondary"
                              dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(inst.description),
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CourseHighlightDialog>
              </div>
            </HighlightSectionCard>
          )}
        </div>
      )}
    </section>
  );
};

interface CourseDetailsPageProps {
  courseId: string;
  tagName: string;
  instituteId: string;
  instituteThemeCode?: string | null;
  enrollInviteId?: string;
  packageSessionId?: string;
  bannerImage?: string;
  level?: string;
  price?: string;
  available_slots?: number;
  /**
   * Present when the visitor came from a Product Page offer section. Enrolling
   * then hands off to that product page's checkout (same funnel as its "Enrol
   * now" card CTA) instead of the standalone enroll-invite dialog.
   */
  productPageCode?: string;
}

interface CourseData {
  id: string;
  title: string;
  description: string | null;
  duration: string | null;
  instructor: string | null;
  price: number;
  elevatedPrice?: number;
  type: string;
  level: string;
  thumbnail: string;
  previewImage?: string;
  bannerImage?: string;
  fullDescription: string;
  learningOutcomes: string[];
  requirements: string[];
  whoShouldLearn: string;
  whyLearn: string;
  aboutCourse: string | null;
  instructors: Array<CourseInstructor>;
  rating: number;
  tags: string[];
  curriculum: Array<{
    week: number;
    title: string;
    topics: string[];
  }>;
  courseDepth: number;
  packageSessionId: string;
  enrollInviteId?: string;
  // Server-computed availability of the course's default enroll invite + the admin's
  // "unavailable" message (from the invite's setting_json). Drive the closed-state UI.
  enrollInviteAvailability?: string;
  unavailableMessageHtml?: string;
  /** Set while the admin has the course on Coming Soon: every enrol CTA becomes "Notify me". */
  comingSoon?: ComingSoonInfo | null;
  levelId?: string;
  /** Set once a course version is selected (BookDetailsComponent reads sessionId). */
  sessionId?: string;
  sessionName?: string;
  courseId?: string;
  course_banner_media_id?: string;
  comma_separeted_tags?: string;
  course_html_description_html?: string;
  about_the_course_html?: string;
  currency?: string;
  available_slots?: number;
  /** course_media_id as stored: a preview video (Watch preview) or an image. */
  courseMediaRaw?: string;
  /** course_page_json (admin "Course page" section): mode and FAQs. */
  coursePageJson?: string | null;
}

interface CourseDetailsPageContentProps extends CourseDetailsPageProps {
  /** Loaded by the CourseDetailsPage shell (it also feeds the language provider). */
  catalogueData: CourseCatalogueData | null;
}

const CourseDetailsPageContent: React.FC<CourseDetailsPageContentProps> = ({
  courseId,
  tagName,
  instituteId,
  instituteThemeCode,
  enrollInviteId,
  packageSessionId,
  bannerImage,
  level,
  price,
  available_slots,
  productPageCode,
  catalogueData,
}) => {
  const { t, i18n } = useTranslation("coursePlayerB");
  // Institute terminology must be seeded before the first paint — see
  // institute-naming-seed.ts.
  const namingReady = useInstituteNamingSettings(instituteId);
  const navigate = useNavigate();
  const router = useRouter();
  const domainRouting = useDomainRouting();
  const isAndroid = Capacitor.getPlatform() === "android";
  const isIOS = Capacitor.getPlatform() === "ios";
  // The course as course-init + the URL describe it. `courseData` (below) is
  // this with the selected language version applied, when the site has them.
  const [loadedCourseData, setCourseData] = useState<CourseData | null>(null);
  const [courseInit, setCourseInit] = useState<CourseInitLike | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getCardStyling = () => {
    if (!catalogueData?.globalSettings) {
      return {
        hover: { shadow: true, scale: 1.05 },
      };
    }

    const globalSettings = catalogueData.globalSettings as any;

    // Find course details page styling
    const detailsPage = globalSettings.pages?.find(
      (page: any) => page.id === "details",
    );
    return (
      detailsPage?.components?.[0]?.style?.card || {
        hover: { shadow: true, scale: 1.05 },
      }
    );
  };
  const [showLeadCollection, setShowLeadCollection] = useState(false);
  // Teachers/Instructors section is hidden unless the institute opts in via
  // STUDENT_DISPLAY_SETTINGS. Fetched from the public (open) settings endpoint
  // because this catalogue page is unauthenticated.
  const [showInstructors, setShowInstructors] = useState(false);
  /**
   * How the institute has configured the course page for its LOGGED-IN
   * learners (Settings -> Student Display Settings -> courseDetails). The
   * logged-out page reads the same record so a visitor and an enrolled
   * learner see the course laid out the same way.
   *
   * - `enrolledLayout: "contentOnly"` means the learner's page IS the content
   *   card grid, so the public page shows cards too.
   * - otherwise the opening tab decides: CONTENT_STRUCTURE is the card grid,
   *   OUTLINE is the folder-row list.
   * Null until the settings land, or when the request fails — the outline is
   * the safe fallback either way.
   */
  const [learnerCourseDetails, setLearnerCourseDetails] =
    useState<LearnerCourseDetailsSettings | null>(null);

  // Debug catalogue data changes
  useEffect(() => {
    console.log("[CourseDetailsPage] Catalogue data loaded:", !!catalogueData);
  }, [catalogueData]);

  // A catalogue can give a course its own authored page instead of this shared
  // details layout (globalSettings.coursePages). The catalogue's own cards
  // already navigate straight there, so this only catches the ways a visitor
  // can still land on the raw /<tag>/<courseId> URL — a bookmark, a link
  // shared before the page existed, a back-navigation. `replace` keeps that
  // dead URL out of history so Back does not bounce them right back here.
  const courseView = resolveCourseView(catalogueData?.globalSettings, {
    courseId,
    packageSessionId,
  });
  const customCoursePageRoute =
    courseView.mode === "PAGE" ? courseView.route : null;
  // Syllabus-first: the marketing accordion (why learn / about / who should
  // learn / instructors) is dropped and the course structure leads, for
  // courses where the syllabus IS the pitch. Same URL, so pricing, enrolment
  // and the site chrome are untouched. TILES is the same page with the
  // subjects drawn as artwork cards rather than folder rows.
  const isOutlineView =
    courseView.mode === "OUTLINE" || courseView.mode === "TILES";
  // The course structure follows whatever the institute set for its logged-in
  // learners, so the page reads the same signed in or out. A per-course
  // OUTLINE/TILES mode is an explicit override and wins over the inherited
  // setting; DETAILS (and no configuration at all) inherits.
  const structureVariant: "outline" | "tiles" =
    courseView.mode === "OUTLINE"
      ? "outline"
      : courseView.mode === "TILES"
        ? "tiles"
        : resolveLearnerStructureVariant(learnerCourseDetails);
  // The version last picked with the Language picker. Picking writes
  // ?packageSessionId; a version the admin mapped to its own page must not
  // whisk the visitor off this page mid-choice.
  const pickedVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!customCoursePageRoute) return;
    if (packageSessionId && pickedVersionRef.current === packageSessionId) return;
    navigate({
      to: `${RouteMatcher.basePath(tagName)}/${customCoursePageRoute}`,
      search: { enrollInviteId, packageSessionId, bannerImage, level },
      replace: true,
    });
  }, [customCoursePageRoute, tagName, navigate, enrollInviteId, packageSessionId, bannerImage, level]);

  useEffect(() => {
    if (!instituteId) return;
    let cancelled = false;
    axios
      .get(
        `${BASE_URL}/admin-core-service/open/institute/setting/v1/student-display`,
        { params: { instituteId } },
      )
      .then((res) => {
        if (cancelled) return;
        const cd = (
          res.data as { courseDetails?: LearnerCourseDetailsSettings } | null
        )?.courseDetails;
        setShowInstructors(cd?.showInstructors ?? false);
        setLearnerCourseDetails(cd ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setShowInstructors(false);
        setLearnerCourseDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [instituteId]);
  const [enrollmentDialogOpen, setEnrollmentDialogOpen] = useState(false);
  // Shown when a learner tries to enroll through an expired / not-yet-started / deactivated invite.
  const [showUnavailableDialog, setShowUnavailableDialog] = useState(false);
  // "Notify me" form for a Coming Soon course.
  const [showNotifyForm, setShowNotifyForm] = useState(false);
  // Any other campaign form a section asks for (header 'openForm' buttons, a
  // coming-soon stream or category in the mega menu) — the same
  // openAudienceForm contract the other page shells listen for.
  const [audienceForm, setAudienceForm] = useState<{ audienceId: string; title?: string } | null>(null);
  useEffect(() => {
    const handleOpenAudienceForm = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.audienceId) setAudienceForm({ audienceId: String(detail.audienceId), title: detail.title });
    };
    window.addEventListener("openAudienceForm", handleOpenAudienceForm);
    return () => window.removeEventListener("openAudienceForm", handleOpenAudienceForm);
  }, []);

  // Catalogue data (header, footer, details page, settings) is fetched by the
  // CourseDetailsPage shell at the bottom of this file.

  // Apply font from JSON if fonts.enabled is true
  useEffect(() => {
    const fonts = catalogueData?.globalSettings?.fonts;
    // A site offering हिन्दी / मराठी also gets a Devanagari face after the
    // brand font, as on the other catalogue pages. Other sites keep exactly
    // the stacks below.
    const devanagari = siteUsesDevanagari(catalogueData?.globalSettings?.i18n);
    if (devanagari) {
      ensureFontsLoaded([...collectConfigFontFamilies(catalogueData), DEVANAGARI_FALLBACK_FAMILY]);
    }

    if (!fonts?.enabled || !fonts?.family) {
      const defaultStack = "'Figtree', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      document.body.style.fontFamily = devanagari ? withDevanagariFallback(defaultStack) : defaultStack;
      return;
    }

    const fontFamily = fonts.family.trim();
    const primaryFont = fontFamily.split(",")[0].replace(/['"]/g, "").trim();

    // Create Google Fonts link
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      primaryFont,
    )}:wght@300;400;500;600;700&display=swap`;

    // Append link only once
    if (!document.querySelector(`link[href="${link.href}"]`)) {
      document.head.appendChild(link);
    }

    // Apply font exactly as specified in JSON, plus the Arabic fallback the
    // stack would otherwise drop (withArabicFallback preserves Latin order).
    const resolvedFontFamily = devanagari
      ? withDevanagariFallback(withArabicFallback(fontFamily))
      : withArabicFallback(fontFamily);
    document.body.style.fontFamily = resolvedFontFamily;
    document.documentElement.style.setProperty("--app-font-family", resolvedFontFamily);
  }, [catalogueData]);

  // Fetch course details
  useEffect(() => {
    const fetchCourseDetails = async () => {
      try {
        setIsLoading(true);

        // Fetch course details from /course-init API (scalable single course endpoint)
        const initApiResponse = await axios.get(
          `${BASE_URL}/admin-core-service/open/v1/learner-study-library/course-init`,
          {
            params: {
              instituteId: instituteId,
              courseId: courseId,
            },
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        // Extract the first (and only) course from the response
        const initData = initApiResponse.data;
        const courseResponse =
          Array.isArray(initData) && initData.length > 0 ? initData[0] : null;

        if (!courseResponse) {
          console.log("[CourseDetailsPage] Course not found in response");
          setError(t("courseDetails.courseNotFoundError", {
            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
          }));
          return;
        }

        const course = courseResponse.course;

        // Check if course is published to catalogue
        if (course.is_course_published_to_catalaouge !== true) {
          // A course sold on a Product Page is ALREADY public there — name,
          // price and an anonymous enrol button — so the catalogue publish
          // flag must not hide its details page. Most product-page courses are
          // not catalogue-published (214 of 219 on Shiksha Nation), which would
          // have dead-ended nearly every "View course" click.
          //
          // Membership is verified against the product page itself rather than
          // trusted from the URL, so a hand-typed ?productPageCode= cannot open
          // a course that page does not actually sell. Only reached for an
          // unpublished course, so a normal catalogue visit costs no extra
          // request (the payload carries every course on the page).
          let offeredByProductPage = false;
          if (productPageCode) {
            try {
              const productPage = await axios.get(
                GET_PRODUCT_PAGE_BY_CODE(productPageCode, instituteId),
              );
              // Reused by the language versions (no second request).
              primeProductPage(instituteId, productPageCode, productPage.data);
              offeredByProductPage = (productPage.data?.mappings ?? []).some(
                (m: { status?: string; package_id?: string }) =>
                  (m.status ?? "ACTIVE") === "ACTIVE" && m.package_id === courseId,
              );
            } catch (productPageError) {
              // Fail closed — an unreachable product page cannot vouch for it.
              console.warn(
                "[CourseDetailsPage] Product page lookup failed:",
                productPageError,
              );
            }
          }

          if (!offeredByProductPage) {
            setError(t("courseDetails.courseNotPublicError", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            }));
            return;
          }
        }

        // Use banner image from props if available, otherwise use API fields (raw media IDs)
        let thumbnailUrl = "/api/placeholder/800/400";
        if (bannerImage) {
          thumbnailUrl = bannerImage;
        } else {
          // Fallback to API fields (raw media IDs, same priority as course catalog)
          const thumbnailField =
            course.course_preview_image_media_id ||
            course.course_banner_media_id ||
            course.thumbnail_file_id;
          thumbnailUrl = thumbnailField || "/api/placeholder/800/400";
        }

        // Default price from course-init API
        let finalPrice = price
          ? parseFloat(price)
          : course.min_plan_actual_price || 0;
        let finalElevatedPrice: number | undefined =
          typeof course.min_plan_elevated_price === "number"
            ? course.min_plan_elevated_price
            : undefined;
        let finalCurrency = course.currency || "USD";
        // Availability window + admin "unavailable" message, read from the enroll-invite fetch below.
        let fetchedInviteAvailability: string | undefined;
        let fetchedInviteSettingJson: string | undefined;

        // Fetch enroll-invite API to get the correct price and currency from payment plans
        // This API contains the actual payment_plans with actual_price and currency
        if (enrollInviteId && instituteId) {
          try {
            console.log(
              "[CourseDetailsPage] Fetching enroll-invite data for price...",
            );
            const enrollInviteResponse = await axios.get(
              `${BASE_URL}/admin-core-service/open/learner/enroll-invite/${instituteId}/${enrollInviteId}`,
              {
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );

            console.log(
              "[CourseDetailsPage] Enroll Invite API response:",
              enrollInviteResponse.data,
            );

            const enrollInviteData = enrollInviteResponse.data;
            // Reused by the language versions (no second request).
            primeOpenEnrollInvite(instituteId, enrollInviteId, enrollInviteData);
            fetchedInviteAvailability = enrollInviteData?.availability_status;
            fetchedInviteSettingJson = enrollInviteData?.setting_json;

            // Extract price and currency from payment_plans — of the invite
            // entry for the linked package session, the same entry the
            // enrolment dialog charges (entry [0] when it is not listed, as
            // before; an invite can sell several package sessions).
            const paymentPlan = invitePaymentEntryFor<OpenInvitePaymentEntry>(
              enrollInviteData,
              packageSessionId,
            )?.payment_option?.payment_plans?.[0];

            if (paymentPlan) {
              const planPrice = paymentPlan.actual_price;
              const planElevated = paymentPlan.elevated_price;
              const planCurrency = paymentPlan.currency;

              console.log("[CourseDetailsPage] Payment plan found:", {
                actualPrice: planPrice,
                elevatedPrice: planElevated,
                currency: planCurrency,
                planName: paymentPlan.name,
              });

              if (planPrice !== undefined && planPrice !== null) {
                finalPrice = planPrice;
              }
              if (typeof planElevated === "number") {
                finalElevatedPrice = planElevated;
              }
              if (planCurrency) {
                finalCurrency = planCurrency;
              }
            } else {
              console.log(
                "[CourseDetailsPage] No payment plan found in enroll-invite response",
              );
            }
          } catch (enrollInviteError) {
            console.error(
              "[CourseDetailsPage] Failed to fetch enroll-invite data:",
              enrollInviteError,
            );
            // Continue with default price from course-init API
          }
        }

        // Known field-name placeholders that the backend sometimes echoes
        // back when a course field is unset. Treat them as empty so we
        // don't render raw identifiers to learners.
        const PLACEHOLDER_FIELD_NAMES = new Set([
          "about_the_course",
          "about_the_course_html",
          "course_html_description",
          "course_html_description_html",
          "who_should_learn",
          "why_learn",
          "course_preview_image_media_id",
          "course_banner_media_id",
          "thumbnail_file_id",
        ]);

        // Parse HTML content safely
        const parseHtmlContent = (htmlString: string) => {
          if (!htmlString) return "";
          // Remove HTML tags and decode entities for display
          const stripped = htmlString
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .trim();
          if (!stripped) return "";
          if (PLACEHOLDER_FIELD_NAMES.has(stripped)) return "";
          return stripped;
        };

        // Preserve rich-text HTML for sections rendered via dangerouslySetInnerHTML
        // (About / What you'll learn / Who should join). Only drops placeholder
        // field-name echoes and visually-empty markup — keeps the formatting tags.
        const rawHtmlContent = (htmlString: string) => {
          if (!htmlString) return "";
          const trimmed = htmlString.trim();
          if (PLACEHOLDER_FIELD_NAMES.has(trimmed)) return "";
          const stripped = trimmed
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .trim();
          if (!stripped) return "";
          if (PLACEHOLDER_FIELD_NAMES.has(stripped)) return "";
          return htmlString;
        };

        // Extract learning outcomes from HTML content
        const extractLearningOutcomes = (htmlContent: string) => {
          if (!htmlContent)
            return [
              "Learn practical skills",
              "Apply knowledge in real projects",
              "Gain industry insights",
            ];

          // Try to extract bullet points or list items
          const listItems = htmlContent.match(/<li[^>]*>(.*?)<\/li>/g);
          if (listItems && listItems.length > 0) {
            return listItems.map((item) => parseHtmlContent(item));
          }

          // Try to extract content between <strong> tags
          const strongItems = htmlContent.match(
            /<strong[^>]*>(.*?)<\/strong>/g,
          );
          if (strongItems && strongItems.length > 0) {
            return strongItems.map((item) => parseHtmlContent(item));
          }

          // Fallback to splitting by sentences
          return parseHtmlContent(htmlContent)
            .split(".")
            .filter((s) => s.trim().length > 10)
            .slice(0, 5);
        };

        // Parse comma-separated tags
        const parseTags = (tagsString: string) => {
          if (!tagsString) return [];
          return tagsString
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        };

        // Transform API response to CourseData interface
        const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
        const courseData: CourseData = {
          id: course.id || courseId,
          title: course.package_name || t("courseDetails.untitledCourse", { course: courseTerm }),
          description: parseHtmlContent(course.course_html_description) || null,
          duration: courseResponse.sessions?.[0]?.level_with_details?.[0]
            ?.read_time_in_minutes
            ? getBackendCourseDuration(
                courseResponse.sessions[0].level_with_details[0]
                  .read_time_in_minutes,
              )
            : null,
          instructor:
            courseResponse.sessions?.[0]?.level_with_details?.[0]
              ?.instructors?.[0]?.full_name || null,
          price: finalPrice,
          elevatedPrice: finalElevatedPrice,
          type: "Course", // Generic type since it's not specified in the API
          level: level || "Basic",
          thumbnail: thumbnailUrl,
          // Add fields for hero section - use placeholder if no valid image
          previewImage:
            course.course_preview_image_media_id &&
            course.course_preview_image_media_id !== null &&
            course.course_preview_image_media_id !== "null"
              ? course.course_preview_image_media_id
              : "/api/placeholder/400/300",
          bannerImage:
            course.course_banner_media_id &&
            course.course_banner_media_id !== null &&
            course.course_banner_media_id !== "null"
              ? course.course_banner_media_id
              : "/api/placeholder/400/300",
          fullDescription:
            parseHtmlContent(course.about_the_course) ||
            parseHtmlContent(course.course_html_description) ||
            "",
          learningOutcomes: extractLearningOutcomes(
            course.who_should_learn || course.why_learn,
          ),
          requirements: [
            "Basic computer skills",
            "Internet connection",
            "Motivation to learn",
          ],
          // No canned fallback copy: the overview hides "What you'll learn" /
          // "Who should learn" when the admin left them blank. The generic
          // "Gain valuable skills and knowledge" placeholder used to make the
          // section appear on every course, filled or not.
          whoShouldLearn: rawHtmlContent(course.who_should_learn),
          whyLearn: rawHtmlContent(course.why_learn),
          // "About this course" must show the dedicated About field (rich text),
          // falling back to the course description. Previously read the wrong field
          // (course_html_description) and stripped all formatting.
          aboutCourse:
            rawHtmlContent(course.about_the_course) ||
            rawHtmlContent(course.course_html_description) ||
            null,
          // Authors = the batch's faculty, each with the profile fields the
          // admin wrote (subtitle, rich-text bio, photo). Email is not carried
          // to the page at all. No faculty -> no authors; the hero's author
          // line (`instructor`) has its own fallback.
          instructors: mapCourseAuthors(
            courseResponse.sessions?.[0]?.level_with_details?.[0]?.instructors,
            t("courseDetails.unknownTeacher", {
              teacher: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
            }),
          ),
          // A real average only: none is 0, and the page shows no rating then.
          rating: typeof course.rating === "number" && course.rating > 0 ? course.rating : 0,
          tags: parseTags(course.tags || ""),
          curriculum: [], // No curriculum data available from API yet
          courseDepth: course.course_depth || 5, // Default to 5 to show full structure
          packageSessionId:
            packageSessionId || course.package_session_id || courseId, // Use passed packageSessionId or fallback to API response
          enrollInviteId: enrollInviteId || course.enroll_invite_id, // Use passed enrollInviteId or fallback to API response
          enrollInviteAvailability: fetchedInviteAvailability,
          unavailableMessageHtml: extractUnavailableMessageHtml(fetchedInviteSettingJson),
          comingSoon: readComingSoon(courseResponse.coming_soon),
          courseMediaRaw: typeof course.course_media_id === "string" ? course.course_media_id : undefined,
          coursePageJson: typeof course.course_page_json === "string" ? course.course_page_json : null,
          levelId: course.level_id, // Add levelId from API response
          courseId: course.course_id || courseId, // Add courseId from API response or use the route param
          course_banner_media_id: course.course_banner_media_id || "", // Explicitly pass the banner ID for BookDetailsComponent
          // Preserve raw HTML fields for BookDetailsComponent (filter placeholder field-name echoes)
          course_html_description_html:
            (PLACEHOLDER_FIELD_NAMES.has(
              (course.course_html_description || "").trim(),
            )
              ? ""
              : course.course_html_description) ||
            (PLACEHOLDER_FIELD_NAMES.has(
              (course.course_html_description_html || "").trim(),
            )
              ? ""
              : course.course_html_description_html) ||
            "",
          about_the_course_html:
            (PLACEHOLDER_FIELD_NAMES.has((course.about_the_course || "").trim())
              ? ""
              : course.about_the_course) ||
            (PLACEHOLDER_FIELD_NAMES.has(
              (course.about_the_course_html || "").trim(),
            )
              ? ""
              : course.about_the_course_html) ||
            "",
          comma_separeted_tags:
            course.tags || course.comma_separeted_tags || "",
          currency: finalCurrency,
          available_slots: available_slots,
        } as any;

        setCourseInit(courseResponse as CourseInitLike);
        setCourseData(courseData);

        // Check if lead collection should be shown based on JSON configuration
        const globalSettings = catalogueData?.globalSettings as any;
        const leadCollectionConfig = globalSettings?.leadCollection;

        // Check if form has already been submitted
        const leadCollectionSubmittedKey = `leadCollectionSubmitted_${instituteId}_${tagName}`;
        const hasSubmittedLeadCollection =
          localStorage.getItem(leadCollectionSubmittedKey) === "true";

        if (leadCollectionConfig?.enabled && !hasSubmittedLeadCollection) {
          setTimeout(() => {
            setShowLeadCollection(true);
          }, 2000);
        }
      } catch (err) {
        console.error("Error fetching course details:", err);
        setError(t("courseDetails.loadFailedError", {
          course: getTerminology(ContentTerms.Course, SystemTerms.Course),
        }));
      } finally {
        setIsLoading(false);
      }
    };

    if (courseId && instituteId) {
      fetchCourseDetails();
    }
  }, [courseId, tagName, instituteId, productPageCode]);

  /* ── Language versions + site cart (both opt-in per site) ─────────────
   * globalSettings.courseLanguages: a course's levels are its language
   *   versions ("Hindi", "English"); the overview cards get a Language picker.
   * globalSettings.siteCart: the enrol CTA adds the version to the site cart.
   * With neither, nothing below requests or renders anything new and
   * `courseData` is exactly the course-init + URL data the page always used.
   */
  const siteLocale = useCatalogueLocale();
  const siteT = siteLocale.t;
  const courseLanguageSettings = catalogueData?.globalSettings?.courseLanguages;
  const courseLanguagesEnabled = !!courseLanguageSettings?.enabled;
  // A product page visit (a folder card's "View" link carries the page's
  // code) shows that page's mapping and price; it goes to the site cart only
  // when the store sells the version at that same price, else it keeps the
  // page's own checkout (and so does a promo link: see siteCartMode).
  const siteCartActive = isSiteCartEnabled(catalogueData?.globalSettings?.siteCart);
  // Single-file product page, chosen per site (globalSettings.courseDetails.layout)
  // or per institute (Student Display Settings -> courseDetails.layout). It also
  // needs the course's own offer: a bare /<tag>/<courseId> link has no invite in
  // the URL, and course-init carries no price.
  const ebookLayout =
    (catalogueData?.globalSettings as { courseDetails?: { layout?: string } } | undefined)
      ?.courseDetails?.layout === "ebook" || learnerCourseDetails?.layout === "ebook";
  // The page as it was before CourseDetailsView (folded highlights, overview
  // card): kept for a site that asks for it (courseDetails.layout "classic").
  const classicLayout =
    (catalogueData?.globalSettings as { courseDetails?: { layout?: string } } | undefined)
      ?.courseDetails?.layout === "classic" || learnerCourseDetails?.layout === "classic";
  const standardLayout = !ebookLayout && !classicLayout;
  const configuredLanguages = useMemo(
    () => courseLanguagesOf(courseLanguageSettings),
    [courseLanguageSettings],
  );
  const versionLanguages = useMemo(
    () => (courseLanguagesEnabled ? configuredLanguages : []),
    [courseLanguagesEnabled, configuredLanguages],
  );
  const courseVersions = useCourseVersions({
    enabled: courseLanguagesEnabled || siteCartActive || ebookLayout,
    instituteId,
    courseId,
    productPageCode,
    courseInit,
    urlPackageSessionId: packageSessionId,
    urlEnrollInviteId: enrollInviteId,
    languages: versionLanguages,
    preferredLanguage: courseLanguagesEnabled
      ? preferredCourseLanguage(siteLocale.locale, versionLanguages)
      : null,
  });
  const selectedVersion = courseVersions.selected;
  const selectedVersionInvite = courseVersions.invite;
  const selectedVersionInviteId = courseVersions.selectedInviteId;
  const versionCount = courseVersions.versions.length;

  // Everything below reads `courseData`; with a version selected it carries
  // that version's invite, price, availability, level, duration and authors.
  const courseData = useMemo<CourseData | null>(() => {
    if (!loadedCourseData || !selectedVersion) return loadedCourseData;
    // Until its invite loads, the version the page opened on keeps the price
    // the page already fetched for that same invite (no flicker through the
    // search row's price); any other version shows its search row meanwhile.
    const keepLoadedOffer =
      !selectedVersionInvite &&
      selectedVersion.source === "catalogue" &&
      selectedVersion.packageSessionId === loadedCourseData.packageSessionId &&
      (selectedVersionInviteId ?? undefined) === loadedCourseData.enrollInviteId;
    const offer = keepLoadedOffer
      ? null
      : resolveVersionOffer(selectedVersion, selectedVersionInvite);
    // The version's own read time and authors, even when it has none: the
    // course-level values describe course-init's first level, often the other
    // language. Kept only for a lone version whose details are unknown.
    const own = versionOwnDetails(selectedVersion, versionCount);
    const versionAuthors = (own.instructors ?? []) as RawCourseInstructor[];
    return {
      ...loadedCourseData,
      packageSessionId: selectedVersion.packageSessionId,
      enrollInviteId: selectedVersionInviteId ?? undefined,
      level: selectedVersion.levelName || loadedCourseData.level,
      levelId: selectedVersion.levelId ?? loadedCourseData.levelId,
      sessionId: selectedVersion.sessionId ?? undefined,
      sessionName: selectedVersion.sessionName ?? undefined,
      ...(offer
        ? {
            price: offer.price,
            elevatedPrice: offer.elevatedPrice,
            currency: offer.currency ?? loadedCourseData.currency,
            enrollInviteAvailability: offer.availability,
            unavailableMessageHtml: extractUnavailableMessageHtml(offer.settingJson),
          }
        : {}),
      available_slots: selectedVersion.availableSlots ?? loadedCourseData.available_slots,
      duration:
        own.durationMinutes === undefined
          ? loadedCourseData.duration
          : own.durationMinutes
            ? getBackendCourseDuration(own.durationMinutes)
            : null,
      ...(own.instructors === undefined
        ? {}
        : {
            instructor: versionAuthors[0]?.full_name || null,
            instructors: mapCourseAuthors(
              versionAuthors,
              t("courseDetails.unknownTeacher", {
                teacher: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
              }),
            ),
          }),
    };
  }, [
    loadedCourseData,
    selectedVersion,
    selectedVersionInvite,
    selectedVersionInviteId,
    versionCount,
    t,
  ]);

  // A link with no price context (a bare /<tag>/<courseId>) has no real price
  // until the versions arrive — show a placeholder rather than "Free".
  const pricePending = courseVersions.status === "loading" && !enrollInviteId && !price;

  // Display copy of the live course text in the visitor's site language, for
  // the JSON details page (hero, HTML page tokens). The same object on a
  // single-language site. Never submitted anywhere.
  const displayCourseData = useMemo(
    () =>
      courseData && siteLocale.dict ? localizeCourseDisplay(courseData, siteT) : courseData,
    [courseData, siteLocale.dict, siteT],
  );

  const hydrateSiteCart = useSiteCartStore((s) => s.hydrate);
  const addToSiteCart = useSiteCartStore((s) => s.add);
  const siteCartReady = useSiteCartStore(
    (s) => s.hydrated && s.instituteId === instituteId,
  );
  // The version a cart line is for: the selected one, else (no versions) the
  // one the link named — never the course-id fallback, which is no version.
  const cartPackageSessionId = selectedVersion
    ? selectedVersion.packageSessionId
    : courseVersions.status === "loading"
      ? null
      : (packageSessionId ?? null);
  const inSiteCart = useSiteCartStore(
    (s) =>
      !!cartPackageSessionId &&
      s.items.some((i) => i.packageSessionId === cartPackageSessionId),
  );
  const otherVersionInCart = useSiteCartStore((s): SiteCartItem | null =>
    cartPackageSessionId
      ? (s.items.find(
          (i) => i.courseId === courseId && i.packageSessionId !== cartPackageSessionId,
        ) ?? null)
      : null,
  );
  useEffect(() => {
    if (siteCartActive && instituteId) void hydrateSiteCart(instituteId);
  }, [siteCartActive, instituteId, hydrateSiteCart]);
  // The cart checks out through the store page, so only a version the store
  // sells goes in (see siteCartMode). Reads nothing, and requests nothing, on
  // a site without a site cart.
  // The ebook layout's breadcrumb: the folders above this PDF, each a link
  // back to its folder (see folder-trail). Reads nothing on other layouts.
  const folderCrumbs = useFolderTrail({
    enabled: ebookLayout,
    instituteId,
    pages: catalogueData?.pages,
    productPageCode,
    tags: courseData?.tags,
  });
  // The default layout's header: breadcrumb, chips and "More in …", from the
  // site's Courses section (its stream library) and course formats. Reads
  // nothing on the ebook or classic layouts.
  const catalogSection = useMemo(
    () => (standardLayout ? findCatalogSection(catalogueData?.pages, catalogueData?.globalSettings) : null),
    [standardLayout, catalogueData?.pages, catalogueData?.globalSettings],
  );
  const catalogStreamsConfig = useMemo(
    () =>
      catalogSection
        ? resolveCatalogDiscovery(catalogSection.props, catalogueData?.globalSettings).streams
        : null,
    [catalogSection, catalogueData?.globalSettings],
  );
  const { streams: catalogStreams } = useCatalogStreams(instituteId ?? "", catalogStreamsConfig);
  const coursePlace = useMemo(
    () =>
      coursePageContext({
        tags: courseData?.tags,
        levelName: courseData?.level,
        globalSettings: catalogueData?.globalSettings,
        streams: catalogStreams,
        catalog: catalogSection,
        labelMode: catalogStreamsConfig?.labelMode,
        locale: siteLocale.locale,
      }),
    [
      courseData?.tags,
      courseData?.level,
      catalogueData?.globalSettings,
      catalogStreams,
      catalogSection,
      catalogStreamsConfig?.labelMode,
      siteLocale.locale,
    ],
  );
  // The Figma page's series (a Learning Path the course is a step of), the
  // site's formats (series step labels) and its app banner.
  const siteFormats = useMemo(
    () => resolveCourseFormats(catalogueData?.globalSettings ?? null),
    [catalogueData?.globalSettings],
  );
  const pathLibraryId = useMemo(
    () =>
      standardLayout
        ? findPathLibraryId(catalogueData?.pages) ||
          (catalogStreamsConfig?.source === "folderLibrary" ? catalogStreamsConfig.libraryId : null)
        : null,
    [standardLayout, catalogueData?.pages, catalogStreamsConfig],
  );
  // globalSettings.courseDetails (Manage Pages → Course page): series = false leaves the
  // "Part of <path>" chips off (seriesLimit = how many of them show), content = false the Course content (modules & slides) tab,
  // contentHeading = false only the "Course Content (Modules & Slides)" line above the structure.
  const courseDetailsSettings = (
    catalogueData?.globalSettings as
      | { courseDetails?: { series?: unknown; seriesLimit?: unknown; content?: unknown; contentHeading?: unknown } }
      | undefined
  )?.courseDetails;
  const seriesOn = courseDetailsSettings?.series !== false;
  const contentOn = courseDetailsSettings?.content !== false;
  const contentHeadingOn = courseDetailsSettings?.contentHeading !== false;
  const courseSeries = useCourseSeries({
    enabled: standardLayout && seriesOn,
    instituteId,
    libraryId: pathLibraryId,
    streamSlug: coursePlace.stream?.slug,
    courseId,
    groupVersions: courseLanguagesEnabled,
    languages: configuredLanguages,
    preferredLanguage: courseLanguagesEnabled ? preferredCourseLanguage(siteLocale.locale, configuredLanguages) : null,
  });
  const appBanner = useMemo(
    () => (standardLayout ? findAppBanner(catalogueData?.pages, catalogueData?.globalSettings) : null),
    [standardLayout, catalogueData?.pages, catalogueData?.globalSettings],
  );
  const storeSale = useStoreSale(
    instituteId,
    catalogueData?.globalSettings?.siteCart,
    siteCartActive,
  );

  const handleVersionSelect = (nextPackageSessionId: string) => {
    // null: unknown version, or nothing to enrol it through. The updates name
    // the version and the invite it is enrolled through (the link's promo
    // invite when that sells it, else the version's own).
    const updates = courseVersions.select(nextPackageSessionId);
    if (!updates) return;
    pickedVersionRef.current = nextPackageSessionId;
    // Mirror the choice into the URL (replace: no history entry per click) so a
    // reload or a shared link opens the same version. Works for both mounts —
    // the $courseId route and the root-mounted segment read the same params —
    // and keeps every other param (?lang=, utm_*).
    const location = router.state.location;
    router.history.replace(
      `${location.pathname}${withSearchParams(location.searchStr, updates)}${
        location.hash ? `#${location.hash}` : ""
      }`,
    );
  };

  // Apply institute theme
  useEffect(() => {
    if (instituteThemeCode) {
      document.documentElement.setAttribute("data-theme", instituteThemeCode);
    }
  }, [instituteThemeCode]);

  // Apply the page-builder primary color (same as the catalogue page).
  // The details page previously had NO theme injection, so its buttons fell
  // back to the global ThemeProvider `--primary` — which can be a stale
  // `theme-custom-color` cached in localStorage (e.g. an old bright green).
  // Scope the catalogue's `theme.primaryColor` onto this page's wrapper so the
  // CTAs honor the institute color the admin set, exactly like the catalogue.
  const themeRootRef = useRef<HTMLDivElement>(null);
  const detailsPrimaryColor = (catalogueData?.globalSettings as any)?.theme
    ?.primaryColor as string | undefined;
  useEffect(() => {
    const el = themeRootRef.current;
    if (!el) return;
    if (detailsPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(detailsPrimaryColor)) {
      const r = parseInt(detailsPrimaryColor.slice(1, 3), 16) / 255;
      const g = parseInt(detailsPrimaryColor.slice(3, 5), 16) / 255;
      const b = parseInt(detailsPrimaryColor.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0,
        s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      const H = Math.round(h * 360),
        S = Math.round(s * 100),
        L = Math.round(l * 100);
      el.style.setProperty("--primary-500", `${H} ${S}% ${L}%`);
      el.style.setProperty("--primary", `${H} ${S}% ${L}%`);
      el.style.setProperty("--primary-400", `${H} ${S}% ${Math.min(L + 10, 90)}%`);
      el.style.setProperty(
        "--primary-200",
        `${H} ${Math.max(S - 15, 10)}% ${Math.min(L + 28, 95)}%`,
      );
      el.style.setProperty(
        "--primary-50",
        `${H} ${Math.max(S - 30, 5)}% ${Math.min(L + 43, 98)}%`,
      );
    } else {
      el.style.removeProperty("--primary-500");
      el.style.removeProperty("--primary");
      el.style.removeProperty("--primary-400");
      el.style.removeProperty("--primary-200");
      el.style.removeProperty("--primary-50");
    }
  }, [detailsPrimaryColor]);

  // The site cart drawer belongs to the header's cart button. A page without
  // one (header switched off or missing) opens a drawer of its own, as the
  // offer and learning-path sections do, so "Buy now" and "In cart" still
  // reach the cart. Sites without a site cart never render it.
  const hasHeaderCart = useHasSiteCartOpener();
  const [fallbackCartOpen, setFallbackCartOpen] = useState(false);
  // Bumped by "Buy now": the page's drawer goes on to checkout once.
  const [fallbackCheckoutRequest, setFallbackCheckoutRequest] = useState(0);
  // The theme wrapper as the drawer opens, so it wears the site's palette.
  const [fallbackCartAnchor, setFallbackCartAnchor] = useState<HTMLElement | null>(null);
  const openFallbackCart = useCallback((checkout: boolean) => {
    setFallbackCartAnchor(themeRootRef.current);
    setFallbackCartOpen(true);
    if (checkout) setFallbackCheckoutRequest((n) => n + 1);
  }, []);
  const reopenFallbackCart = useCallback(() => openFallbackCart(false), [openFallbackCart]);
  // Back from the store checkout reopens it — once the page, and any header
  // cart button that would take the request instead, is on screen.
  useFallbackCartReopen(
    siteCartActive && !isLoading && namingReady && !error && !!courseData,
    reopenFallbackCart,
  );

  // data-vacademy="enrol" inside an html `details` page (HtmlPageSection)
  // dispatches this; the handler itself is defined after the loading/error
  // returns below, so reach it through a ref that is refreshed every render.
  const enrollClickRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onOpenEnrollment = () => enrollClickRef.current();
    window.addEventListener(OPEN_COURSE_ENROLLMENT_EVENT, onOpenEnrollment);
    return () => window.removeEventListener(OPEN_COURSE_ENROLLMENT_EVENT, onOpenEnrollment);
  }, []);

  // Listen for openLeadCollection event from HeaderComponent
  useEffect(() => {
    const handleOpenLeadCollection = () => {
      setShowLeadCollection(true);
    };

    window.addEventListener("openLeadCollection", handleOpenLeadCollection);

    return () => {
      window.removeEventListener(
        "openLeadCollection",
        handleOpenLeadCollection,
      );
    };
  }, []);

  const handleLeadCollectionClose = () => {
    setShowLeadCollection(false);
  };

  const handleLeadCollectionSubmit = () => {
    setShowLeadCollection(false);
  };

  if (isLoading || !namingReady) {
    return <DashboardLoader />;
  }

  if (error || !courseData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-catalogue-text-primary mb-2">
            {error || t("courseDetails.courseNotFoundDefault", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </h2>
          <p className="text-catalogue-text-secondary mb-4">
            {t("courseDetails.courseLoadFailedDescription", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </p>
          <button
            onClick={() => navigate({ to: RouteMatcher.pagePath(tagName) })}
            className="px-4 py-2 bg-primary-500 text-white rounded-catalogue-sm hover:bg-primary-400 transition-colors"
          >
            {t("courseDetails.backToCatalog")}
          </button>
        </div>
      </div>
    );
  }

  // Enroll-invite availability (server-computed). When not AVAILABLE, every enroll CTA opens the
  // admin's "unavailable" message instead of the payment/lead flow.
  const inviteAvailability = resolveInviteAvailability(courseData.enrollInviteAvailability);
  const isEnrollmentClosed = inviteAvailability !== "AVAILABLE";
  const unavailableMessageHtml = courseData.unavailableMessageHtml ?? "";

  const comingSoon = courseData.comingSoon ?? null;
  const comingSoonCta = comingSoon
    ? comingSoon.buttonText
      ? siteT(comingSoon.buttonText)
      : t("comingSoon.notifyMe")
    : null;
  const comingSoonLaunch = formatLaunchDate(comingSoon?.launchDate, i18n.language);
  const comingSoonHint = comingSoonLaunch
    ? t("comingSoon.launchingOnHint", { date: comingSoonLaunch })
    : t("comingSoon.notifyHint");

  // Language picker: only when the site has language versions and this course
  // is offered in at least two languages. A Level picker follows when the
  // selected language has several versions ("Beginner Hindi" and "Advanced
  // Hindi"), so each of them can be seen and chosen. Either one names the
  // version on screen, so the static Level row steps aside for them.
  const showLanguagePicker = courseLanguagesEnabled && courseVersions.options.length >= 2;
  const showLevelPicker = courseLanguagesEnabled && courseVersions.levelOptions.length >= 2;
  const showLevelRow = !showLanguagePicker && !showLevelPicker;
  const selectedVersionId = selectedVersion?.packageSessionId ?? null;
  const languagePicker =
    showLanguagePicker || showLevelPicker ? (
      <>
        {showLanguagePicker && (
          <CourseLanguagePicker
            options={courseVersions.options}
            selectedPackageSessionId={selectedVersionId}
            onSelect={handleVersionSelect}
          />
        )}
        {showLevelPicker && (
          <CourseVersionPicker
            label={getTerminology(ContentTerms.Level, SystemTerms.Level)}
            icon={
              <GraduationCap
                size={13}
                className="text-catalogue-text-muted"
                weight="duotone"
                aria-hidden="true"
              />
            }
            options={courseVersions.levelOptions}
            selectedPackageSessionId={selectedVersionId}
            onSelect={handleVersionSelect}
          />
        )}
      </>
    ) : null;

  // While an opted-in page is still working out which version is on screen,
  // its enrol button waits: the dialog would open on the link's version and
  // reset what the visitor typed when the picked version lands. ("off" on
  // sites without language versions or a site cart: nothing changes there.)
  const enrolPending = courseVersions.status === "loading" && !comingSoon;
  const enrolButtonClass = (base: string) =>
    enrolPending ? `${base} cursor-wait opacity-70` : base;

  // A link whose invite prices the version on screen (a promo or bundle link,
  // not the version's own catalogue invite) keeps that invite's own enrol
  // flow, as a product page visit keeps its page's checkout: the store
  // checkout would charge the store's plan instead.
  const linkInviteVisit = keepsLinkInviteEnrolment({
    status: courseVersions.status,
    selected: selectedVersion,
    selectedInviteId: selectedVersionInviteId,
    urlEnrollInviteId: enrollInviteId,
  });
  // Site cart: "Add to cart" + "Buy now" replace the enrol button for a
  // version the store page sells as it is — the cart checks out there (the
  // rule offers and learning paths follow, see storeCartRoute). Any other
  // version keeps the enrol flow the site has without a site cart (the invite
  // dialog, "Enroll for free" for a free one), and so does every version
  // while the store page will not load. Until the version on screen and the
  // store are both known, neither is offered (storeCheckPending). A Coming
  // Soon course still collects interest and a closed invite still explains
  // itself, through the original button.
  const storeRoute: StoreCartRoute =
    !siteCartActive || comingSoon
      ? "page"
      : courseVersions.status === "loading"
        ? "pending"
        : linkInviteVisit || isEnrollmentClosed || !cartPackageSessionId
          ? "page"
          : productPageCode &&
              storeSale.status === "ready" &&
              !sameOffer(storeSale.offer?.(cartPackageSessionId) ?? null, courseData)
            ? "page"
            : storeCartRoute(storeSale, [cartPackageSessionId], enrolFlowSellsVersion);
  const siteCartMode = storeRoute === "cart";
  const storeCheckPending = storeRoute === "pending";
  const siteCartItem =
    siteCartMode && cartPackageSessionId
      ? buildCourseCartItem({
          courseId,
          // Base-language values: the cart translates at display time.
          title: courseData.title,
          packageSessionId: cartPackageSessionId,
          levelName: selectedVersion ? selectedVersion.levelName : (level ?? null),
          languages: configuredLanguages,
          price: courseData.price,
          elevatedPrice: courseData.elevatedPrice,
          currency: courseData.currency,
          // ?bannerImage, else preview / banner / thumbnail media id (catalogue order).
          image: courseData.thumbnail,
          enrollInviteId: courseData.enrollInviteId,
        })
      : null;
  // The versions have settled by now (they are pending until then), so the
  // line carries the settled version, invite and price.
  const showCartActions = siteCartMode && !!siteCartItem;
  const cartActionsReady = siteCartReady && showCartActions;
  const otherVersionLabel = otherVersionInCart
    ? (configuredLanguages.find((l) => l.code === otherVersionInCart.languageCode) ??
        languageOfLevel(otherVersionInCart.levelName, configuredLanguages))?.label ??
      otherVersionInCart.levelName ??
      ""
    : "";
  const cartNote =
    otherVersionInCart && !inSiteCart
      ? otherVersionLabel
        ? t("courseDetails.siteCart.replacesVersion", {
            defaultValue: "Your cart has the {{version}} version. Adding this one replaces it.",
            version: siteT(otherVersionLabel),
          })
        : t(
            "courseDetails.siteCart.replacesOther",
            "Adding this replaces the version already in your cart.",
          )
      : null;

  // The header's cart drawer when the page has one, else the page's own.
  const openSiteCart = (intent: SiteCartOpenDetail["intent"]) => {
    const detail: SiteCartOpenDetail = {
      intent,
      packageSessionId: siteCartItem?.packageSessionId,
      source: "course",
    };
    if (!openSiteCartDrawer(detail)) openFallbackCart(intent === "checkout");
  };
  // One store checkout takes at most SITE_CART_MAX_ITEMS courses, and the
  // store does not enforce it, so a new course is refused here when the cart
  // is full (swapping this course's version never grows the cart). Success is
  // read back from the store rather than assumed.
  const addSiteCartItem = (item: SiteCartItem): boolean => {
    if (!cartCanTake(useSiteCartStore.getState().items, item)) {
      toast.error(
        t("siteCart.full", {
          max: SITE_CART_MAX_ITEMS,
          courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase(),
          defaultValue: "Your cart is full — up to {{max}} {{courses}} per order.",
        }),
      );
      return false;
    }
    addToSiteCart(item); // no-op when it is already in the cart
    const added = useSiteCartStore.getState().has(item.packageSessionId);
    if (!added) {
      toast.error(t("courseDetails.siteCart.notAdded", "Could not add this to your cart."));
    }
    return added;
  };
  const handleAddToCart = () => {
    if (!siteCartItem || !siteCartReady) return;
    if (addSiteCartItem(siteCartItem)) {
      toast.success(t("courseDetails.siteCart.added", "Added to your cart"));
    }
  };
  // Checkout runs through the cart, which pre-checks every item against the
  // store product page before handing off, so nothing is silently dropped.
  const handleBuyNow = () => {
    if (!siteCartItem || !siteCartReady) return;
    openSiteCart(addSiteCartItem(siteCartItem) ? "checkout" : "view");
  };

  /**
   * Every enroll CTA on this page (desktop sidebar, inline card, mobile bar)
   * routes through here so the three never drift apart.
   *
   * Arrived from a Product Page offer section → hand back to that product
   * page's checkout with this course preselected, which is byte-for-byte the
   * destination its "Enrol now" card CTA uses. Otherwise keep the original
   * behaviour: payment dialog when payment is on, lead form when it is off.
   */
  const handleEnrollClick = () => {
    // Coming Soon → nothing to buy yet; collect interest instead. Checked
    // before the invite window because such a course often has no invite.
    if (comingSoon) {
      if (comingSoon.audienceId) setShowNotifyForm(true);
      return;
    }

    // The version on screen is not settled yet, or (site cart) whether the
    // store sells it is not known yet — the buttons wait; an HTML page's
    // data-vacademy="enrol" lands here too.
    if (enrolPending || storeCheckPending) return;

    // Invite expired / not-yet-started / deactivated → show the admin message.
    if (isEnrollmentClosed) {
      setShowUnavailableDialog(true);
      return;
    }

    // The version on screen (Language picker), else what the URL named.
    const psId =
      selectedVersion?.packageSessionId || courseData.packageSessionId || packageSessionId;
    // Site cart (also on a product page visit the store sells as shown):
    // an HTML page's data-vacademy="enrol" buys like "Buy now".
    if (siteCartMode && siteCartItem) {
      handleBuyNow();
      return;
    }

    if (productPageCode && psId) {
      // A site with languages opens the checkout inside the site (its header
      // and dictionary) in the visitor's language, as its other checkout
      // links do; a single-language site keeps the URL it always had.
      const siteLang =
        siteLocale.enabled && siteLocale.locale !== siteLocale.baseLocale
          ? siteLocale.locale
          : undefined;
      navigate({
        to: "/product-pages/$productPageCode",
        params: { productPageCode },
        search: {
          ...(instituteId ? { instituteId } : {}),
          courseIds: psId,
          defaultTab: "CART" as const,
          ...(siteLocale.enabled && tagName ? { tagName } : {}),
          ...(siteLang ? { lang: siteLang } : {}),
        },
      });
      return;
    }

    // Payment disabled on the catalogue → the lead form is the conversion step.
    const paymentEnabled =
      (catalogueData?.globalSettings as any)?.payment?.enabled === true;
    if (paymentEnabled) {
      setEnrollmentDialogOpen(true);
    } else {
      setShowLeadCollection(true);
    }
  };
  enrollClickRef.current = handleEnrollClick;

  // Honor the catalogue's light/dark mode, exactly like CourseCataloguePage.
  // Without this the details page kept light tokens under a dark catalogue:
  // the hero painted its configured dark background while the title still
  // resolved text-catalogue-text-primary to near-black (dark on dark), and the
  // content below stayed white.
  const isDarkMode = (catalogueData?.globalSettings as any)?.mode === "dark";

  // The syllabus tree. Rendered once, but at a different point in the column
  // depending on the view (see isOutlineView), so it is bound here rather than
  // written out twice — courseData is guaranteed non-null past the guard above.
  // Keyed by the version: its load chain has no cancellation, so a slower
  // load for the version the visitor just left must not land over the new
  // one's syllabus. The key never changes on a site without versions.
  // The default layout's facts strip, "includes" rows, language, authors and
  // page content (mode, FAQs). Labels in the visitor's language.
  const pageView = (() => {
    const content = parseCoursePageJson(courseData.coursePageJson);
    const isBook =
      coursePlace.formatKeys.length > 0 && coursePlace.formatKeys.every((k) => BOOK_FORMATS.has(k));
    const authors = visibleCourseAuthors(
      courseData.instructors || [],
      showInstructors,
      courseData.instructor,
    ).map((a) => ({
      ...a,
      name: siteT(a.name),
      subtitle: a.subtitle ? siteT(a.subtitle) : a.subtitle,
      description: a.description ? siteT(a.description) : a.description,
    }));
    const languageLabel = courseLanguageLabel({
      levelName: selectedVersion?.levelName ?? courseData.level,
      tags: courseData.tags,
      languages: configuredLanguages.length ? configuredLanguages : FALLBACK_LANGUAGES,
    });
    const format = coursePlace.formatLabels[0] ? siteT(coursePlace.formatLabels[0]) : "";
    const duration = showsDuration(courseData.duration, coursePlace.formatKeys) ? courseData.duration : null;
    const mode =
      content.mode === "LIVE"
        ? t("courseDetails.page.modeLive", "Live")
        : content.mode === "SELF_PACED"
          ? t("courseDetails.page.modeSelfPaced", "Self-paced")
          : "";
    const author = authors[0]?.name || "";
    // The admin's role for this author (e.g. "Acharya") replaces the generic label.
    const authorRoleLabel = authors[0]?.role;
    const category = coursePlace.category ? siteT(coursePlace.category.label) : "";
    const row = (label: string, value: string | null | undefined) => (value ? [{ label, value }] : []);
    const L = {
      mode: t("courseDetails.page.mode", "Mode"),
      language: t("courseDetails.page.language", "Language"),
      format: t("courseDetails.page.format", "Format"),
      duration: t("courseDetails.duration"),
      author: authorRoleLabel || t("courseDetails.page.author", "Author"),
      instructor: authorRoleLabel || t("courseDetails.page.instructor", "Instructor"),
      category: t("courseDetails.page.category", "Category"),
    };
    const facts = isBook
      ? [...row(L.author, author), ...row(L.language, languageLabel), ...row(L.format, format), ...row(L.category, category)]
      : [...row(L.mode, mode), ...row(L.language, languageLabel), ...row(L.format, format), ...row(L.duration, duration)];
    const includes = isBook
      ? [...row(L.format, format), ...row(L.language, languageLabel), ...row(L.author, author), ...row(L.category, category)]
      : [...row(L.format, format), ...row(L.duration, duration), ...row(L.language, languageLabel), ...row(L.instructor, author)];
    return { content, isBook, authors, languageLabel, facts, includes };
  })();

  const courseStructure = (
    <CourseStructureDetails
      key={courseData.packageSessionId}
      courseDepth={courseData.courseDepth}
      courseId={courseData.courseId || courseId}
      instituteId={instituteId}
      packageSessionId={courseData.packageSessionId}
      levelId={courseData.levelId}
      variant={structureVariant}
      showContentHeading={contentHeadingOn}
    />
  );

  // Empty unless the site has versions or languages, so other sites keep the
  // plain page-id key (no remounts).
  const detailsTokenKey =
    courseVersions.status !== "off" || siteLocale.enabled
      ? `:${courseData.packageSessionId}:${siteLocale.locale}:${courseData.price}`
      : "";

  return (
    <div
      ref={themeRootRef}
      data-catalogue-theme={
        (catalogueData?.globalSettings as any)?.theme?.preset || "default"
      }
      className={`min-h-screen bg-catalogue-bg w-full${isDarkMode ? " dark" : ""}`}
      // Opt-in theme.palette / theme.contentMaxWidth vars; undefined (no style attribute) when unset.
      style={buildSiteThemeVars(catalogueData?.globalSettings) as React.CSSProperties | undefined}
    >
      {/* Render header and footer - add them if not in JSON */}
      {!catalogueData && (
        <div className="container mx-auto p-8 text-center space-y-4">
          <h2 className="text-2xl font-semibold text-catalogue-text-primary">
            {t("courseDetails.loadingCatalogueTitle", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </h2>
          <p className="text-catalogue-text-secondary">
            {t("courseDetails.loadingCatalogueDescription", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </p>
        </div>
      )}

      {catalogueData && (
        <>
          {/* Header from JSON globalSettings — sticky like the catalogue page
              (it previously scrolled away on the details page). */}
          {(catalogueData.globalSettings as any).layout?.header &&
            (catalogueData.globalSettings as any).layout?.header?.enabled !==
              false && (
              <div
                className={
                  (catalogueData.globalSettings as any).stickyHeader !== false
                    ? "sticky top-0 z-50"
                    : ""
                }
              >
                <JsonRenderer
                  page={{
                    id: "header",
                    route: "header",
                    title: "Header",
                    components: [
                      (catalogueData.globalSettings as any).layout.header,
                    ],
                  }}
                  globalSettings={catalogueData.globalSettings}
                  instituteId={instituteId}
                  tagName={tagName}
                  catalogueData={catalogueData}
                />
              </div>
            )}

          {/* Render details page components from JSON.
              HeaderComponent renders a `fixed` <header> (h-16 md:h-20) and emits
              no spacer, so the wrapper above collapses to zero height and the
              hero title would slide under it. The catalogue page reserves the
              same offset on its <main> (`pt-16 md:pt-20`) — mirror it here. */}
          <div
            className={
              (catalogueData.globalSettings as any).layout?.header &&
              (catalogueData.globalSettings as any).layout?.header?.enabled !==
                false
                ? headerOffsetClass((catalogueData.globalSettings as any).layout?.header?.props)
                : ""
            }
          >
            {catalogueData.pages
              ?.filter(
                (page) =>
                  page.id === "details" || page.route === "course-details",
              )
              ?.map((page) => {
                // A bookDetails block adds the course to the book cart from
                // this data, so it gets the base-language values; everything
                // else shows the course in the visitor's site language.
                const submitsCourse = page.components?.some((c) => c?.type === "bookDetails");
                // An htmlPage fills {{course.*}} once per course id: remount it
                // when the version or the site language changes.
                const fillsTokens = page.components?.some((c) => c?.type === "htmlPage");
                return (
                  <JsonRenderer
                    key={fillsTokens ? `${page.id}${detailsTokenKey}` : page.id}
                    page={page}
                    globalSettings={catalogueData.globalSettings}
                    instituteId={instituteId}
                    tagName={tagName}
                    courseData={submitsCourse ? courseData : displayCourseData}
                  />
                );
              })}
          </div>
        </>
      )}

      {/* Single-file product layout: same purchase actions and dialogs. */}
      {ebookLayout &&
        (catalogueData?.globalSettings as any)?.courseCatalogeType?.enabled !==
          true && (
          <EbookDetailsView
            title={siteT(courseData.title)}
            coverFileId={courseData.previewImage || courseData.thumbnail || courseData.bannerImage}
            aboutHtml={courseData.aboutCourse}
            learnHtml={courseData.whyLearn ? siteT(courseData.whyLearn) : ""}
            audienceHtml={courseData.whoShouldLearn ? siteT(courseData.whoShouldLearn) : ""}
            tags={courseData.tags}
            crumbs={folderCrumbs}
            price={courseData.price}
            elevatedPrice={courseData.elevatedPrice}
            currency={courseData.currency}
            pricePending={pricePending}
            showPrice={catalogueData?.globalSettings?.payment?.enabled !== false}
            instituteId={instituteId}
            tagName={tagName}
            globalSettings={catalogueData?.globalSettings}
            actions={
              showCartActions ? (
                <CourseCartActions
                  inCart={inSiteCart}
                  ready={cartActionsReady}
                  onAdd={handleAddToCart}
                  onBuyNow={handleBuyNow}
                  onViewCart={() => openSiteCart("view")}
                  note={cartNote}
                />
              ) : storeCheckPending ? (
                <CourseCartPending />
              ) : (
                <button
                  onClick={handleEnrollClick}
                  disabled={enrolPending}
                  aria-busy={enrolPending || undefined}
                  className={enrolButtonClass(
                    "w-full rounded-catalogue-md bg-primary-500 px-4 py-3.5 text-base font-semibold text-white shadow-md transition-all duration-200 hover:opacity-90 active:scale-[0.98]",
                  )}
                >
                  {comingSoonCta ??
                    (catalogueData?.globalSettings?.payment?.enabled !== false
                      ? courseData.price === 0 && !pricePending
                        ? t("courseDetails.ebook.getFree", "Get it free")
                        : t("courseDetails.ebook.buyNow", "Buy now")
                      : t("courseDetails.getStarted"))}
                </button>
              )
            }
          />
        )}

      {/* Course Content */}
      {/* The default layout (CourseDetailsView, the Figma course page):
          hero, sticky tabs and enrol card, series, "You may also like",
          the site's app banner. Same actions, outline and dialogs. */}
      {standardLayout &&
        (catalogueData?.globalSettings as any)?.courseCatalogeType?.enabled !==
          true && (
          <CourseDetailsView
            title={siteT(courseData.title)}
            subtitle={courseData.description ? plainText(siteT(courseData.description)) : summaryOf(courseData.aboutCourse)}
            aboutHtml={siteT(courseData.aboutCourse || "")}
            whyLearnHtml={courseData.whyLearn ? siteT(courseData.whyLearn) : ""}
            whoShouldLearnHtml={courseData.whoShouldLearn ? siteT(courseData.whoShouldLearn) : ""}
            imageCandidates={[courseData.thumbnail, courseData.previewImage, courseData.bannerImage]}
            previewVideo={previewVideoOf(courseData.courseMediaRaw)}
            isBook={pageView.isBook}
            showHeader={
              !catalogueData?.pages?.some(
                (page) => page.id === "details" || page.route === "course-details",
              )
            }
            context={coursePlace}
            facts={pageView.facts}
            includes={pageView.includes}
            authors={pageView.authors}
            faqs={pageView.content.faqs}
            languageLabel={pageView.languageLabel}
            languagePicker={languagePicker}
            price={{
              show: catalogueData?.globalSettings?.payment?.enabled !== false,
              pending: pricePending,
              free: courseData.price === 0,
              text:
                courseData.price === 0
                  ? t("courseDetails.page.free", "Free")
                  : formatAmountLabel(courseData.price, courseData.currency, siteLocale.locale),
              mrpText:
                typeof courseData.elevatedPrice === "number" && courseData.elevatedPrice > courseData.price
                  ? formatAmountLabel(courseData.elevatedPrice, courseData.currency, siteLocale.locale)
                  : "",
              hint: comingSoon
                ? comingSoonHint || ""
                : courseData.price === 0
                  ? t("courseDetails.page.freeHint", "Start now, no payment needed")
                  : pageView.isBook
                    ? t("courseDetails.page.bookHint", {
                        price: formatAmountLabel(courseData.price, courseData.currency, siteLocale.locale),
                        defaultValue: "Just for {{price}}. Order now and enjoy reading.",
                      })
                    : t("courseDetails.page.paidHint", "Instant access after payment"),
            }}
            heroActions={
              showCartActions ? (
                <CourseCartActions
                  layout="row"
                  inCart={inSiteCart}
                  ready={cartActionsReady}
                  onAdd={handleAddToCart}
                  onBuyNow={handleBuyNow}
                  onViewCart={() => openSiteCart("view")}
                  note={cartNote}
                />
              ) : undefined
            }
            actions={
              showCartActions ? (
                <CourseCartActions
                  inCart={inSiteCart}
                  ready={cartActionsReady}
                  onAdd={handleAddToCart}
                  onBuyNow={handleBuyNow}
                  onViewCart={() => openSiteCart("view")}
                  note={cartNote}
                />
              ) : storeCheckPending ? (
                <CourseCartPending />
              ) : (
                <button
                  onClick={handleEnrollClick}
                  disabled={enrolPending}
                  aria-busy={enrolPending || undefined}
                  className={enrolButtonClass(FIGMA_CTA)}
                >
                  {comingSoonCta ??
                    (catalogueData?.globalSettings?.payment?.enabled === false
                      ? t("courseDetails.getStarted")
                      : courseData.price === 0 && !pricePending
                        ? pageView.isBook
                          ? t("courseDetails.ebook.getFree", "Get it free")
                          : t("courseDetails.page.getFree", "Get course for free")
                        : pageView.isBook
                          ? t("courseDetails.page.orderNow", "Order now")
                          : t("courseDetails.enrollNow"))}
                </button>
              )
            }
            series={courseSeries}
            seriesLimit={courseDetailsSettings?.seriesLimit}
            formatStepPrice={(step) =>
              step.price === null
                ? ""
                : step.price === 0
                  ? t("courseDetails.page.free", "Free")
                  : formatAmountLabel(step.price, step.currency, siteLocale.locale)
            }
            stepFormat={(step) => {
              const key = courseFormatKeys({ tags: step.tags, level_name: step.levelName }, siteFormats)[0];
              const label = key ? siteFormats?.byKey.get(key)?.label : "";
              return label ? siteT(label) : "";
            }}
            outline={courseStructure}
            showContent={contentOn}
            related={
              coursePlace.related ? (
                <CourseShowcaseComponent
                  header={
                    <RelatedHeader
                      allHref={catalogSection ? RouteMatcher.pagePath(tagName, catalogSection.route) : null}
                    />
                  }
                  sectionClassName={RELATED_SECTION_CLASS}
                  shellClassName={RELATED_SHELL_CLASS}
                  columns={4}
                  source="tag"
                  tag={coursePlace.related.tag}
                  limit={4}
                  layout="grid"
                  // Neither this course nor its other listings (the same book in another language).
                  excludeCourseIds={[courseData.courseId || courseId]}
                  excludeTitles={[courseData.title]}
                  instituteId={instituteId}
                  tagName={tagName}
                  globalSettings={catalogueData?.globalSettings}
                  {...relatedCardStyle(catalogSection?.props, catalogStreamsConfig)}
                />
              ) : null
            }
            closingBanner={
              appBanner && catalogueData ? (
                <JsonRenderer
                  page={{
                    id: "course-app-banner",
                    route: "course-app-banner",
                    title: "",
                    components: [appBanner as unknown as (typeof catalogueData.pages)[number]["components"][number]],
                  }}
                  globalSettings={catalogueData.globalSettings}
                  instituteId={instituteId}
                  tagName={tagName}
                  catalogueData={catalogueData}
                />
              ) : null
            }
            tagName={tagName}
          />
        )}

      {/* The classic layout (courseDetails.layout "classic"). */}
      {!ebookLayout &&
        classicLayout &&
        (catalogueData?.globalSettings as any)?.courseCatalogeType?.enabled !==
        true && (
        <div className="pt-4 pb-24 sm:pt-6 bg-catalogue-bg-subtle w-full">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-section lg:gap-8">
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-4">
                {/* Tags+title are rendered by the JSON catalogue hero
                    (HeroSectionComponent) above; we don't repeat them here.
                    If no hero is configured, no header shows. */}

                {/* Course highlights accordion — collapsed by default,
                    wraps the what-you'll-learn / about / who-should-learn /
                    instructors sections that used to stack as separate cards
                    below the structure. Outline view drops it: the syllabus
                    is the pitch there, and the marketing copy pushes it below
                    the fold. */}
                {!isOutlineView && (
                  <CourseHighlightsAccordion
                    whyLearn={courseData.whyLearn}
                    aboutCourse={courseData.aboutCourse}
                    whoShouldLearn={courseData.whoShouldLearn}
                    instructors={courseData.instructors || []}
                    showInstructors={showInstructors}
                    primaryInstructor={courseData.instructor}
                  />
                )}

                {/* Outline view leads with the syllabus, above the mobile
                    price card; every other view keeps it below (see the same
                    block further down). */}
                {isOutlineView && courseStructure}

                {/* Course Overview Card - Mobile First */}
                <div className="lg:hidden">
                  <div className="bg-catalogue-bg-elevated border border-catalogue-border rounded-catalogue-lg shadow-sm p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-2 pb-3 border-b border-catalogue-border-subtle">
                      <div className="p-1.5 bg-primary-50 rounded-catalogue-md">
                        <House size={16} className="text-primary-500" weight="duotone" />
                      </div>
                      <h2 className="text-sm font-semibold text-catalogue-text-primary">
                        {t("courseDetails.courseOverview", {
                          course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                        })}
                      </h2>
                    </div>

                    {/* Course Stats */}
                    <div className="space-y-2">
                      {/* Language versions (sites with courseLanguages on) */}
                      {languagePicker}

                      {/* Price - Only show if payment is enabled */}
                      {catalogueData?.globalSettings?.payment?.enabled !==
                        false && (
                        <div className="flex items-center justify-between py-2 px-3 bg-primary-50 rounded-catalogue-md border border-primary-100">
                          <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                            <Tag size={13} className="text-primary-400" />
                            {t("courseDetails.price")}
                          </span>
                          {pricePending ? (
                            <span
                              role="status"
                              className="block h-6 w-20 animate-pulse rounded-catalogue-sm bg-catalogue-bg-muted"
                            >
                              <span className="sr-only">
                                {t("courseDetails.priceLoading", "Loading price")}
                              </span>
                            </span>
                          ) : (
                            <PriceWithMrp
                              actual={courseData.price}
                              elevated={courseData.elevatedPrice}
                              currency={courseData.currency}
                              size="md"
                              className="text-primary-500 font-semibold"
                            />
                          )}
                        </div>
                      )}

                      {/* Rating: a real average only */}
                      {courseData.rating > 0 && (
                      <div className="flex items-center justify-between py-2 px-3 bg-catalogue-bg-subtle rounded-catalogue-md">
                        <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                          <Star size={13} className="text-yellow-400" weight="fill" />
                          {t("courseDetails.rating")}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                size={12}
                                weight="fill"
                                className={cn(
                                  star <= Math.floor(courseData.rating)
                                    ? "text-yellow-400"
                                    : "text-gray-200"
                                )}
                              />
                            ))}
                          </div>
                          <span className="text-xs font-semibold text-catalogue-text-primary">
                            {courseData.rating.toFixed(1)}
                          </span>
                        </div>
                      </div>
                      )}

                      {/* Level (hidden when the level is a sentinel like "Default",
                          and when a Language / Level picker already names it) */}
                      {showLevelRow && displayLevelName(courseData.level) && (
                        <div className="flex items-center justify-between py-2 px-3 bg-catalogue-bg-subtle rounded-catalogue-md">
                          <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                            <GraduationCap size={13} className="text-catalogue-text-muted" weight="duotone" />
                            {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                          </span>
                          <span className="text-xs font-semibold text-catalogue-text-primary bg-catalogue-bg-elevated border border-catalogue-border px-2 py-0.5 rounded-catalogue-sm">
                            {siteT(displayLevelName(courseData.level))}
                          </span>
                        </div>
                      )}

                      {/* Duration */}
                      {courseData.duration && (
                        <div className="flex items-center justify-between py-2 px-3 bg-catalogue-bg-subtle rounded-catalogue-md">
                          <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                            <Clock size={13} className="text-catalogue-text-muted" weight="duotone" />
                            {t("courseDetails.duration")}
                          </span>
                          <span className="text-xs font-semibold text-catalogue-text-primary bg-catalogue-bg-elevated border border-catalogue-border px-2 py-0.5 rounded-catalogue-sm">
                            {courseData.duration}
                          </span>
                        </div>
                      )}

                    </div>

                    {/* Enroll Button */}
                    <div className="pt-1 space-y-2">
                      {showCartActions ? (
                        <CourseCartActions
                          inCart={inSiteCart}
                          ready={cartActionsReady}
                          onAdd={handleAddToCart}
                          onBuyNow={handleBuyNow}
                          onViewCart={() => openSiteCart("view")}
                          note={cartNote}
                        />
                      ) : storeCheckPending ? (
                        <CourseCartPending />
                      ) : (
                        <>
                          <button
                            onClick={handleEnrollClick}
                            disabled={enrolPending}
                            aria-busy={enrolPending || undefined}
                            className={enrolButtonClass(
                              "w-full text-white py-3 px-4 rounded-catalogue-md text-sm font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md",
                            )}
                            style={{
                              backgroundColor: `hsl(var(--primary-500, var(--primary)))`,
                            }}
                          >
                            {comingSoonCta ??
                              (catalogueData?.globalSettings?.payment?.enabled !==
                              false
                                ? courseData.price === 0 && !pricePending
                                  ? t("courseDetails.enrollForFree")
                                  : t("courseDetails.enrollNow")
                                : t("courseDetails.getStarted"))}
                          </button>
                          <p className="text-xs text-catalogue-text-muted text-center">
                            {comingSoon
                              ? comingSoonHint
                              : t("courseDetails.clickToRegister", {
                                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                                })}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Course Structure */}
                {!isOutlineView && contentOn && courseStructure}

                {/* Content sections (what-you'll-learn / about /
                    who-should-learn / instructors / tags) moved into the
                    CourseHeroHeader + CourseHighlightsAccordion above the
                    course structure. */}
              </div>

              {/* Sidebar */}
              <div className="lg:col-span-1">
                <div className="sticky top-4 space-y-4">
                  {/* Course Overview Card - Hidden on mobile, shown on desktop */}
                  <div className="hidden lg:block bg-catalogue-bg-elevated border border-catalogue-border rounded-catalogue-lg shadow-sm p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-2 pb-3 border-b border-catalogue-border-subtle">
                      <div className="p-1.5 bg-primary-50 rounded-catalogue-md">
                        <House size={16} className="text-primary-500" weight="duotone" />
                      </div>
                      <h2 className="text-sm font-semibold text-catalogue-text-primary">
                        {t("courseDetails.courseOverview", {
                          course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                        })}
                      </h2>
                    </div>

                    {/* Course Stats */}
                    <div className="space-y-2">
                      {/* Language versions (sites with courseLanguages on) */}
                      {languagePicker}

                      {/* Price - Only show if payment is enabled */}
                      {catalogueData?.globalSettings?.payment?.enabled !==
                        false && (
                        <div className="flex items-center justify-between py-2 px-3 bg-primary-50 rounded-catalogue-md border border-primary-100">
                          <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                            <Tag size={13} className="text-primary-400" />
                            {t("courseDetails.price")}
                          </span>
                          {pricePending ? (
                            <span
                              role="status"
                              className="block h-6 w-20 animate-pulse rounded-catalogue-sm bg-catalogue-bg-muted"
                            >
                              <span className="sr-only">
                                {t("courseDetails.priceLoading", "Loading price")}
                              </span>
                            </span>
                          ) : (
                            <PriceWithMrp
                              actual={courseData.price}
                              elevated={courseData.elevatedPrice}
                              currency={courseData.currency}
                              size="md"
                              className="text-primary-500 font-semibold"
                            />
                          )}
                        </div>
                      )}

                      {/* Rating: a real average only */}
                      {courseData.rating > 0 && (
                      <div className="flex items-center justify-between py-2 px-3 bg-catalogue-bg-subtle rounded-catalogue-md">
                        <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                          <Star size={13} className="text-yellow-400" weight="fill" />
                          {t("courseDetails.rating")}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                size={12}
                                weight="fill"
                                className={cn(
                                  star <= Math.floor(courseData.rating)
                                    ? "text-yellow-400"
                                    : "text-gray-200"
                                )}
                              />
                            ))}
                          </div>
                          <span className="text-xs font-semibold text-catalogue-text-primary">
                            {courseData.rating.toFixed(1)}
                          </span>
                        </div>
                      </div>
                      )}

                      {/* Level (hidden when the level is a sentinel like "Default",
                          and when a Language / Level picker already names it) */}
                      {showLevelRow && displayLevelName(courseData.level) && (
                        <div className="flex items-center justify-between py-2 px-3 bg-catalogue-bg-subtle rounded-catalogue-md">
                          <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                            <GraduationCap size={13} className="text-catalogue-text-muted" weight="duotone" />
                            {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                          </span>
                          <span className="text-xs font-semibold text-catalogue-text-primary bg-catalogue-bg-elevated border border-catalogue-border px-2 py-0.5 rounded-catalogue-sm">
                            {siteT(displayLevelName(courseData.level))}
                          </span>
                        </div>
                      )}

                      {/* Duration */}
                      {courseData.duration && (
                        <div className="flex items-center justify-between py-2 px-3 bg-catalogue-bg-subtle rounded-catalogue-md">
                          <span className="text-xs font-medium text-catalogue-text-secondary flex items-center gap-1.5">
                            <Clock size={13} className="text-catalogue-text-muted" weight="duotone" />
                            {t("courseDetails.duration")}
                          </span>
                          <span className="text-xs font-semibold text-catalogue-text-primary bg-catalogue-bg-elevated border border-catalogue-border px-2 py-0.5 rounded-catalogue-sm">
                            {courseData.duration}
                          </span>
                        </div>
                      )}

                    </div>

                    {/* Enroll Button */}
                    <div className="pt-1 space-y-2">
                      {showCartActions ? (
                        <CourseCartActions
                          inCart={inSiteCart}
                          ready={cartActionsReady}
                          onAdd={handleAddToCart}
                          onBuyNow={handleBuyNow}
                          onViewCart={() => openSiteCart("view")}
                          note={cartNote}
                        />
                      ) : storeCheckPending ? (
                        <CourseCartPending />
                      ) : (
                        <>
                          <button
                            onClick={handleEnrollClick}
                            disabled={enrolPending}
                            aria-busy={enrolPending || undefined}
                            className={enrolButtonClass(
                              "w-full text-white py-3 px-4 rounded-catalogue-md text-sm font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-md",
                            )}
                            style={{
                              backgroundColor: `hsl(var(--primary-500, var(--primary)))`,
                            }}
                          >
                            {comingSoonCta ?? t("courseDetails.enrollNow")}
                          </button>
                          <p className="text-xs text-catalogue-text-muted text-center">
                            {comingSoon
                              ? comingSoonHint
                              : t("courseDetails.clickToRegister", {
                                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                                })}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer from JSON globalSettings */}
      {catalogueData &&
        (catalogueData.globalSettings as any).layout?.footer &&
        (catalogueData.globalSettings as any).layout?.footer?.enabled !==
          false && (
          <JsonRenderer
            page={{
              id: "footer",
              route: "footer",
              title: "Footer",
              components: [(catalogueData.globalSettings as any).layout.footer],
            }}
            globalSettings={catalogueData.globalSettings}
            instituteId={instituteId}
            tagName={tagName}
          />
        )}

      {/* The page's own cart drawer, only on a page without a header cart
          button (kept mounted while open so it can animate closed). */}
      {siteCartActive &&
        catalogueData?.globalSettings?.siteCart &&
        (!hasHeaderCart || fallbackCartOpen) && (
          <SiteCartDrawer
            open={fallbackCartOpen}
            onOpenChange={setFallbackCartOpen}
            instituteId={instituteId}
            tagName={tagName}
            settings={catalogueData.globalSettings.siteCart}
            languages={courseLanguagesEnabled ? configuredLanguages : undefined}
            themeAnchor={fallbackCartAnchor}
            checkoutRequest={fallbackCheckoutRequest}
          />
        )}

      {/* Coming Soon → "Notify me" lead form (the course's own audience list) */}
      {comingSoon?.audienceId && (
        <AudienceFormModal
          isOpen={showNotifyForm}
          onClose={() => setShowNotifyForm(false)}
          audienceId={comingSoon.audienceId}
          title={t("comingSoon.notifyTitle", { title: siteT(courseData.title) })}
          instituteId={instituteId}
        />
      )}

      {audienceForm && (
        <AudienceFormModal
          isOpen={!!audienceForm}
          onClose={() => setAudienceForm(null)}
          audienceId={audienceForm.audienceId}
          title={audienceForm.title}
          instituteId={instituteId}
        />
      )}

      {/* Enrollment unavailable (expired / not-yet-started / deactivated invite) */}
      <Dialog open={showUnavailableDialog} onOpenChange={setShowUnavailableDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">{t("courseDetails.enrollmentUnavailableTitle")}</DialogTitle>
          </DialogHeader>
          <InviteUnavailableMessage
            availability={inviteAvailability}
            messageHtml={unavailableMessageHtml}
            className="py-2"
          />
        </DialogContent>
      </Dialog>

      {/* Lead Collection Modal */}
      {showLeadCollection && catalogueData?.globalSettings?.leadCollection && (
        <LeadCollectionModal
          isOpen={showLeadCollection}
          onClose={handleLeadCollectionClose}
          onSubmit={handleLeadCollectionSubmit}
          settings={{
            enabled:
              catalogueData?.globalSettings?.leadCollection?.enabled || false,
            mandatory:
              catalogueData?.globalSettings?.leadCollection?.mandatory || false,
            inviteLink:
              catalogueData?.globalSettings?.leadCollection?.inviteLink || null,
            formStyle: catalogueData?.globalSettings?.leadCollection
              ?.formStyle || {
              type: "single",
              showProgress: false,
              progressType: "bar",
              transition: "slide",
            },
            fields: catalogueData?.globalSettings?.leadCollection?.fields || [
              {
                name: "name",
                label: t("courseDetails.leadFormDefaults.fullName"),
                type: "text",
                required: true,
                step: 1,
              },
              {
                name: "email",
                label: t("courseDetails.leadFormDefaults.email"),
                type: "email",
                required: true,
                step: 2,
              },
              {
                name: "phone",
                label: t("courseDetails.leadFormDefaults.phone"),
                type: "tel",
                required: true,
                step: 3,
              },
            ],
          }}
          instituteId={instituteId}
          mandatory={
            catalogueData?.globalSettings?.leadCollection?.mandatory || false
          }
          packageSessionId={courseData.packageSessionId}
        />
      )}

      {/* Enrollment Payment Dialog */}
      {courseData && (
        <EnrollmentPaymentDialog
          open={enrollmentDialogOpen}
          onOpenChange={(open) => {
            if (open) {
            }
            setEnrollmentDialogOpen(open);
          }}
          instituteId={instituteId}
          courseData={{
            id: courseData.id,
            title: courseData.title,
            price: courseData.price,
            packageSessionId: courseData.packageSessionId,
            enrollInviteId: courseData.enrollInviteId || "",
          }}
          onSuccess={async (tokens) => {
            try {
              // Store tokens using the same method as other parts of the app
              const { setTokenInStorage } =
                await import("@/lib/auth/sessionUtility");
              const { TokenKey } = await import("@/constants/auth/tokens");
              const { Preferences } = await import("@capacitor/preferences");
              const { getTokenDecodedData } =
                await import("@/lib/auth/sessionUtility");
              const { fetchAndStoreInstituteDetails } =
                await import("@/services/fetchAndStoreInstituteDetails");
              const { fetchAndStoreStudentDetails } =
                await import("@/services/studentDetails");
              const { getStudentDisplaySettings } =
                await import("@/services/student-display-settings");
              const { identifyUser } = await import("@/lib/analytics");

              await setTokenInStorage(TokenKey.accessToken, tokens.accessToken);
              await setTokenInStorage(
                TokenKey.refreshToken,
                tokens.refreshToken,
              );
              await Preferences.set({ key: "instituteId", value: instituteId });
              await Preferences.set({ key: "InstituteId", value: instituteId });

              // Decode token to get user data (same as SessionLoginForm.tsx)
              const tokenData = getTokenDecodedData(tokens.accessToken);
              const userId = tokenData?.user;

              if (instituteId && userId) {
                // Identify user for analytics (same as SessionLoginForm.tsx)
                identifyUser(userId, {
                  username: tokenData?.username,
                  email: tokenData?.email,
                });

                try {
                  // Fetch and store institute details (same as SessionLoginForm.tsx)
                  await fetchAndStoreInstituteDetails(instituteId, userId);
                  getStudentDisplaySettings(true);
                } catch (error) {
                  console.error("Error fetching institute details:", error);
                }

                try {
                  // Fetch and store student details. Pass a fallbackUser so a
                  // just-enrolled learner — whose student record may not be
                  // queryable yet right after enrollment — still gets
                  // StudentDetails persisted. Without it the student API throws,
                  // StudentDetails is never stored, isAuthenticated() returns
                  // false, and the learner is bounced to /login instead of being
                  // auto-logged-in.
                  await fetchAndStoreStudentDetails(instituteId, userId, {
                    id: userId,
                    username: tokenData?.username || "",
                    email: tokenData?.email || "",
                    full_name: tokenData?.username || "",
                    roles: ["STUDENT"],
                  });
                } catch (error) {
                  console.error("Error fetching student details:", error);
                }
              }

              console.log(
                "[CourseDetailsPage] All APIs called successfully, redirecting to /study-library/courses",
              );
              window.location.href = "/study-library/courses";
            } catch (error) {
              console.error(
                "[CourseDetailsPage] Error in onSuccess flow:",
                error,
              );
              // Fallback to localStorage if Capacitor Storage fails
              localStorage.setItem("accessToken", tokens.accessToken);
              localStorage.setItem("refreshToken", tokens.refreshToken);
              window.location.href = "/study-library/courses";
            }
          }}
        />
      )}

      {/* Mobile Action Buttons - Fixed at bottom for course details page.
          The ebook layout puts Buy now in the first screen instead. */}
      {!ebookLayout &&
        (catalogueData?.globalSettings as any)?.courseCatalogeType?.enabled !==
        true && (
        <div className="md:hidden fixed bottom-0 start-0 end-0 z-50 bg-catalogue-bg-elevated border-t border-catalogue-border p-4">
          <div className={`flex flex-col gap-3 ${isAndroid || isIOS ? "mb-8" : ""}`}>
            {/* Login Button (the classic layout; the default one leaves it to the header) */}
            {classicLayout && (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => navigate({ to: "/login" })}
                className="w-full px-4 py-3 text-sm font-semibold hover:opacity-90 active:scale-[0.98] rounded-catalogue-md border transition-all duration-200"
                style={{
                  color: `hsl(var(--primary-500, var(--primary)))`,
                  borderColor: `hsl(var(--primary-500, var(--primary)))`,
                }}
              >
                {t("header.login")}
              </button>
            </div>
            )}

            {/* Get Started / Enroll Button */}
            {showCartActions ? (
              <CourseCartActions
                layout="row"
                inCart={inSiteCart}
                ready={cartActionsReady}
                onAdd={handleAddToCart}
                onBuyNow={handleBuyNow}
                onViewCart={() => openSiteCart("view")}
              />
            ) : storeCheckPending ? (
              <CourseCartPending />
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleEnrollClick}
                  disabled={enrolPending}
                  aria-busy={enrolPending || undefined}
                  className={enrolButtonClass(
                    "w-full px-4 py-3 text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] rounded-catalogue-md shadow-md transition-all duration-200",
                  )}
                  style={{
                    backgroundColor: `hsl(var(--primary-500, var(--primary)))`,
                  }}
                >
                  {comingSoonCta ??
                    (catalogueData?.globalSettings?.payment?.enabled !== false
                      ? courseData.price === 0 && !pricePending
                        ? t("courseDetails.enrollForFree")
                        : t("courseDetails.enrollNow")
                      : t("courseDetails.getStarted"))}
                </button>
                <span className="text-xs text-catalogue-text-secondary text-center">{t("courseDetails.forNewUsers")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Site Assistant (globalSettings.siteAssistant): knows this course
          (page.course_id) and clears the mobile enrol bar above. */}
      {catalogueData && (
        <HostedSiteAssistant
          globalSettings={catalogueData.globalSettings}
          tagName={tagName}
          pageKind="course"
          courseId={courseId}
          hasMobileBar={
            !ebookLayout &&
            (catalogueData.globalSettings as { courseCatalogeType?: { enabled?: boolean } } | undefined)
              ?.courseCatalogeType?.enabled !== true
          }
        />
      )}
    </div>
  );
};

/**
 * The public course page (/<tag>/<courseId>, and /<courseId> on a
 * root-mounted host). This shell loads the site's catalogue JSON — header,
 * footer, details page and settings — and provides the visitor's site
 * language (globalSettings.i18n, remembered per site under the tag name), so
 * the sections and the live course text below render in हिन्दी or EN. On a
 * single-language site the provider is the base language with no dictionary
 * and the page renders exactly as before.
 */
export const CourseDetailsPage: React.FC<CourseDetailsPageProps> = (props) => {
  const { instituteId, tagName } = props;
  const [catalogueData, setCatalogueData] =
    useState<CourseCatalogueData | null>(null);

  // Fetch catalogue data for header and footer
  useEffect(() => {
    const fetchCatalogueData = async () => {
      try {
        const data = await CourseCatalogueService.getCourseCatalogueByTag(
          instituteId,
          tagName,
        );
        setCatalogueData(data);
      } catch (error) {
        console.error(
          "[CourseDetailsPage] Failed to fetch catalogue data:",
          error,
        );
        console.error("[CourseDetailsPage] Error details:", {
          message: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          response: (error as any)?.response?.data,
        });
        // Set empty catalogue data as fallback
        setCatalogueData({
          globalSettings: {
            courseCatalogeType: {
              enabled: false,
              value: "",
            },
            mode: "light",
            compactness: "medium",
            audience: "all",
            leadCollection: {
              enabled: false,
              mandatory: false,
              inviteLink: null,
              formStyle: {
                type: "single",
                showProgress: false,
                progressType: "bar",
                transition: "slide",
              },
              fields: [],
            },
            enrquiry: {
              enabled: true,
              requirePayment: false,
            },
            payment: {
              enabled: true,
              provider: "razorpay",
              fields: [],
            },
          },
          pages: [],
        });
      }
    };

    if (instituteId && tagName) {
      fetchCatalogueData();
    }
  }, [instituteId, tagName]);

  return (
    <CatalogueLocaleProvider
      settings={catalogueData?.globalSettings?.i18n}
      scope={tagName}
    >
      <ImageFitProvider fit={siteImageFit(catalogueData?.globalSettings)}>
      <CourseDetailsPageContent
        {...props}
        // Both mounts hand over search params the router parsed as JSON
        // ("?level=10" arrives as a number); the page works on text.
        enrollInviteId={searchText(props.enrollInviteId)}
        packageSessionId={searchText(props.packageSessionId)}
        bannerImage={searchText(props.bannerImage)}
        level={searchText(props.level)}
        price={searchText(props.price)}
        productPageCode={searchText(props.productPageCode)}
        catalogueData={catalogueData}
      />
      </ImageFitProvider>
    </CatalogueLocaleProvider>
  );
};

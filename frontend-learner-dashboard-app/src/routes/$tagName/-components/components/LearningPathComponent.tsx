import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Path,
  ShoppingCartSimple,
  SpinnerGap,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { PriceWithMrp, formatPriceAmount } from "@/components/common/price-with-mrp";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import {
  courseLanguagesOf,
  languageOfLevel,
  preferredCourseLanguage,
  type CourseLanguageOption,
} from "../../-utils/course-variants";
import { isSiteCartEnabled } from "../../-utils/site-cart";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import { localizeComponentProps } from "../../-utils/catalogue-site-language";
import { URL_PARAMS, useCatalogueSearchParams } from "../../-utils/catalogue-url-state";
import { useCourseTerms } from "../../-utils/catalogue-naming";
import { fetchPublicFolderTree, nodeTitle, type PublicFolderNode } from "../../-services/folder-library-service";
import { CourseThumbnail } from "../site-cart/CourseThumbnail";
import { SiteCartDrawer } from "../site-cart/SiteCartDrawer";
import { openSiteCartDrawer } from "../site-cart/site-cart-events";
import { isMeaningfulLevel } from "../site-cart/site-cart-items";
import { pageSells, storeCartRoute } from "../site-cart/store-sale";
import { useFallbackCartReopen, useSiteCart, useSiteCartNotifier } from "../site-cart/use-site-cart";
import { useStoreSale } from "../site-cart/use-store-sale";
import {
  buildPathSteps,
  pathCardDetails,
  pathCartItems,
  pathCheckoutTotals,
  pathCourseIds,
  pathSelection,
  pathTotals,
  pathsInScope,
  planPathCart,
  resolvePathScope,
  type PathEntry,
  type PathMapping,
  type PathStep,
} from "./learning-path-utils";
import {
  LearningPathFeatured,
  LearningPathFeaturedSkeleton,
  withSharedPathOptions,
  type LearningPathFeaturedOptions,
} from "./LearningPathFeatured";

/**
 * Learning path — a product page shown as numbered steps (single), or the
 * paths of a stream as cards (list). See learning-path-utils for the model.
 *
 * single: the product page's courses in display order, a course's language
 *   versions folded into one step with a language choice, the path's total,
 *   and "Add whole path to cart" (site cart, when its store page sells every
 *   chosen course) or "Enrol in this path" (the product page's own checkout
 *   with every course selected).
 * list: the product pages under the stream folder named by ?stream=, a chosen
 *   folder, or the whole library; "View path" sets ?path=<code> (pushed, so
 *   Back returns to the list) and the section shows that path.
 *
 * Like the other live-data sections, a visitor never sees a broken or empty
 * band: unconfigured / failed / empty states render nothing for visitors
 * (unless the admin wrote an empty text) and a hint in the builder preview.
 */
export interface LearningPathProps extends LearningPathFeaturedOptions {
  mode?: "single" | "list";
  productPageCode?: string;
  /** The chosen product page's name, kept for the builder (fallback heading). */
  productPageName?: string;
  libraryId?: string;
  folderId?: string;
  /** List mode: read the stream folder from ?stream=. */
  streamFromUrl?: boolean;
  /** List mode: the query parameter holding the open path (default "path"). */
  pathParam?: string;
  title?: string;
  subtitle?: string;
  showStepNumbers?: boolean;
  showTotal?: boolean;
  addAllLabel?: string;
  enrolLabel?: string;
  viewPathLabel?: string;
  emptyText?: string;
  backgroundColor?: string;
  // Supplied by the renderer.
  instituteId?: string;
  tagName?: string;
  globalSettings?: Partial<GlobalSettings>;
  isPreviewMode?: boolean;
  /** The page's sections, passed by the renderer only when `sharedWith` is set. */
  pageSections?: unknown;
}

interface Shell {
  backgroundColor?: string;
  sectionRef: (node: HTMLElement | null) => void;
  /** Element inside the theme wrapper, for a cart drawer opened from here. */
  themeAnchor: HTMLElement | null;
  scrollToTop: () => void;
}

const Section: React.FC<{ shell: Shell; children: React.ReactNode }> = ({ shell, children }) => {
  // Admin-authored band colour — a free-form value, so it cannot be a token.
  const sectionStyle = shell.backgroundColor ? { backgroundColor: shell.backgroundColor } : undefined;
  return (
    <section ref={shell.sectionRef} className="catalogue-section bg-catalogue-bg" style={sectionStyle}>
      <div className="catalogue-shell">{children}</div>
    </section>
  );
};

const NoteCard: React.FC<{ children: React.ReactNode; alert?: boolean }> = ({ children, alert }) => (
  <div
    role={alert ? "alert" : undefined}
    className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted"
  >
    {children}
  </div>
);

const BackLink: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-catalogue-brand-ink hover:underline"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" weight="bold" aria-hidden="true" />
      {t("learningPath.allPaths", "All learning paths")}
    </button>
  );
};

const StepsSkeleton: React.FC = () => (
  <div aria-busy="true" className="space-y-4">
    <div className="catalogue-skeleton-shimmer h-8 w-1/2 rounded-catalogue-xs" />
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex gap-4">
        <div className="catalogue-skeleton-shimmer size-9 shrink-0 rounded-full" />
        <div className="catalogue-card flex flex-1 gap-4 p-4">
          <div className="catalogue-skeleton-shimmer hidden h-20 w-36 shrink-0 rounded-catalogue-md sm:block" />
          <div className="flex-1 space-y-2">
            <div className="catalogue-skeleton-shimmer h-5 w-3/4 rounded-catalogue-xs" />
            <div className="catalogue-skeleton-shimmer h-4 w-1/3 rounded-catalogue-xs" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ─── one path ───────────────────────────────────────────────────────────────

interface PathDetailProps {
  shell: Shell;
  code: string;
  instituteId: string;
  tagName?: string;
  globalSettings?: Partial<GlobalSettings>;
  /** Heading in the visitor's language (authored, or a translated folder title). */
  heading?: string;
  description?: string;
  productPageName?: string;
  showStepNumbers: boolean;
  showTotal: boolean;
  addAllLabel?: string;
  enrolLabel?: string;
  emptyText?: string;
  isPreviewMode: boolean;
  /** List mode: back to the list (the path was opened by the visitor). */
  onBack?: () => void;
}

const PathDetail: React.FC<PathDetailProps> = ({
  shell,
  code,
  instituteId,
  tagName,
  globalSettings,
  heading,
  description,
  productPageName,
  showStepNumbers,
  showTotal,
  addAllLabel,
  enrolLabel,
  emptyText,
  isPreviewMode,
  onBack,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const terms = useCourseTerms();
  const siteT = useSiteT();
  const { enabled: languagesEnabled, locale, baseLocale } = useCatalogueLocale();
  const hidePrices = shouldHidePaidPurchaseUI();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    ...handleGetProductPage(code, instituteId),
  });

  const languages: CourseLanguageOption[] = useMemo(
    () => courseLanguagesOf(globalSettings?.courseLanguages),
    [globalSettings?.courseLanguages],
  );
  const groupVersions = !!globalSettings?.courseLanguages?.enabled;
  const preferred = preferredCourseLanguage(locale, languages);

  const steps = useMemo(
    () =>
      buildPathSteps((data?.mappings || []) as PathMapping[], {
        groupVersions,
        languages,
        preferredLanguage: preferred,
      }),
    [data?.mappings, groupVersions, languages, preferred],
  );

  // The visitor's language pick per step (step key → language code). Keyed by
  // step, not course: two steps can be levels of the same course.
  const [choices, setChoices] = useState<Record<string, string>>({});
  const chosen = useMemo(() => pathSelection(steps, choices, languages), [steps, choices, languages]);
  const items = useMemo(
    () => pathCartItems(chosen, { languages, productPageCode: code, pathTitle: data?.name || undefined }),
    [chosen, languages, code, data?.name],
  );

  const siteCartSettings = globalSettings?.siteCart;
  const siteCartOn = isSiteCartEnabled(siteCartSettings);
  const cart = useSiteCart(instituteId, siteCartOn);
  const notify = useSiteCartNotifier();
  // The site cart checks out through its store page: the path goes into it
  // only when the store sells every course the visitor chose. Otherwise
  // "Enrol in this path" keeps the path's own checkout, as on a site without
  // a site cart — unless that would charge a course twice (see
  // storeCartRoute); while the store page loads, neither is offered.
  const storeSale = useStoreSale(instituteId, siteCartSettings, siteCartOn);
  const ownPageSells = useMemo(() => pageSells(data?.mappings), [data?.mappings]);
  const route = siteCartOn
    ? storeCartRoute(storeSale, items.map((i) => i.packageSessionId), ownPageSells)
    : "page";
  const toCart = route === "cart";
  // The cart holds one version per course, so the path is measured (and
  // added) one version per course — one add always settles the button.
  const plan = useMemo(() => planPathCart(items, cart.has), [items, cart.has]);
  const allInCart = toCart && cart.hydrated && plan.allInCart;
  const someInCart = toCart && cart.hydrated && plan.someInCart;

  // The total for what the button does: the cart's courses when the path
  // goes to the site cart; otherwise the product page's own price for the
  // path (basket pricing and offers included), as its checkout will charge it.
  const totals = useMemo(
    () => (toCart ? pathTotals(plan.targets) : pathCheckoutTotals(pathTotals(items), chosen, data?.settings_json)),
    [toCart, plan.targets, items, chosen, data?.settings_json],
  );

  const [adding, setAdding] = useState(false);
  // Used only when the page has no header cart button to open instead.
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const openCart = useCallback(() => {
    if (!openSiteCartDrawer()) setFallbackOpen(true);
  }, []);
  const openFallback = useCallback(() => setFallbackOpen(true), []);
  useFallbackCartReopen(siteCartOn, openFallback);

  const addWholePath = async () => {
    if (!plan.missing.length) {
      openCart();
      return;
    }
    setAdding(true);
    try {
      const previous = cart.items;
      const result = await cart.add(plan.missing);
      // The drawer is the confirmation; toasts only when a full cart turned items away.
      notify(result, { previous, quiet: true, onViewCart: openCart });
      if (result?.accepted.length) openCart();
    } finally {
      setAdding(false);
    }
  };

  const lang = languagesEnabled && locale !== baseLocale ? locale : undefined;
  // productPageName is the picked page's cached name: data the renderer leaves
  // as stored, so it goes through the site dictionary here like the live name.
  const title = heading || siteT(data?.name) || siteT(productPageName) || "";
  const countLabel = t("learningPath.courseCount", {
    count: steps.length,
    course: (steps.length === 1 ? terms.course : terms.courses).toLocaleLowerCase(),
    defaultValue: "{{count}} {{course}}",
  });
  // Which total applies is known once the store page has loaded.
  const totalPending = route === "pending";
  const totalText =
    totalPending || totals.total === null
      ? null
      : totals.total === 0
        ? t("productPageOffer.free", "Free")
        : formatPriceAmount(totals.total, totals.currency);

  if (isLoading) {
    return (
      <Section shell={shell}>
        {onBack && <BackLink onBack={onBack} />}
        <StepsSkeleton />
      </Section>
    );
  }

  if (isError) {
    // A path the visitor opened from the list must explain itself; a section
    // configured on the page stays out of sight, as other sections do.
    if (!onBack && !isPreviewMode) return null;
    return (
      <Section shell={shell}>
        {onBack && <BackLink onBack={onBack} />}
        <NoteCard alert>
          <p>{t("learningPath.loadError", "This learning path could not load.")}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm mt-4"
          >
            <ArrowCounterClockwise className="size-4" aria-hidden="true" />
            {t("learningPath.retry", "Try again")}
          </button>
        </NoteCard>
      </Section>
    );
  }

  if (steps.length === 0) {
    if (!emptyText && !onBack && !isPreviewMode) return null;
    return (
      <Section shell={shell}>
        {onBack && <BackLink onBack={onBack} />}
        <NoteCard>
          {emptyText ||
            t("learningPath.emptyCourses", {
              courses: terms.courses.toLocaleLowerCase(),
              defaultValue: "This learning path has no {{courses}} yet.",
            })}
        </NoteCard>
      </Section>
    );
  }

  const stepRow = (step: PathStep<PathMapping>, index: number) => {
    const variant = chosen[index] ?? step.primary;
    const courseTitle = siteT(variant.package_name) || terms.course;
    const variantLanguage = languageOfLevel(variant.level_name, languages);
    const activeCode = choices[step.key] ?? variantLanguage?.code ?? null;
    const meta = [
      !variantLanguage && isMeaningfulLevel(variant.level_name) ? siteT(variant.level_name) : null,
      isMeaningfulLevel(variant.session_name) ? siteT(variant.session_name) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const inCart = siteCartOn && cart.has(variant.package_session_id);
    const detailsLink =
      tagName && variant.package_id
        ? {
            to: "/$tagName/$courseId" as const,
            params: { tagName, courseId: variant.package_id },
            // Every key the details route validates. productPageCode makes the
            // course page's enrol button come back to this path's checkout.
            search: {
              enrollInviteId: variant.enroll_invite_id || undefined,
              packageSessionId: variant.package_session_id,
              productPageCode: code,
              bannerImage: undefined,
              level: variant.level_name || undefined,
              price: variant.payment_plan?.actual_price?.toString(),
              available_slots: undefined,
            },
          }
        : null;
    const last = index === steps.length - 1;

    return (
      <li key={step.key} className="flex gap-3 sm:gap-4">
        <div className="flex flex-col items-center" aria-hidden="true">
          {showStepNumbers ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white sm:size-9">
              {index + 1}
            </span>
          ) : (
            <span className="mt-3 size-3 shrink-0 rounded-full bg-primary-500" />
          )}
          {!last && <span className="my-1 w-px flex-1 bg-catalogue-border" />}
        </div>
        <div
          className={cn(
            "catalogue-card mb-4 flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center",
            // The same ring as a chosen catalogue card (catalogue-card-selected
            // only styles the elevated card).
            inCart && "border-primary-500 ring-2 ring-primary-500/35",
          )}
        >
          <CourseThumbnail image={variant.course_preview_image_media_id} className="aspect-[16/9] w-full sm:w-36" />
          <div className="min-w-0 flex-1">
            {showStepNumbers && (
              <span className="sr-only">
                {t("learningPath.stepLabel", { number: index + 1, defaultValue: "Step {{number}}" })}
              </span>
            )}
            <h3 className="line-clamp-2 text-base font-semibold leading-snug text-catalogue-text-primary">
              {courseTitle}
            </h3>
            {meta && <p className="mt-0.5 text-xs text-catalogue-text-muted">{meta}</p>}
            {step.languages.length > 1 ? (
              <div
                role="group"
                aria-label={t("learningPath.languageFor", {
                  title: courseTitle,
                  defaultValue: "Language for {{title}}",
                })}
                className="mt-2 flex flex-wrap gap-1.5"
              >
                {step.languages.map((language) => {
                  const selected = language.code === activeCode;
                  return (
                    <button
                      key={language.code}
                      type="button"
                      aria-pressed={selected}
                      title={siteT(language.label)}
                      onClick={() => setChoices((c) => ({ ...c, [step.key]: language.code }))}
                      className={cn(
                        "inline-flex min-w-9 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-colors",
                        selected
                          ? "bg-primary-500 text-white ring-primary-500"
                          : "bg-catalogue-bg text-catalogue-text-secondary ring-catalogue-border hover:ring-primary-300",
                      )}
                    >
                      {language.chip || language.label}
                    </button>
                  );
                })}
              </div>
            ) : step.languages.length === 1 ? (
              <span
                title={siteT(step.languages[0]!.label)}
                className="mt-2 inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-catalogue-brand-ink ring-1 ring-primary-100"
              >
                {step.languages[0]!.chip || step.languages[0]!.label}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:flex-col sm:items-end">
            {!hidePrices && (
              <PriceWithMrp
                actual={variant.payment_plan?.actual_price}
                elevated={variant.payment_plan?.elevated_price}
                currency={variant.payment_plan?.currency}
                size="sm"
                layout="inline"
                hideBadge
              />
            )}
            {inCart && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-600">
                <CheckCircle className="size-3.5" weight="fill" aria-hidden="true" />
                {t("siteCart.inCart", "In cart")}
              </span>
            )}
            {detailsLink && (
              <Link {...detailsLink} className="text-xs font-semibold text-catalogue-brand-ink no-underline hover:underline">
                {t("learningPath.viewCourse", { course: terms.course, defaultValue: "View {{course}}" })}
              </Link>
            )}
          </div>
        </div>
      </li>
    );
  };

  const cta = route === "pending" ? (
    <button
      type="button"
      disabled
      aria-busy="true"
      className="catalogue-btn catalogue-btn-primary disabled:opacity-60"
    >
      <SpinnerGap className="size-4 animate-spin" aria-hidden="true" />
      {t("siteCart.checking", "Checking availability…")}
    </button>
  ) : toCart ? (
    allInCart ? (
      <>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success-600">
          <CheckCircle className="size-4" weight="fill" aria-hidden="true" />
          {t("learningPath.inCart", "Whole path is in your cart")}
        </span>
        <button type="button" onClick={openCart} className="catalogue-btn catalogue-btn-secondary">
          {t("siteCart.viewCart", "View cart")}
        </button>
      </>
    ) : (
      <button
        type="button"
        onClick={() => void addWholePath()}
        disabled={adding}
        aria-busy={adding || undefined}
        className="catalogue-btn catalogue-btn-primary disabled:opacity-60"
      >
        {adding ? (
          <SpinnerGap className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ShoppingCartSimple className="size-4" weight="bold" aria-hidden="true" />
        )}
        {someInCart
          ? t("learningPath.addRemaining", {
              count: plan.missing.length,
              defaultValue: "Add the remaining {{count}} to cart",
            })
          : addAllLabel || t("learningPath.addAll", "Add whole path to cart")}
      </button>
    )
  ) : (
    <Link
      to="/product-pages/$productPageCode"
      params={{ productPageCode: code }}
      search={{
        ...(instituteId ? { instituteId } : {}),
        ...(tagName ? { tagName } : {}),
        courseIds: pathCourseIds(chosen),
        defaultTab: "CART" as const,
        ...(lang ? { lang } : {}),
      }}
      className="catalogue-btn catalogue-btn-primary no-underline"
    >
      {enrolLabel || t("learningPath.enrol", "Enrol in this path")}
      <ArrowRight className="size-4 rtl:rotate-180" weight="bold" aria-hidden="true" />
    </Link>
  );

  return (
    <Section shell={shell}>
      {onBack && <BackLink onBack={onBack} />}
      <header className="catalogue-section-header text-start">
        {title && <h2 className="catalogue-h2 text-catalogue-text-primary">{title}</h2>}
        {description && (
          <p className="catalogue-lead catalogue-measure-start text-catalogue-text-muted">{description}</p>
        )}
        <p className="mt-2 text-sm text-catalogue-text-muted">
          {countLabel}
          {showTotal && !hidePrices && totalText ? ` · ${totalText}` : ""}
        </p>
      </header>

      <ol aria-label={t("learningPath.stepsAria", { title: title || countLabel, defaultValue: "Steps in {{title}}" })}>
        {steps.map(stepRow)}
      </ol>

      <div className="catalogue-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {showTotal && !hidePrices && (
            <>
              <p className="text-3xs font-medium uppercase tracking-wide text-catalogue-text-muted">
                {t("learningPath.pathTotal", "Path total")}
              </p>
              {totalPending ? (
                <span aria-hidden="true" className="catalogue-skeleton-shimmer mt-1 block h-6 w-24 rounded-catalogue-xs" />
              ) : totalText === null ? (
                <p className="text-sm text-catalogue-text-muted">
                  {t("learningPath.totalAtCheckout", "Total shown at checkout")}
                </p>
              ) : (
                <p className="flex items-baseline gap-2">
                  {totals.elevatedTotal !== null && totals.total !== null && totals.elevatedTotal > totals.total && (
                    <span className="text-sm text-catalogue-text-muted line-through">
                      {formatPriceAmount(totals.elevatedTotal, totals.currency)}
                    </span>
                  )}
                  <span className="text-xl font-bold text-catalogue-text-primary">{totalText}</span>
                </p>
              )}
            </>
          )}
          <p className="text-xs text-catalogue-text-muted">{countLabel}</p>
          {toCart && plan.collapsed && (
            // Two steps of one course (its levels, or ungrouped language
            // versions): say why fewer go into the cart than the path lists.
            <p className="mt-1 max-w-md text-xs text-catalogue-text-muted">
              {t("learningPath.oneVersionPerCourse", {
                count: plan.targets.length,
                course: terms.course.toLocaleLowerCase(),
                defaultValue: "Your cart holds one version of each {{course}}, so {{count}} of these go into it.",
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">{cta}</div>
      </div>

      {siteCartOn && siteCartSettings && (
        <SiteCartDrawer
          open={fallbackOpen}
          onOpenChange={setFallbackOpen}
          instituteId={instituteId}
          tagName={tagName}
          settings={siteCartSettings}
          languages={languages}
          themeAnchor={shell.themeAnchor}
        />
      )}
    </Section>
  );
};

// ─── list of paths ──────────────────────────────────────────────────────────

const LearningPathList: React.FC<LearningPathProps & { shell: Shell; instituteId: string }> = ({
  shell,
  libraryId,
  folderId,
  streamFromUrl = false,
  pathParam,
  title,
  subtitle,
  showStepNumbers = true,
  showTotal = true,
  addAllLabel,
  enrolLabel,
  viewPathLabel,
  emptyText,
  instituteId,
  tagName,
  globalSettings,
  isPreviewMode = false,
  ...featuredOptions
}) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const { get, update } = useCatalogueSearchParams();
  const paramKey = (pathParam || "").trim() || URL_PARAMS.path;
  const stream = streamFromUrl ? get(URL_PARAMS.stream) : null;
  const openCode = get(paramKey);

  const { data, isLoading, isError } = useQuery({
    // Same key as the folder browser, so a page with both fetches the tree once.
    queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, libraryId],
    queryFn: () => fetchPublicFolderTree(instituteId, libraryId!),
    enabled: !!libraryId,
    staleTime: 60_000,
    retry: (count, err: unknown) =>
      // A deleted / unknown library is a 404 — retrying will not change that.
      (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  });

  const roots = useMemo(() => data?.roots || [], [data]);
  const scope = useMemo(() => resolvePathScope(roots, { stream, folderId }), [roots, stream, folderId]);
  const entries = useMemo(() => pathsInScope(roots, scope), [roots, scope]);
  // Only a path this list offers opens — a crafted ?path= cannot surface a
  // product page the admin did not put here.
  const openEntry = openCode ? entries.find((e) => e.code === openCode) ?? null : null;

  const openPath = (code: string) => {
    update({ [paramKey]: code }, { push: true });
    shell.scrollToTop();
  };
  const closePath = () => {
    update({ [paramKey]: null }, { push: true });
    shell.scrollToTop();
  };

  // Featured layout (opt-in): the parts may be split over two sections, and
  // only the one showing the featured part hosts an opened path. It brings
  // itself into view when a path opens from the other section.
  const featuredLayout = featuredOptions.listLayout === "featured";
  const hostsOpenPath = !featuredLayout || featuredOptions.showFeatured !== false;
  const { scrollToTop } = shell;
  useEffect(() => {
    if (featuredLayout && hostsOpenPath && openCode) scrollToTop();
  }, [featuredLayout, hostsOpenPath, openCode, scrollToTop]);

  const hint = (message: string) =>
    isPreviewMode ? (
      <Section shell={shell}>
        <NoteCard>{message}</NoteCard>
      </Section>
    ) : null;

  if (!libraryId) {
    return hint(t("learningPath.preview.pickLibrary", "Pick a folder library to list learning paths from."));
  }
  if (isLoading) {
    if (featuredLayout) {
      if (openCode && !hostsOpenPath) return null;
      return (
        <LearningPathFeaturedSkeleton
          showGoals={featuredOptions.showGoals}
          showFeatured={featuredOptions.showFeatured}
          showGrid={featuredOptions.showGrid}
          backgroundColor={shell.backgroundColor}
          sectionRef={shell.sectionRef}
        />
      );
    }
    return (
      <Section shell={shell}>
        <div aria-busy="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="catalogue-card-elevated overflow-hidden">
              <div className="catalogue-skeleton-shimmer aspect-[16/9] w-full" />
              <div className="space-y-2 p-4">
                <div className="catalogue-skeleton-shimmer h-5 w-3/4 rounded-catalogue-xs" />
                <div className="catalogue-skeleton-shimmer h-4 w-full rounded-catalogue-xs" />
              </div>
            </div>
          ))}
        </div>
      </Section>
    );
  }
  if (isError) {
    return hint(t("learningPath.listLoadError", "The learning paths could not load. Please refresh the page."));
  }

  if (openCode) {
    if (!hostsOpenPath) return null;
    if (!openEntry) {
      return (
        <Section shell={shell}>
          <BackLink onBack={closePath} />
          <NoteCard>{t("learningPath.notFound", "This learning path is no longer available.")}</NoteCard>
        </Section>
      );
    }
    return (
      <PathDetail
        key={openEntry.code}
        shell={shell}
        code={openEntry.code}
        instituteId={instituteId}
        tagName={tagName}
        globalSettings={globalSettings}
        heading={siteT(nodeTitle(openEntry.node)) || undefined}
        description={siteT(openEntry.node.description) || undefined}
        showStepNumbers={showStepNumbers}
        showTotal={showTotal}
        addAllLabel={addAllLabel}
        enrolLabel={enrolLabel}
        isPreviewMode={isPreviewMode}
        onBack={closePath}
      />
    );
  }

  const streamNote =
    isPreviewMode && streamFromUrl && !stream ? (
      <p className="mb-4 text-xs text-catalogue-text-muted">
        {t("learningPath.preview.streamHint", "On a stream tab (?stream=…) visitors see that stream's paths here.")}
      </p>
    ) : null;

  if (entries.length === 0) {
    // Featured layout split over two sections: only the one hosting the
    // featured part says it, so the note shows once.
    if (emptyText && hostsOpenPath) {
      return (
        <Section shell={shell}>
          <NoteCard>{emptyText}</NoteCard>
        </Section>
      );
    }
    return isPreviewMode ? (
      <Section shell={shell}>
        {streamNote}
        <NoteCard>
          {t(
            "learningPath.preview.emptyLibrary",
            "No product pages here yet — add some under this folder in Manage Pages → Folders.",
          )}
        </NoteCard>
      </Section>
    ) : null;
  }

  const scopeFolderId = scope.kind === "folder" ? scope.folder.id : null;
  const eyebrowOf = (entry: PathEntry): string => {
    const parent: PublicFolderNode | null = entry.parent;
    if (!parent || parent.id === scopeFolderId) return "";
    return siteT(nodeTitle(parent));
  };
  const viewLabel = viewPathLabel || t("learningPath.viewPath", "View path");

  if (featuredLayout) {
    return (
      <LearningPathFeatured
        {...featuredOptions}
        entries={entries}
        roots={roots}
        instituteId={instituteId}
        tagName={tagName}
        globalSettings={globalSettings}
        title={title}
        viewPathLabel={viewPathLabel}
        backgroundColor={shell.backgroundColor}
        sectionRef={shell.sectionRef}
        onOpenPath={openPath}
      />
    );
  }

  return (
    <Section shell={shell}>
      {(title || subtitle) && (
        <header className="catalogue-section-header text-start">
          {title && <h2 className="catalogue-h2 text-catalogue-text-primary">{title}</h2>}
          {subtitle && <p className="catalogue-lead catalogue-measure-start text-catalogue-text-muted">{subtitle}</p>}
        </header>
      )}
      {streamNote}
      <ul
        aria-label={title || t("learningPath.listAria", "Learning paths")}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3"
      >
        {entries.map((entry) => {
          const name = siteT(nodeTitle(entry.node)) || entry.code;
          const description = siteT(entry.node.description);
          const eyebrow = eyebrowOf(entry);
          // The item's own card fields, each only when the admin set it.
          const details = pathCardDetails(entry.node);
          const cardSubtitle = details.subtitle ? siteT(details.subtitle) : "";
          const tagline = details.tagline ? siteT(details.tagline) : "";
          const buttonLabel = (details.ctaLabel && siteT(details.ctaLabel)) || viewLabel;
          const accent = details.accentColor;
          return (
            <li key={entry.code} className="catalogue-card-elevated group flex flex-col overflow-hidden">
              {accent && (
                <span
                  aria-hidden="true"
                  className="block h-1 w-full shrink-0"
                  style={{ backgroundColor: accent }} // design-lint-ignore: path accent colour is admin data (validated hex)
                />
              )}
              <div
                className={cn("relative aspect-[16/9] w-full", !accent && "bg-catalogue-bg-muted")}
                style={accent ? { backgroundColor: accent } : undefined} // design-lint-ignore: path accent colour is admin data (validated hex)
              >
                {entry.node.image_url ? (
                  <FitImage src={entry.node.image_url} alt="" loading="lazy" className="absolute inset-0 size-full" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-catalogue-brand-ink">
                    <Path className="size-10 opacity-60" weight="duotone" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                {eyebrow && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-catalogue-brand-ink">{eyebrow}</p>
                )}
                <h3 className="line-clamp-2 text-base font-semibold leading-snug text-catalogue-text-primary">{name}</h3>
                {cardSubtitle && cardSubtitle !== name && (
                  <p className="text-sm font-medium text-catalogue-text-secondary">{cardSubtitle}</p>
                )}
                {tagline && <p className="line-clamp-2 text-sm font-semibold text-catalogue-text-primary">{tagline}</p>}
                {description && <p className="line-clamp-2 text-sm text-catalogue-text-muted">{description}</p>}
                <div className="mt-auto pt-3">
                  <button
                    type="button"
                    onClick={() => openPath(entry.code)}
                    aria-label={`${buttonLabel} — ${name}`}
                    className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
                  >
                    {buttonLabel}
                    <ArrowRight className="size-3.5 rtl:rotate-180" weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
};

// ─── the section ────────────────────────────────────────────────────────────

export const LearningPathComponent: React.FC<LearningPathProps> = ({ pageSections, ...ownProps }) => {
  const { dict } = useCatalogueLocale();
  const props = withSharedPathOptions(ownProps, pageSections, (p) => localizeComponentProps(p, dict));
  const {
    mode = "single",
    productPageCode,
    productPageName,
    title,
    subtitle,
    showStepNumbers = true,
    showTotal = true,
    addAllLabel,
    enrolLabel,
    emptyText,
    backgroundColor,
    instituteId,
    tagName,
    globalSettings,
    isPreviewMode = false,
  } = props;
  const { t } = useTranslation("coursePlayerB");
  const sectionNode = useRef<HTMLElement | null>(null);
  // State as well as a ref: a cart drawer opened from this section reads the
  // catalogue theme through it.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const sectionRef = useCallback((node: HTMLElement | null) => {
    sectionNode.current = node;
    setAnchor(node);
  }, []);

  // Bring the section's top into view after opening / closing a path from far
  // down the page.
  const scrollToTop = useCallback(() => {
    const el = sectionNode.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const shell: Shell = { backgroundColor, sectionRef, themeAnchor: anchor, scrollToTop };

  if (!instituteId) return null;

  if (mode === "list") return <LearningPathList {...props} instituteId={instituteId} shell={shell} />;

  const code = (productPageCode || "").trim();
  if (!code) {
    return isPreviewMode ? (
      <Section shell={shell}>
        <NoteCard>
          {t("learningPath.preview.pickPage", "Pick the product page this learning path follows in its properties.")}
        </NoteCard>
      </Section>
    ) : null;
  }

  return (
    <PathDetail
      shell={shell}
      code={code}
      instituteId={instituteId}
      tagName={tagName}
      globalSettings={globalSettings}
      heading={title || undefined}
      description={subtitle || undefined}
      productPageName={productPageName}
      showStepNumbers={showStepNumbers}
      showTotal={showTotal}
      addAllLabel={addAllLabel}
      enrolLabel={enrolLabel}
      emptyText={emptyText}
      isPreviewMode={isPreviewMode}
    />
  );
};

export default LearningPathComponent;

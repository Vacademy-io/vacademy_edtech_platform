import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "@phosphor-icons/react";
import type {
  ProductPageData,
  ProductPageSettings,
  PageJson,
  ProductPageFinderGroup,
} from "../-types/product-page-types";
import { PageRenderer, CourseGridBlock } from "./PageRenderer";
import { BasketSummaryBar } from "./BasketSummaryBar";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import { StepRailBar } from "./StepRailBar";
import { CourseFinderStep } from "./CourseFinderStep";
import { CourseFinderDialog } from "./CourseFinderDialog";
import { useProductPageStore } from "../-stores/product-page-store";
import {
  clearSavedGroupId,
  FINDER_SKIPPED,
  groupPackageSessionIds,
  isFinderUsable,
  mappingInGroup,
  parseCourseFinder,
  readSavedGroupId,
  saveGroupId,
  usableGroups,
} from "../-utils/course-finder";

interface CatalogStepProps {
  pageData: ProductPageData;
  settings: ProductPageSettings;
  /** Catalogue slug — enables the per-card "View course" link. */
  tagName?: string;
  productPageCode?: string;
  /** Comma-separated level names the grid is restricted to (Course Finder). */
  levels?: string;
  /**
   * Courses named in the URL. A visitor who arrived with a basket already
   * chosen has answered the Course Finder's question by other means, so asking
   * it again would discard the pick the link was built to deliver.
   */
  courseIds?: string;
  onNext: () => void;
  /**
   * Jump past the cart to the details step. Supplied by the shell, which owns
   * the step machine and has to remember the cart was skipped so Back from the
   * form does not land on a step the visitor never saw.
   */
  onJumpToForm?: () => void;
}

function parseSafeJson<T>(jsonStr: string | null | undefined, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_PAGE_JSON: PageJson = {
  globalSettings: { primaryColor: "#4F46E5", logoFileId: "" }, // design-lint-ignore: page-builder default color
  components: [],
};

export const CatalogStep = ({
  pageData,
  settings,
  tagName,
  productPageCode,
  levels,
  courseIds,
  onNext,
  onJumpToForm,
}: CatalogStepProps) => {
  const { t } = useTranslation("productPages");
  const courses = useCourseTerms().courses;
  const setSelection = useProductPageStore((s) => s.setSelection);

  const pageJson = parseSafeJson<PageJson>(
    pageData.page_json,
    DEFAULT_PAGE_JSON,
  );

  const designedPrimary = pageJson.globalSettings?.primaryColor || "#4F46E5"; // design-lint-ignore: page-builder default color

  // ── Course Finder ("choose your class") ────────────────────────────────────
  const finder = useMemo(
    () => parseCourseFinder(pageData.settings_json),
    [pageData.settings_json],
  );
  const usableFinder = useMemo(
    () => (isFinderUsable(finder, pageData.mappings) ? finder : null),
    [finder, pageData.mappings],
  );

  /**
   * The visitor's answer to the finder — a group id, FINDER_SKIPPED, or null
   * for "not asked yet" — restored from sessionStorage on mount.
   *
   * It has to survive a mount: this component is unmounted for the whole of the
   * cart and form steps, so state alone would re-ask the question on every
   * Back. Skipping counts as an answer for the same reason, which is why both
   * live in one value rather than a second boolean that resets.
   *
   * A saved id that no longer names a usable group (the page's courses changed
   * mid-session) resolves to null and simply asks again.
   */
  const [finderChoice, setFinderChoice] = useState<string | null>(() =>
    productPageCode ? readSavedGroupId(productPageCode) : null,
  );
  const skipped = finderChoice === FINDER_SKIPPED;
  const pickedGroupId = skipped ? null : finderChoice;

  const rememberChoice = (choice: string | null) => {
    setFinderChoice(choice);
    if (!productPageCode) return;
    if (choice === null) clearSavedGroupId(productPageCode);
    else saveGroupId(productPageCode, choice);
  };

  const pickedGroup: ProductPageFinderGroup | null = useMemo(() => {
    if (!usableFinder || !pickedGroupId) return null;
    return usableGroups(usableFinder, pageData.mappings).find((g) => g.id === pickedGroupId) ?? null;
  }, [usableFinder, pickedGroupId, pageData.mappings]);

  const lockedPackageSessionIds = useMemo(
    () => (pickedGroup ? groupPackageSessionIds(pickedGroup, pageData.mappings) : undefined),
    [pickedGroup, pageData.mappings],
  );

  const handlePick = (group: ProductPageFinderGroup) => {
    const inGroup = pageData.mappings.filter(
      (m) => m.status === "ACTIVE" && mappingInGroup(m, group),
    );

    // One class, one course, and the page asked to skip ahead: select it and go
    // straight to the details step. Only for a group of exactly one — choosing
    // among several is the visitor's decision, not the page's, so anything
    // wider falls through to the catalogue below.
    if (onJumpToForm && usableFinder?.onPick === "GO_TO_FORM" && inGroup.length === 1) {
      setSelection([inGroup[0]!.ps_invite_payment_option_id]);
      rememberChoice(group.id);
      onJumpToForm();
      return;
    }

    // Drop what belongs to another class, keep what belongs to this one.
    // Carrying everything through would enrol a Class 9 student in the Class 6
    // test they glanced at first, with the cart their only warning; clearing
    // everything would silently discard a course the page itself preselected,
    // or one added while browsing before answering.
    const kept = inGroup.map((m) => m.ps_invite_payment_option_id);
    // Read at click time rather than subscribing: a live subscription here
    // re-renders the whole designed page — header, hero, every block — on each
    // add or remove, when the basket is only ever needed at this instant.
    const selected = useProductPageStore.getState().selectedPsOptionIds;
    setSelection(selected.filter((id) => kept.includes(id)));
    rememberChoice(group.id);
  };

  const handleChangeClass = () => {
    // Abandoning the class abandons its basket — nothing selected can belong
    // to a class the visitor has not chosen yet.
    setSelection([]);
    rememberChoice(null);
  };

  // A deep link carrying courses has already answered the question.
  const arrivedWithBasket = !!courseIds?.trim();
  const finderOpen = !!usableFinder && !pickedGroup && !skipped && !arrivedWithBasket;

  // FULLSCREEN replaces the page outright; DIALOG (the default) lays a modal
  // over the unrestricted grid, so the visitor can see what the page sells
  // while answering — the catalogue's own behaviour.
  if (usableFinder && finderOpen && usableFinder.display === "FULLSCREEN") {
    return (
      <CourseFinderStep
        finder={usableFinder}
        mappings={pageData.mappings}
        primaryColor={designedPrimary}
        pageName={pageData.name}
        onPick={handlePick}
        onSkip={() => rememberChoice(FINDER_SKIPPED)}
      />
    );
  }

  const finderDialog = usableFinder && finderOpen ? (
    <CourseFinderDialog
      finder={usableFinder}
      mappings={pageData.mappings}
      primaryColor={designedPrimary}
      onPick={handlePick}
      onSkip={() => rememberChoice(FINDER_SKIPPED)}
    />
  ) : null;

  /** Lets the visitor undo a pick without hunting for the browser's Back. */
  const changeClassBar =
    usableFinder && (pickedGroup || skipped) ? (
      <div className="border-b border-catalogue-border bg-catalogue-bg-subtle">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-2 px-6 py-2.5 lg:px-8">
          <button
            type="button"
            onClick={handleChangeClass}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-catalogue-text-secondary transition-colors hover:text-catalogue-text-primary"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {usableFinder.changeLabel?.trim() || t("courseFinder.change")}
          </button>
          {pickedGroup && (
            <span className="truncate text-sm text-catalogue-text-muted">
              · {pickedGroup.label}
            </span>
          )}
        </div>
      </div>
    ) : null;

  if (pageJson.components.length > 0) {
    return (
      <>
        {/* The rail belongs here too. Leaving it off a designed page meant the
            wizard was absent while browsing and appeared on reaching the cart,
            which reads as random rather than as step 1 of 4. */}
        <StepRailBar primaryColor={designedPrimary} variant="catalogue" />
        {changeClassBar}
        {finderDialog}
      <PageRenderer
        pageJson={pageJson}
        pageData={pageData}
        settings={settings}
        tagName={tagName}
        productPageCode={productPageCode}
        lockedLevels={levels}
        lockedPackageSessionIds={lockedPackageSessionIds}
        onNext={onNext}
      />
      </>
    );
  }

  // ── Fallback: a product page with no page_json still gets the full browse
  // experience (search, popular tags, level / batch / price filters, paging)
  // instead of an unfiltered wall of every course on the page. Same grid the
  // page-builder renders, so the two never diverge.
  const activeMappings = pageData.mappings.filter((m) => m.status === "ACTIVE");
  const primaryColor = pageJson.globalSettings?.primaryColor || "#4F46E5"; // design-lint-ignore: page-builder default color

  // The column count follows what the visitor will actually be shown, so a
  // class with one course does not stretch a lone card across a 3-up grid.
  const visibleCount = lockedPackageSessionIds
    ? activeMappings.filter((m) => lockedPackageSessionIds.includes(m.package_session_id)).length
    : activeMappings.length;

  return (
    <div className="min-h-screen bg-catalogue-bg">
      <StepRailBar primaryColor={primaryColor} variant="catalogue" />
      {changeClassBar}
      {finderDialog}

      {/* Page title */}
      <div className="border-b border-catalogue-border px-6 py-8 lg:px-8">
        <div className="mx-auto max-w-screen-2xl">
          <h1 className="text-3xl font-bold leading-tight text-catalogue-text-primary md:text-4xl">
            {pageData.name}
          </h1>
          {visibleCount > 1 && (
            <p className="mt-2 text-sm text-catalogue-text-muted">
              {t("catalogStep.selectPrompt", { courses: courses.toLocaleLowerCase() })}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl">
        {/* Column count tracks the catalogue size, as the previous fallback
            did — a lone course stretched across a 3-up grid reads as a
            broken row rather than a deliberate single offer. */}
        <CourseGridBlock
          props={{ columns: Math.min(visibleCount, 3) || 1 }}
          pageData={pageData}
          settings={settings}
          primaryColor={primaryColor}
          tagName={tagName}
          productPageCode={productPageCode}
          lockedLevels={levels}
          lockedPackageSessionIds={lockedPackageSessionIds}
        />
      </div>

      {/* Sticky action bar — shared with the designed-page catalogue, so the
          two formats cannot quote different totals for the same basket. */}
      <BasketSummaryBar
        pageData={pageData}
        onNext={onNext}
        primaryColor={primaryColor}
      />

    </div>
  );
};

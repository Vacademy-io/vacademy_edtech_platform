import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, FileText, MagnifyingGlass, SquaresFour, X } from "@phosphor-icons/react";
import { urlCourseDetails } from "@/constants/urls";
import { cn } from "@/lib/utils";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import { resolveCoursePageRoute } from "../../-utils/course-page-routing";
import { courseLanguagesOf, preferredCourseLanguage } from "../../-utils/course-variants";
import { fetchPublicFolderTree } from "../../-services/folder-library-service";
import type { CourseCatalogueData, GlobalSettings, HeaderMegaMenuConfig } from "../../-types/course-catalogue-types";
import { buildMegaMenuModel } from "./mega-menu-model";
import {
  courseIdOf,
  courseSearchItems,
  courseSitePath,
  groupSearchResults,
  pageSearchItems,
  rankSiteSearch,
  streamSearchItems,
  type CourseSearchRow,
  type RankedSearchItem,
  type SearchGroup,
  type SiteSearchItem,
} from "./header-search";
import { openNotifyForm, retryUnlessMissingLibrary, useHeaderLinkNavigation } from "./header-hooks";
import { ComingSoonTag } from "./MegaMenuParts";
import { EDITORIAL_SEARCH_BUTTON, EDITORIAL_SEARCH_ICON } from "./header-chrome";

/**
 * Header search: an icon that opens a search dialog over courses (the open
 * course search), the site's pages and the mega menu's streams/categories.
 *
 * The dialog is a combobox: the input keeps focus, ↑/↓ move through the
 * results, Enter opens one, Esc closes and focus returns to the icon. It is
 * portalled into the catalogue's theme root (not <body>) so the site's theme
 * preset, brand colour and dark mode still apply, and it sits above the
 * header and the phone action bar.
 */

export interface HeaderSearchProps {
  instituteId: string | null | undefined;
  tagName: string;
  catalogueData?: CourseCatalogueData;
  globalSettings?: GlobalSettings;
  /** Authored configs of the header's mega menus (their streams are searchable). */
  megaConfigs: HeaderMegaMenuConfig[];
  /** Group heading for streams — the mega menu's own nav label when there is one. */
  streamsLabel?: string;
  className?: string;
  /** "editorial" = the design's 18px line icon in the palette olive (header navStyle "editorial"). Absent = original. */
  variant?: "default" | "editorial";
}

const fetchSearchCourses = async (instituteId: string): Promise<CourseSearchRow[]> => {
  const res = await axios.post(
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
      // Same request as the catalogue grid, so search spans every course it lists.
      params: { instituteId, page: 0, size: 1000, sort: "createdAt,desc" },
      headers: { "Content-Type": "application/json" },
    },
  );
  const raw = res.data?.content || res.data || [];
  return Array.isArray(raw) ? raw : [];
};

const SUGGESTION_LIMIT = 6;

const KindIcon: React.FC<{ kind: SiteSearchItem["kind"] }> = ({ kind }) => {
  const Icon = kind === "course" ? BookOpen : kind === "page" ? FileText : SquaresFour;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-catalogue-bg-muted text-catalogue-text-secondary"
    >
      <Icon className="size-4" />
    </span>
  );
};

export const HeaderSearch: React.FC<HeaderSearchProps> = ({
  instituteId,
  tagName,
  catalogueData,
  globalSettings,
  megaConfigs,
  streamsLabel,
  className,
  variant,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const { locale: siteLocale } = useCatalogueLocale();
  const location = useLocation();
  const { resolve, go } = useHeaderLinkNavigation(tagName);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const titleId = `site-search-title-${baseId}`;
  const listId = `site-search-list-${baseId}`;
  const optionId = (index: number) => `site-search-option-${baseId}-${index}`;

  // Stable across renders while the authored configs do not change.
  const configsKey = JSON.stringify(megaConfigs.map((c) => [c.libraryId, c.streamLinkPattern, c.categoryLinkPattern]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const configs = useMemo(() => megaConfigs.filter((c) => (c.libraryId || "").trim()), [configsKey]);

  const coursesQuery = useQuery({
    queryKey: ["CATALOGUE_SITE_SEARCH_COURSES", instituteId],
    queryFn: () => fetchSearchCourses(instituteId!),
    enabled: open && !!instituteId,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const treeQueries = useQueries({
    queries: configs.map((c) => ({
      queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, (c.libraryId || "").trim()],
      queryFn: () => fetchPublicFolderTree(instituteId!, (c.libraryId || "").trim()),
      enabled: open && !!instituteId,
      staleTime: 5 * 60_000,
      retry: retryUnlessMissingLibrary,
    })),
  });
  const treesKey = treeQueries.map((q) => q.dataUpdatedAt).join("|");

  const streamItems = useMemo(() => {
    const seen = new Set<string>();
    return configs
      .flatMap((c, i) => streamSearchItems(buildMegaMenuModel(treeQueries[i]?.data, c), siteT))
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs, treesKey, siteT]);

  const pageItems = useMemo(
    () => pageSearchItems(catalogueData?.pages, { homeLabel: t("header.searchDialog.home", "Home"), translate: siteT }),
    [catalogueData?.pages, siteT, t],
  );

  const courseItems = useMemo(() => {
    // One result per course opens the version a merged course card opens:
    // the visitor's language when the course has it.
    const languages = courseLanguagesOf(globalSettings?.courseLanguages);
    return courseSearchItems(coursesQuery.data, {
      translate: siteT,
      preferredLanguage: preferredCourseLanguage(siteLocale, languages),
      languages,
      hrefFor: (row) =>
        courseSitePath(
          row,
          resolveCoursePageRoute(globalSettings, {
            courseId: courseIdOf(row),
            packageSessionId: row.package_session_id,
          }),
        ),
    });
  }, [coursesQuery.data, globalSettings, siteT, siteLocale]);

  const trimmed = query.trim();
  const groups: SearchGroup[] = useMemo(() => {
    if (!trimmed) {
      // Before typing: the streams and pages, as suggestions.
      const asRanked = (items: SiteSearchItem[]): RankedSearchItem[] =>
        items.slice(0, SUGGESTION_LIMIT).map((item) => ({ ...item, score: 0 }));
      return [
        { kind: "streams" as const, items: asRanked(streamItems.filter((i) => i.kind === "stream")) },
        { kind: "pages" as const, items: asRanked(pageItems) },
      ].filter((g) => g.items.length);
    }
    return groupSearchResults(rankSiteSearch(trimmed, [...streamItems, ...courseItems, ...pageItems]), SUGGESTION_LIMIT);
  }, [trimmed, streamItems, courseItems, pageItems]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActiveIndex(0), [trimmed]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, open]);

  // Any navigation closes the dialog.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.searchStr]);

  // While open: the page behind does not scroll, the input has focus.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const openDialog = () => {
    // Into the catalogue's theme root so its theme, colour and dark mode apply.
    setPortalTarget(
      (triggerRef.current?.closest("[data-catalogue-theme]") as HTMLElement | null) ?? document.body,
    );
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  };

  const closeDialog = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = (item: SiteSearchItem | undefined) => {
    if (!item) return;
    if (item.notifyAudienceId) {
      closeDialog(false);
      openNotifyForm(item.notifyAudienceId, item.title);
      return;
    }
    if (!item.link) return;
    const target = resolve(item.link);
    closeDialog(false);
    go(target);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // An IME (Hindi transliteration…) commits its word with Enter and moves
    // through its candidates with the arrows: those keys are not ours then.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      if (flat[activeIndex]) {
        e.preventDefault();
        choose(flat[activeIndex]);
      }
    }
  };

  // Esc closes; Tab stays inside the dialog.
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"]), a[href]'),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const groupLabel = (kind: SearchGroup["kind"]) =>
    kind === "courses"
      ? t("header.searchDialog.courses", "Courses")
      : kind === "pages"
        ? t("header.searchDialog.pages", "Pages")
        : streamsLabel || t("header.searchDialog.streams", "Streams");

  const coursesLoading = !!trimmed && !!instituteId && coursesQuery.isPending && coursesQuery.fetchStatus !== "idle";

  const dialog = (
    <div className="fixed inset-0 z-60 flex items-start justify-center px-4 pt-16 sm:pt-24">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("header.searchDialog.close", "Close search")}
        onClick={() => closeDialog()}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
        className="relative flex max-h-screen-80 w-dialog-lg flex-col overflow-hidden rounded-catalogue-xl border border-catalogue-border bg-catalogue-bg-elevated shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
      >
        <h2 id={titleId} className="sr-only">
          {t("header.searchDialog.title", "Search this site")}
        </h2>
        <div className="flex items-center gap-2 border-b border-catalogue-border px-4">
          <MagnifyingGlass aria-hidden="true" className="size-5 shrink-0 text-catalogue-text-muted" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={flat[activeIndex] ? optionId(activeIndex) : undefined}
            aria-label={t("header.searchDialog.title", "Search this site")}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t("header.searchDialog.placeholder", "Search courses, streams and pages")}
            className="h-14 w-full bg-transparent text-base text-catalogue-text-primary placeholder:text-catalogue-text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={() => closeDialog()}
            aria-label={t("header.searchDialog.close", "Close search")}
            className="catalogue-btn catalogue-btn-ghost catalogue-btn-icon size-9 shrink-0 justify-center rounded-full"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain p-2">
          {!trimmed && (
            <p className="px-3 py-2 text-sm text-catalogue-text-muted">
              {t("header.searchDialog.hint", "Type to search courses, streams and pages.")}
            </p>
          )}

          {groups.length > 0 && (
            <ul id={listId} role="listbox" aria-label={t("header.searchDialog.results", "Search results")}>
              {groups.map((group) => {
                const headingId = `${listId}-${group.kind}`;
                return (
                  <li key={group.kind} role="presentation" className="pb-2">
                    <p
                      id={headingId}
                      className="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-wider text-catalogue-text-muted"
                    >
                      {groupLabel(group.kind)}
                    </p>
                    <ul role="group" aria-labelledby={headingId}>
                      {group.items.map((item) => {
                        const index = flat.indexOf(item);
                        const active = index === activeIndex;
                        const selectable = !!item.link || !!item.notifyAudienceId;
                        return (
                          <li
                            key={item.id}
                            id={optionId(index)}
                            role="option"
                            aria-selected={active}
                            aria-disabled={selectable ? undefined : true}
                            onMouseMove={() => setActiveIndex(index)}
                            onClick={() => choose(item)}
                            className={cn(
                              "flex items-center gap-3 rounded-catalogue-md px-3 py-2.5",
                              selectable ? "cursor-pointer" : "cursor-default opacity-70",
                              active && "bg-primary-50",
                            )}
                          >
                            <KindIcon kind={item.kind} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-catalogue-text-primary">
                                {item.title}
                              </span>
                              {item.subtitle && (
                                <span className="block truncate text-caption text-catalogue-text-muted">
                                  {item.subtitle}
                                </span>
                              )}
                            </span>
                            {/* The tag only on what is coming soon; an open item
                                whose link could not be built gets no arrow. */}
                            {item.comingSoon ? (
                              <ComingSoonTag />
                            ) : item.link ? (
                              <ArrowRight
                                aria-hidden="true"
                                className={cn(
                                  "size-4 shrink-0 rtl:rotate-180",
                                  active ? "text-primary-500" : "text-catalogue-text-muted",
                                )}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}

          <div aria-live="polite" className="px-3">
            {coursesLoading && (
              <p className="py-2 text-sm text-catalogue-text-muted">
                {t("header.searchDialog.loadingCourses", "Searching courses…")}
              </p>
            )}
            {!!trimmed && coursesQuery.isError && (
              <p className="py-2 text-sm text-catalogue-text-muted">
                {t("header.searchDialog.coursesError", "Courses could not be searched right now.")}
              </p>
            )}
            {!!trimmed && !flat.length && !coursesLoading && (
              <p className="py-6 text-center text-sm text-catalogue-text-muted">
                {t("header.searchDialog.noResults", { defaultValue: "No results for “{{query}}”", query: trimmed })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-label={t("header.search")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          variant === "editorial"
            ? `${EDITORIAL_SEARCH_BUTTON} transition-colors duration-200`
            : "p-2 rounded-catalogue-sm text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover transition-colors duration-200",
          className,
        )}
      >
        {variant === "editorial" ? (
          <MagnifyingGlass aria-hidden="true" weight="bold" className={EDITORIAL_SEARCH_ICON} />
        ) : (
          <MagnifyingGlass className="w-5 h-5" />
        )}
      </button>
      {open && portalTarget && createPortal(dialog, portalTarget)}
    </>
  );
};

export default HeaderSearch;

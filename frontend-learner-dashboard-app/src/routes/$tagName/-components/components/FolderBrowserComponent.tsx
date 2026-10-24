import React, { useEffect, useMemo, useRef, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CaretRight,
  Folder,
  MagnifyingGlass,
  ShoppingCartSimple,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import { useSiteT } from "@/routes/$tagName/-utils/catalogue-locale";
import { ProductPageOfferComponent } from "./ProductPageOfferComponent";
import { isSiteCartEnabled } from "../../-utils/site-cart";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import {
  fetchPublicFolderTree,
  nodeTitle,
  pathTo,
  pruneEmptyFolders,
  type FolderImageShape,
  type FolderLayout,
  type FolderView,
  type PublicFolderNode,
} from "../../-services/folder-library-service";

/**
 * Folder Browser — an admin-curated folder tree (Class → Subject → …) that a
 * visitor opens one level at a time. Folders are cards; a product page inside
 * the open folder shows its courses right there, with add-to-cart and
 * checkout exactly as the Product Page Offer section.
 *
 * WHY THE TREE IS READ LIVE: it lives in a shared library (Manage Pages →
 * Folders) that any number of sections and sites may show, so the section
 * stores only the library id and reads the tree at render time — the same
 * reasoning as productPageOffer storing only a code.
 *
 * The open folder is in the URL (`?folder=<id>`), so the back button walks
 * back up the tree and a folder can be shared as a link. Other query params
 * (UTMs, …) are kept when it changes.
 */

interface FolderBrowserProps {
  libraryId?: string;
  /** Start here instead of the library's top level ('' = top level). */
  rootFolderId?: string;
  title?: string;
  subtitle?: string;
  align?: "left" | "center";
  layout?: FolderLayout;
  imageShape?: FolderImageShape;
  columns?: number;
  showDescription?: boolean;
  showCounts?: boolean;
  showBreadcrumbs?: boolean;
  showSearch?: boolean;
  hideEmptyFolders?: boolean;
  /** Courses of a product page inside a folder: */
  enableCart?: boolean;
  showPrice?: boolean;
  showViewCourse?: boolean;
  courseColumns?: number;
  coursePageSize?: number;
  backgroundColor?: string;
  instituteId?: string;
  tagName?: string;
  isPreviewMode?: boolean;
  /** Passed to embedded product-page offers so they join the site-wide cart (globalSettings.siteCart). */
  globalSettings?: Partial<GlobalSettings>;
}

const FOLDER_PARAM = "folder";
/** Below this many nodes a search box is noise. */
const SEARCH_MIN_NODES = 8;

const ASPECT: Record<Exclude<FolderImageShape, "none">, string> = {
  landscape: "catalogue-aspect-video",
  square: "catalogue-aspect-square",
  portrait: "catalogue-aspect-portrait",
};

/** Desktop column counts, mapped to whole class names so Tailwind keeps them. */
const COLUMN_CLASSES: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

const clampColumns = (n: unknown) => Math.min(Math.max(Number(n) || 3, 2), 5);

/** Flat list of every node under `nodes`, each with its folder path, for search. */
const flatten = (
  nodes: PublicFolderNode[],
  trail: PublicFolderNode[] = [],
): { node: PublicFolderNode; trail: PublicFolderNode[] }[] =>
  nodes.flatMap((n) => [
    { node: n, trail },
    ...(n.node_type === "FOLDER" ? flatten(n.children || [], [...trail, n]) : []),
  ]);

/** Consecutive folders share one grid; each product page is its own block. */
type Run =
  | { kind: "folders"; nodes: PublicFolderNode[] }
  | { kind: "page"; node: PublicFolderNode };

const toRuns = (items: PublicFolderNode[]): Run[] => {
  const runs: Run[] = [];
  for (const n of items) {
    if (n.node_type === "PRODUCT_PAGE") {
      runs.push({ kind: "page", node: n });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.kind === "folders") last.nodes.push(n);
    else runs.push({ kind: "folders", nodes: [n] });
  }
  return runs;
};

export const FolderBrowserComponent: React.FC<FolderBrowserProps> = ({
  libraryId,
  rootFolderId = "",
  title,
  subtitle,
  align = "left",
  layout = "cards",
  imageShape = "landscape",
  columns = 3,
  showDescription = true,
  showCounts = true,
  showBreadcrumbs = true,
  showSearch = true,
  hideEmptyFolders = true,
  enableCart = true,
  showPrice = true,
  showViewCourse = true,
  courseColumns = 3,
  coursePageSize = 9,
  backgroundColor,
  instituteId,
  tagName,
  isPreviewMode = false,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const terms = useCourseTerms();
  // Folder names and descriptions are live data from the library, so they
  // are translated where they are shown. Navigation, search matching and
  // folder ids keep reading the stored values.
  const siteT = useSiteT();
  const titleOf = (n: PublicFolderNode) => siteT(nodeTitle(n));
  const location = useLocation();
  const router = useRouter();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, libraryId],
    queryFn: () => fetchPublicFolderTree(instituteId!, libraryId!),
    enabled: !!instituteId && !!libraryId,
    staleTime: 60_000,
    retry: (count, err: unknown) =>
      // A deleted / unknown library is a 404 — retrying will not change that.
      (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  });

  const roots = useMemo(() => {
    const all = data?.roots || [];
    return hideEmptyFolders ? pruneEmptyFolders(all) : all;
  }, [data, hideEmptyFolders]);

  // The section's own top: the library's top level, or a chosen start folder.
  // A start folder that is hidden, deleted or (pruned) empty shows NOTHING —
  // falling back to the whole library would turn a "Class 10" page into a
  // page listing every class.
  const base = useMemo(() => {
    if (!rootFolderId) return null;
    const trail = pathTo(roots, rootFolderId);
    const hit = trail[trail.length - 1];
    return hit && hit.node_type === "FOLDER" ? hit : null;
  }, [roots, rootFolderId]);
  const baseItems = useMemo(
    () => (rootFolderId ? (base ? base.children || [] : []) : roots),
    [rootFolderId, base, roots],
  );

  const folderParam = useMemo(
    () => new URLSearchParams(location.searchStr || "").get(FOLDER_PARAM),
    [location.searchStr],
  );
  // Only honour a folder that is inside THIS section's tree — another section
  // on the page (or a stale link) may carry an id this one has never seen.
  const trail = useMemo(() => {
    const path = pathTo(baseItems, folderParam);
    const last = path[path.length - 1];
    return last && last.node_type === "FOLDER" ? path : [];
  }, [baseItems, folderParam]);
  const current = trail.length ? trail[trail.length - 1] : null;
  const items = current ? current.children || [] : baseItems;

  // Display settings for what is listed: the section's defaults, overridden
  // by the open folder's own (or the start folder's, at the top).
  const view: Required<FolderView> = {
    layout,
    imageShape,
    columns: clampColumns(columns),
    showDescription,
    showCounts,
    ...((current || base)?.view || {}),
  } as Required<FolderView>;
  view.columns = clampColumns(view.columns);
  if (view.layout === "tiles" && view.imageShape === "none") view.imageShape = "landscape";

  // Bring the section's top into view when the visitor changes folder; without
  // it, opening a folder from the bottom of a long grid leaves them staring at
  // the footer.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Back/forward changes the folder without going through openFolder, and a
    // query left behind would keep its results on screen with no box to clear it.
    setQuery("");
    const el = sectionRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [folderParam]);

  const openFolder = (id: string | null) => {
    setQuery("");
    const params = new URLSearchParams(location.searchStr || "");
    if (id) params.set(FOLDER_PARAM, id);
    else params.delete(FOLDER_PARAM);
    const qs = params.toString();
    router.history.push(`${location.pathname}${qs ? `?${qs}` : ""}`);
  };

  const searchable = useMemo(() => flatten(baseItems), [baseItems]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    // A visitor may type the name as they read it (translated) or as stored.
    return searchable.filter(({ node }) =>
      [nodeTitle(node), node.description || "", node.product_page_name || ""]
        .flatMap((s) => (s ? [s, siteT(s)] : []))
        .some((s) => s.toLowerCase().includes(q)),
    );
  }, [query, searchable, siteT]);

  const isCenter = align === "center";
  const homeLabel = base ? titleOf(base) : t("folderBrowser.home", "All");
  const heading = current ? titleOf(current) : title;
  const lead = current ? (current.description ? siteT(current.description) : current.description) : subtitle;

  // ── Not configured / nothing to show ──
  const hint = (message: string) =>
    isPreviewMode ? (
      <section className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell">
          <div className="catalogue-card border-dashed p-8 text-center text-sm text-catalogue-text-muted">
            {message}
          </div>
        </div>
      </section>
    ) : null;

  if (!libraryId) return hint(t("folderBrowser.previewPickLibrary", "Pick a folder library for this section in its properties."));
  if (isError) {
    return hint(t("folderBrowser.loadError", "This section could not load. Please refresh the page."));
  }
  if (!isLoading && baseItems.length === 0) {
    return hint(t("folderBrowser.previewEmptyLibrary", "This folder library has nothing students can see yet."));
  }

  const countLine = (n: PublicFolderNode) => {
    const folders = (n.children || []).filter((c) => c.node_type === "FOLDER").length;
    const pages = (n.children || []).length - folders;
    const parts: string[] = [];
    if (folders) parts.push(t("folderBrowser.folderCount", { count: folders, defaultValue: "{{count}} folders" }));
    if (pages) {
      parts.push(
        folders
          ? t("folderBrowser.coursesInside", { courses: terms.courses, defaultValue: "{{courses}} inside" })
          : t("folderBrowser.viewCourses", { courses: terms.courses.toLocaleLowerCase(), defaultValue: "View {{courses}}" }),
      );
    }
    return parts.join(" · ");
  };

  const media = (n: PublicFolderNode, className?: string) => {
    if (view.imageShape === "none") return null;
    return (
      // Not zoomed on hover: cover art with text at its edges would be cropped.
      <div className={cn("relative w-full overflow-hidden bg-catalogue-bg-muted", ASPECT[view.imageShape], className)}>
        {n.image_url ? (
          <FitImage src={n.image_url} alt="" loading="lazy" className="absolute inset-0 size-full" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-catalogue-text-muted">
            {n.node_type === "FOLDER" ? (
              <Folder className="size-10 opacity-60" weight="duotone" aria-hidden="true" />
            ) : (
              <ShoppingCartSimple className="size-10 opacity-60" weight="duotone" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
    );
  };

  const folderCard = (n: PublicFolderNode) => {
    const label = titleOf(n);
    const description = n.description ? siteT(n.description) : n.description;
    const counts = view.showCounts ? countLine(n) : "";

    if (view.layout === "tiles") {
      return (
        <button
          key={n.id}
          type="button"
          onClick={() => openFolder(n.id)}
          className="catalogue-card-elevated group relative block w-full text-start"
        >
          {media(n)}
          {/* Over a photo the text must stay light whatever the theme. */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-4 pt-10 text-white">
            <p className="line-clamp-2 text-base font-semibold leading-snug">{label}</p>
            {view.showDescription && description && (
              <p className="mt-1 line-clamp-2 text-xs opacity-90">{description}</p>
            )}
            {counts && <p className="mt-1 text-xs font-medium opacity-80">{counts}</p>}
          </div>
        </button>
      );
    }

    if (view.layout === "list") {
      return (
        <button
          key={n.id}
          type="button"
          onClick={() => openFolder(n.id)}
          className="group flex w-full items-center gap-4 px-4 py-3 text-start transition-colors hover:bg-catalogue-interactive-hover"
        >
          {view.imageShape !== "none" && (
            <div className="relative size-14 shrink-0 overflow-hidden rounded-catalogue-md bg-catalogue-bg-muted">
              {n.image_url ? (
                <FitImage src={n.image_url} alt="" loading="lazy" className="absolute inset-0 size-full" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-catalogue-text-muted">
                  <Folder className="size-6 opacity-60" weight="duotone" aria-hidden="true" />
                </div>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-catalogue-text-primary">{label}</p>
            {view.showDescription && description && (
              <p className="mt-0.5 line-clamp-1 text-sm text-catalogue-text-muted">{description}</p>
            )}
            {counts && <p className="mt-0.5 text-xs text-catalogue-text-muted">{counts}</p>}
          </div>
          <CaretRight
            className="size-4 shrink-0 text-catalogue-text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
            weight="bold"
            aria-hidden="true"
          />
        </button>
      );
    }

    return (
      <button
        key={n.id}
        type="button"
        onClick={() => openFolder(n.id)}
        className="catalogue-card-elevated group flex h-full w-full flex-col text-start"
      >
        {media(n)}
        <div className="flex flex-1 flex-col gap-1 p-4">
          <div className="flex items-start gap-2">
            {view.imageShape === "none" && (
              <Folder className="mt-0.5 size-5 shrink-0 text-catalogue-brand-ink" weight="duotone" aria-hidden="true" />
            )}
            <p className="line-clamp-2 flex-1 text-base font-semibold leading-snug text-catalogue-text-primary">{label}</p>
          </div>
          {view.showDescription && description && (
            <p className="line-clamp-2 text-sm text-catalogue-text-muted">{description}</p>
          )}
          {counts && (
            <p className="mt-auto flex items-center gap-1 pt-2 text-xs font-semibold text-catalogue-brand-ink">
              {counts}
              <CaretRight className="size-3 rtl:rotate-180" weight="bold" aria-hidden="true" />
            </p>
          )}
        </div>
      </button>
    );
  };

  const folderGrid = (nodes: PublicFolderNode[]) =>
    view.layout === "list" ? (
      <div className="catalogue-card divide-y divide-catalogue-border overflow-hidden">
        {nodes.map(folderCard)}
      </div>
    ) : (
      <div
        className={cn(
          "grid gap-4 md:gap-6",
          view.layout === "tiles" ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2",
          COLUMN_CLASSES[view.columns],
        )}
      >
        {nodes.map(folderCard)}
      </div>
    );

  // A product page that is the folder's only content IS the folder: its name
  // would just repeat the heading, so it shows only when the admin gave the
  // item a title of its own.
  const soleItem = items.length === 1;
  // Each product page's basket docks its own checkout bar at the foot of the
  // screen; two in one folder would sit exactly on top of each other (and
  // fight over the body class that lifts the mobile CTA). So the basket is
  // offered only when the open folder holds ONE product page — otherwise each
  // course enrols on its own.
  const pageCount = items.filter((n) => n.node_type === "PRODUCT_PAGE").length;
  const pageBlock = (n: PublicFolderNode) => (
    <ProductPageOfferComponent
      embedded
      productPageCode={n.product_page_code || undefined}
      title={soleItem && !(n.title || "").trim() ? undefined : titleOf(n)}
      subtitle={soleItem && !(n.title || "").trim() ? undefined : n.description ? siteT(n.description) : undefined}
      align={isCenter ? "center" : "left"}
      headerScale="md"
      columns={clampColumns(courseColumns)}
      layout="grid"
      // Without a site cart each offer docks its own basket bar, so a folder
      // holding several product pages offers none; the site cart is one bar.
      enableCart={enableCart && (pageCount === 1 || isSiteCartEnabled(globalSettings?.siteCart))}
      globalSettings={globalSettings}
      showPrice={showPrice}
      showViewCourse={showViewCourse}
      showViewAll={false}
      pageSize={Math.max(Number(coursePageSize) || 0, 0)}
      instituteId={instituteId}
      tagName={tagName}
      isPreviewMode={isPreviewMode}
    />
  );

  const showSearchBox = showSearch && !current && searchable.length >= SEARCH_MIN_NODES;
  // Results only exist while the box that produced them is on screen.
  const shownResults = showSearchBox ? results : null;
  const runs = toRuns(items);
  const showContents = !isLoading && !shownResults && items.length > 0;

  return (
    <section
      ref={sectionRef}
      className="catalogue-section bg-catalogue-bg"
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <div className="catalogue-shell">
        {showBreadcrumbs && current && (
          <nav
            aria-label={t("folderBrowser.breadcrumbLabel", "Folders")}
            className={cn("mb-4 flex flex-wrap items-center gap-1 text-sm", isCenter && "justify-center")}
          >
            <button
              type="button"
              onClick={() => openFolder(null)}
              className="rounded px-1 font-medium text-catalogue-brand-ink hover:underline"
            >
              {homeLabel}
            </button>
            {trail.map((n, i) => (
              <span key={n.id} className="flex items-center gap-1">
                <CaretRight className="size-3 text-catalogue-text-muted rtl:rotate-180" aria-hidden="true" />
                {i === trail.length - 1 ? (
                  <span aria-current="page" className="px-1 font-semibold text-catalogue-text-primary">
                    {titleOf(n)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openFolder(n.id)}
                    className="rounded px-1 font-medium text-catalogue-brand-ink hover:underline"
                  >
                    {titleOf(n)}
                  </button>
                )}
              </span>
            ))}
          </nav>
        )}

        {(heading || lead || current || showSearchBox) && (
          <div
            className={cn(
              "catalogue-section-header flex flex-col gap-4",
              isCenter ? "items-center text-center" : "md:flex-row md:items-end md:justify-between",
            )}
          >
            <div className={cn("min-w-0", isCenter && "flex flex-col items-center")}>
              {current && (
                <button
                  type="button"
                  onClick={() => openFolder(trail.length > 1 ? trail[trail.length - 2].id : null)}
                  className="catalogue-btn catalogue-btn-ghost catalogue-btn-sm mb-2 -ms-2"
                >
                  <ArrowLeft className="size-4 rtl:rotate-180" weight="bold" aria-hidden="true" />
                  {t("folderBrowser.back", "Back")}
                </button>
              )}
              {heading && <h2 className="catalogue-h2 text-catalogue-text-primary">{heading}</h2>}
              {lead && (
                <p className={cn("catalogue-lead text-catalogue-text-muted", isCenter ? "catalogue-measure" : "catalogue-measure-start")}>
                  {lead}
                </p>
              )}
            </div>
            {showSearchBox && (
              <div className="relative w-full md:w-72">
                <MagnifyingGlass
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-catalogue-text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("folderBrowser.searchPlaceholder", "Search folders and courses")}
                  aria-label={t("folderBrowser.searchLabel", "Search this section")}
                  className="catalogue-input catalogue-input-icon-start catalogue-input-icon-end"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={t("common.clearSearch")}
                    className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-catalogue-text-muted hover:text-catalogue-text-primary"
                  >
                    <X className="size-4" weight="bold" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6", COLUMN_CLASSES[clampColumns(columns)])}>
            {Array.from({ length: clampColumns(columns) }).map((_, i) => (
              <div key={i} className="catalogue-card overflow-hidden">
                <div className="catalogue-skeleton catalogue-aspect-video w-full" />
                <div className="space-y-2 p-4">
                  <div className="catalogue-skeleton catalogue-skeleton-title w-2/3" />
                  <div className="catalogue-skeleton catalogue-skeleton-text w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : shownResults ? (
          shownResults.length === 0 ? (
            <p className="py-8 text-center text-sm text-catalogue-text-muted">
              {t("folderBrowser.noResults", { query: query.trim(), defaultValue: "Nothing matches “{{query}}”." })}
            </p>
          ) : (
            <div className="catalogue-card divide-y divide-catalogue-border overflow-hidden">
              <p className="px-4 py-2 text-xs font-medium text-catalogue-text-muted" aria-live="polite">
                {t("folderBrowser.resultCount", { count: shownResults.length, defaultValue: "{{count}} matches" })}
              </p>
              {shownResults.map(({ node, trail: path }) => {
                const isFolder = node.node_type === "FOLDER";
                // A product page opens the folder that holds it.
                const target = isFolder ? node.id : path.length ? path[path.length - 1].id : null;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => openFolder(target)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-catalogue-interactive-hover"
                  >
                    {isFolder ? (
                      <Folder className="size-5 shrink-0 text-catalogue-brand-ink" weight="duotone" aria-hidden="true" />
                    ) : (
                      <ShoppingCartSimple className="size-5 shrink-0 text-catalogue-brand-ink" weight="duotone" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-catalogue-text-primary">{titleOf(node)}</p>
                      {path.length > 0 && (
                        <p className="truncate text-xs text-catalogue-text-muted">
                          {t("folderBrowser.inPath", {
                            path: [homeLabel, ...path.map(titleOf)].join(" › "),
                            defaultValue: "in {{path}}",
                          })}
                        </p>
                      )}
                    </div>
                    <CaretRight className="size-4 shrink-0 text-catalogue-text-muted rtl:rotate-180" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          )
        ) : items.length === 0 ? (
          <div className="catalogue-card border-dashed px-6 py-12 text-center">
            <Folder className="mx-auto size-10 text-catalogue-text-muted opacity-60" weight="duotone" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-catalogue-text-primary">
              {t("folderBrowser.emptyTitle", "Nothing here yet")}
            </p>
            <p className="mt-1 text-sm text-catalogue-text-muted">{t("folderBrowser.emptyHint", "Check back soon.")}</p>
          </div>
        ) : null}
      </div>

      {/* Contents, in the admin's order. Folder grids get a shell of their
          own; product pages do not, because each brings its own shell (and
          its carousel must bleed to the section edge) — nesting them inside
          the shell above would double the side padding. */}
      {showContents &&
        runs.map((run, i) =>
          run.kind === "folders" ? (
            <div key={`folders-${i}`} className={cn("catalogue-shell", i > 0 && "mt-10")}>
              {folderGrid(run.nodes)}
            </div>
          ) : (
            <div key={run.node.id} className={i > 0 ? "mt-10" : undefined}>
              {pageBlock(run.node)}
            </div>
          ),
        )}
    </section>
  );
};

export default FolderBrowserComponent;

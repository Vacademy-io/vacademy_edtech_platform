import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useSiteT } from "../../-utils/catalogue-locale";
import { readSearchParam, URL_PARAMS } from "../../-utils/catalogue-url-state";
import type { HeaderMegaMenuConfig } from "../../-types/course-catalogue-types";
import { routeHeaderLink, type HeaderLink } from "./header-links";
import {
  buildMegaMenuModel,
  initialStreamIndex,
  isMissingLibraryError,
  type MegaMenuCategory,
  type MegaMenuStream,
} from "./mega-menu-model";
import { openNotifyForm, useHeaderLinkNavigation, useMegaMenuTexts, useMegaMenuTree } from "./header-hooks";
import { desktopNavItemClasses } from "./header-variants";
import { AvailabilityDot, AvailabilityLegend, ComingSoonTag, MegaItemIcon } from "./MegaMenuParts";
import { EDITORIAL_OPEN_UNDERLINE, editorialChevronClasses, editorialNavItemClasses } from "./header-chrome";
import * as ED from "./mega-menu-editorial";

/**
 * Desktop header nav item that opens the "Knowledge Streams" mega menu: a
 * disclosure button (aria-expanded / aria-controls) followed in the DOM by its
 * panel, so Tab moves from the button straight into the panel. The panel is
 * positioned against the fixed <header>, full width under it.
 *
 * Open: click. Close: click again, Esc (focus returns to the button), a click
 * outside, focus leaving the menu, or any route change. Inside: pointing at or
 * focusing a tile selects its stream; arrow keys move between tiles (one tab
 * stop for the row), Tab continues into the selected stream's detail panel.
 * On touch, the first tap on a tile selects it and the second follows it.
 *
 * When the library is gone (the public tree answers 404 — it was deleted),
 * the item turns into a plain nav button that follows its own route; it is
 * the same element, so keyboard focus stays on it.
 */

export interface MegaMenuNavItemProps {
  /** Nav label as shown (in the visitor's language). */
  label: string;
  /** Menu config as rendered — its texts are already in the visitor's language. */
  config: HeaderMegaMenuConfig;
  /** Authored config — library and link patterns come from here. */
  baseConfig: HeaderMegaMenuConfig;
  instituteId: string | null | undefined;
  tagName: string;
  activeStyle?: unknown;
  /** The item's own route is the current page. */
  routeActive?: boolean;
  /** What a plain nav item would do and show — used once the library is gone (404). */
  plainLink?: { onClick: () => void; active: boolean };
  /** Header navStyle "editorial": text trigger, bold gold + accent underline while open. Absent = original. */
  navStyle?: "editorial";
  /** Header megaMenuStyle "editorial": the design's panel (mega-menu-editorial.ts). Absent = original. */
  panelStyle?: "editorial";
}

const LG_TILE_COLUMNS = [
  "lg:grid-cols-1",
  "lg:grid-cols-2",
  "lg:grid-cols-3",
  "lg:grid-cols-4",
  "lg:grid-cols-5",
  "lg:grid-cols-6",
];

export const MegaMenuNavItem: React.FC<MegaMenuNavItemProps> = ({
  label,
  config,
  baseConfig,
  instituteId,
  tagName,
  activeStyle,
  routeActive = false,
  plainLink,
  navStyle,
  panelStyle,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const location = useLocation();
  const { resolve, onLinkClick } = useHeaderLinkNavigation(tagName);
  const texts = useMegaMenuTexts(config, siteT);

  const [open, setOpen] = useState(false);
  // Fetch on intent: the first hover / focus / click arms the query.
  const [armed, setArmed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLElement | null>>([]);
  const pointerTypeRef = useRef<string | null>(null);

  const edNav = navStyle === "editorial";
  const ed = panelStyle === "editorial";

  const reactId = useId();
  const triggerId = `mega-trigger-${reactId}`;
  const panelId = `mega-panel-${reactId}`;
  const headingId = `mega-categories-${reactId}`;

  const libraryId = (baseConfig.libraryId || "").trim();
  // The library this item already found deleted. Remembered so the query
  // stops: a refetch of a query without data briefly drops its error, which
  // would bring the caret back for a moment.
  const [goneLibrary, setGoneLibrary] = useState<string | null>(null);
  const knownGone = !!libraryId && goneLibrary === libraryId;
  const query = useMegaMenuTree(instituteId, libraryId, armed && !knownGone);
  const model = useMemo(() => buildMegaMenuModel(query.data, baseConfig), [query.data, baseConfig]);
  const status: "loading" | "error" | "ready" =
    !instituteId || !libraryId ? "loading" : query.data ? "ready" : query.isError ? "error" : "loading";
  // A deleted library: there is no menu to show, so the item is a plain link from now on.
  const libraryGone = knownGone || (!query.data && isMissingLibraryError(query.error));

  const streamParam = readSearchParam(location.searchStr, URL_PARAMS.stream);
  const pickedIndex = selectedId ? model.streams.findIndex((s) => s.id === selectedId) : -1;
  const selectedIndex = pickedIndex >= 0 ? pickedIndex : initialStreamIndex(model.streams, streamParam);
  const selected: MegaMenuStream | undefined = model.streams[selectedIndex];

  const arm = useCallback(() => setArmed(true), []);

  const toggle = () => {
    setArmed(true);
    if (!open) setSelectedId(null); // reopen on the current page's stream
    setOpen(!open);
  };

  // Any navigation closes the menu (including Back/Forward).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.searchStr]);

  // The 404 can land while the panel shows its skeleton (a tap opens and
  // fetches at once): close it, the button below is a plain link now.
  useEffect(() => {
    if (!libraryGone) return;
    setOpen(false);
    setGoneLibrary(libraryId);
  }, [libraryGone, libraryId]);

  // Esc closes; focus goes back to the button when it was inside the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      const inside = !!active && (active === triggerRef.current || !!panelRef.current?.contains(active));
      setOpen(false);
      if (inside) triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // A click or tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Tabbing out of the menu closes it. A blur with no next target (a click on
  // empty panel space, the window losing focus) is left to the click handler.
  const onBlurWithin = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next) return;
    if (triggerRef.current?.contains(next) || panelRef.current?.contains(next)) return;
    setOpen(false);
  };

  // Hover and focus select a tile — except on touch, where the browser fires
  // emulated hover/focus right before the click: the tap itself selects
  // (onTileClick), so the first tap shows the stream instead of leaving.
  const select = (stream: MegaMenuStream) => {
    if (pointerTypeRef.current === "touch") return;
    setSelectedId(stream.id);
  };

  const notify = (audienceId: string, title: string) => {
    setOpen(false);
    openNotifyForm(audienceId, title);
  };

  const follow = (link: HeaderLink, e: React.MouseEvent) => {
    onLinkClick(link, e);
    setOpen(false);
  };

  const onTileClick = (e: React.MouseEvent, stream: MegaMenuStream, index: number) => {
    const touchFirstTap = pointerTypeRef.current === "touch" && index !== selectedIndex;
    pointerTypeRef.current = null;
    if (touchFirstTap) {
      e.preventDefault();
      setSelectedId(stream.id);
      return;
    }
    if (stream.action.kind === "link") follow(resolve(stream.action.link), e);
    else if (stream.action.kind === "notify") notify(stream.action.audienceId, siteT(stream.title));
    else setSelectedId(stream.id);
  };

  // One tab stop for the tile row; arrows move between tiles (mirrored in RTL).
  const onTilesKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const count = model.streams.length;
    if (!count) return;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let next: number;
    switch (e.key) {
      case "ArrowRight":
        next = selectedIndex + (rtl ? -1 : 1);
        break;
      case "ArrowLeft":
        next = selectedIndex + (rtl ? 1 : -1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    next = (next + count) % count;
    pointerTypeRef.current = null;
    setSelectedId(model.streams[next].id);
    tileRefs.current[next]?.focus();
  };

  const eyebrow = (config.eyebrow || "").trim();
  const helpLabel = (config.helpLabel || "").trim();
  const helpLink = helpLabel ? routeHeaderLink(baseConfig.helpRoute) : null;
  const footnote = (config.footnote || "").trim();

  const tileClass = (isSelected: boolean) =>
    ed ? ED.editorialTileClass(isSelected) : cn(
      "flex h-full w-full flex-col items-center gap-2 rounded-catalogue-xl border-2 px-3 py-4 text-center transition-colors duration-200",
      isSelected ? "border-primary-500 bg-primary-50" : "border-transparent hover:bg-catalogue-interactive-hover",
    );

  const tileContent = (stream: MegaMenuStream, isSelected = false) =>
    ed ? (
      <>
        <MegaItemIcon item={stream} className={ED.EDITORIAL_TILE_ICON} initialClassName="text-4xl" />
        <span className={ED.editorialTileName(isSelected)}>{siteT(stream.title)}</span>
        {stream.subtitle && <span className={ED.editorialTileSub(isSelected)}>{siteT(stream.subtitle)}</span>}
        {stream.comingSoon && <ComingSoonTag />}
      </>
    ) : (
    <>
      <MegaItemIcon item={stream} className="size-16" initialClassName="text-xl" />
      <span className="text-sm font-bold text-catalogue-text-primary">{siteT(stream.title)}</span>
      {stream.subtitle && (
        <span className="text-caption font-medium uppercase tracking-wider text-catalogue-text-muted">
          {siteT(stream.subtitle)}
        </span>
      )}
      {stream.comingSoon && <ComingSoonTag />}
    </>
  );

  const renderTile = (stream: MegaMenuStream, index: number) => {
    const isSelected = index === selectedIndex;
    const shared = {
      ref: (el: HTMLElement | null) => {
        tileRefs.current[index] = el;
      },
      tabIndex: isSelected ? 0 : -1,
      onPointerEnter: (e: React.PointerEvent) => {
        pointerTypeRef.current = e.pointerType;
        select(stream);
      },
      onFocus: () => select(stream),
      onPointerDown: (e: React.PointerEvent) => {
        pointerTypeRef.current = e.pointerType;
      },
      onClick: (e: React.MouseEvent) => onTileClick(e, stream, index),
      className: tileClass(isSelected),
    };
    if (stream.action.kind === "link") {
      const link = resolve(stream.action.link);
      return (
        <a
          {...shared}
          href={link.href}
          target={link.external ? "_blank" : undefined}
          rel={link.external ? "noopener noreferrer" : undefined}
        >
          {tileContent(stream, isSelected)}
        </a>
      );
    }
    return (
      <button {...shared} type="button">
        {tileContent(stream, isSelected)}
      </button>
    );
  };

  const rowClass = (interactive: boolean) =>
    ed ? ED.editorialRowClass(interactive) : cn(
      "group flex w-full items-center gap-3 rounded-catalogue-lg px-3 py-2.5 text-start transition-colors duration-200",
      interactive && "hover:bg-catalogue-bg-elevated focus-visible:bg-catalogue-bg-elevated",
    );

  const rowContent = (cat: MegaMenuCategory) =>
    ed ? (
      <>
        <MegaItemIcon item={cat} className={ED.EDITORIAL_ROW_ICON} initialClassName="text-sm" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={ED.editorialRowTitle(cat.comingSoon)}>{siteT(cat.title)}</span>
            {cat.subtitle && <span className={ED.editorialRowSubtitle(cat.comingSoon)}>{siteT(cat.subtitle)}</span>}
            {cat.comingSoon && <ComingSoonTag />}
          </span>
          {cat.description && <span className={ED.EDITORIAL_ROW_TEXT}>{siteT(cat.description)}</span>}
        </span>
        {cat.action.kind !== "none" && <ArrowRight aria-hidden="true" weight="bold" className={ED.EDITORIAL_ROW_ARROW} />}
      </>
    ) : (
    <>
      <MegaItemIcon item={cat} className="size-9" initialClassName="text-sm" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {config.showLegend && <AvailabilityDot comingSoon={cat.comingSoon} />}
          <span className={cn("text-sm font-semibold", cat.comingSoon ? "text-catalogue-text-muted" : "text-catalogue-brand-ink")}>
            {siteT(cat.title)}
          </span>
          {cat.subtitle && (
            <span
              className={cn(
                "text-sm font-medium",
                cat.comingSoon ? "text-catalogue-text-muted" : "text-catalogue-text-primary",
              )}
            >
              {siteT(cat.subtitle)}
            </span>
          )}
          {cat.comingSoon && <ComingSoonTag />}
        </span>
        {cat.description && (
          <span className="mt-0.5 block truncate text-xs text-catalogue-text-muted">{siteT(cat.description)}</span>
        )}
      </span>
      {cat.action.kind !== "none" && (
        <ArrowRight
          aria-hidden="true"
          className="size-4 shrink-0 text-catalogue-text-muted transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
        />
      )}
    </>
  );

  const renderCategory = (cat: MegaMenuCategory) => {
    if (cat.action.kind === "link") {
      const link = resolve(cat.action.link);
      return (
        <a
          href={link.href}
          target={link.external ? "_blank" : undefined}
          rel={link.external ? "noopener noreferrer" : undefined}
          onClick={(e) => follow(link, e)}
          className={rowClass(true)}
        >
          {rowContent(cat)}
        </a>
      );
    }
    if (cat.action.kind === "notify") {
      const { audienceId } = cat.action;
      return (
        <button type="button" onClick={() => notify(audienceId, siteT(cat.title))} className={rowClass(true)}>
          {rowContent(cat)}
          <span className="sr-only">{t("header.megaMenu.notifyMe", "Notify me")}</span>
        </button>
      );
    }
    return <div className={rowClass(false)}>{rowContent(cat)}</div>;
  };

  const renderCta = (stream: MegaMenuStream) => {
    if (stream.action.kind === "link") {
      const link = resolve(stream.action.link);
      return (
        <a
          href={link.href}
          target={link.external ? "_blank" : undefined}
          rel={link.external ? "noopener noreferrer" : undefined}
          onClick={(e) => follow(link, e)}
          className={ed ? ED.EDITORIAL_DETAIL_CTA : "catalogue-btn catalogue-btn-primary mt-1"}
        >
          {texts.ctaLabel(stream)}
          <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </a>
      );
    }
    if (stream.action.kind === "notify") {
      const { audienceId } = stream.action;
      return (
        <button
          type="button"
          onClick={() => notify(audienceId, siteT(stream.title))}
          className={ed ? ED.EDITORIAL_DETAIL_CTA : "catalogue-btn catalogue-btn-primary mt-1"}
        >
          {t("header.megaMenu.notifyMe", "Notify me")}
        </button>
      );
    }
    return stream.comingSoon ? <ComingSoonTag className="mt-1" /> : null;
  };

  const renderBody = () => {
    if (status === "loading") {
      return (
        <div aria-busy="true" className="mt-5 grid grid-cols-3 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="catalogue-skeleton-shimmer h-32 rounded-catalogue-xl" />
          ))}
          <span className="sr-only">{t("header.megaMenu.loading", "Loading…")}</span>
        </div>
      );
    }
    if (status === "error") {
      return (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center gap-3 rounded-catalogue-lg border border-catalogue-border p-4 text-sm text-catalogue-text-secondary"
        >
          {t("header.megaMenu.error", "We couldn't load this menu.")}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
          >
            {t("header.megaMenu.retry", "Try again")}
          </button>
        </div>
      );
    }
    if (!model.streams.length || !selected) {
      return <p className="mt-5 text-sm text-catalogue-text-muted">{t("header.megaMenu.empty", "Nothing to show here yet.")}</p>;
    }
    if (ed) {
      return (
        <>
          <ul onKeyDown={onTilesKeyDown} className={cn(ED.EDITORIAL_TILES, LG_TILE_COLUMNS[Math.min(model.streams.length, 6) - 1])}>
            {model.streams.map((stream, index) => (
              <li key={stream.id}>{renderTile(stream, index)}</li>
            ))}
          </ul>

          <div className={ED.EDITORIAL_DETAIL}>
            <div className={ED.EDITORIAL_DETAIL_LEFT}>
              <p className={ED.EDITORIAL_DETAIL_TITLE}>
                <MegaItemIcon item={selected} className={ED.EDITORIAL_DETAIL_ICON} initialClassName="text-xl" />
                <span>{siteT(selected.title)}</span>
                {selected.subtitle && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{siteT(selected.subtitle)}</span>
                  </>
                )}
              </p>
              {selected.tagline && <p className={ED.EDITORIAL_DETAIL_TAGLINE}>{siteT(selected.tagline)}</p>}
              {selected.description && <p className={ED.EDITORIAL_DETAIL_TEXT}>{siteT(selected.description)}</p>}
              {renderCta(selected)}
            </div>

            <div className={ED.EDITORIAL_DETAIL_RIGHT}>
              <p id={headingId} className={ED.EDITORIAL_CATEGORIES_HEADING}>
                {texts.categoriesHeading(selected)}
              </p>
              {selected.categories.length ? (
                <ul aria-labelledby={headingId} className={ED.EDITORIAL_CATEGORY_LIST}>
                  {selected.categories.map((cat) => (
                    <li key={cat.id}>{renderCategory(cat)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-palette-muted">
                  {t("header.megaMenu.noCategories", "Categories are on their way.")}
                </p>
              )}
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        <ul
          onKeyDown={onTilesKeyDown}
          className={cn("mt-5 grid grid-cols-3 gap-3", LG_TILE_COLUMNS[Math.min(model.streams.length, 6) - 1])}
        >
          {model.streams.map((stream, index) => (
            <li key={stream.id}>{renderTile(stream, index)}</li>
          ))}
        </ul>

        <div className="mt-5 grid gap-6 rounded-catalogue-2xl bg-primary-50 p-6 lg:grid-cols-5 lg:gap-8">
          <div className="flex flex-col items-start gap-3 lg:col-span-2">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <MegaItemIcon item={selected} className="size-8" initialClassName="text-sm" />
              <span className="text-catalogue-text-primary">{siteT(selected.title)}</span>
              {selected.subtitle && (
                <>
                  <span aria-hidden="true" className="text-catalogue-text-muted">
                    ·
                  </span>
                  <span className="text-catalogue-text-secondary">{siteT(selected.subtitle)}</span>
                </>
              )}
            </p>
            {selected.tagline && <p className="catalogue-h3 text-catalogue-text-primary">{siteT(selected.tagline)}</p>}
            {selected.description && (
              <p className="text-sm leading-relaxed text-catalogue-text-secondary">{siteT(selected.description)}</p>
            )}
            {renderCta(selected)}
          </div>

          <div className="lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id={headingId} className="text-xs font-semibold uppercase tracking-wider text-catalogue-text-muted">
                {texts.categoriesHeading(selected)}
              </p>
              {config.showLegend && <AvailabilityLegend />}
            </div>
            {selected.categories.length ? (
              <ul aria-labelledby={headingId} className="mt-3 grid gap-1">
                {selected.categories.map((cat) => (
                  <li key={cat.id}>{renderCategory(cat)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-catalogue-text-muted">
                {t("header.megaMenu.noCategories", "Categories are on their way.")}
              </p>
            )}
          </div>
        </div>
      </>
    );
  };

  // The panel's rows: eyebrow + help link, the body, the footnote.
  const panelContent = () => (
    <>
      {(eyebrow || helpLink) && (
        <div className={ed ? ED.EDITORIAL_TOP_ROW : "flex flex-wrap items-center justify-between gap-3"}>
          {eyebrow ? (
            ed ? (
              <p className={ED.EDITORIAL_EYEBROW}>
                <span aria-hidden="true" className={ED.EDITORIAL_EYEBROW_RULE} />
                {eyebrow}
              </p>
            ) : (
            // catalogue-eyebrow draws the leading rule itself.
            <p className="catalogue-eyebrow text-catalogue-text-muted">{eyebrow}</p>
            )
          ) : (
            <span />
          )}
          {helpLink &&
            (() => {
              const link = resolve(helpLink);
              return (
                <a
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noopener noreferrer" : undefined}
                  onClick={(e) => follow(link, e)}
                  className={ed ? ED.EDITORIAL_HELP_LINK : "catalogue-link inline-flex items-center gap-1 text-sm font-medium"}
                >
                  {helpLabel}
                  <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
                </a>
              );
            })()}
        </div>
      )}
      {renderBody()}
      {/* Only under real tiles, never beside a loading, error or empty state. */}
      {footnote && status === "ready" && model.streams.length > 0 && (
        <p className={ed ? ED.EDITORIAL_FOOTNOTE : "mt-3 text-caption text-catalogue-text-muted"}>{footnote}</p>
      )}
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-expanded={libraryGone ? undefined : open}
        aria-controls={libraryGone ? undefined : panelId}
        onClick={libraryGone ? plainLink?.onClick : toggle}
        onPointerEnter={arm}
        onFocus={arm}
        onBlur={onBlurWithin}
        className={
          edNav
            ? libraryGone
              ? editorialNavItemClasses(!!plainLink?.active)
              : `${editorialNavItemClasses(open)} gap-1.5`
            : libraryGone
            ? // The plain nav item's own classes.
              `px-4 py-2 rounded-catalogue-sm text-sm font-medium transition-colors duration-200 ${desktopNavItemClasses(!!plainLink?.active, activeStyle)}`
            : `inline-flex items-center gap-1 px-4 py-2 rounded-catalogue-sm text-sm font-medium transition-colors duration-200 ${desktopNavItemClasses(open || routeActive, activeStyle)}`
        }
      >
        {edNav ? (
          // The open underline spans the label only, on the header's bottom edge.
          <span className="relative inline-flex h-full items-center">
            {label}
            {open && !libraryGone && <span aria-hidden="true" className={EDITORIAL_OPEN_UNDERLINE} />}
          </span>
        ) : (
          label
        )}
        {!libraryGone &&
          (edNav ? (
            <svg aria-hidden="true" viewBox="0 0 10 6" fill="none" className={editorialChevronClasses(open)}>
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <CaretDown
              aria-hidden="true"
              weight="bold"
              className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
            />
          ))}
      </button>
      {open && !libraryGone && ed && <div aria-hidden="true" className={ED.EDITORIAL_DIM} />}
      {open && !libraryGone && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          onBlur={onBlurWithin}
          className={ed ? ED.EDITORIAL_PANEL : "absolute start-0 end-0 top-full z-catalogue-dropdown max-h-screen-80 overflow-y-auto overscroll-contain rounded-b-catalogue-2xl border-b border-catalogue-border bg-catalogue-bg-elevated shadow-xl animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"}
        >
          {ed ? (
            <div className={ED.EDITORIAL_PANEL_OUTER}>
              <div className={ED.EDITORIAL_PANEL_INNER}>{panelContent()}</div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">{panelContent()}</div>
          )}
        </div>
      )}
    </>
  );
};

export default MegaMenuNavItem;

import React, { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useSiteT } from "../../-utils/catalogue-locale";
import type { HeaderMegaMenuConfig } from "../../-types/course-catalogue-types";
import type { HeaderLink } from "./header-links";
import {
  buildMegaMenuModel,
  isMissingLibraryError,
  type MegaMenuCategory,
  type MegaMenuStream,
} from "./mega-menu-model";
import { openNotifyForm, useHeaderLinkNavigation, useMegaMenuTexts, useMegaMenuTree } from "./header-hooks";
import { ComingSoonTag, MegaItemIcon } from "./MegaMenuParts";

/**
 * The mega menu inside the phone hamburger menu: the nav item expands into
 * its streams, and a stream expands into its categories plus its CTA (one
 * stream open at a time). Same data, links and coming-soon rules as the
 * desktop panel. Once its library turns out to be gone (404), the item is a
 * plain nav item that follows its own route.
 */

export interface MobileMegaMenuProps {
  label: string;
  config: HeaderMegaMenuConfig;
  baseConfig: HeaderMegaMenuConfig;
  instituteId: string | null | undefined;
  tagName: string;
  /** Classes of the menu's other nav items, so this one lines up with them. */
  itemClassName: string;
  /** Closes the hamburger menu after a link or form is opened. */
  onDone: () => void;
  /** What a plain nav item would do and look like — used once the library is gone (404). */
  plainLink?: { onClick: () => void; className: string };
}

export const MobileMegaMenu: React.FC<MobileMegaMenuProps> = ({
  label,
  config,
  baseConfig,
  instituteId,
  tagName,
  itemClassName,
  onDone,
  plainLink,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const { resolve, onLinkClick } = useHeaderLinkNavigation(tagName);
  const texts = useMegaMenuTexts(config, siteT);
  const [open, setOpen] = useState(false);
  const [openStreamId, setOpenStreamId] = useState<string | null>(null);
  const listId = `mobile-mega-${useId()}`;

  const libraryId = (baseConfig.libraryId || "").trim();
  // Remembered once found deleted (see MegaMenuNavItem: a refetch would
  // briefly drop the error).
  const [goneLibrary, setGoneLibrary] = useState<string | null>(null);
  const knownGone = !!libraryId && goneLibrary === libraryId;
  const query = useMegaMenuTree(instituteId, libraryId, open && !knownGone);
  const model = useMemo(() => buildMegaMenuModel(query.data, baseConfig), [query.data, baseConfig]);
  const libraryGone = knownGone || (!query.data && isMissingLibraryError(query.error));
  // Collapse when the 404 lands: the item is a plain link from now on.
  useEffect(() => {
    if (!libraryGone) return;
    setOpen(false);
    setGoneLibrary(libraryId);
  }, [libraryGone, libraryId]);

  const follow = (link: HeaderLink, e: React.MouseEvent) => {
    onLinkClick(link, e);
    onDone();
  };
  const notify = (audienceId: string, title: string) => {
    onDone();
    openNotifyForm(audienceId, title);
  };

  const anchorProps = (link: HeaderLink) => ({
    href: link.href,
    target: link.external ? "_blank" : undefined,
    rel: link.external ? "noopener noreferrer" : undefined,
    onClick: (e: React.MouseEvent) => follow(link, e),
  });

  const renderCategory = (cat: MegaMenuCategory) => {
    const content = (
      <>
        <MegaItemIcon item={cat} className="size-7" initialClassName="text-xs" />
        <span className="min-w-0 flex-1">
          <span className={cn("text-sm font-semibold", cat.comingSoon ? "text-catalogue-text-muted" : "text-catalogue-brand-ink")}>
            {siteT(cat.title)}
          </span>
          {cat.subtitle && (
            <span
              className={cn(
                "ms-2 text-sm font-medium",
                cat.comingSoon ? "text-catalogue-text-muted" : "text-catalogue-text-primary",
              )}
            >
              {siteT(cat.subtitle)}
            </span>
          )}
        </span>
        {cat.comingSoon && <ComingSoonTag />}
      </>
    );
    const rowClass = "flex w-full items-center gap-2 rounded-catalogue-sm px-2 py-2 text-start";
    if (cat.action.kind === "link") {
      return (
        <a {...anchorProps(resolve(cat.action.link))} className={cn(rowClass, "hover:bg-catalogue-interactive-hover")}>
          {content}
        </a>
      );
    }
    if (cat.action.kind === "notify") {
      const { audienceId } = cat.action;
      return (
        <button
          type="button"
          onClick={() => notify(audienceId, siteT(cat.title))}
          className={cn(rowClass, "hover:bg-catalogue-interactive-hover")}
        >
          {content}
          <span className="sr-only">{t("header.megaMenu.notifyMe", "Notify me")}</span>
        </button>
      );
    }
    return <div className={rowClass}>{content}</div>;
  };

  const renderCta = (stream: MegaMenuStream) => {
    const ctaClass = "catalogue-btn catalogue-btn-primary catalogue-btn-sm mt-2 w-full justify-center";
    if (stream.action.kind === "link") {
      return (
        <a {...anchorProps(resolve(stream.action.link))} className={ctaClass}>
          {texts.ctaLabel(stream)}
          <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </a>
      );
    }
    if (stream.action.kind === "notify") {
      const { audienceId } = stream.action;
      return (
        <button type="button" onClick={() => notify(audienceId, siteT(stream.title))} className={ctaClass}>
          {t("header.megaMenu.notifyMe", "Notify me")}
        </button>
      );
    }
    return null;
  };

  const renderStreams = () => {
    if (!query.data) {
      if (query.isError) {
        return (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-catalogue-text-secondary">
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
      return (
        <div aria-busy="true" className="space-y-2 px-3 py-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="catalogue-skeleton-shimmer h-10 rounded-catalogue-md" />
          ))}
          <span className="sr-only">{t("header.megaMenu.loading", "Loading…")}</span>
        </div>
      );
    }
    if (!model.streams.length) {
      return (
        <p className="px-3 py-2 text-sm text-catalogue-text-muted">
          {t("header.megaMenu.empty", "Nothing to show here yet.")}
        </p>
      );
    }
    return (
      <ul className="space-y-1">
        {model.streams.map((stream) => {
          const expanded = openStreamId === stream.id;
          const panelId = `${listId}-${stream.id}`;
          return (
            <li key={stream.id}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpenStreamId(expanded ? null : stream.id)}
                className="flex w-full items-center gap-3 rounded-catalogue-md px-3 py-2 text-start hover:bg-catalogue-interactive-hover"
              >
                <MegaItemIcon item={stream} className="size-9" initialClassName="text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-catalogue-text-primary">{siteT(stream.title)}</span>
                  {stream.subtitle && (
                    <span className="block text-caption font-medium uppercase tracking-wider text-catalogue-text-muted">
                      {siteT(stream.subtitle)}
                    </span>
                  )}
                </span>
                {stream.comingSoon && <ComingSoonTag />}
                <CaretDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-catalogue-text-muted transition-transform duration-200",
                    expanded && "rotate-180",
                  )}
                />
              </button>
              {expanded && (
                <div id={panelId} className="ms-12 pb-2">
                  {stream.categories.length ? (
                    <ul className="space-y-0.5">
                      {stream.categories.map((cat) => (
                        <li key={cat.id}>{renderCategory(cat)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-2 py-1 text-sm text-catalogue-text-muted">
                      {t("header.megaMenu.noCategories", "Categories are on their way.")}
                    </p>
                  )}
                  {renderCta(stream)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  // Same element in both modes, so focus stays on it when the 404 lands.
  return (
    <div>
      <button
        type="button"
        aria-expanded={libraryGone ? undefined : open}
        aria-controls={libraryGone ? undefined : listId}
        onClick={libraryGone ? plainLink?.onClick : () => setOpen((v) => !v)}
        className={libraryGone ? plainLink?.className : cn(itemClassName, "flex items-center justify-between gap-2")}
      >
        <span>{label}</span>
        {!libraryGone && (
          <CaretDown
            aria-hidden="true"
            className={cn("size-4 shrink-0 transition-transform duration-200", open && "rotate-180")}
          />
        )}
      </button>
      {open && !libraryGone && (
        <div id={listId} className="mt-1 ps-2">
          {renderStreams()}
        </div>
      )}
    </div>
  );
};

export default MobileMegaMenu;

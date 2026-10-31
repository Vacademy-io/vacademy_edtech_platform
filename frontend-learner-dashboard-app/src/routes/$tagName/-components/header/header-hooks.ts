import React, { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { fetchPublicFolderTree } from "../../-services/folder-library-service";
import { RouteMatcher } from "../../-services/route-matcher";
import type { HeaderMegaMenuConfig } from "../../-types/course-catalogue-types";
import { carrySearchParams, fillTextPattern, toAppHref, type HeaderLink } from "./header-links";
import { isMissingLibraryError, streamTextValues, type MegaMenuStream } from "./mega-menu-model";

/** A deleted / unknown library is a 404 — retrying will not change that. */
export const retryUnlessMissingLibrary = (count: number, err: unknown): boolean =>
  !isMissingLibraryError(err) && count < 2;

/**
 * The mega menu's folder library. Same query key and fetcher as the Folder
 * Browser section, so a page showing both makes one request. Fetched on
 * intent (`enabled` flips true when the visitor points at, focuses or opens
 * the menu), never on page load.
 */
export const useMegaMenuTree = (
  instituteId: string | null | undefined,
  libraryId: string | null | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, libraryId],
    queryFn: () => fetchPublicFolderTree(instituteId!, libraryId!),
    enabled: enabled && !!instituteId && !!libraryId,
    staleTime: 5 * 60_000,
    retry: retryUnlessMissingLibrary,
  });

/** Plain left click — anything else (new tab, new window, download) is left to the browser. */
export const isPlainLeftClick = (e: React.MouseEvent): boolean =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * Turns a header link into what this host serves and follows it inside the
 * SPA. `resolve` maps a site path onto the host (tag prefix or root mount) and
 * keeps the visitor's ?lang=; external links are left alone (they open in a
 * new tab through their anchor).
 */
export const useHeaderLinkNavigation = (tagName: string) => {
  const navigate = useNavigate();
  const location = useLocation();
  const searchStr = location.searchStr || "";

  const resolve = useCallback(
    (link: HeaderLink): HeaderLink =>
      link.external
        ? link
        : {
            href: carrySearchParams(
              toAppHref(link.href, { tagName, pagePath: (route) => RouteMatcher.pagePath(tagName, route) }),
              searchStr,
            ),
            external: false,
          },
    [tagName, searchStr],
  );

  /** Follows an already-resolved internal link (router navigation, scroll reset, search middlewares). */
  const go = useCallback(
    (resolved: HeaderLink) => {
      if (resolved.external) {
        window.open(resolved.href, "_blank", "noopener,noreferrer");
        return;
      }
      void navigate({ href: resolved.href });
    },
    [navigate],
  );

  /** onClick for an <a href={resolved.href}>: SPA navigation for plain clicks only. */
  const onLinkClick = useCallback(
    (resolved: HeaderLink, e: React.MouseEvent) => {
      if (resolved.external || !isPlainLeftClick(e)) return;
      e.preventDefault();
      go(resolved);
    },
    [go],
  );

  return { resolve, go, onLinkClick };
};

/**
 * The stream's CTA label and the categories heading, from the author's
 * patterns or the chrome defaults. `config` holds the props as rendered
 * (already in the visitor's language); `translate` is useSiteT.
 */
export const useMegaMenuTexts = (config: HeaderMegaMenuConfig, translate: (s: string) => string) => {
  const { t } = useTranslation("coursePlayerB");
  return {
    ctaLabel: (stream: MegaMenuStream): string => {
      if (stream.ctaLabel) return translate(stream.ctaLabel);
      const values = streamTextValues(stream, translate);
      const pattern = (config.ctaLabelPattern || "").trim();
      // ctaLabelPattern is not walked by the page-level localization (its key
      // reads as data), so it goes through the dictionary here.
      return pattern
        ? fillTextPattern(translate(pattern), values)
        : t("header.megaMenu.explore", { defaultValue: "Explore {{stream}}", stream: values.stream });
    },
    categoriesHeading: (stream: MegaMenuStream): string => {
      const values = streamTextValues(stream, translate);
      const pattern = (config.categoriesHeading || "").trim();
      return pattern
        ? fillTextPattern(pattern, values)
        : t("header.megaMenu.categoriesIn", { defaultValue: "Categories in {{stream}}", stream: values.stream });
    },
  };
};

/**
 * Opens a coming-soon item's "notify me" form through the page shell's
 * AudienceFormModal (the same event every catalogue button uses).
 */
export const openNotifyForm = (audienceId: string, title: string) => {
  window.dispatchEvent(new CustomEvent("openAudienceForm", { detail: { audienceId, title } }));
};

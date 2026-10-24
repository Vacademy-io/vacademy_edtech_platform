import React from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { translateText } from "../-utils/catalogue-i18n";
import { useCatalogueLocale } from "../-utils/catalogue-locale";
import { computeCatalogueSeo, pageSeoOf } from "../-utils/catalogue-seo";

/**
 * The institute's own tab title (white-label branding), from the same
 * localStorage mirror the boot script in index.html applies before React
 * starts. Read from storage — never from document.title, which this
 * component itself writes.
 */
const readBrandTabText = (): string | null => {
  try {
    const raw = localStorage.getItem("TabBranding");
    const parsed = raw ? (JSON.parse(raw) as { tabText?: unknown }) : null;
    return typeof parsed?.tabText === "string" && parsed.tabText.trim() ? parsed.tabText.trim() : null;
  } catch {
    return null;
  }
};

interface CatalogueSeoHeadProps {
  /** The catalogue page on screen (its `seo` block, when the editor set one). */
  page?: unknown;
  instituteName?: string | null;
  /**
   * Ignored: the page shells compute these outside CatalogueLocaleProvider,
   * where they cannot follow the site language — this component reads the
   * institute's words for course / courses itself, inside it.
   * @deprecated Stop passing them.
   */
  course?: string;
  courses?: string;
}

/**
 * <title>, description and og:* for a catalogue page, in the visitor's site
 * language. Rendered inside CatalogueLocaleProvider, so both the chrome
 * fallbacks (react-i18next) and the authored page SEO follow ?lang=. A blog
 * post's own Helmet, rendered further down the tree, still wins.
 *
 * Only for a site with languages (globalSettings.i18n.enabled): any other
 * site keeps its original head — the catalogue home's document.title rule,
 * and no title from sub-pages (CourseCataloguePage / CourseSubPage).
 */
export const CatalogueSeoHead: React.FC<CatalogueSeoHeadProps> = ({ page, instituteName }) => {
  const { t } = useTranslation("coursePlayerA");
  const { dict } = useCatalogueLocale();
  // Read here, inside the provider, so the term is in the site language like
  // the sentence around it — on the first render and after a switch too.
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const institute = instituteName ? translateText(instituteName, dict) : "";
  const seo = computeCatalogueSeo({
    pageSeo: pageSeoOf(page),
    tabText: readBrandTabText(),
    instituteName,
    defaultTitle: t("courseCataloguePage.defaultTitle", { course }),
    defaultDescription: institute
      ? t("courseCataloguePage.seoDescriptionWithInstitute", { courses, institute })
      : t("courseCataloguePage.seoDescription", { courses }),
    dict,
  });
  return (
    <Helmet>
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      <meta property="og:title" content={seo.ogTitle} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:type" content="website" />
    </Helmet>
  );
};

export default CatalogueSeoHead;

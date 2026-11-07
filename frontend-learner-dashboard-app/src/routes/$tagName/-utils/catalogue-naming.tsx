import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useCatalogueLocale } from "./catalogue-locale";

/**
 * A catalogue's own words for a course, read straight from its config.
 *
 * Deliberately NOT written into the shared naming-settings store. That store is
 * the institute's, shared by every surface and every catalogue it owns, and
 * seeding it from one catalogue would leak that catalogue's vocabulary across
 * the whole app for the rest of the browser session. This stays a read-only
 * override scoped to the React tree the catalogue renders.
 *
 * Falls through to the institute's terminology for anything the catalogue does
 * not set, so a catalogue with no `naming` block behaves exactly as before.
 *
 * The words are written in the site's BASE language. A site with languages
 * shows them in another language only where its dictionary translates them;
 * otherwise the institute's term in that language (getTerminology resolves in
 * the site language under CatalogueLocaleProvider) — never an English word on
 * a हिन्दी page.
 */
export interface CatalogueNaming {
  course?: string;
  coursePlural?: string;
  /** Headings of the catalogue's Level / Session filters (e.g. "Format"). */
  level?: string;
  levelPlural?: string;
  session?: string;
  sessionPlural?: string;
}

const CatalogueNamingContext = createContext<CatalogueNaming | undefined>(undefined);

export const CatalogueNamingProvider = ({
  naming,
  children,
}: {
  naming: CatalogueNaming | undefined;
  children: ReactNode;
}) => (
  <CatalogueNamingContext.Provider value={naming}>{children}</CatalogueNamingContext.Provider>
);

/** A catalogue word, trimmed; under `translate` only when the dictionary has it. */
const ownWord = (
  value: string | undefined,
  translate: ((text: string) => string) | null
): string | undefined => {
  const word = typeof value === "string" && value.trim() ? value.trim() : undefined;
  if (!word || !translate) return word;
  const shown = translate(word);
  return shown !== word ? shown : undefined;
};

/**
 * The words for one render: the catalogue's own (passed through `translate`
 * when the site renders another language than its base one), else the
 * institute's terminology.
 */
const readCourseTerms = (
  course: string | undefined,
  coursePlural: string | undefined,
  translate: ((text: string) => string) | null
): { course: string; courses: string } => {
  const own = (value: string | undefined) => ownWord(value, translate);
  return {
    course: own(course) ?? getTerminology(ContentTerms.Course, SystemTerms.Course),
    courses: own(coursePlural) ?? getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
  };
};

/** The singular and plural course term for the surface being rendered. */
export const useCourseTerms = (): { course: string; courses: string } => {
  const naming = useContext(CatalogueNamingContext);
  const { enabled, locale, baseLocale, t: siteT } = useCatalogueLocale();
  // Re-renders this component when the chrome's translations change — the
  // site language's terms catalog landing, a switch of language.
  useTranslation();
  const course = naming?.course;
  const coursePlural = naming?.coursePlural;
  // Memoised exactly as before on a site without languages. On one with
  // languages the words are read on every render instead: they follow the
  // visitor's language and a terms catalog that can land after the first one.
  const memoised = useMemo(
    () => (enabled ? null : readCourseTerms(course, coursePlural, null)),
    [enabled, course, coursePlural]
  );
  return memoised ?? readCourseTerms(course, coursePlural, locale !== baseLocale ? siteT : null);
};

/**
 * The catalogue's own headings for its Level / Session filters, or undefined
 * where it sets none (the caller keeps the institute's plural term). The plural
 * wins over the singular; translated like the course word above.
 */
export const useCatalogueFilterHeadings = (): { levels?: string; sessions?: string } => {
  const naming = useContext(CatalogueNamingContext);
  const { locale, baseLocale, t: siteT } = useCatalogueLocale();
  useTranslation();
  const translate = locale !== baseLocale ? siteT : null;
  return {
    levels: ownWord(naming?.levelPlural, translate) ?? ownWord(naming?.level, translate),
    sessions: ownWord(naming?.sessionPlural, translate) ?? ownWord(naming?.session, translate),
  };
};

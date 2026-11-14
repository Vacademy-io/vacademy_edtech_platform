import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogEditorialCardConfig } from "../../../-types/catalog-cards-types";
import { useCatalogueLocale, useSiteT } from "../../../-utils/catalogue-locale";
import { formatLaunchDate, openComingSoonForm, readComingSoon } from "../../../-utils/coming-soon";
import { useCourseFormats } from "../../../-utils/course-format";
import { preferredCourseLanguage } from "../../../-utils/course-variants";
import {
  buildEditorialCardView,
  editorialPriceRow,
  resolveCardDesign,
  type EditorialCardDeps,
} from "./catalog-card-view";
import { buildCatalogCards, cardPriceView, type CatalogRowLike } from "./catalog-cards";
import { normaliseLanguages, resolveCatalogDiscovery, resolveVersionGroups } from "./catalog-config";
import { formatAmountLabel } from "./catalog-format";
import { useCatalogStreams } from "./use-catalog-discovery";
import { EditorialCardSkeleton, EditorialCourseCard } from "./EditorialCourseCard";

/**
 * courseShowcase with cardStyle "editorial" (feature 'cards'): the curated
 * strip drawn with the catalogue's editorial card — Free pill, format pill,
 * stream line, language chips, price and a text CTA. Mounted ONLY for such a
 * showcase, so a default showcase runs none of these hooks.
 *
 * Language versions fold into one card exactly as in the catalogue (same
 * buildCatalogCards) when globalSettings.courseLanguages is on. Folding runs
 * over EVERY fetched course, so a strip that picks only the EN package still
 * shows its HI version's chip; a card is kept when any of its versions was
 * selected, in selection order, and the limit applies after that. The price
 * (Free pill, CTA) speaks for the selected versions, as the catalogue's
 * merged cards speak for the versions matching its filters. Streams come
 * from `streamsLibraryId` (the folder library the catalogue uses), formats
 * from globalSettings.courseFormats.
 */

/** A showcase course as CourseShowcaseComponent maps it (raw fields kept for the card). */
export interface EditorialShowcaseCourse {
  id: string;
  title: string;
  description: string;
  thumbnailId: string;
  price: number;
  currency?: string;
  level?: string;
  tagsRaw?: string | null;
  comingSoonRaw?: unknown;
  availability?: string | null;
}

interface ShowcaseRow extends CatalogRowLike {
  thumbnail: string;
  course: EditorialShowcaseCourse;
}

export const SHOWCASE_EDITORIAL_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4";
export const SHOWCASE_EDITORIAL_GRID_CLASS_4 = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6";

export interface EditorialShowcaseGridProps {
  /** Every course the showcase fetched (language versions fold across all of them). */
  courses: EditorialShowcaseCourse[];
  /** Ids the showcase's source selected, in order (before the limit). */
  selectedIds: readonly string[];
  limit: number;
  loading: boolean;
  /** A card holding any of these courses (one of its language versions) is left out. */
  excludeIds?: readonly string[];
  /** Told how many cards there are once known, so the section can hide when none is left. */
  onCardCount?: (count: number) => void;
  /** Cards per row on large screens (default 3). */
  columns?: 3 | 4;
  card?: CatalogEditorialCardConfig;
  streamsLibraryId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalSettings?: any;
  instituteId?: string;
  onOpen: (course: EditorialShowcaseCourse) => void;
}

export const EditorialShowcaseGrid: React.FC<EditorialShowcaseGridProps> = ({
  courses,
  selectedIds,
  limit,
  loading,
  excludeIds,
  onCardCount,
  columns,
  card,
  streamsLibraryId,
  globalSettings,
  instituteId,
  onOpen,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const siteLocale = useCatalogueLocale();
  const design = useMemo(() => resolveCardDesign({ cardStyle: "editorial", card }), [card]);
  const { formats } = useCourseFormats(globalSettings);
  // The catalogue's own stream resolution (folder library → streams), so the stream line matches it.
  const streamsConfig = useMemo(
    () =>
      streamsLibraryId
        ? resolveCatalogDiscovery({ streams: { enabled: true, source: "folderLibrary", libraryId: streamsLibraryId } }, null)
            .streams
        : null,
    [streamsLibraryId],
  );
  const { streams } = useCatalogStreams(instituteId ?? "", streamsConfig);

  const languageSettings = globalSettings?.courseLanguages;
  const grouping = languageSettings?.enabled === true;
  const languages = useMemo(() => normaliseLanguages(languageSettings), [languageSettings]);
  const versionGroups = useMemo(() => resolveVersionGroups(languageSettings?.versionGroups), [languageSettings]);
  const preferredLanguage = grouping ? preferredCourseLanguage(siteLocale.locale, languages) : null;

  const cards = useMemo(() => {
    const rows: ShowcaseRow[] = courses.map((c) => ({
      id: c.id,
      package_id: c.id,
      title: c.title,
      description: c.description,
      price: c.price,
      currency: c.currency,
      level: c.level ?? "",
      level_name: c.level ?? null,
      rating: 0,
      instructor: "",
      comma_separeted_tags: c.tagsRaw ?? null,
      coming_soon: c.comingSoonRaw,
      enroll_invite_availability: c.availability ?? null,
      thumbnail: c.thumbnailId,
      course: c,
    }));
    const order = new Map<string, number>();
    selectedIds.forEach((id, i) => {
      if (!order.has(id)) order.set(id, i);
    });
    const rankOf = (rs: ShowcaseRow[]) =>
      Math.min(...rs.map((r) => order.get(r.id) ?? Number.POSITIVE_INFINITY));
    const skip = new Set(excludeIds ?? []);
    return buildCatalogCards(rows, { grouping, languages, preferredLanguage, versionGroups })
      .filter((c) => !c.rows.some((r) => skip.has(r.id)))
      .map((c) => ({ card: c, rank: rankOf(c.rows) }))
      .filter((x) => Number.isFinite(x.rank))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, Math.max(1, limit))
      .map(({ card: c }) => {
        // The selected versions set the price (a free strip shows "Free" though another version is paid).
        const picked = c.rows.filter((r) => order.has(r.id));
        return { card: c, priceRow: editorialPriceRow(c, cardPriceView(c, picked), picked, false) };
      });
  }, [courses, selectedIds, grouping, languages, preferredLanguage, versionGroups, limit, excludeIds]);

  useEffect(() => {
    if (!loading) onCardCount?.(cards.length);
  }, [loading, cards.length, onCardCount]);

  if (!design) return null;

  if (loading) {
    return (
      <div className={columns === 4 ? SHOWCASE_EDITORIAL_GRID_CLASS_4 : SHOWCASE_EDITORIAL_GRID_CLASS}>
        {Array.from({ length: Math.min(Math.max(1, limit), 6) }, (_, i) => (
          <EditorialCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const tt = (key: string, opts?: Record<string, unknown> | string): string => String(t(key, opts as never));
  const deps: EditorialCardDeps = {
    design,
    formats,
    streams,
    languages,
    activeLanguage: preferredLanguage,
    paymentEnabled: globalSettings?.payment?.enabled !== false,
    imageFit: "cover",
    siteT,
    t: tt,
    formatAmount: (amount, currency) => formatAmountLabel(amount, currency, siteLocale.locale),
    formatLaunch: (date) => formatLaunchDate(date, siteLocale.locale) ?? null,
    descriptionPlaceholder: tt("courseCatalog.noDescriptionAvailable"),
  };

  return (
    <div className={columns === 4 ? SHOWCASE_EDITORIAL_GRID_CLASS_4 : SHOWCASE_EDITORIAL_GRID_CLASS}>
      {cards.map(({ card: c, priceRow }, index) => {
        const view = buildEditorialCardView(c, deps, { priceRow });
        const course = c.primary.course;
        const comingSoon = readComingSoon(c.primary.coming_soon);
        return (
          <EditorialCourseCard
            key={c.courseId}
            view={view}
            index={index}
            onOpen={() => onOpen(course)}
            onCta={
              comingSoon
                ? () => {
                    if (!openComingSoonForm(comingSoon, tt("comingSoon.notifyTitle", { title: view.title }))) onOpen(course);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
};

export default EditorialShowcaseGrid;

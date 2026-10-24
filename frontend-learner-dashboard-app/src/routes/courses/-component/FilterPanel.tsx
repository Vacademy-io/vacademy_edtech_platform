import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogStore } from "../-store/catalogStore";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { toTitleCase, compareByNameNatural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Funnel, CaretDown, CaretUp } from "@phosphor-icons/react";

// Internal reusable component for individual filter sections
interface FilterSectionProps {
  title: string;
  items: { id: string; name: string }[];
  selectedItems: string[];
  handleChange: (itemId: string) => void;
  disabled?: boolean;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  items,
  selectedItems,
  handleChange,
  disabled,
}) => {
  const { t } = useTranslation("coursesRouteA");
  const [isExpanded, setIsExpanded] = useState(false);
  const initialDisplayCount = 3;
  const canExpand = items.length > initialDisplayCount;
  const itemsToDisplay =
    canExpand && !isExpanded ? items.slice(0, initialDisplayCount) : items;

  return (
    <div className="mb-4 sm:mb-6">
      <h3 className="text-base sm:text-lg font-semibold text-gray-700 mb-2 sm:mb-3">{title}</h3>
      <div className="space-y-2">
        {items.length === 0 && !disabled && (
          <p className="text-sm text-gray-500">
            {t("filterPanel.noItemsAvailable", { title: title.toLowerCase() })}
          </p>
        )}
        {disabled && (
          <p className="text-sm text-gray-500">
            {t("filterPanel.filtersUnavailable", { title })}
          </p>
        )}
        {itemsToDisplay.map((item) => (
          <label
            key={item.id}
            className={`flex items-center text-gray-600 hover:text-gray-800 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
          >
            <input
              type="checkbox"
              className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 me-2"
              checked={selectedItems.includes(item.id)}
              onChange={() => handleChange(item.id)}
              disabled={disabled}
            />
            <span className="text-sm sm:text-base">{item.name}</span>
          </label>
        ))}
      </div>

      {canExpand && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          disabled={disabled}
          className={`text-sm mt-2 flex items-center gap-1 ${disabled
            ? "text-gray-400 cursor-not-allowed"
            : "text-blue-600 hover:text-blue-800"
            }`}
        >
          {isExpanded ? (
            <>
              {t("filterPanel.showLess")}
              <CaretUp size={14} />
            </>
          ) : (
            <>
              {t("filterPanel.showMore")}
              <CaretDown size={14} />
            </>
          )}
        </button>
      )}
    </div>
  );
};

// Props for the entire filter panel
interface FilterPanelProps {
  selectedLevels: string[];
  onLevelChange: (levelId: string) => void;
  selectedTags: string[];
  onTagChange: (tagId: string) => void;
  selectedInstructors: string[];
  onInstructorChange: (instructorId: string) => void;
  clearAllFilters: () => void;
  onApplyFilters: () => void;
  levelsDisabled?: boolean;
  tagsDisabled?: boolean;
  instructorsDisabled?: boolean;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  selectedLevels,
  onLevelChange,
  selectedTags,
  onTagChange,
  selectedInstructors,
  onInstructorChange,
  clearAllFilters,
  onApplyFilters,
  levelsDisabled = false,
  tagsDisabled = false,
  instructorsDisabled = false,
}) => {
  const { t } = useTranslation("coursesRouteA");
  const { instructor, instituteData } = useCatalogStore();
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  const hasActiveFilters =
    selectedLevels.length > 0 ||
    selectedTags.length > 0 ||
    selectedInstructors.length > 0;

  //   eslint-disable-next-line @typescript-eslint/no-explicit-any
  const levels = (instituteData?.levels || [])
    .map((level: any) => ({
      id: level.id,
      name: toTitleCase(level.level_name || `Unnamed ${getTerminology(ContentTerms.Level, SystemTerms.Level)}`),
    }))
    // Natural sort so levels read as Class 6, 7, 8 … then non-numeric names.
    .sort(compareByNameNatural);

  const tags = useMemo(() => {
    const uniqueNormalizedTags = new Set<string>();
    (instituteData?.tags || []).forEach((tag: string) => {
      if (tag) {
        uniqueNormalizedTags.add(toTitleCase(tag.trim()));
      }
    });

    return Array.from(uniqueNormalizedTags)
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({
        id: tag,
        name: tag,
      }));
  }, [instituteData?.tags]);

  //   eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instructors = (instructor || []).map((inst: any) => ({
    id: inst.id,
    name: inst.full_name || inst.username || `Unnamed ${getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)}`,
  }));

  return (
    <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
      {/* Mobile Header - Only visible on mobile */}
      <div className="lg:hidden mb-4">
        <button
          onClick={() => setIsMobileExpanded(!isMobileExpanded)}
          className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Funnel size={18} className="text-gray-600" />
            <span className="text-sm font-semibold text-gray-900">{t("filterPanel.title")}</span>
            {hasActiveFilters && (
              <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-1 rounded-full">
                {selectedLevels.length + selectedTags.length + selectedInstructors.length}
              </span>
            )}
          </div>
          <CaretDown
            size={16}
            className={`text-gray-500 transition-transform ${isMobileExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Filter Content - Hidden on mobile when collapsed */}
      <div className={`lg:block ${isMobileExpanded ? 'block' : 'hidden'}`}>
        {/* Desktop Header */}
        <div className="hidden lg:flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">{t("filterPanel.title")}</h2>
          <div className="flex gap-1">
            <Button
              onClick={clearAllFilters}
              disabled={!hasActiveFilters}
              className={`px-2 py-1 h-fit transition text-xs mt-px`}
            >
              {t("filterPanel.clearAll")}
            </Button>
            <Button
              onClick={onApplyFilters}
              disabled={!hasActiveFilters}
              className={`px-2 py-1 h-fit transition text-xs mt-px`}
            >
              {t("filterPanel.apply")}
            </Button>
          </div>
        </div>

        {/* Mobile Header */}
        <div className="lg:hidden flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-800">{t("filterPanel.title")}</h2>
          <div className="flex gap-1">
            <Button
              onClick={clearAllFilters}
              disabled={!hasActiveFilters}
              className={`px-2 py-1 h-fit transition text-xs mt-px`}
            >
              {t("filterPanel.clearAll")}
            </Button>
            <Button
              onClick={onApplyFilters}
              disabled={!hasActiveFilters}
              className={`px-2 py-1 h-fit transition text-xs mt-px`}
            >
              {t("filterPanel.apply")}
            </Button>
          </div>
        </div>

        <FilterSection
          title={getTerminology(ContentTerms.Level, SystemTerms.Level)}
          items={levels}
          selectedItems={selectedLevels}
          handleChange={onLevelChange}
          disabled={levelsDisabled || levels.length === 0}
        />

        <FilterSection
          title={getTerminologyPlural(ContentTerms.PopularTag, SystemTerms.PopularTag)}
          items={tags}
          selectedItems={selectedTags}
          handleChange={onTagChange}
          disabled={tagsDisabled || tags.length === 0}
        />

        <FilterSection
          title={getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)}
          items={instructors}
          selectedItems={selectedInstructors}
          handleChange={onInstructorChange}
          disabled={instructorsDisabled || instructors.length === 0}
        />
      </div>
    </div>
  );
};

export default FilterPanel;

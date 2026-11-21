import React, { useState, ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown } from "@phosphor-icons/react";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";

interface SearchAndSortBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  sortOption: string;
  onSortChange: (value: string) => void;
}

const SearchAndSortBar: React.FC<SearchAndSortBarProps> = ({
  searchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
}) => {
  const { t } = useTranslation("coursesRouteA");
  const [inputValue, setInputValue] = useState(searchTerm);

  const handleKeyDown = () => {
    onSearchChange(inputValue);
  };

  return (
    <div className="flex flex-col gap-stack sm:gap-4 md:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg bg-white border border-gray-200 shadow-sm">
      {/* Search Section */}
      <div className="relative w-full md:w-2/3 lg:w-1/2">
        <input
          type="text"
          placeholder={t("searchAndSortBar.searchPlaceholder", {
            courses: getTerminology(
              ContentTerms.Course,
              SystemTerms.Course
            ).toLocaleLowerCase() + "s",
          })}
          className="w-full ps-10 pe-4 py-2.5 sm:py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleKeyDown()}
        />
        <MagnifyingGlassIcon className="absolute start-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
      </div>

      {/* Sort Section */}
      <div className="relative w-full md:w-auto">
        <select
          value={sortOption}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onSortChange(e.target.value)
          }
          className="appearance-none w-full me-2 md:w-auto bg-white border border-gray-300 text-gray-700 py-2.5 sm:py-3 px-3 sm:px-4 pe-8 rounded-md leading-tight focus:outline-none focus:bg-white focus:border-blue-500 hover:border-gray-400 text-sm sm:text-base"
        >
          <option value="Newest">{t("searchAndSortBar.sortNewest")}</option>
          <option value="Oldest">{t("searchAndSortBar.sortOldest")}</option>
          {/* <option value="Popularity">Sort by: Popularity</option>
          <option value="Rating">Sort by: Rating</option> */}
        </select>
        <CaretDown className="absolute end-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
      </div>
    </div>
  );
};

export default SearchAndSortBar;

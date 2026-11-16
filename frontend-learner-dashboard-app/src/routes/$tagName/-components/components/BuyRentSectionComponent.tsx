import React, { useState } from "react";
import { RouteMatcher } from "../../-services/route-matcher";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShoppingBag, BookOpen, ArrowRight } from "@phosphor-icons/react";
import { RentLocationConfirmDialog } from "./RentLocationConfirmDialog";
import { rentLocationCityOf, setCatalogueMode } from "../../-utils/catalogue-mode";
import type { GlobalSettings } from "../../-types/course-catalogue-types";

interface BuyRentOption {
  buttonLabel: string;
  /** The level name the catalogue filters on in this mode ("Buy" / "Rent"). */
  levelFilterValue: string;
  /** Page the card opens — the catalogue's ("library"). Absent = the site root, as before. */
  targetRoute?: string;
}

interface BuyRentSectionProps {
  heading?: string;
  buy: BuyRentOption;
  rent: BuyRentOption;
  tagName?: string;
  /** Its `rentLocationCity`, when set, makes the Rent card ask the location question first. */
  globalSettings?: GlobalSettings;
}

export const BuyRentSectionComponent: React.FC<BuyRentSectionProps> = ({
  buy,
  rent,
  tagName,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredCard, setHoveredCard] = useState<"buy" | "rent" | null>(null);
  const [showRentConfirmation, setShowRentConfirmation] = useState(false);

  const currentTagName = tagName || location.pathname.split("/").filter(Boolean)[0] || "";

  // Switch the storefront's mode, then open the option's page (the catalogue).
  const handleCardClick = (option: BuyRentOption) => {
    if (option.levelFilterValue) setCatalogueMode(option.levelFilterValue);
    const target = (option.targetRoute || "").trim();
    if (RouteMatcher.isExternalLink(target)) {
      window.location.href = target;
      return;
    }
    navigate({ to: RouteMatcher.pagePath(currentTagName, target) as never });
  };

  // The location question only when the catalogue names its rent city; else straight to rent.
  const rentCity = rentLocationCityOf(globalSettings);
  const handleRentClick = () => {
    if (rentCity) {
      setShowRentConfirmation(true);
      return;
    }
    handleCardClick(rent);
  };
  const handleRentConfirm = () => {
    setShowRentConfirmation(false);
    handleCardClick(rent);
  };
  const handleRentCancel = () => setShowRentConfirmation(false);
  const handleBuyRedirect = () => {
    setShowRentConfirmation(false);
    handleCardClick(buy);
  };

  return (
    // NEUTRAL: Section background
    <div className="w-full py-4 sm:py-6 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-3 sm:mb-4">
          <p className="text-sm sm:text-base text-gray-600">
            {t("buyRentSection.chooseOption")}
          </p>
        </div>

        {/* Two Column Layout - always side by side */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {/* RENT Card - NEUTRAL with PRIMARY accent on hover */}
          <div
            className={`relative overflow-hidden rounded-catalogue-md border transition-all duration-200 cursor-pointer ${
              hoveredCard === "rent" 
                ? "border-primary-400 bg-primary-50" 
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
            onMouseEnter={() => setHoveredCard("rent")}
            onMouseLeave={() => setHoveredCard(null)}
            onClick={handleRentClick}
          >
            <div className="p-3 sm:p-5 flex flex-col items-center text-center">
              {/* Icon - PRIMARY accent */}
              <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-catalogue-md mb-2 sm:mb-3 flex items-center justify-center transition-colors ${
                hoveredCard === "rent" ? "bg-primary-500" : "bg-primary-100"
              }`}>
                <BookOpen className={`h-5 w-5 sm:h-6 sm:w-6 ${hoveredCard === "rent" ? "text-white" : "text-primary-600"}`} />
              </div>

              {/* Title - dark neutral */}
              <h3 className="text-base sm:text-xl font-bold text-gray-900 mb-0.5 sm:mb-1">
                {t("buyRentSection.rentTitle")}
              </h3>
              {/* Description - NEUTRAL */}
              <p className="text-xs text-gray-600 mb-2 sm:mb-3">
                {t("buyRentSection.rentDescription")}
              </p>

              {/* Button - PRIMARY */}
              <button className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-catalogue-sm text-xs sm:text-sm font-medium text-primary-foreground bg-primary-500 hover:brightness-90 transition flex items-center gap-1 sm:gap-2">
                <span>{rent.buttonLabel}</span>
                <ArrowRight className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform ${hoveredCard === "rent" ? "translate-x-1" : ""}`} />
              </button>
            </div>
          </div>

          {/* BUY Card - NEUTRAL with PRIMARY accent on hover */}
          <div
            className={`relative overflow-hidden rounded-catalogue-md border transition-all duration-200 cursor-pointer ${
              hoveredCard === "buy" 
                ? "border-primary-400 bg-primary-50" 
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
            onMouseEnter={() => setHoveredCard("buy")}
            onMouseLeave={() => setHoveredCard(null)}
            onClick={() => handleCardClick(buy)}
          >
            <div className="p-3 sm:p-5 flex flex-col items-center text-center">
              {/* Icon - PRIMARY accent */}
              <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-catalogue-md mb-2 sm:mb-3 flex items-center justify-center transition-colors ${
                hoveredCard === "buy" ? "bg-primary-500" : "bg-primary-100"
              }`}>
                <ShoppingBag className={`h-5 w-5 sm:h-6 sm:w-6 ${hoveredCard === "buy" ? "text-white" : "text-primary-600"}`} />
              </div>

              {/* Title - dark neutral */}
              <h3 className="text-base sm:text-xl font-bold text-gray-900 mb-0.5 sm:mb-1">
                {t("buyRentSection.buyTitle")}
              </h3>
              {/* Description - NEUTRAL */}
              <p className="text-xs text-gray-600 mb-2 sm:mb-3">
                {t("buyRentSection.buyDescription")}
              </p>

              {/* Button - PRIMARY */}
              <button className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-catalogue-sm text-xs sm:text-sm font-medium text-primary-foreground bg-primary-500 hover:brightness-90 transition flex items-center gap-1 sm:gap-2">
                <span>{buy.buttonLabel}</span>
                <ArrowRight className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform ${hoveredCard === "buy" ? "translate-x-1" : ""}`} />
              </button>
            </div>
          </div>
        </div>

        {/* How it Works Section - NEUTRAL */}
        <div className="mt-4 sm:mt-6">
          <div className="bg-white border border-gray-200 rounded-catalogue-md overflow-hidden">
            <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200">
              <h3 className="text-sm sm:text-base font-semibold text-gray-900">{t("buyRentSection.howItWorks")}</h3>
            </div>

            <div className="p-3 sm:p-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {[
                  { step: 1, title: t("buyRentSection.steps.step1Title"), desc: t("buyRentSection.steps.step1Desc") },
                  { step: 2, title: t("buyRentSection.steps.step2Title"), desc: t("buyRentSection.steps.step2Desc") },
                  { step: 3, title: t("buyRentSection.steps.step3Title"), desc: t("buyRentSection.steps.step3Desc") },
                  { step: 4, title: t("buyRentSection.steps.step4Title"), desc: t("buyRentSection.steps.step4Desc") },
                ].map(({ step, title, desc }) => (
                  <div key={step} className="flex gap-2 sm:gap-3">
                    {/* PRIMARY ACCENT: Step number */}
                    <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-primary-500 flex items-center justify-center text-white text-caption sm:text-xs font-medium">
                      {step}
                    </div>
                    <div>
                      {/* Title - darker neutral */}
                      <h4 className="text-xs sm:text-sm font-medium text-gray-800">{title}</h4>
                      {/* Description - NEUTRAL */}
                      <p className="text-caption sm:text-xs text-gray-500 hidden sm:block">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rent Confirmation Modal (only when the catalogue names its rent city) */}
      {rentCity && (
        <RentLocationConfirmDialog
          open={showRentConfirmation}
          onCancel={handleRentCancel}
          onContinue={handleRentConfirm}
          onBuyInstead={handleBuyRedirect}
          city={rentCity}
        />
      )}
    </div>
  );
};

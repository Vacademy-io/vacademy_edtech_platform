import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { IntroPage } from '../-types/course-catalogue-types';
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { useDomainRouting } from '@/hooks/use-domain-routing';
import { getPublicUrlWithoutLogin } from '@/services/upload_file';
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useSiteT } from '../-utils/catalogue-locale';

interface IntroPageComponentProps {
  introPage: IntroPage;
  onGetStarted: () => void;
  onLogin: () => void;
  onComplete: () => void;
  onClose: () => void;
  leadCollectionSettings?: any;
  instituteId?: string;
}

export const IntroPageComponent: React.FC<IntroPageComponentProps> = ({
  introPage,
  onGetStarted,
  onLogin,
  onComplete,
  onClose,
  leadCollectionSettings,
  instituteId,
}) => {
  const { t } = useTranslation("coursePlayerA");
  // Captions and field labels are authored in the catalogue JSON (introPage,
  // leadCollection) outside the page tree, so they are translated here, for
  // display only.
  const siteT = useSiteT();
  const domainRouting = useDomainRouting();
  const isAndroid = Capacitor.getPlatform() === 'android';
  const isIOS = Capacitor.getPlatform() === 'ios';
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [instituteLogoUrl, setInstituteLogoUrl] = useState<string | null>(null);
  const [processedImages, setProcessedImages] = useState<Array<{ source: string; caption: string }>>([]);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const handleInstituteLogoClick = () => {
    if (domainRouting.homeIconClickRoute) {
      window.location.href = domainRouting.homeIconClickRoute;
    }
  };

  // Load institute logo
  useEffect(() => {
    const loadInstituteLogo = async () => {
      if (domainRouting.instituteLogoFileId) {
        try {
          const url = await getPublicUrlWithoutLogin(domainRouting.instituteLogoFileId);
          setInstituteLogoUrl(url);
        } catch (error) {
          console.error('Error loading institute logo:', error);
        }
      }
    };

    loadInstituteLogo();
  }, [domainRouting.instituteLogoFileId]);

  // Process images (convert Google Drive URLs to direct format)
  useEffect(() => {
    const processImages = () => {
      const processed = introPage.imageSlider.images.map((image) => {
        // Convert Google Drive URLs to direct format
        if (image.source.includes('drive.google.com/uc?id=')) {
          // Extract file ID and convert to direct format
          const fileIdMatch = image.source.match(/id=([^&]+)/);
          if (fileIdMatch) {
            const fileId = fileIdMatch[1];
            // Convert to direct Google Drive image URL
            const directUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1920-h1080`;
            return { source: directUrl, caption: image.caption };
          }
        }
        return { source: image.source, caption: image.caption };
      });
      setProcessedImages(processed);
    };

    processImages();
  }, [introPage.imageSlider.images]);

  // Auto-play functionality - DISABLED
  // useEffect(() => {
  //   if (isAutoPlaying && introPage.imageSlider.autoPlay && processedImages.length > 0) {
  //     intervalRef.current = setInterval(() => {
  //       setCurrentImageIndex((prev) => 
  //         prev === processedImages.length - 1 ? 0 : prev + 1
  //       );
  //     }, introPage.imageSlider.interval);
  //   }

  //   return () => {
  //     if (intervalRef.current) {
  //       clearInterval(intervalRef.current);
  //     }
  //   };
  // }, [isAutoPlaying, introPage.imageSlider.autoPlay, introPage.imageSlider.interval, processedImages.length]);

  // Auto-completion removed - user must click "Get Started" to proceed

  const nextImage = () => {
    if (currentImageIndex === processedImages.length - 1) {
      // On last slide, navigate to catalogue
      onComplete();
    } else {
      // On other slides, go to next image
      setCurrentImageIndex((prev) => prev + 1);
    }
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? 0 : prev - 1
    );
  };

  const handleButtonClick = (action: string) => {
    switch (action) {
      case 'loadNextSection':
        onComplete();
        break;
      case 'navigateToLogin':
        onLogin();
        break;
      case 'openLeadCollection':
        // Only show lead form if it's enabled in settings
        if (leadCollectionSettings?.enabled) {
          setShowLeadForm(true);
        } else {
          console.log("[IntroPageComponent] Lead collection is disabled, ignoring openLeadCollection action");
        }
        break;
      default:
        onComplete();
    }
  };

  const handleLeadFormClose = () => {
    setShowLeadForm(false);
  };

  const handleLeadFormSubmit = () => {
    setShowLeadForm(false);
    onComplete(); // Go to catalogue after form submission
  };

  const getButtonStyle = (style: string) => {
    const baseClasses = 'px-6 py-3 rounded-catalogue-md font-semibold transition-colors duration-200';
    const themeColor = domainRouting.instituteThemeCode ? 
      `hsl(var(--primary))` : 
      '#3b82f6'; // design-lint-ignore: page-builder default color
    const themeColorHover = domainRouting.instituteThemeCode ? 
      `hsl(var(--primary) / 0.9)` : 
      '#2563eb'; // design-lint-ignore: page-builder default color
    
    switch (style) {
      case 'primary':
        return `${baseClasses} text-white hover:opacity-90`;
      case 'outlined':
        return `${baseClasses} border-2 hover:text-white`;
      case 'text':
        return `${baseClasses} hover:opacity-80`;
      default:
        return `${baseClasses} text-white hover:opacity-90`;
    }
  };

  const getButtonStyles = (style: string) => {
    const themeColor = domainRouting.instituteThemeCode ? 
      `hsl(var(--primary))` : 
      '#3b82f6'; // design-lint-ignore: page-builder default color
    const themeColorHover = domainRouting.instituteThemeCode ? 
      `hsl(var(--primary) / 0.9)` : 
      '#2563eb'; // design-lint-ignore: page-builder default color
    
    switch (style) {
      case 'primary':
        return {
          backgroundColor: themeColor,
          color: 'white',
          border: 'none'
        };
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          color: themeColor,
          borderWidth: '2px',
          borderStyle: 'solid',
          borderColor: themeColor
        };
      case 'text':
        return {
          backgroundColor: 'transparent',
          color: themeColor,
          border: 'none'
        };
      default:
        return {
          backgroundColor: themeColor,
          color: 'white',
          border: 'none'
        };
    }
  };

  if (!introPage.enabled) {
    return null;
  }

  return (
    <div 
      className={`fixed inset-0 z-50 bg-white ${introPage.fullScreen ? 'h-screen' : 'h-full'} overflow-hidden flex flex-col pb-20 md:pb-0`}
      ref={sliderRef}
    >
      {/* Close button - only show if not fullScreen or if showHeader is true */}
      {(!introPage.fullScreen || introPage.showHeader) && (
        <button
          onClick={onClose}
          className="absolute top-4 end-4 z-30 text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-full hover:bg-gray-100"
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X className="w-6 h-6" aria-hidden="true" />
        </button>
      )}

      {/* Logo - Use institute logo from domainRouting */}
      {instituteLogoUrl && (
        <div className={`flex-shrink-0 py-4 pt-10 md:pt-4 ${
          introPage.logo?.alignment === 'left' ? 'self-start ps-4' :
          introPage.logo?.alignment === 'right' ? 'self-end pe-4' :
          'self-center'
        }`}>
          <img
            src={instituteLogoUrl}
            alt={domainRouting.instituteName || t("introPage.instituteLogo")}
            style={{ height: introPage.logo?.height || "80px" }}
            className={`object-contain${domainRouting.homeIconClickRoute ? " cursor-pointer" : ""}`}
            onClick={domainRouting.homeIconClickRoute ? handleInstituteLogoClick : undefined}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
      )}

      {/* Image Slider or Lead Collection Form */}
      {!showLeadForm ? (
        <div 
          className="relative w-full flex-1 overflow-hidden"
          style={{ 
            backgroundColor: 'white',
            minHeight: '400px',
            maxHeight: '70vh'
          }}
        >
        {processedImages.map((image, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              index === currentImageIndex ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* Image Caption - Above the image with proper spacing */}
            <div className="absolute top-4 start-0 end-0 text-center px-4 z-10 mb-4">
              <p className="text-gray-800 text-lg sm:text-xl md:text-2xl lg:text-3xl font-semibold">
                {siteT(image.caption)}
              </p>
            </div>
            
            <img
              src={image.source}
              // No caption keeps the attribute absent, as before (siteT
              // would turn it into alt="", marking the image decorative).
              alt={image.caption ? siteT(image.caption) : image.caption}
              className="w-full h-full object-cover mt-16 md:mt-20"
              style={{
                objectFit: introPage.imageSlider.styles.objectFit,
                maxHeight: 'calc(100% - 4rem)',
                maxWidth: '100%'
              }}
              onError={(e) => {
                // Try alternative Google Drive format as fallback
                if (image.source.includes('drive.google.com/thumbnail')) {
                  const fileIdMatch = image.source.match(/id=([^&]+)/);
                  if (fileIdMatch) {
                    const fileId = fileIdMatch[1];
                    const fallbackUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
                    e.currentTarget.src = fallbackUrl;
                  } else {
                    e.currentTarget.style.display = "none";
                  }
                } else {
                  e.currentTarget.style.display = "none";
                }
              }}
            />
          </div>
        ))}

        {/* Navigation Arrows - Only show on desktop */}
        {processedImages.length > 1 && (
          <>
            <button
              onClick={prevImage}
              disabled={currentImageIndex === 0}
              className={`hidden md:block absolute start-4 top-1/2 transform -translate-y-1/2 transition-colors p-2 rounded-full ${
                currentImageIndex === 0 
                  ? 'text-gray-400 cursor-not-allowed' 
                  : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200'
              }`}
              title={t("introPage.previousImage")}
            >
              <CaretLeft className="w-8 h-8" />
            </button>
            <button
              onClick={nextImage}
              className="hidden md:block absolute end-4 top-1/2 transform -translate-y-1/2 transition-colors p-2 rounded-full text-gray-700 hover:text-gray-900 hover:bg-gray-200"
              title={t("introPage.nextImage")}
            >
              <CaretRight className="w-8 h-8" />
            </button>
          </>
        )}

        </div>
      ) : (
        /* Lead Collection Form - Inline */
        <div className="relative w-full flex-1 bg-white flex items-center justify-center p-8">
          {leadCollectionSettings && leadCollectionSettings.enabled && instituteId && (
            <div className="w-full max-w-2xl">
              <div className="bg-white rounded-catalogue-md shadow-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">
                    {t("common.getCourseDetails", {
                      course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                    })}
                  </h2>
                  <button
                    onClick={handleLeadFormClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={t("common.close")}
                  >
                    <X className="w-6 h-6" aria-hidden="true" />
                  </button>
                </div>
                
                {/* Multi-step form content */}
                <div className="space-y-6">
                  {leadCollectionSettings.formStyle?.type === 'multiStep' && leadCollectionSettings.fields && (
                    <div>
                      {/* Progress Bar */}
                      {leadCollectionSettings.formStyle.showProgress && (
                        <div className="mb-6 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">{t("introPage.stepOfTotal", { total: leadCollectionSettings.fields.length })}</span>
                            <span className="text-sm text-gray-500">{t("introPage.progress")}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(1 / leadCollectionSettings.fields.length) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      
                      {/* Form Fields */}
                      <div className="space-y-4">
                        {leadCollectionSettings.fields.map((field: any, index: number) => (
                          <div key={field.name} className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700">
                              {siteT(field.label)}
                              {field.required && <span className="text-red-500 ms-1">*</span>}
                            </label>
                            
                            {field.type === 'text' || field.type === 'email' || field.type === 'tel' ? (
                              <input
                                type={field.type}
                                className="w-full px-3 py-2 border border-gray-300 rounded-catalogue-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                placeholder={t("introPage.enterField", { field: siteT(field.label).toLowerCase() })}
                              />
                            ) : field.type === 'chips' && field.options ? (
                              <div className="flex flex-wrap gap-2">
                                {field.options.map((option: any, optionIndex: number) => (
                                  <button
                                    key={optionIndex}
                                    className="px-4 py-2 border border-gray-300 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                  >
                                    {siteT(option.label)}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex justify-end space-x-4 mt-8">
                        <button
                          onClick={handleLeadFormClose}
                          className="px-6 py-2 border border-gray-300 rounded-catalogue-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          onClick={handleLeadFormSubmit}
                          className="px-6 py-2 bg-primary-600 text-white rounded-catalogue-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {t("common.submit")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dots Indicator - Between image slider and action buttons */}
      {!showLeadForm && processedImages.length > 1 && (
        <div className="flex justify-center mt-4 mb-20 md:mb-4 space-x-2">
          {processedImages.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentImageIndex(index)}
              className={`w-3 h-3 rounded-full transition-colors duration-200 ${
                index === currentImageIndex 
                  ? 'bg-primary-600'
                  : 'bg-gray-400'
              }`}
              title={t("introPage.goToImage", { index: index + 1 })}
            />
          ))}
        </div>
      )}

      {/* Desktop Action Buttons - Only show when not in lead form */}
      {!showLeadForm && (
        <div className="hidden md:block flex-shrink-0 bg-white py-8">
          <div className={`flex ${
            introPage.actions.alignment === 'left' ? 'justify-start' :
            introPage.actions.alignment === 'right' ? 'justify-end' :
            'justify-center'
          } px-4`}>
            <div className="flex flex-col gap-4 items-center pb-6">
              {/* Login Button */}
              {introPage.actions.buttons.some(btn => btn.action === 'navigateToLogin') && (
                <div className="flex flex-col gap-1 items-center">
                  <button
                    onClick={() => handleButtonClick('navigateToLogin')}
                    className="px-6 py-3 rounded-catalogue-md font-semibold transition-colors duration-200 border hover:opacity-90"
                    style={{
                      color: domainRouting.instituteThemeCode ? `hsl(var(--primary))` : '#3b82f6', // design-lint-ignore: page-builder default color
                      borderColor: domainRouting.instituteThemeCode ? `hsl(var(--primary))` : '#3b82f6' // design-lint-ignore: page-builder default color
                    }}
                  >
                    {t("common.login")}
                  </button>
                  <span className="text-xs text-gray-500">{t("introPage.ifAlreadyRegistered")}</span>
                </div>
              )}

              {/* Next Button - Show on all slides */}
              {processedImages.length > 1 && (
                <button
                  onClick={() => {
                    if (currentImageIndex === processedImages.length - 1) {
                      // On last slide, navigate to catalogue
                      onComplete();
                    } else {
                      // On other slides, go to next image
                      setCurrentImageIndex(prev => prev + 1);
                    }
                  }}
                  className="px-6 py-3 rounded-catalogue-md font-semibold transition-colors duration-200 text-white hover:opacity-90"
                  style={{
                    backgroundColor: domainRouting.instituteThemeCode ? `hsl(var(--primary))` : '#3b82f6' // design-lint-ignore: page-builder default color
                  }}
                >
                  {t("common.next")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Action Buttons - Fixed at bottom */}
      {!showLeadForm && (
        <div className={`md:hidden fixed bottom-0 start-0 end-0 z-60 bg-white border-t border-gray-200 p-4 ${isAndroid || isIOS ? 'mb-8' : ''}`}>
          <div className="flex flex-col gap-stack">
            {/* Login Button - Mobile */}
            {introPage.actions.buttons.some(btn => btn.action === 'navigateToLogin') && (
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleButtonClick('navigateToLogin')}
                  className="w-full px-4 py-2 font-medium hover:opacity-90 rounded-catalogue-sm border transition-colors"
                  style={{
                    color: domainRouting.instituteThemeCode ? `hsl(var(--primary))` : '#3b82f6', // design-lint-ignore: page-builder default color
                    borderColor: domainRouting.instituteThemeCode ? `hsl(var(--primary))` : '#3b82f6' // design-lint-ignore: page-builder default color
                  }}
                >
                  {t("common.login")}
                </button>
              </div>
            )}

            {/* Next Button - Full width on mobile */}
            {processedImages.length > 1 && (
              <button
                onClick={() => {
                  if (currentImageIndex === processedImages.length - 1) {
                    // On last slide, navigate to catalogue
                    onComplete();
                  } else {
                    // On other slides, go to next image
                    setCurrentImageIndex(prev => prev + 1);
                  }
                }}
                className="w-full px-4 py-2 text-white font-medium hover:opacity-90 rounded-catalogue-sm transition-colors"
                style={{
                  backgroundColor: domainRouting.instituteThemeCode ? `hsl(var(--primary))` : '#3b82f6' // design-lint-ignore: page-builder default color
                }}
              >
                {t("common.next")}
              </button>
            )}
          </div>
        </div>
      )}


    </div>
  );
};

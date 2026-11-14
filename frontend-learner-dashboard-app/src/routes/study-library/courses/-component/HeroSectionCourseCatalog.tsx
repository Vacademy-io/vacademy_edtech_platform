import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCatalogStore } from '../-store/catalogStore.ts'; // Import the store
import { getPublicUrl } from '@/services/upload_file'; // Import getPublicUrl
import { useTheme } from '@/providers/theme/theme-provider';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';

const HeroSectionCourseCatalog: React.FC = () => {
  const { t } = useTranslation("study");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const bannerAlt = t("courseCatalogBanner.alt", { course });
  const { apiFetchedInstituteDetails } = useCatalogStore(); // Get details from store
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);


  const defaultStaticBannerUrl = '/images/banner.webp';
  const { getPrimaryColorCode } = useTheme();

  useEffect(() => {
    let isMounted = true; // For cleanup

    const fetchBannerUrl = async () => {
      if (apiFetchedInstituteDetails && apiFetchedInstituteDetails.institute_banner_file_id) {
        try {
          const url = await getPublicUrl(apiFetchedInstituteDetails.institute_banner_file_id);
          if (isMounted) {
            if (url) {
              setBannerImageUrl(url);
            } else {
              // getPublicUrl returned no URL. Fallback based on theme_code.
              if (!apiFetchedInstituteDetails.institute_theme_code) {
                setBannerImageUrl(defaultStaticBannerUrl);
              } else {
                setBannerImageUrl(null); // Signal to use theme color
              }
            }
          }
        } catch (error) {
          if (isMounted) {
            // On error, fallback based on theme_code.
            if (apiFetchedInstituteDetails.institute_theme_code) {
              setBannerImageUrl(null); // Signal to use theme color
            } else {
              setBannerImageUrl(defaultStaticBannerUrl);
            }
          }
        }
      } else if (apiFetchedInstituteDetails && apiFetchedInstituteDetails.institute_theme_code) {
        // No banner_file_id, but theme_code exists: signal to use theme color.
        if (isMounted) {
          setBannerImageUrl(null);
        }
      } else {
        // No banner_file_id and no theme_code: use default static banner.
        if (isMounted) {
          setBannerImageUrl(defaultStaticBannerUrl);
        }
      }
    };

    fetchBannerUrl();

    return () => {
      isMounted = false; // Cleanup to prevent state updates on unmounted component
    };
  }, [apiFetchedInstituteDetails]);

  let bannerContent;

  if (!bannerImageUrl) {
    // This will render if bannerImageUrl is a fetched URL or the defaultStaticBannerUrl
    bannerContent = <img src='./images/banner.webp' alt={bannerAlt} className='w-full h-full object-cover' />;
  } else if (apiFetchedInstituteDetails && apiFetchedInstituteDetails.institute_theme_code) {
    // This condition is met if bannerImageUrl is null AND theme_code exists
    const themeStyle: React.CSSProperties = {
      backgroundColor: getPrimaryColorCode(),
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
    bannerContent = <div style={themeStyle}></div>; 
  } else {
    // Final fallback if bannerImageUrl is null and no theme_code (should be rare if useEffect is correct)
    bannerContent = <img src={defaultStaticBannerUrl} alt={bannerAlt} className='w-full h-full object-cover' />;
  }

  return (
    <div className='h-catalog-hero'>
      {bannerContent}
    </div>
  );
};

export default HeroSectionCourseCatalog;

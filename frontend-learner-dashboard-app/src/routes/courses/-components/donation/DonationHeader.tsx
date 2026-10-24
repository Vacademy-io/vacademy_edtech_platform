import { Heart } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { InstituteBrandingComponent } from "@/components/common/institute-branding";

interface DonationHeaderProps {
  step: string;
}

export const DonationHeader = ({ step }: DonationHeaderProps) => {
  const { t } = useTranslation("coursesRouteA");
  const {
    instituteId,
    instituteName,
    instituteLogoFileId,
    instituteThemeCode,
    homeIconClickRoute,
    hideInstituteName,
    logoWidthPx,
    logoHeightPx,
  } = useDomainRouting();

  return (
    <div className="mb-6">
      <div className="flex w-full items-center justify-center mb-4">
        <InstituteBrandingComponent
          branding={{
            instituteId,
            instituteName,
            instituteLogoFileId,
            instituteThemeCode,
            homeIconClickRoute,
            hideInstituteName,
            logoWidthPx,
            logoHeightPx,
          }}
          size="small"
          showName={false}
        />
      </div>
      <div className="flex items-center justify-center gap-2 mb-3">
        <Heart className="w-6 h-6 text-red-500" />
        <h2 className="text-xl font-bold text-gray-900">
          {t("donation.header.title")}
        </h2>
      </div>
      {step === 'select' && (
        <p className="text-sm text-gray-600 text-center mb-4">
          {t("donation.header.subtitle")}
        </p>
      )}
    </div>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';

const Nav: React.FC = () => {
  const { t } = useTranslation("study");
  return (
    <div className='h-16 flex items-center justify-between px-4 sm:px-8 py-4 bg-white shadow-sm'>
      <div className='flex items-center justify-center gap-2'>
        <img src="/images/Frame.png" alt={t("legacyNav.logoAlt")} className="h-8 w-8" />
        <p className='font-semibold text-gray-800'>{t("legacyNav.brandName")}</p>
      </div>
      <img src="/images/Frame2.svg" alt={t("legacyNav.userProfileAlt")} className="h-10 w-10 rounded-full" />
    </div>
  );
}

export default Nav;
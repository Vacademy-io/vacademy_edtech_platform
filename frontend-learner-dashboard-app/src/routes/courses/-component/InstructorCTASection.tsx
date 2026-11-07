import React from 'react';
import { useTranslation } from 'react-i18next';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';

const InstructorCTASection: React.FC = () => {
  const { t } = useTranslation('coursesRouteA');
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase();

  return (
    <div className="bg-white flex flex-col items-center text-center gap-y-3 p-8 md:p-12">
      <h1 className='font-bold text-3xl md:text-4xl'>{t("cta.titlePrefix")} <span className="text-blue-600">{course}</span>{t("cta.titleSuffix")}</h1>
      <p className="text-gray-700 max-w-xl">{t("cta.subtitle1")}</p>
      <p className="text-gray-700 max-w-xl">{t("cta.subtitle2", { courses })}</p>
      <button className="border-2 border-black mt-5 bg-white text-black px-10 py-2 rounded-md hover:bg-gray-100 transition-colors ">{t("common.login")}</button>
    </div>
  );
}

export default InstructorCTASection;
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';

const InstructorCTASection: React.FC = () => {
  const { t } = useTranslation("study");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  return (
    <div className="bg-white flex flex-col items-center text-center gap-y-3 p-8 md:p-12">
      <h1 className='font-bold text-3xl md:text-4xl'>{t("instructorCta.headingBefore")} <span className="text-blue-600">{course}</span>{t("instructorCta.headingAfter")}</h1>
      <p className="text-gray-700 max-w-xl">{t("instructorCta.subtitle")}</p>
      <p className="text-gray-700 max-w-xl">{t("instructorCta.description", { courses: courses.toLowerCase() })}</p>
      <button className="border-2 border-black mt-5 bg-white text-black px-10 py-2 rounded-md hover:bg-gray-100 transition-colors ">{t("instructorCta.login")}</button>
    </div>
  );
}

export default InstructorCTASection;
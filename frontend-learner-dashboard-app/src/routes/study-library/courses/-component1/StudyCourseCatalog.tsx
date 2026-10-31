//import React from 'react'

import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

const StudyCourseCatalog = () => {
  const { t } = useTranslation("study");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  return (
    <div>
      <h1 className="text-2xl font-bold bg-red-400">
        {t("studyCourseCatalog.heading", { course })}
      </h1>
    </div>
  );
};

export default StudyCourseCatalog;

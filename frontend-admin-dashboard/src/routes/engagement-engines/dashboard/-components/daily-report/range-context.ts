import { createContext, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { rangeT } from '../../-utils/report-range-t';

/** True while the report on screen covers more than one day, so its copy says "period". */
export const ReportRangeContext = createContext(false);

/** The report's translate function: "on this day" for one day, "in this period" for a range. */
export function useReportT() {
    const { t } = useTranslation('engagementDailyReport');
    const range = useContext(ReportRangeContext);
    return useMemo(() => rangeT(t, range), [t, range]);
}

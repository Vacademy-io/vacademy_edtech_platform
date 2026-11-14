/**
 * Whether the Alerts tab is shown. The probe reads GET /admin/fleet under the same key as the
 * tab and the Panels list, so they share one answer.
 */
import { useFeatureProbe, type TabAvailability } from '../featureProbe';
import { alertsProbe } from './api';

export function useAlertsAvailability(instituteId: string): TabAvailability {
    return useFeatureProbe(alertsProbe(instituteId));
}

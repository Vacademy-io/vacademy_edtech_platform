/**
 * Whether the Installers tab is shown. The probe reads GET /admin/partners under the same key
 * as the tab, so opening the tab reuses the answer.
 */
import { useFeatureProbe, type TabAvailability } from '../featureProbe';
import { installersProbe } from './api';

export function useInstallersAvailability(instituteId: string): TabAvailability {
    return useFeatureProbe(installersProbe(instituteId));
}

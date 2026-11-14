/**
 * Whether the Licences tab is shown. The probe reads GET /admin/licence under the same key as
 * the tab, so opening the tab reuses the answer.
 */
import { useFeatureProbe, type TabAvailability } from '../featureProbe';
import { licenceProbe } from './api';

export function useLicenceAvailability(instituteId: string): TabAvailability {
    return useFeatureProbe(licenceProbe(instituteId));
}

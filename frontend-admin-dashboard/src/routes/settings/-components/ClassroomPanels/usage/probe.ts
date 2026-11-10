import { useState } from 'react';
import { getBrowserTimezone } from '@/utils/timezone';
import { isFeatureOff, type TabAvailability } from '../featureProbe';
import { defaultUsageRange, useUsageQuery } from './usageApi';

/**
 * Whether the Usage tab is shown. It asks for the tab's own default range under the tab's own
 * query key, so opening the tab reuses this answer. The range is fixed when the screen mounts:
 * a new day at midnight must not send the tab back to 'loading' (which would hide it).
 */
export function useUsageAvailability(instituteId: string): TabAvailability {
    const [range] = useState(defaultUsageRange);
    const [tz] = useState(() => getBrowserTimezone());
    // Infinity here only stops this observer refetching; the tab's own observer keeps its
    // shorter staleness.
    const query = useUsageQuery(instituteId, range, tz, { staleTime: Infinity });
    if (query.data !== undefined) return 'on';
    if (query.isPending) return 'loading';
    return isFeatureOff(query.error) ? 'off' : 'on';
}

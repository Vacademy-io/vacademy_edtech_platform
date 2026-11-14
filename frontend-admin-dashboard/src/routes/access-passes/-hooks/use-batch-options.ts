import { useMemo } from 'react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { BatchForSession } from '@/types/payment-logs';
import type { OptionType } from '@/components/design-system/multi-select';

const isDefault = (id?: string) => !id || id.toUpperCase() === 'DEFAULT';

/** "Course · Level · Session", leaving out the DEFAULT level / session placeholders. */
export const batchLabel = (b: BatchForSession): string =>
    [
        b.package_dto?.package_name,
        isDefault(b.level?.id) ? undefined : b.level?.level_name,
        isDefault(b.session?.id) ? undefined : b.session?.session_name,
    ]
        .filter(Boolean)
        .join(' · ');

/**
 * Course batches an access pass can include: the institute's live batches minus
 * organisation batches (the backend rejects those — enrolling into one creates a
 * sub-org per learner, which a background grant cannot do).
 */
export const useBatchOptions = () => {
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    return useMemo(() => {
        const batches = (instituteDetails?.batches_for_sessions ?? []) as unknown as BatchForSession[];
        const usable = batches.filter(
            (b) => b?.id && !b.is_org_associated && (b.status ?? 'ACTIVE').toUpperCase() !== 'DELETED'
        );
        const options: OptionType[] = usable
            .map((b) => ({ value: b.id, label: batchLabel(b) || b.id }))
            .sort((a, b) => a.label.localeCompare(b.label));
        const labelById = new Map(options.map((o) => [o.value, o.label]));
        return { options, labelById };
    }, [instituteDetails]);
};

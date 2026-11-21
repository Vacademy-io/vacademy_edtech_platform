import { useMemo } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface BatchPickerProps {
    // All package_session_ids the user is enrolled in. The first one is the latest
    // (the slim query ORDERs by enrolled_date DESC).
    packageSessionIds: string[];
    value: string;
    onChange: (packageSessionId: string) => void;
    // When false, the component renders nothing when the user has 0 or 1 enrollment.
    // When true, renders a disabled static label even for a single enrollment.
    alwaysShow?: boolean;
    label?: string;
    /**
     * When set, prepends an "all batches" entry with this label and the value
     * {@link ALL_BATCHES}. Still hidden for a single enrollment unless `alwaysShow`.
     */
    allLabel?: string;
}

/** Value of the optional "all batches" entry (Radix Select can't use an empty string). */
export const ALL_BATCHES = '__all__';

// Renders a dropdown when the learner has more than one enrollment so admin can
// scope side-view actions (Portal Access redirect, Learning Progress view, Sub Org
// member fetch, etc.) to a specific batch. Latest enrollment is the default.
export const BatchPicker = ({
    packageSessionIds,
    value,
    onChange,
    alwaysShow = false,
    label,
    allLabel,
}: BatchPickerProps) => {
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const options = useMemo(() => {
        return packageSessionIds.map((psId) => {
            const details = getDetailsFromPackageSessionId({ packageSessionId: psId });
            const packageName = removeDefaultPrefix(details?.package_dto?.package_name || '');
            const levelName = details?.level?.level_name;
            const cleanedLevel =
                levelName && levelName !== 'DEFAULT' ? removeDefaultPrefix(levelName) : '';
            const composed = cleanedLevel
                ? `${packageName} - ${cleanedLevel}`.trim()
                : packageName || psId;
            return { id: psId, label: composed || psId };
        });
    }, [packageSessionIds, getDetailsFromPackageSessionId]);

    if (options.length === 0) return null;
    if (options.length === 1 && !alwaysShow) return null;

    return (
        <div className="mb-3 flex flex-col gap-1">
            <Label className="text-xs text-neutral-500">{label ?? `Select ${batchTerm}`}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-9 w-full text-sm">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {allLabel && <SelectItem value={ALL_BATCHES}>{allLabel}</SelectItem>}
                    {options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
};

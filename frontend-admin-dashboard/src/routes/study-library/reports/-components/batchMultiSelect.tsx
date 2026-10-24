import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MultiSelect } from '@/components/design-system/multi-select';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn, convertCapitalToTitleCase } from '@/lib/utils';

/**
 * One selectable batch (package session) for the Learning Reports pickers.
 *
 * Every report endpoint takes a single package_session_id, so multi-batch
 * reports fan out one request per selected option and label each result with
 * `label` / `courseName` / `batchLabel` from here.
 */
export interface BatchOption {
    /** package_session_id */
    value: string;
    /** "Course · Level · Session" — DEFAULT placeholders skipped. */
    label: string;
    courseId: string;
    courseName: string;
    sessionId: string;
    sessionName: string;
    levelId: string;
    levelName: string;
    /** "Session · Level" — empty when both are the DEFAULT placeholder. */
    batchLabel: string;
}

const isDefault = (id: string | undefined, name: string | undefined) =>
    id === 'DEFAULT' || (name ?? '').trim().toUpperCase() === 'DEFAULT';

export const toBatchOption = (batch: BatchForSessionType): BatchOption => {
    const courseName = convertCapitalToTitleCase(batch.package_dto?.package_name ?? '');
    const levelName = isDefault(batch.level?.id, batch.level?.level_name)
        ? ''
        : convertCapitalToTitleCase(batch.level?.level_name ?? '');
    const sessionName = isDefault(batch.session?.id, batch.session?.session_name)
        ? ''
        : convertCapitalToTitleCase(batch.session?.session_name ?? '');
    const childName = batch.name?.trim() ? convertCapitalToTitleCase(batch.name.trim()) : '';
    return {
        value: batch.id,
        label: [courseName, levelName, sessionName, childName].filter(Boolean).join(' · '),
        courseId: batch.package_dto?.id ?? '',
        courseName,
        sessionId: batch.session?.id ?? '',
        sessionName,
        levelId: batch.level?.id ?? '',
        levelName,
        batchLabel: [sessionName, levelName, childName].filter(Boolean).join(' · '),
    };
};

/** Every batch of the institute as picker options, sorted by label. */
export function useBatchOptions(): BatchOption[] {
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    return useMemo(
        () =>
            (instituteDetails?.batches_for_sessions ?? [])
                .map(toBatchOption)
                .sort((a, b) => a.label.localeCompare(b.label)),
        [instituteDetails]
    );
}

/** package_session_id → option, for labelling fanned-out results. */
export function useBatchLookup(): Map<string, BatchOption> {
    const options = useBatchOptions();
    return useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
}

interface BatchMultiSelectProps {
    selected: string[];
    onChange: (ids: string[]) => void;
    disabled?: boolean;
    /** Validation message rendered under the control. */
    error?: string;
    /** Hide the label row (when the caller renders its own). */
    hideLabel?: boolean;
    className?: string;
}

/**
 * Searchable multi-select of every batch in the institute, replacing the
 * Course → Session → Level cascade on the Learning Reports pickers so a
 * report can be generated for several batches at once.
 */
export default function BatchMultiSelect({
    selected,
    onChange,
    disabled = false,
    error,
    hideLabel = false,
    className,
}: BatchMultiSelectProps) {
    const { t } = useTranslation('studyLibraryReportsBatchMultiSelect');
    const options = useBatchOptions();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchTermPlural = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);

    return (
        <div className={cn('flex flex-col gap-1', className)}>
            {!hideLabel && (
                <label className="text-caption font-medium text-neutral-700">
                    {t('label', { term: batchTermPlural })}
                    <span className="ms-1 text-danger-600">*</span>
                </label>
            )}
            <MultiSelect
                options={options}
                selected={selected}
                onChange={onChange}
                disabled={disabled || options.length === 0}
                checkboxes
                placeholder={t('placeholder', { term: batchTermPlural.toLowerCase() })}
                className="h-auto min-h-9 py-1 text-body font-normal"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
                {error ? (
                    <span className="text-caption text-danger-600">{error}</span>
                ) : (
                    <span className="text-caption text-neutral-500">
                        {selected.length > 0
                            ? t('selectedCount', {
                                  count: selected.length,
                                  term: batchTerm.toLowerCase(),
                              })
                            : t('hint', { term: batchTermPlural.toLowerCase() })}
                    </span>
                )}
                {selected.length > 0 && !disabled && (
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        className="text-caption font-medium text-primary-500 hover:underline"
                    >
                        {t('clear')}
                    </button>
                )}
            </div>
        </div>
    );
}

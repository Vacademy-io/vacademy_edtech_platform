import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import DateRangeFilter from '@/components/design-system/date-range-filter';
import { getInstituteId } from '@/constants/helper';
import { useLearnerDetailsForBatches } from '../../-store/useLearnersDetails';
import BatchMultiSelect, { useBatchLookup } from '../batchMultiSelect';
import { toast } from 'sonner';

export interface AppliedLiveBatch {
    packageSessionId: string;
    /** Full picker label — "Course · Level · Session". */
    label: string;
    courseName: string;
    /** "Session · Level" — empty when both are DEFAULT. */
    batchLabel: string;
}

export interface AppliedLiveFilters {
    /** In learner mode only the selected batches the learner is enrolled in. */
    batches: AppliedLiveBatch[];
    startDate: string;
    endDate: string;
    userId?: string;
    learnerName?: string;
    /**
     * Stamped per "Generate" click and part of every query key, so re-running the
     * same batch + range always fetches fresh numbers (the mutation-based
     * version fetched on every click) while paging within a run stays cached.
     */
    runId: number;
}

const buildSchema = (t: TFunction, withLearner: boolean) =>
    z
        .object({
            batches: z.array(z.string()).min(1, t('validation.batchRequired')),
            startDate: z.string().min(1, t('validation.startDateRequired')),
            endDate: z.string().min(1, t('validation.endDateRequired')),
            learner: withLearner
                ? z.string().min(1, t('validation.learnerRequired'))
                : z.string().optional(),
        })
        .refine(
            (data) => {
                const start = new Date(data.startDate);
                const end = new Date(data.endDate);
                const diffInDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                return diffInDays <= 31;
            },
            {
                message: t('validation.dateRangeWithinMonth'),
                path: ['startDate'],
            }
        );

interface Props {
    withLearner?: boolean;
    submitting?: boolean;
    onApply: (filters: AppliedLiveFilters) => void;
}

export default function LiveReportFilterForm({
    withLearner = false,
    submitting = false,
    onApply,
}: Props) {
    const { t } = useTranslation('studyLibraryLiveReportFilterForm');
    const batchLookup = useBatchLookup();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);

    type FormValues = z.infer<ReturnType<typeof buildSchema>>;
    const {
        handleSubmit,
        setValue,
        watch,
        clearErrors,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(buildSchema(t, withLearner)),
        defaultValues: { batches: [], startDate: '', endDate: '', learner: '' },
    });

    const selectedBatches = watch('batches');
    const selectedLearner = watch('learner');

    // Learner mode: the union of learners across the selected batches.
    const { learners, isLoading: isLearnersLoading } = useLearnerDetailsForBatches(
        withLearner ? selectedBatches : [],
        getInstituteId() || ''
    );

    // A learner that is no longer in any selected batch can't stay picked.
    useEffect(() => {
        if (
            withLearner &&
            selectedLearner &&
            !isLearnersLoading &&
            !learners.some((l) => l.user_id === selectedLearner)
        ) {
            setValue('learner', '');
        }
    }, [learners, isLearnersLoading, selectedLearner, withLearner, setValue]);

    const onSubmit = (data: FormValues) => {
        const learner = withLearner ? learners.find((l) => l.user_id === data.learner) : undefined;
        // Learner mode: only report on the batches the learner is enrolled in.
        const batchIds = withLearner
            ? data.batches.filter((id) => learner?.batchIds.includes(id))
            : data.batches;
        if (!batchIds.length) {
            toast.error(t('learnerNotInBatches'));
            return;
        }
        onApply({
            batches: batchIds.map((id) => {
                const option = batchLookup.get(id);
                return {
                    packageSessionId: id,
                    label: option?.label ?? '',
                    courseName: option?.courseName ?? '',
                    batchLabel: option?.batchLabel ?? '',
                };
            }),
            startDate: data.startDate,
            endDate: data.endDate,
            userId: withLearner ? data.learner : undefined,
            learnerName: learner?.full_name,
            runId: Date.now(),
        });
    };

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <BatchMultiSelect
                        selected={selectedBatches}
                        onChange={(ids) => {
                            setValue('batches', ids);
                            if (ids.length) clearErrors('batches');
                        }}
                        error={errors.batches?.message}
                    />

                    {withLearner && (
                        <div className="flex flex-col gap-1">
                            <label className="text-caption font-medium text-neutral-700">
                                {learnerTerm}
                                <span className="ms-1 text-danger-600">*</span>
                            </label>
                            <SearchableSelect
                                options={learners.map((l) => ({
                                    label: l.full_name,
                                    value: l.user_id,
                                }))}
                                value={selectedLearner ?? ''}
                                onChange={(value) => {
                                    setValue('learner', value);
                                    clearErrors('learner');
                                }}
                                placeholder={
                                    isLearnersLoading
                                        ? t('loading')
                                        : t('selectPlaceholder', { term: learnerTerm })
                                }
                                searchPlaceholder={t('searchPlaceholder', { term: learnerTerm })}
                                disabled={!selectedBatches.length || !learners.length}
                                triggerClassName="h-9 text-body"
                            />
                            {errors.learner ? (
                                <span className="text-caption text-danger-600">
                                    {errors.learner.message as string}
                                </span>
                            ) : (
                                <span className="text-caption text-neutral-500">
                                    {selectedBatches.length
                                        ? t('learnerHint', { count: learners.length })
                                        : t('pickBatchFirst', { batch: batchTerm.toLowerCase() })}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <DateRangeFilter
                            onChange={(res) => {
                                if (res) {
                                    const [sDay, sMonth, sYear] = res.startDate.split('/');
                                    const [eDay, eMonth, eYear] = res.endDate.split('/');
                                    setValue('startDate', `${sYear}-${sMonth}-${sDay}`);
                                    setValue('endDate', `${eYear}-${eMonth}-${eDay}`);
                                    clearErrors('startDate');
                                    clearErrors('endDate');
                                } else {
                                    setValue('startDate', '');
                                    setValue('endDate', '');
                                }
                            }}
                        />
                    </div>
                    <div className="sm:mb-1">
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            className="h-9 px-4 text-body"
                            disabled={submitting}
                        >
                            {submitting ? t('loading') : t('generateReport')}
                        </MyButton>
                    </div>
                </div>

                {(errors.startDate || errors.endDate) && (
                    <div className="rounded-md border border-danger-200 bg-danger-50 p-3">
                        <p className="mb-1 text-body font-medium text-danger-700">
                            {t('fixFollowing')}
                        </p>
                        <ul className="space-y-1">
                            {errors.startDate && (
                                <li className="text-caption text-danger-600">
                                    • {errors.startDate.message as string}
                                </li>
                            )}
                            {errors.endDate && (
                                <li className="text-caption text-danger-600">
                                    • {errors.endDate.message as string}
                                </li>
                            )}
                        </ul>
                    </div>
                )}
            </form>
        </div>
    );
}

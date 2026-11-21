import { Doubt as DoubtType } from '../../-types/get-doubts-type';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Doubt } from './doubt';
import { Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export const DoubtList = ({
    allDoubts,
    isLoading,
    lastDoubtElementRef,
    refetch,
    isFetchingNextPage,
    status,
}: {
    allDoubts: DoubtType[];
    isLoading: boolean;
    lastDoubtElementRef: (node: HTMLDivElement) => void;
    refetch: () => void;
    isFetchingNextPage: boolean;
    status: string;
}) => {
    const { t } = useTranslation('studyLibraryDoubtList');
    const showInitialLoader = isLoading && allDoubts.length === 0;
    const showEmptyState = !isLoading && !isFetchingNextPage && allDoubts.length === 0;

    return (
        <div className="flex flex-col gap-4 py-1">
            {showInitialLoader && <DashboardLoader />}

            {!showInitialLoader && allDoubts.length > 0 && (
                <div className="flex flex-col gap-3">
                    {allDoubts.map((doubt, index) => (
                        <div
                            key={doubt.id || index}
                            ref={index === allDoubts.length - 1 ? lastDoubtElementRef : undefined}
                        >
                            <Doubt doubt={doubt} refetch={refetch} />
                        </div>
                    ))}
                </div>
            )}

            {showEmptyState && (
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
                    <Info size={48} className="text-neutral-400" />
                    <p className="text-base font-medium text-neutral-600">{t('noDoubtsHere')}</p>
                    <p className="text-sm text-neutral-500">
                        {status === 'ALL'
                            ? t('emptyState.all')
                            : status === 'RESOLVED'
                              ? t('emptyState.resolved')
                              : t('emptyState.other')}
                    </p>
                </div>
            )}

            {isFetchingNextPage && (
                <div className="py-4">
                    <DashboardLoader />
                </div>
            )}
        </div>
    );
};

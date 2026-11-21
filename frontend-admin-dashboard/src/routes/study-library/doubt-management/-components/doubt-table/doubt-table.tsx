import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { useDoubtTable } from '../../-hooks/useDoubtTable';
import { DOUBTS_TABLE_COLUMN_WIDTHS } from '@/components/design-system/utils/constants/table-layout';
import { useDoubtTableColumns } from '../../-hooks/useDoubtColumns';
import { ChatTeardropDots } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

const EmptyState = () => {
    const { t } = useTranslation('studyLibraryDoubtTable');
    return (
        <div
            role="status"
            className="flex min-h-[360px] w-full animate-in fade-in duration-500 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-neutral-200 bg-white/60 px-6 py-16 text-center"
        >
            <div className="flex size-16 items-center justify-center rounded-full bg-primary-50">
                <ChatTeardropDots size={32} weight="duotone" className="text-primary-500" />
            </div>
            <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-neutral-800">{t('emptyTitle')}</h3>
                <p className="max-w-sm text-sm text-neutral-500">{t('emptyBody')}</p>
            </div>
        </div>
    );
};

export const DoubtTable = () => {
    const { currentPage, setCurrentPage, doubts, isLoading, error } = useDoubtTable();
    const { columns } = useDoubtTableColumns();
    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };
    const isEmpty = !isLoading && doubts?.content.length === 0;
    return (
        <div className="flex w-full flex-col gap-4 sm:gap-6">
            {isEmpty ? (
                <EmptyState />
            ) : (
                <>
                    <MyTable<Doubt>
                        currentPage={currentPage}
                        data={doubts}
                        columns={columns}
                        isLoading={isLoading}
                        error={error}
                        scrollable
                        columnWidths={DOUBTS_TABLE_COLUMN_WIDTHS}
                    />
                    {doubts && doubts.total_pages > 1 && (
                        <MyPagination
                            currentPage={currentPage}
                            totalPages={doubts.total_pages}
                            onPageChange={handlePageChange}
                        />
                    )}
                </>
            )}
        </div>
    );
};

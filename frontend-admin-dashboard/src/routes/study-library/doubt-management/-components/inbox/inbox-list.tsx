import {
    Doubt,
    PaginatedDoubtResponse,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { UserBasicDetails } from '@/services/get_user_basic_details';
import { MyPagination } from '@/components/design-system/pagination';
import { ChatTeardropDots } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { InboxListItem } from './inbox-list-item';

/** Left pane: scrollable doubt list + pagination. */
export const InboxList = ({
    list,
    isLoading,
    error,
    selectedId,
    onSelect,
    userDetailsRecord,
    page,
    currentPage,
    setCurrentPage,
}: {
    list: Doubt[];
    isLoading: boolean;
    error: unknown;
    selectedId: string | null;
    onSelect: (id: string) => void;
    userDetailsRecord: Record<string, UserBasicDetails>;
    page?: PaginatedDoubtResponse;
    currentPage: number;
    setCurrentPage: (page: number) => void;
}) => {
    const { t } = useTranslation('studyLibraryInboxList');
    return (
        <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex flex-col gap-2 p-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-16 animate-pulse rounded-md bg-neutral-100" />
                        ))}
                    </div>
                ) : error ? (
                    <p className="p-6 text-center text-sm text-danger-600">{t('failedToLoad')}</p>
                ) : list.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                        <div className="flex size-12 items-center justify-center rounded-full bg-primary-50">
                            <ChatTeardropDots
                                size={24}
                                weight="duotone"
                                className="text-primary-500"
                            />
                        </div>
                        <p className="text-sm font-medium text-neutral-700">{t('emptyTitle')}</p>
                        <p className="text-xs text-neutral-500">{t('emptyDescription')}</p>
                    </div>
                ) : (
                    list.map((d) => (
                        <InboxListItem
                            key={d.id}
                            doubt={d}
                            selected={d.id === selectedId}
                            onSelect={() => onSelect(d.id)}
                            learnerName={userDetailsRecord[d.user_id]?.name}
                        />
                    ))
                )}
            </div>
            {page && page.total_pages > 1 && (
                <div className="border-t border-neutral-200 p-2">
                    <MyPagination
                        currentPage={currentPage}
                        totalPages={page.total_pages}
                        onPageChange={setCurrentPage}
                    />
                </div>
            )}
        </div>
    );
};

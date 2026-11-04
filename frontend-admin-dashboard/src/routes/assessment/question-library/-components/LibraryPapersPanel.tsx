import { useTranslation } from 'react-i18next';
import { Files, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLibraryPapers, type LibraryPaper } from '../-services/question-library-services';

/**
 * Whole papers on the selected topic and the topics below it, or on the whole library
 * when no topic is selected. Renders nothing when there are none: most topics have only
 * loose questions, and an empty box above the list would only push it down.
 */
export const LibraryPapersPanel = ({
    instituteId,
    nodeId,
    readOnly,
    onRemove,
}: {
    instituteId: string;
    nodeId?: string;
    readOnly: boolean;
    onRemove: (paper: LibraryPaper) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const papers = useLibraryPapers(instituteId, nodeId);

    if (papers.isLoading) return <Skeleton className="h-16 w-full rounded-lg" />;
    if (papers.isError) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 text-body text-neutral-600">
                <span className="flex-1">{t('papers.loadFailed')}</span>
                <MyButton buttonType="secondary" scale="small" onClick={() => papers.refetch()}>
                    {t('common.retry')}
                </MyButton>
            </div>
        );
    }
    const rows = papers.data ?? [];
    if (rows.length === 0) return null;

    return (
        <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
            <span className="text-subtitle font-semibold text-neutral-700">
                {t('papers.title')}
            </span>
            <ul className="flex flex-col gap-2">
                {rows.map((paper) => (
                    <li
                        key={paper.id}
                        className="flex items-center gap-3 rounded-md border border-neutral-100 p-2"
                    >
                        <Files size={18} className="shrink-0 text-primary-500" />
                        <span className="min-w-0 flex-1 truncate text-body text-neutral-700">
                            {paper.title}
                        </span>
                        <span className="shrink-0 text-caption text-neutral-500">
                            {t('list.total', { count: paper.question_count })}
                        </span>
                        {!readOnly && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                aria-label={t('papers.remove')}
                                onClick={() => onRemove(paper)}
                            >
                                <Trash size={16} />
                            </MyButton>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
};

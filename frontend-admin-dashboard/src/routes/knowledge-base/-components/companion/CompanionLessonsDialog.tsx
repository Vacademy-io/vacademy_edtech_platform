import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompanion } from '../../-hooks/companion';
import { leafState, type LeafLessonState } from './companion-constants';
import { LessonPreviewDialog } from './LessonPreviewDialog';

const CHIP: Record<LeafLessonState, StatusType> = {
    READY: 'SUCCESS',
    GENERATING: 'INFO',
    FAILED: 'DANGER',
    NONE: 'WARNING',
};

/**
 * Every topic the companion teaches, with its lesson status and a Preview that
 * shows the cards exactly as a student sees them — the trust builder before a
 * teacher hands the companion to a class.
 */
export function CompanionLessonsDialog({
    companionId,
    companionName,
    open,
    onOpenChange,
}: {
    companionId: string;
    companionName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const { data, isLoading } = useCompanion(open ? companionId : null);
    const [preview, setPreview] = useState<{
        id: string;
        title: string;
        prepared: boolean;
    } | null>(null);
    const learnOff = data ? !data.modes.includes('learn') : false;

    const label: Record<LeafLessonState, string> = {
        READY: t('lessons.status.ready'),
        GENERATING: t('lessons.status.preparing'),
        FAILED: t('lessons.status.failed'),
        NONE: t('lessons.status.notPrepared'),
    };

    return (
        <>
            <MyDialog
                heading={t('lessons.heading', { name: companionName })}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-3xl"
            >
                <div className="flex flex-col gap-4">
                    {data && (
                        <p className="text-body text-neutral-500">
                            {t('lessons.summary', {
                                ready: data.lessons_ready,
                                total: data.leaves_total,
                            })}
                        </p>
                    )}
                    {learnOff && (
                        <p className="text-caption text-warning-700">{t('lessons.learnOff')}</p>
                    )}
                    {isLoading && <Skeleton className="h-48 w-full rounded-md" />}
                    {data && data.topics.length === 0 && (
                        <p className="text-body text-neutral-500">{t('lessons.noTopics')}</p>
                    )}
                    {data?.topics.map((topic) => (
                        <div
                            key={topic.id}
                            className="overflow-hidden rounded-md border border-neutral-200"
                        >
                            <p className="bg-neutral-50 px-3 py-2 text-body font-semibold text-neutral-700">
                                {topic.title || t('lessons.untitled')}
                            </p>
                            <div className="divide-y divide-neutral-100">
                                {topic.leaves.map((leaf) => {
                                    const state = leafState(leaf);
                                    const title = leaf.title || t('lessons.untitled');
                                    return (
                                        <div
                                            key={leaf.id}
                                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                        >
                                            <p className="min-w-0 flex-1 text-body text-neutral-700">
                                                {title}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <StatusChip
                                                    status={CHIP[state]}
                                                    text={label[state]}
                                                    textSize="text-caption"
                                                    showIcon={false}
                                                />
                                                <MyButton
                                                    buttonType="text"
                                                    scale="medium"
                                                    disable={learnOff}
                                                    onClick={() =>
                                                        setPreview({
                                                            id: leaf.id,
                                                            title,
                                                            prepared:
                                                                state === 'READY' ||
                                                                state === 'GENERATING',
                                                        })
                                                    }
                                                >
                                                    <Eye className="me-1 size-4" />
                                                    {t('lessons.preview')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </MyDialog>

            <LessonPreviewDialog
                companionId={companionId}
                leaf={preview ? { id: preview.id, title: preview.title } : null}
                prepared={preview?.prepared ?? false}
                onOpenChange={(next) => !next && setPreview(null)}
            />
        </>
    );
}

import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BookOpen, Sparkle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useKnowledgeBases } from '@/routes/knowledge-base/-hooks';
import { CurriculumPicker } from '@/routes/knowledge-base/-components/curriculum/CurriculumPicker';
import { curriculumOnly, ownOnly } from '@/routes/knowledge-base/-components/curriculum/curriculum';

interface GenerateWithAiDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * "Generate question paper" from the Question Papers screen.
 *
 * The paper wizard lives under a knowledge base, so the only decision here is
 * WHICH material: a curriculum book (Board → Class → Subject) or one of the
 * institute's own knowledge bases. Picking one opens the wizard on it.
 */
export const GenerateWithAiDialog = ({ open, onOpenChange }: GenerateWithAiDialogProps) => {
    const { t } = useTranslation('assessmentGenerateWithAi');
    const navigate = useNavigate();
    const { data: allBases, isLoading } = useKnowledgeBases();
    const curriculum = useMemo(() => curriculumOnly(allBases), [allBases]);
    const own = useMemo(
        () => ownOnly(allBases).filter((kb) => kb.purpose !== 'institute_info'),
        [allBases]
    );

    const openWizard = (kbId: string) => {
        onOpenChange(false);
        navigate({ to: '/knowledge-base/paper/$kbId', params: { kbId } });
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
        >
            <div className="flex flex-col gap-5 p-6">
                <p className="text-body text-neutral-600">{t('description')}</p>

                {isLoading && <Skeleton className="h-24 w-full rounded-md" />}

                {!isLoading && curriculum.length > 0 && (
                    <section className="flex flex-col gap-2">
                        <p className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                            <BookOpen className="size-4 text-primary-500" />
                            {t('curriculum.heading')}
                        </p>
                        <p className="text-caption text-neutral-500">{t('curriculum.hint')}</p>
                        <CurriculumPicker
                            knowledgeBases={curriculum}
                            onPick={(kb) => openWizard(kb.id)}
                        />
                    </section>
                )}

                {!isLoading && own.length > 0 && (
                    <section className="flex flex-col gap-2">
                        <p className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                            <Sparkle className="size-4 text-primary-500" />
                            {t('own.heading')}
                        </p>
                        <div className="flex max-h-64 flex-col divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                            {own.map((kb) => (
                                <button
                                    key={kb.id}
                                    type="button"
                                    onClick={() => openWizard(kb.id)}
                                    className="flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-primary-50"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-body text-neutral-700">
                                            {kb.name}
                                        </span>
                                        <span className="block text-caption text-neutral-500">
                                            {t('own.sources', { count: kb.source_count ?? 0 })}
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-caption text-primary-500">
                                        {t('own.use')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {!isLoading && curriculum.length === 0 && own.length === 0 && (
                    <p className="text-body text-neutral-500">{t('empty')}</p>
                )}
            </div>
        </MyDialog>
    );
};

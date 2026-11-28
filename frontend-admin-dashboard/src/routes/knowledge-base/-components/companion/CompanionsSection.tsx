import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    Archive,
    ChartBar,
    Lightning,
    ListChecks,
    PencilSimple,
    Plus,
    Spinner,
    Student,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
    hasGeneratingLessons,
    useArchiveCompanion,
    useCompanion,
    useCompanions,
} from '../../-hooks/companion';
import { companionErrorMessage } from '../../-services/companion-service';
import type { Companion } from '../../-types/companion';
import { describeAssignments } from './companion-constants';
import { CompanionFormDialog } from './CompanionFormDialog';
import { CompanionInsightsDialog } from './CompanionInsightsDialog';
import { CompanionLessonsDialog } from './CompanionLessonsDialog';
import { PrepareLessonsDialog } from './PrepareLessonsDialog';

type Panel = 'edit' | 'prepare' | 'insights' | 'lessons' | 'archive';

function CompanionRow({
    companion,
    onOpen,
}: {
    companion: Companion;
    onOpen: (panel: Panel) => void;
}) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    // The list has no lesson counts; the detail does (and polls while preparing).
    const { data: detail } = useCompanion(companion.id);
    const ready = detail?.lessons_ready ?? 0;
    const total = detail?.leaves_total ?? 0;
    const preparing = hasGeneratingLessons(detail);
    const active = companion.status === 'ACTIVE';

    return (
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-h3">
                    {companion.avatar_emoji || '🦉'}
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-subtitle font-semibold text-neutral-700">
                            {companion.name}
                        </p>
                        <StatusChip
                            status={active ? 'SUCCESS' : 'WARNING'}
                            text={active ? t('status.active') : t('status.paused')}
                            textSize="text-caption"
                            showIcon={false}
                        />
                    </div>
                    <p className="text-caption text-neutral-500">
                        {describeAssignments(companion, t)}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                        {detail ? (
                            <>
                                <Progress
                                    value={total ? (ready / total) * 100 : 0}
                                    className="h-1.5 w-28"
                                />
                                <span className="text-caption text-neutral-500">
                                    {t('row.lessonsReady', { ready, total })}
                                </span>
                                {preparing && (
                                    <span className="flex items-center gap-1 text-caption text-primary-500">
                                        <Spinner className="size-3.5 animate-spin" />
                                        {t('row.preparing')}
                                    </span>
                                )}
                            </>
                        ) : (
                            <Skeleton className="h-3 w-40" />
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <MyButton buttonType="secondary" scale="medium" onClick={() => onOpen('edit')}>
                    <PencilSimple className="me-1 size-4" />
                    {t('row.edit')}
                </MyButton>
                <MyButton buttonType="secondary" scale="medium" onClick={() => onOpen('lessons')}>
                    <ListChecks className="me-1 size-4" />
                    {t('row.lessons')}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => onOpen('prepare')}
                    disable={Boolean(detail) && total > 0 && ready >= total}
                >
                    <Lightning className="me-1 size-4" />
                    {t('row.prepare')}
                </MyButton>
                <MyButton buttonType="secondary" scale="medium" onClick={() => onOpen('insights')}>
                    <ChartBar className="me-1 size-4" />
                    {t('row.progress')}
                </MyButton>
                <MyButton
                    buttonType="text"
                    scale="medium"
                    onClick={() => onOpen('archive')}
                    className="text-danger-600"
                >
                    <Archive className="me-1 size-4" />
                    {t('row.archive')}
                </MyButton>
            </div>
        </div>
    );
}

/**
 * "Student companions" on the KB page: AI study buddies built on this KB that
 * teach students topic by topic, strictly from the material.
 */
export function CompanionsSection({ kbId, kbName }: { kbId: string; kbName: string }) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const { data: companions, isLoading, isError, refetch } = useCompanions(kbId);
    const archive = useArchiveCompanion(kbId);
    const [createOpen, setCreateOpen] = useState(false);
    const [active, setActive] = useState<{ companion: Companion; panel: Panel } | null>(null);

    const visible = (companions ?? []).filter((c) => c.status !== 'ARCHIVED');
    const current = active?.companion;
    const close = (open: boolean) => !open && setActive(null);

    const confirmArchive = async () => {
        if (!current) return;
        try {
            await archive.mutateAsync(current.id);
            toast.success(t('toast.archived', { name: current.name }));
            setActive(null);
        } catch (e) {
            toast.error(companionErrorMessage(e) ?? t('toast.archiveFailed'));
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <p className="text-subtitle font-semibold text-neutral-700">{t('heading')}</p>
                    <p className="text-caption text-neutral-500">{t('subheading')}</p>
                </div>
                {visible.length > 0 && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus className="me-1 size-4" />
                        {t('createButton')}
                    </MyButton>
                )}
            </div>

            <Card className="overflow-hidden">
                {isLoading && <Skeleton className="m-4 h-16 rounded-md" />}
                {isError && (
                    <div className="flex flex-col items-center gap-2 p-6 text-center">
                        <WarningCircle className="size-6 text-danger-500" />
                        <p className="text-body text-neutral-600">{t('loadError')}</p>
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('actions.tryAgain')}
                        </MyButton>
                    </div>
                )}
                {!isLoading && !isError && visible.length === 0 && (
                    <div className="flex flex-col items-center gap-3 p-8 text-center">
                        <div className="rounded-full bg-primary-50 p-3">
                            <Student className="size-7 text-primary-500" />
                        </div>
                        <div>
                            <p className="text-body font-medium text-neutral-700">
                                {t('empty.title')}
                            </p>
                            <p className="mx-auto max-w-md text-caption text-neutral-500">
                                {t('empty.body')}
                            </p>
                        </div>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setCreateOpen(true)}
                        >
                            <Plus className="me-1 size-4" />
                            {t('createButton')}
                        </MyButton>
                    </div>
                )}
                {visible.length > 0 && (
                    <div className="divide-y divide-neutral-100">
                        {visible.map((c) => (
                            <CompanionRow
                                key={c.id}
                                companion={c}
                                onOpen={(panel) => setActive({ companion: c, panel })}
                            />
                        ))}
                    </div>
                )}
            </Card>

            <CompanionFormDialog
                kbId={kbId}
                kbName={kbName}
                open={createOpen}
                onOpenChange={setCreateOpen}
            />

            {current && (
                <>
                    <CompanionFormDialog
                        kbId={kbId}
                        kbName={kbName}
                        open={active?.panel === 'edit'}
                        onOpenChange={close}
                        companion={current}
                    />
                    <PrepareLessonsDialog
                        companionId={current.id}
                        open={active?.panel === 'prepare'}
                        onOpenChange={close}
                    />
                    <CompanionInsightsDialog
                        companionId={current.id}
                        companionName={current.name}
                        open={active?.panel === 'insights'}
                        onOpenChange={close}
                    />
                    <CompanionLessonsDialog
                        companionId={current.id}
                        companionName={current.name}
                        open={active?.panel === 'lessons'}
                        onOpenChange={close}
                    />
                    <MyDialog
                        heading={t('archive.heading', { name: current.name })}
                        open={active?.panel === 'archive'}
                        onOpenChange={close}
                        dialogWidth="max-w-md"
                        footer={
                            <div className="flex w-full justify-end gap-2">
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => setActive(null)}
                                >
                                    {t('actions.cancel')}
                                </MyButton>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={confirmArchive}
                                    disable={archive.isPending}
                                >
                                    {t('archive.confirm')}
                                </MyButton>
                            </div>
                        }
                    >
                        <p className="text-body text-neutral-600">{t('archive.body')}</p>
                    </MyDialog>
                </>
            )}
        </div>
    );
}

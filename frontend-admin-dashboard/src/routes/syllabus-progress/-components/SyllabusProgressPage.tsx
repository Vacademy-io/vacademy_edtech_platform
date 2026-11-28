import { useEffect, useMemo } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    BookOpenText,
    GearSix,
    ListChecks,
    ToggleLeft,
    UserCircleMinus,
    WarningCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { syllabusErrorMessage, useSyllabusBatches } from '@/services/syllabus-progress';
import { BatchProgress } from './BatchProgress';
import { EmptyState } from './EmptyState';
import { LearnerProgress } from './LearnerProgress';
import { LearnerSearch } from './LearnerSearch';

const routeApi = getRouteApi('/syllabus-progress/');

/** Teachers mark each learner's progress through the stage syllabus, week block by week block. */
export function SyllabusProgressPage() {
    const { t } = useTranslation('syllabusProgress');
    const navigate = useNavigate();
    const { packageSessionId, userId } = routeApi.useSearch();
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getCurrentInstituteId();

    useEffect(() => {
        setNavHeading(t('page.title'));
    }, [setNavHeading, t]);

    const { data, isLoading, isError, error, refetch } = useSyllabusBatches(instituteId);
    const batches = useMemo(() => data?.batches ?? [], [data]);

    const options = useMemo(
        () =>
            batches.map((b) => ({
                value: b.package_session_id,
                label: t('picker.option', {
                    course: b.course_name,
                    stage: b.level_name,
                    batch: b.batch_name,
                    count: b.learners,
                }),
                keywords: [b.course_name, b.level_name, b.batch_name],
            })),
        [batches, t]
    );

    // A batch from the URL wins; with only one batch, pick it.
    const selectedId =
        packageSessionId && batches.some((b) => b.package_session_id === packageSessionId)
            ? packageSessionId
            : batches.length === 1
              ? batches[0]?.package_session_id ?? ''
              : '';
    const selected = batches.find((b) => b.package_session_id === selectedId);

    const selectBatch = (next: string) =>
        void navigate({
            to: '/syllabus-progress',
            search: { packageSessionId: next || undefined },
        });

    const openLearner = (next: string) =>
        void navigate({
            to: '/syllabus-progress',
            search: { packageSessionId: packageSessionId || undefined, userId: next },
        });

    const closeLearner = () =>
        void navigate({
            to: '/syllabus-progress',
            search: { packageSessionId: packageSessionId || undefined },
        });

    const openSettings = () =>
        void navigate({ to: '/settings', search: { selectedTab: 'syllabusProgress' } });

    const renderBody = () => {
        if (!instituteId || isLoading) {
            return (
                <div className="space-y-4">
                    <Skeleton className="h-10 w-full md:w-96" />
                    <Skeleton className="h-64 w-full" />
                </div>
            );
        }
        if (isError || !data) {
            return (
                <Alert variant="destructive">
                    <WarningCircle className="size-4" />
                    <AlertTitle>{t('page.loadFailed')}</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-3">
                        {syllabusErrorMessage(error, t('page.loadFailedHint'))}
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void refetch()}
                        >
                            <ArrowClockwise className="size-4" aria-hidden /> {t('retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            );
        }
        if (!data.enabled) {
            return (
                <EmptyState
                    icon={<ToggleLeft className="size-8" aria-hidden />}
                    title={t('off.title')}
                    body={t('off.body')}
                    action={
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={openSettings}
                        >
                            <GearSix className="size-4" aria-hidden /> {t('off.action')}
                        </MyButton>
                    }
                />
            );
        }
        if (batches.length === 0 && data.scope === 'ASSIGNED') {
            return (
                <EmptyState
                    icon={<UserCircleMinus className="size-8" aria-hidden />}
                    title={t('noAssigned.title')}
                    body={t('noAssigned.body')}
                />
            );
        }
        if (batches.length === 0) {
            return (
                <EmptyState
                    icon={<BookOpenText className="size-8" aria-hidden />}
                    title={t('noBatches.title')}
                    body={t('noBatches.body')}
                />
            );
        }
        return (
            <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="flex min-w-0 flex-col gap-2 lg:flex-1">
                        <span className="text-body font-semibold text-neutral-800">
                            {t('picker.label')}
                        </span>
                        <div className="w-full md:max-w-xl">
                            <SearchableSelect
                                options={options}
                                value={selectedId}
                                onChange={selectBatch}
                                placeholder={t('picker.placeholder')}
                                searchPlaceholder={t('picker.search')}
                                emptyText={t('picker.empty')}
                            />
                        </div>
                        {selected && !userId && (
                            <p className="text-caption text-neutral-500">
                                {t('picker.summary', {
                                    learners: selected.learners,
                                    blocks: selected.blocks,
                                })}
                            </p>
                        )}
                    </div>
                    {instituteId && (
                        <div className="flex min-w-0 flex-col gap-2 lg:w-96">
                            <span className="text-body font-semibold text-neutral-800">
                                {t('search.label')}
                            </span>
                            <LearnerSearch instituteId={instituteId} onPick={openLearner} />
                        </div>
                    )}
                </div>
                {userId && instituteId ? (
                    <LearnerProgress
                        key={userId}
                        instituteId={instituteId}
                        userId={userId}
                        onBack={closeLearner}
                        onOpenBatch={selectBatch}
                    />
                ) : selectedId && instituteId ? (
                    <BatchProgress
                        key={selectedId}
                        instituteId={instituteId}
                        packageSessionId={selectedId}
                    />
                ) : (
                    <EmptyState
                        icon={<ListChecks className="size-8" aria-hidden />}
                        title={t('picker.promptTitle')}
                        body={t('picker.promptBody')}
                    />
                )}
            </div>
        );
    };

    return (
        <LayoutContainer>
            <div className="min-w-0 space-y-6 p-4 sm:p-6">
                <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-h2-semibold text-neutral-900">{t('page.title')}</h1>
                        <p className="mt-1 max-w-2xl text-body text-neutral-600">
                            {t('page.subtitle')}
                        </p>
                    </div>
                    {data?.enabled && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="shrink-0"
                            onClick={openSettings}
                        >
                            <GearSix className="size-4" aria-hidden /> {t('page.settings')}
                        </MyButton>
                    )}
                </header>
                {renderBody()}
            </div>
        </LayoutContainer>
    );
}

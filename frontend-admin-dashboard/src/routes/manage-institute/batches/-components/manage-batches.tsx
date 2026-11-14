import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { BatchesEnhancedCounts } from './BatchesEnhancedCounts';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BatchSection } from './batch-section';
import { BatchesToolbar, BatchView } from './batches-toolbar';
import { useGetBatchesQuery } from '@/routes/manage-institute/batches/-services/get-batches';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CreateBatchDialog } from './create-batch-dialog';
import {
    DropdownItemType,
    DropdownValueType,
} from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { MyButton } from '@/components/design-system/button';
import { EmptyBatchImage } from '@/assets/svgs';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { DownloadSimple, Plus, Stack } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { buildCsv, downloadCsv } from '@/routes/manage-custom-teams/-utils/list-export';
import {
    applyBatchFilters,
    DEFAULT_BATCH_FILTERS,
    getBatchDisplayStatus,
    hasActiveBatchFilters,
} from '@/routes/manage-institute/batches/-utils/batch-filters';

export const ManageBatches = () => {
    const { t } = useTranslation('manageInstituteManageBatches');
    const { setNavHeading } = useNavHeadingStore();

    const { getAllSessions, instituteDetails } = useInstituteDetailsStore();
    const [sessionList, setSessionList] = useState<DropdownItemType[]>(
        getAllSessions().map((session) => ({
            id: session.id,
            name: session.session_name,
        }))
    );

    const [currentSession, setCurrentSession] = useState<DropdownItemType | undefined>();
    const [filters, setFilters] = useState(DEFAULT_BATCH_FILTERS);
    const [view, setView] = useState<BatchView>('grid');
    const [createDialog, setCreateDialog] = useState<{
        open: boolean;
        course: { id: string; name: string } | null;
    }>({ open: false, course: null });

    useEffect(() => {
        if (sessionList.length > 0) {
            let selectedSession = sessionList[0];
            getAllSessions().forEach((session) => {
                if (session.status === 'ACTIVE') {
                    selectedSession = { id: session.id, name: session.session_name };
                }
            });
            setCurrentSession(selectedSession);
        } else {
            setCurrentSession(undefined);
        }
    }, [sessionList]);

    const { data, isLoading, isError } = useGetBatchesQuery({
        sessionId: currentSession?.id || '',
    });

    const handleSessionChange = (value: DropdownValueType) => {
        if (value && typeof value === 'object' && 'id' in value && 'name' in value) {
            setCurrentSession(value as DropdownItemType);
        }
    };

    useEffect(() => {
        setSessionList(
            getAllSessions().map((session) => ({
                id: session.id,
                name: session.session_name,
            }))
        );
    }, [instituteDetails]);

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, []);

    /**
     * Each course with only the batches that belong to the selected session. A
     * course whose batches all sit in other sessions is left out; a course with
     * no batches at all stays, so its empty state shows.
     */
    const sessionCourses = useMemo(() => {
        if (!data) return [];
        const sessionsForBatches = instituteDetails?.batches_for_sessions;
        if (!currentSession?.id || !sessionsForBatches) return data;
        const sessionOf = new Map(
            sessionsForBatches.map((detail) => [detail.id, detail.session.id])
        );
        return data
            .map((course) => ({
                course,
                batches: course.batches.filter(
                    (batch) => sessionOf.get(batch.package_session_id) === currentSession.id
                ),
            }))
            .filter(({ course, batches }) => batches.length > 0 || course.batches.length === 0)
            .map(({ course, batches }) => ({ ...course, batches }));
    }, [data, instituteDetails, currentSession?.id]);

    const visibleCourses = useMemo(
        () => applyBatchFilters(sessionCourses, filters),
        [sessionCourses, filters]
    );

    const totalsByCourse = useMemo(
        () =>
            new Map(
                sessionCourses.map((course) => [
                    course.package_dto.id,
                    {
                        batches: course.batches.length,
                        learners: course.batches.reduce(
                            (sum, batch) => sum + (batch.count_students ?? 0),
                            0
                        ),
                    },
                ])
            ),
        [sessionCourses]
    );

    const openCreateBatch = (course: { id: string; name: string } | null = null) =>
        setCreateDialog({ open: true, course });

    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    // Derived from the list already loaded for this session — no extra request.
    const sessionBatchCount = sessionCourses.reduce((sum, c) => sum + c.batches.length, 0);
    const visibleBatchCount = visibleCourses.reduce((sum, c) => sum + c.batches.length, 0);
    const visibleLearnerCount = visibleCourses.reduce(
        (sum, c) => sum + c.batches.reduce((n, b) => n + (b.count_students ?? 0), 0),
        0
    );

    /** CSV of the batches on screen (current session + filters), built in the browser. */
    const exportBatches = () => {
        const rows = visibleCourses.flatMap((course) =>
            course.batches.map((batch) => [
                course.package_dto.package_name,
                batch.batch_name,
                currentSession?.name ?? '',
                t(`toolbar.status.${getBatchDisplayStatus(batch)}`),
                batch.count_students ?? 0,
                batch.invite_code ?? '',
                batch.start_date ? dayjs(batch.start_date).format('YYYY-MM-DD') : '',
            ])
        );
        const headers = [
            getTerminology(ContentTerms.Course, SystemTerms.Course),
            batchTerm,
            getTerminology(ContentTerms.Session, SystemTerms.Session),
            t('csv.status'),
            getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
            t('csv.inviteCode'),
            t('csv.startDate'),
        ];
        downloadCsv(
            buildCsv(headers, rows),
            `${batchTerm}-${currentSession?.name ?? 'all'}.csv`.replace(/\s+/g, '-')
        );
    };

    if (isLoading) return <DashboardLoader />;

    if (isError)
        return (
            <div className="flex h-full flex-col items-center justify-center text-neutral-500">
                <p>{t('fetchError')}</p>
            </div>
        );

    const hasCourses = sessionCourses.length > 0;

    return (
        <div className="flex flex-col gap-5 p-2 text-neutral-700 sm:gap-6">
            <ScreenHeader
                icon={Stack}
                title={t('heading', { learner: learnerTerm })}
                subtitle={t('subheading', {
                    learner: learnerTerm.toLocaleLowerCase(),
                    session: getTerminology(
                        ContentTerms.Session,
                        SystemTerms.Session
                    ).toLocaleLowerCase(),
                })}
                actions={
                    <>
                        {sessionList.length > 0 && currentSession !== undefined && (
                            <MyDropdown
                                currentValue={currentSession}
                                dropdownList={sessionList}
                                placeholder={t('selectSessionPlaceholder', {
                                    session: getTerminology(
                                        ContentTerms.Session,
                                        SystemTerms.Session
                                    ),
                                })}
                                handleChange={handleSessionChange}
                            />
                        )}
                        {hasCourses && (
                            <MyButton
                                scale="large"
                                buttonType="secondary"
                                className="gap-2"
                                onClick={exportBatches}
                            >
                                <DownloadSimple size={18} />
                                {t('export')}
                            </MyButton>
                        )}
                        <MyButton
                            scale="large"
                            buttonType="primary"
                            className="gap-2"
                            onClick={() => openCreateBatch()}
                        >
                            <Plus size={18} />
                            {t('createBatch', { term: batchTerm })}
                        </MyButton>
                    </>
                }
            />

            {hasCourses ? (
                <>
                    <BatchesEnhancedCounts
                        courses={sessionCourses}
                        status={filters.status}
                        onStatus={(status) => setFilters({ ...filters, status })}
                    />
                    <BatchesToolbar
                        filters={filters}
                        onChange={setFilters}
                        view={view}
                        onViewChange={setView}
                    />
                    <p className="-mt-2 text-neutral-500">
                        <span className="text-caption">
                            {t('summary', {
                                shown: visibleBatchCount.toLocaleString('en-IN'),
                                total: sessionBatchCount.toLocaleString('en-IN'),
                                batches: getTerminologyPlural(
                                    ContentTerms.Batch,
                                    SystemTerms.Batch
                                ).toLocaleLowerCase(),
                                learners: visibleLearnerCount.toLocaleString('en-IN'),
                                learnerTerm: getTerminologyPlural(
                                    RoleTerms.Learner,
                                    SystemTerms.Learner
                                ).toLocaleLowerCase(),
                            })}
                        </span>
                    </p>
                    {visibleCourses.length > 0 ? (
                        <div className="flex flex-col gap-8">
                            {visibleCourses.map((course) => {
                                const totals = totalsByCourse.get(course.package_dto.id);
                                return (
                                    <BatchSection
                                        key={course.package_dto.id}
                                        course={course}
                                        totalBatches={totals?.batches ?? 0}
                                        totalLearners={totals?.learners ?? 0}
                                        view={view}
                                        onCreateBatch={() =>
                                            openCreateBatch({
                                                id: course.package_dto.id,
                                                name: course.package_dto.package_name,
                                            })
                                        }
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-12 text-center">
                            <p className="text-subtitle font-medium text-neutral-600">
                                {t('emptyState.noMatches', { term: batchTerm.toLocaleLowerCase() })}
                            </p>
                            {hasActiveBatchFilters(filters) && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() =>
                                        setFilters({
                                            ...DEFAULT_BATCH_FILTERS,
                                            sort: filters.sort,
                                        })
                                    }
                                >
                                    {t('emptyState.clearFilters')}
                                </MyButton>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-10 text-center sm:gap-5 sm:py-16">
                    <EmptyBatchImage className="size-24 text-neutral-400 sm:size-32" />
                    <p className="text-subtitle font-medium text-neutral-600">
                        {currentSession
                            ? t('emptyState.noBatchesForSession', { session: currentSession.name })
                            : t('emptyState.noSessionsAvailable')}
                    </p>
                    <p className="max-w-md text-body text-neutral-500">
                        {currentSession
                            ? t('emptyState.createBatchHint')
                            : t('emptyState.createSessionHint')}
                    </p>
                    {currentSession && (
                        <MyButton buttonType="primary" onClick={() => openCreateBatch()}>
                            <Plus size={18} className="me-1.5" />
                            {t('createBatch', { term: batchTerm })}
                        </MyButton>
                    )}
                </div>
            )}

            <CreateBatchDialog
                open={createDialog.open}
                onOpenChange={(open) => setCreateDialog((prev) => ({ ...prev, open }))}
                initialCourse={createDialog.course}
            />
        </div>
    );
};

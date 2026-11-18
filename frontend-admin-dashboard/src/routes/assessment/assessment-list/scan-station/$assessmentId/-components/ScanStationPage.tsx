import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsFetching, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Scan } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Route } from '..';
import {
    buildScanSession,
    createScanSession,
    getScanConfig,
    getScanSession,
    listScanSessions,
    removeScanLoad,
    reopenScanSession,
    type ScanConfig,
    type ScanSession,
} from '../-services/scan-station-services';
import { canEdit, issueAnchor, nextIssue, type ScanIssue } from '../-lib/review-model';
import { apiErrorMessage, isScanNotFound, retryUnlessNotFound } from '../-lib/api-error';
import { sessionPollInterval } from '../-lib/session-poll';
import {
    scanConfigKey,
    scanSessionKey,
    useApplySession,
    useOnScanNotFound,
    useScanActions,
} from '../-hooks/useScanActions';
import { LoadIntake } from './LoadIntake';
import { GuidedScan } from './GuidedScan';
import { LoadSummaryCard } from './LoadSummaryCard';
import { CopyReviewList } from './CopyReviewList';
import { FrontsDirectionPrompt } from './FrontsDirectionPrompt';
import { PairCheckDialog } from './PairCheckDialog';
import { ScanVerdictBar } from './ScanVerdictBar';
import { StartCheckingDialog } from './StartCheckingDialog';
import { ScanSessionsPanel } from './ScanSessionsPanel';
import { StartedBatchPanel } from './StartedBatchPanel';

const POLL_MS = 4000;
const USE_FOLDERS_KEY = 'scanStation.useFolders';

/** The clerk's choice of folders over the scanner helper, kept in this browser. */
const readUseFolders = () => {
    try {
        return window.localStorage.getItem(USE_FOLDERS_KEY) === '1';
    } catch {
        return false;
    }
};
const saveUseFolders = (on: boolean) => {
    try {
        if (on) window.localStorage.setItem(USE_FOLDERS_KEY, '1');
        else window.localStorage.removeItem(USE_FOLDERS_KEY);
    } catch {
        // Storage blocked: the choice lasts until the page is left.
    }
};

/**
 * Scan station: turn a scanned pile (two passes per load) into one copy per
 * student, have a person look at what the reader was unsure of, then hand the
 * built copies to the bulk AI check. Shown only when the server says the
 * feature is on for this institute.
 */
export const ScanStationPage = () => {
    const { t } = useTranslation('scanStation');
    const { assessmentId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const instituteId = getInstituteId() ?? '';
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(t('title'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const config = useQuery({
        queryKey: scanConfigKey(instituteId),
        queryFn: () => getScanConfig(instituteId),
        staleTime: 10 * 60 * 1000,
        enabled: !!instituteId,
        retry: retryUnlessNotFound,
    });
    // GET /config answers 200 {enabled:false} while the feature is off; a 404
    // there (a server without the routes) means off too, never "try again".
    const configNotFound = isScanNotFound(config.error);

    const openSession = (id: string | undefined) =>
        navigate({ search: (prev) => ({ ...prev, session: id }), replace: true });

    const hasRouteBack = !!(search.examType && search.assessmentType && search.tab);
    const goToSubmissions = (intake?: string) => {
        if (search.examType && search.assessmentType && search.tab) {
            void navigate({
                to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
                params: {
                    assessmentId,
                    examType: search.examType,
                    assesssmentType: search.assessmentType,
                    assessmentTab: search.tab,
                },
                search: intake ? { intake } : {},
            });
            return;
        }
        if (intake) toast.info(t('start.noRoute'));
        void navigate({ to: '/assessment/assessment-list' });
    };

    if (config.isLoading) return <DashboardLoader />;
    if (config.isError && !configNotFound) {
        return (
            <EmptyState title={t('loadFailed')}>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    onClick={() => void config.refetch()}
                >
                    {t('retry')}
                </MyButton>
            </EmptyState>
        );
    }
    if (configNotFound || !config.data?.enabled) {
        return (
            <EmptyState title={t('off.title')} body={t('off.body')}>
                <MyButton type="button" buttonType="secondary" onClick={() => goToSubmissions()}>
                    {hasRouteBack ? t('back') : t('backToList')}
                </MyButton>
            </EmptyState>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    className="gap-1"
                    onClick={() => goToSubmissions()}
                >
                    <ArrowLeft size={14} />
                    {hasRouteBack ? t('back') : t('backToList')}
                </MyButton>
                <p className="text-caption text-neutral-500">{t('subtitle')}</p>
            </div>
            {search.session ? (
                <SessionView
                    key={search.session}
                    sessionId={search.session}
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    config={config.data}
                    onLeave={() => openSession(undefined)}
                    onOpenChecks={(batchId) => goToSubmissions(batchId)}
                    examType={search.examType ?? 'EXAM'}
                />
            ) : (
                <StartScreen
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    onOpen={(id) => openSession(id)}
                />
            )}
        </div>
    );
};

const EmptyState = ({
    title,
    body,
    children,
}: {
    title: string;
    body?: string;
    children?: React.ReactNode;
}) => (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 p-8 text-center">
        <Scan size={40} className="text-neutral-400" />
        <h1 className="text-h3 font-semibold text-neutral-800">{title}</h1>
        {body && <p className="text-body text-neutral-600">{body}</p>}
        {children}
    </div>
);

/** The three-step picture card, and the sessions of this test to resume. */
const StartScreen = ({
    assessmentId,
    instituteId,
    onOpen,
}: {
    assessmentId: string;
    instituteId: string;
    onOpen: (sessionId: string) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const apply = useApplySession(instituteId);
    const onNotFound = useOnScanNotFound(instituteId);
    const create = useMutation({
        mutationFn: () => createScanSession(assessmentId, instituteId),
        onSuccess: (session) => {
            apply(session);
            onOpen(session.id);
        },
        onError: (e) =>
            toast.error(
                onNotFound(e)
                    ? t('sessions.createFailed')
                    : apiErrorMessage(e, t('sessions.createFailed'))
            ),
    });
    const steps = ['one', 'two', 'three'] as const;

    return (
        <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                <h2 className="text-subtitle font-semibold text-neutral-800">{t('steps.title')}</h2>
                <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {steps.map((step, i) => (
                        <li
                            key={step}
                            className="flex gap-3 rounded-md border border-neutral-100 bg-neutral-50 p-3"
                        >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-body font-semibold text-primary-600">
                                {i + 1}
                            </span>
                            <span className="flex flex-col gap-1">
                                <span className="text-body font-medium text-neutral-800">
                                    {t(`steps.${step}.title`)}
                                </span>
                                <span className="text-caption text-neutral-600">
                                    {t(`steps.${step}.body`)}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>
                <p className="text-caption text-neutral-500">{t('steps.modes')}</p>
                <div>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className="gap-1"
                        disabled={create.isPending}
                        onClick={() => create.mutate()}
                    >
                        <Plus size={16} />
                        {create.isPending ? t('sessions.creating') : t('sessions.new')}
                    </MyButton>
                </div>
            </section>
            <ScanSessionsPanel
                assessmentId={assessmentId}
                instituteId={instituteId}
                onOpen={onOpen}
            />
        </div>
    );
};

/** One session: verdict bar, loads, the direction prompt, copies, and the start dialog. */
const SessionView = ({
    sessionId,
    assessmentId,
    instituteId,
    config,
    examType,
    onLeave,
    onOpenChecks,
}: {
    sessionId: string;
    assessmentId: string;
    instituteId: string;
    config: ScanConfig;
    examType: string;
    onLeave: () => void;
    onOpenChecks: (batchId: string) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const apply = useApplySession(instituteId);
    const { decide, pending } = useScanActions(sessionId, instituteId);
    const [currentIssue, setCurrentIssue] = useState<string | null>(null);
    const [pairIssue, setPairIssue] = useState<ScanIssue | null>(null);
    const [rescanLoad, setRescanLoad] = useState<number | null>(null);
    const [startOpen, setStartOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [removeLoad, setRemoveLoad] = useState<number | null>(null);
    const [useFolders, setUseFolders] = useState(readUseFolders);
    const chooseFolders = (on: boolean) => {
        setUseFolders(on);
        saveUseFolders(on);
    };

    const onNotFound = useOnScanNotFound(instituteId);
    const configChecking = useIsFetching({ queryKey: scanConfigKey(instituteId) }) > 0;
    const query = useQuery({
        queryKey: scanSessionKey(sessionId, instituteId),
        queryFn: async () => {
            try {
                return await getScanSession(sessionId, instituteId);
            } catch (e) {
                // Switched off while open: re-read the config so the page shows
                // the off state, and stop polling (sessionPollInterval).
                onNotFound(e);
                throw e;
            }
        },
        retry: retryUnlessNotFound,
        refetchInterval: (q) => sessionPollInterval(q.state, POLL_MS),
    });
    // After a 404 the last session read is stale: never show it.
    const gone = isScanNotFound(query.error);
    const session = gone ? undefined : query.data;

    const onError = (fallback: string) => (e: unknown) =>
        toast.error(onNotFound(e) ? fallback : apiErrorMessage(e, fallback));
    const build = useMutation({
        mutationFn: () => buildScanSession(sessionId, instituteId),
        onSuccess: apply,
        onError: onError(t('bar.buildFailed')),
    });
    const reopen = useMutation({
        mutationFn: () => reopenScanSession(sessionId, instituteId),
        onSuccess: apply,
        onError: onError(t('bar.reopenFailed')),
    });
    const remove = useMutation({
        mutationFn: (loadNo: number) => removeScanLoad(sessionId, loadNo, instituteId),
        onSuccess: (next: ScanSession, loadNo) => {
            apply(next);
            toast.success(t('load.removed', { load: loadNo }));
        },
        onError: onError(t('errors.decision')),
    });

    if (query.isLoading || (gone && configChecking)) return <DashboardLoader />;
    if (!session) {
        return (
            <EmptyState title={t('sessions.notFound')}>
                <MyButton type="button" buttonType="secondary" onClick={onLeave}>
                    {t('sessions.backToList')}
                </MyButton>
            </EmptyState>
        );
    }

    const readOnly = !canEdit(session) || pending;
    const directionFlag = session.session_flags.find(
        (f) => f.code === 'FRONT_ORDER_UNCERTAIN' && !f.accepted
    );
    const goNext = () => {
        const issue = nextIssue(session, currentIssue);
        if (!issue) return;
        setCurrentIssue(issue.id);
        document
            .getElementById(issueAnchor(issue))
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const loadsFull = session.loads.length >= config.max_loads;

    return (
        <div className="flex flex-col gap-4">
            <ScanVerdictBar
                session={session}
                busy={build.isPending || reopen.isPending}
                onNext={goNext}
                onBuild={() => build.mutate()}
                onReopen={() => reopen.mutate()}
                onStart={() => setStartOpen(true)}
                onOpenChecks={() =>
                    session.intake_batch_id && onOpenChecks(session.intake_batch_id)
                }
            />

            {session.status === 'STARTED' && session.intake_batch_id && (
                <StartedBatchPanel
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    examType={examType}
                    batchId={session.intake_batch_id}
                />
            )}

            {canEdit(session) && !useFolders && (
                <GuidedScan
                    sessionId={sessionId}
                    instituteId={instituteId}
                    nextLoadNo={session.loads.length + 1}
                    maxPagesPerPass={config.max_pages_per_pass}
                    loadsFull={loadsFull}
                    maxLoads={config.max_loads}
                    onLoadSent={apply}
                    onUseFolders={() => {
                        chooseFolders(true);
                        if (!loadsFull) setAddOpen(true);
                    }}
                />
            )}

            {canEdit(session) && (
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        type="button"
                        buttonType={session.loads.length === 0 ? 'primary' : 'secondary'}
                        scale="medium"
                        className="gap-1"
                        disabled={loadsFull}
                        onClick={() => setAddOpen(true)}
                    >
                        <Plus size={16} />
                        {session.loads.length === 0 ? t('addLoad.first') : t('addLoad.next')}
                    </MyButton>
                    <span className="text-caption text-neutral-500">
                        {loadsFull
                            ? t('addLoad.full', { max: config.max_loads })
                            : t('addLoad.hint')}
                    </span>
                    {useFolders && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="ms-auto gap-1"
                            onClick={() => chooseFolders(false)}
                        >
                            <Scan size={14} />
                            {t('guided.useScanner')}
                        </MyButton>
                    )}
                </div>
            )}
            {!canEdit(session) && session.status !== 'STARTED' && (
                <p className="text-caption text-neutral-500">{t('readOnly')}</p>
            )}

            {directionFlag && (
                <FrontsDirectionPrompt session={session} decide={decide} readOnly={readOnly} />
            )}

            {session.loads.length > 0 && (
                <section className="flex flex-col gap-3">
                    <h2 className="text-subtitle font-semibold text-neutral-800">
                        {t('loads.title')}
                    </h2>
                    {session.loads.map((load) => (
                        <LoadSummaryCard
                            key={load.load_no}
                            session={session}
                            load={load}
                            decide={decide}
                            readOnly={readOnly}
                            onRescan={setRescanLoad}
                            onRemove={setRemoveLoad}
                            onPairCheck={setPairIssue}
                        />
                    ))}
                </section>
            )}

            {session.loads.length > 0 && (
                <CopyReviewList
                    session={session}
                    decide={decide}
                    readOnly={readOnly}
                    onPairCheck={setPairIssue}
                />
            )}

            <MyDialog
                heading={
                    rescanLoad !== null
                        ? t('intake.replaceTitle', { load: rescanLoad })
                        : t('addLoad.title', { load: session.loads.length + 1 })
                }
                open={addOpen || rescanLoad !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setAddOpen(false);
                        setRescanLoad(null);
                    }
                }}
                dialogWidth="max-w-4xl"
            >
                <div className="p-4 sm:p-6">
                    <LoadIntake
                        sessionId={sessionId}
                        instituteId={instituteId}
                        maxPagesPerPass={config.max_pages_per_pass}
                        replaceLoadNo={rescanLoad}
                        onDone={(next) => {
                            apply(next);
                            setAddOpen(false);
                            setRescanLoad(null);
                        }}
                        onCancel={() => {
                            setAddOpen(false);
                            setRescanLoad(null);
                        }}
                    />
                </div>
            </MyDialog>

            <MyDialog
                heading={t('load.remove')}
                open={removeLoad !== null}
                onOpenChange={(open) => {
                    if (!open) setRemoveLoad(null);
                }}
                dialogWidth="max-w-md"
            >
                <div className="flex flex-col gap-4 p-4 sm:p-6">
                    <p className="text-body text-neutral-700">
                        {t('load.removeConfirm', { load: removeLoad ?? 0 })}
                    </p>
                    <div className="flex justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setRemoveLoad(null)}
                        >
                            {t('intake.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disabled={remove.isPending}
                            onClick={() => {
                                if (removeLoad !== null) remove.mutate(removeLoad);
                                setRemoveLoad(null);
                            }}
                        >
                            {t('load.remove')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>

            <PairCheckDialog
                session={session}
                issue={pairIssue}
                onClose={() => setPairIssue(null)}
                decide={decide}
                readOnly={readOnly}
                onRescan={setRescanLoad}
            />

            <StartCheckingDialog
                open={startOpen}
                onOpenChange={setStartOpen}
                session={session}
                assessmentId={assessmentId}
                instituteId={instituteId}
                onStarted={(result) => {
                    apply(result.session);
                    onOpenChecks(result.batch.id);
                }}
            />
        </div>
    );
};

export default ScanStationPage;

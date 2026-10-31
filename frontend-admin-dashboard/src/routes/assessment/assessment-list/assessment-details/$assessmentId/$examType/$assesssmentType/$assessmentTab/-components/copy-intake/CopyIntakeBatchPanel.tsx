import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    CheckCircle,
    CircleNotch,
    DownloadSimple,
    MagnifyingGlass,
    UserCircle,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import {
    getCopyIntakeBatch,
    isCopyIntakeSettled,
    listCheckedCopies,
    listCopyIntakeBatches,
    resolveCopyIntakeItem,
    retryCopyIntakeItem,
    skipCopyIntakeItem,
    type CopyIntakeBatch,
    type CopyIntakeCandidate,
    type CopyIntakeItem,
    type CopyIntakeItemStatus,
} from '../../-services/copy-intake-services';
import {
    fetchBatchLearners,
    fetchIndividualParticipants,
} from '@/routes/assessment/assessment-list/offline-entry/$assessmentId/-services/offline-entry-services';
import { downloadCheckedCopies } from './download-checked-copies';

const ITEM_TONE: Record<CopyIntakeItemStatus, StatusType> = {
    PENDING: 'INFO',
    IDENTIFYING: 'INFO',
    MATCHED: 'INFO',
    QUEUED: 'INFO',
    EVALUATING: 'INFO',
    AMBIGUOUS: 'WARNING',
    UNMATCHED: 'WARNING',
    COMPLETED: 'SUCCESS',
    FAILED: 'DANGER',
    SKIPPED: 'INFO',
};

/** Copies still moving on their own get a spinner instead of the neutral chip's cross. */
const ACTIVE_ITEM: ReadonlySet<CopyIntakeItemStatus> = new Set([
    'PENDING',
    'IDENTIFYING',
    'MATCHED',
    'QUEUED',
    'EVALUATING',
]);

const POLL_MS = 6000;

/**
 * Where a bulk upload lives after "Start": one row per copy, what was read off
 * it, who it was matched to, and where the check is. Copies the reader could
 * not place get a student picker. Polls while the batch is moving and toasts
 * once when it settles - the same moment the bell and the email fire.
 */
export const CopyIntakeBatchPanel = ({
    assessmentId,
    instituteId,
    examType,
    packageSessionIds,
    initialBatchId,
    onClose,
}: {
    assessmentId: string;
    instituteId: string;
    examType: string;
    packageSessionIds: string[];
    initialBatchId?: string | null;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [selectedId, setSelectedId] = useState<string | null>(initialBatchId ?? null);

    const { data: batches = [], isLoading: loadingList } = useQuery({
        queryKey: ['COPY_INTAKE_BATCHES', assessmentId, instituteId],
        queryFn: () => listCopyIntakeBatches(assessmentId, instituteId),
        refetchInterval: (query) =>
            (query.state.data ?? []).some((b) => !isCopyIntakeSettled(b.status)) ? POLL_MS : false,
    });
    const batchId = selectedId ?? batches[0]?.id ?? null;

    const { data: batch, isLoading: loadingBatch } = useQuery({
        queryKey: ['COPY_INTAKE_BATCH', batchId, instituteId],
        queryFn: () => getCopyIntakeBatch(batchId ?? '', instituteId),
        enabled: !!batchId,
        refetchInterval: (query) =>
            query.state.data && !isCopyIntakeSettled(query.state.data.status) ? POLL_MS : false,
    });

    // One toast per settle, on the transition only - not on every poll and
    // not for a batch that was already finished when the panel opened.
    const lastStatus = useRef<Record<string, string>>({});
    useEffect(() => {
        if (!batch) return;
        const prev = lastStatus.current[batch.id];
        lastStatus.current[batch.id] = batch.status;
        if (prev && prev !== batch.status && isCopyIntakeSettled(batch.status)) {
            const waiting = batch.ambiguous + batch.unmatched;
            if (batch.status === 'NEEDS_REVIEW') {
                toast.warning(t('toasts.needsReview', { count: waiting }), { duration: 8000 });
            } else if (batch.status === 'COMPLETED') {
                toast.success(
                    t('toasts.completed', { checked: batch.evaluated, total: batch.total_items }),
                    {
                        duration: 8000,
                    }
                );
            } else {
                toast.error(t('toasts.failed'));
            }
            queryClient.invalidateQueries({ queryKey: ['COPY_INTAKE_BATCHES', assessmentId] });
        }
    }, [batch, assessmentId, queryClient, t]);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['COPY_INTAKE_BATCH', batchId] });
        queryClient.invalidateQueries({ queryKey: ['COPY_INTAKE_BATCHES', assessmentId] });
    };

    const items = batch?.items ?? [];
    const waiting = items.filter(needsPerson);
    const openResult = (item: CopyIntakeItem) => {
        if (item.attempt_id && item.process_id) {
            navigate({
                to: '/assessment/evaluation-ai/$attemptId/$processId',
                params: { attemptId: item.attempt_id, processId: item.process_id },
            });
        }
    };

    return (
        <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-subtitle font-semibold text-neutral-800">
                        {t('panel.title')}
                    </h3>
                    <p className="text-caption text-neutral-500">{t('panel.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={refresh}>
                        <ArrowsClockwise size={14} />
                        {t('panel.refresh')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('panel.close')}
                        onClick={onClose}
                    >
                        <X size={16} />
                    </MyButton>
                </div>
            </div>

            {batches.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    {batches.map((b) => (
                        <button
                            key={b.id}
                            type="button"
                            onClick={() => setSelectedId(b.id)}
                            className={cn(
                                'rounded-full border px-3 py-1 text-caption font-medium',
                                b.id === batchId
                                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-300'
                            )}
                        >
                            {new Date(b.created_at).toLocaleString()} · {b.total_items} ·{' '}
                            {t(
                                b.source === 'SUBMITTED'
                                    ? 'panel.sourceSubmitted'
                                    : 'panel.sourceUpload'
                            )}
                        </button>
                    ))}
                </div>
            )}

            {loadingList || loadingBatch ? (
                <DashboardLoader />
            ) : !batch ? (
                <p className="text-sm text-neutral-500">{t('panel.empty')}</p>
            ) : (
                <>
                    <BatchSummary batch={batch} instituteId={instituteId} />

                    {waiting.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                            <WarningCircle size={18} className="mt-px shrink-0" />
                            <span>{t('panel.waitingHint', { count: waiting.length })}</span>
                        </div>
                    )}

                    <ul className="flex flex-col gap-2 sm:hidden">
                        {items.map((item) => (
                            <ItemCard
                                key={item.id}
                                item={item}
                                submitted={batch.source === 'SUBMITTED'}
                                assessmentId={assessmentId}
                                instituteId={instituteId}
                                examType={examType}
                                packageSessionIds={packageSessionIds}
                                onChanged={refresh}
                                onOpen={() => openResult(item)}
                            />
                        ))}
                    </ul>

                    <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full min-w-table-sm text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-caption uppercase tracking-wide text-neutral-500">
                                    <th className="py-2 pr-3">{t('table.file')}</th>
                                    <th className="py-2 pr-3">{t('table.read')}</th>
                                    <th className="py-2 pr-3">{t('table.student')}</th>
                                    <th className="py-2 pr-3">{t('table.status')}</th>
                                    <th className="py-2 text-right">{t('table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {items.map((item) => (
                                    <ItemRow
                                        key={item.id}
                                        item={item}
                                        submitted={batch.source === 'SUBMITTED'}
                                        assessmentId={assessmentId}
                                        instituteId={instituteId}
                                        examType={examType}
                                        packageSessionIds={packageSessionIds}
                                        onChanged={refresh}
                                        onOpen={() => openResult(item)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
};

const BatchSummary = ({ batch, instituteId }: { batch: CopyIntakeBatch; instituteId: string }) => {
    const { t } = useTranslation('assessmentCopyIntake');
    // Settled one way or another; skipped copies are done too, not "in progress".
    const done = batch.evaluated + batch.failed + batch.skipped;
    const pct = batch.total_items ? Math.round((done / batch.total_items) * 100) : 0;
    const tone: StatusType =
        batch.status === 'COMPLETED'
            ? 'SUCCESS'
            : batch.status === 'NEEDS_REVIEW'
              ? 'WARNING'
              : batch.status === 'FAILED'
                ? 'DANGER'
                : 'INFO';
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                    {batch.status === 'RUNNING' && (
                        <CircleNotch size={14} className="shrink-0 animate-spin text-primary-500" />
                    )}
                    <StatusChip
                        text={t(`batchStatus.${batch.status}`)}
                        textSize="text-caption"
                        status={tone}
                        showIcon={tone !== 'INFO'}
                    />
                </div>
                <StatusChip
                    text={t(
                        batch.source === 'SUBMITTED'
                            ? 'panel.sourceSubmitted'
                            : 'panel.sourceUpload'
                    )}
                    textSize="text-caption"
                    status="INFO"
                    showIcon={false}
                />
                <span className="text-caption text-neutral-500">
                    {t('panel.startedBy', {
                        name: batch.created_by_name || '—',
                        when: new Date(batch.created_at).toLocaleString(),
                    })}
                </span>
                {batch.email_status === 'FAILED' && (
                    <span className="text-caption text-danger-600">{t('panel.emailFailed')}</span>
                )}
                <DownloadCheckedCopiesButton batch={batch} instituteId={instituteId} />
            </div>
            {batch.error_message && (
                <p className="text-caption text-warning-700">{batch.error_message}</p>
            )}
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                    className="h-full rounded-full bg-primary-500 transition-all"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <Stat label={t('stats.total')} value={batch.total_items} />
                <Stat label={t('stats.checked')} value={batch.evaluated} tone="text-success-600" />
                <Stat label={t('stats.inProgress')} value={batch.in_progress} />
                <Stat
                    label={t('stats.needReview')}
                    value={batch.ambiguous + batch.unmatched}
                    tone="text-warning-600"
                />
                <Stat label={t('stats.failed')} value={batch.failed} tone="text-danger-600" />
            </div>
        </div>
    );
};

/**
 * Every checked copy of the batch in one zip, built in the browser from the
 * copies already in storage. Shown once at least one copy has been checked;
 * the rest of the batch (matching, review) is untouched by it.
 */
const DownloadCheckedCopiesButton = ({
    batch,
    instituteId,
}: {
    batch: CopyIntakeBatch;
    instituteId: string;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const download = useMutation({
        mutationFn: async () => {
            const copies = await listCheckedCopies(batch.id, instituteId);
            if (copies.length === 0) throw new Error(t('download.none'));
            setProgress({ done: 0, total: copies.length });
            const day = new Date(batch.created_at).toISOString().slice(0, 10);
            return downloadCheckedCopies(copies, `checked-copies-${day}.zip`, (done, total) =>
                setProgress({ done, total })
            );
        },
        onSuccess: ({ added, failed }) => {
            if (added === 0) toast.error(t('download.failed'));
            else if (failed > 0) toast.warning(t('download.partial', { count: added, failed }));
            else toast.success(t('download.done', { count: added }));
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('download.failed')),
        onSettled: () => setProgress(null),
    });
    if (batch.evaluated <= 0) return null;
    return (
        <MyButton
            type="button"
            buttonType="secondary"
            scale="small"
            className="ml-auto"
            disabled={download.isPending}
            onClick={() => download.mutate()}
        >
            {download.isPending ? (
                <CircleNotch size={14} className="animate-spin" />
            ) : (
                <DownloadSimple size={14} />
            )}
            {download.isPending
                ? progress
                    ? t('download.progress', { done: progress.done, total: progress.total })
                    : t('download.preparing')
                : t('download.button', { count: batch.evaluated })}
        </MyButton>
    );
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
        <div className="text-caption text-neutral-500">{label}</div>
        <div className={cn('text-lg font-semibold text-neutral-800', tone)}>{value}</div>
    </div>
);

type ItemContext = {
    item: CopyIntakeItem;
    /** Batch built from the learners' own uploads: no header was read. */
    submitted?: boolean;
    assessmentId: string;
    instituteId: string;
    examType: string;
    packageSessionIds: string[];
    onChanged: () => void;
    onOpen: () => void;
};

const needsPerson = (item: CopyIntakeItem) =>
    item.status === 'AMBIGUOUS' || item.status === 'UNMATCHED';

const FileCell = ({ item }: { item: CopyIntakeItem }) => {
    const { t } = useTranslation('assessmentCopyIntake');
    return (
        <>
            <div
                className="truncate font-medium text-neutral-800"
                title={item.file_name ?? item.file_id}
            >
                {item.file_name ?? item.file_id}
            </div>
            {item.page_count != null && (
                <div className="text-caption text-neutral-500">
                    {t('table.pages', { count: item.page_count })}
                </div>
            )}
        </>
    );
};

const ReadCell = ({ item, submitted }: { item: CopyIntakeItem; submitted?: boolean }) => {
    const { t } = useTranslation('assessmentCopyIntake');
    if (submitted) {
        return <span className="text-caption text-neutral-400">—</span>;
    }
    if (!item.extracted_name) {
        return (
            <span className="text-caption text-neutral-400">
                {item.status === 'PENDING' || item.status === 'IDENTIFYING'
                    ? t('table.reading')
                    : t('table.noName')}
            </span>
        );
    }
    const detail = [
        item.extracted_roll && t('table.roll', { roll: item.extracted_roll }),
        item.extracted_class,
    ]
        .filter(Boolean)
        .join(' · ');
    return (
        <div>
            <div className="text-neutral-800">{item.extracted_name}</div>
            {detail && <div className="text-caption text-neutral-500">{detail}</div>}
        </div>
    );
};

const StudentCell = ({ item }: { item: CopyIntakeItem }) => {
    if (item.matched_name) {
        return (
            <span className="flex items-center gap-1.5 text-neutral-800">
                <UserCircle size={16} className="shrink-0 text-primary-500" />
                {item.matched_name}
            </span>
        );
    }
    if (needsPerson(item)) {
        return <span className="text-caption text-warning-700">{item.error_message}</span>;
    }
    return <span className="text-caption text-neutral-400">—</span>;
};

const StatusCell = ({ item }: { item: CopyIntakeItem }) => {
    const { t } = useTranslation('assessmentCopyIntake');
    return (
        <>
            <div className="flex items-center gap-1.5">
                {ACTIVE_ITEM.has(item.status) && (
                    <CircleNotch size={14} className="shrink-0 animate-spin text-primary-500" />
                )}
                <StatusChip
                    text={t(`itemStatus.${item.status}`)}
                    textSize="text-caption"
                    status={ITEM_TONE[item.status]}
                    showIcon={ITEM_TONE[item.status] !== 'INFO'}
                />
            </div>
            {item.status === 'FAILED' && item.error_message && (
                <div className="mt-1 max-w-72 text-caption text-danger-600">
                    {item.error_message}
                </div>
            )}
        </>
    );
};

/** The buttons a copy offers (pick / skip / retry / open) and the picker they open. */
const ItemActions = ({
    item,
    assessmentId,
    instituteId,
    examType,
    packageSessionIds,
    onChanged,
    onOpen,
    className,
}: ItemContext & { className?: string }) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const [pickerOpen, setPickerOpen] = useState(false);

    const skip = useMutation({
        mutationFn: () => skipCopyIntakeItem(item.id, instituteId),
        onSuccess: () => {
            toast.success(t('toasts.skipped'));
            onChanged();
        },
        onError: () => toast.error(t('errors.actionFailed')),
    });
    const retry = useMutation({
        mutationFn: () => retryCopyIntakeItem(item.id, instituteId),
        onSuccess: () => {
            toast.success(t('toasts.retried'));
            onChanged();
        },
        onError: () => toast.error(t('errors.actionFailed')),
    });

    return (
        <>
            <div className={cn('flex flex-wrap gap-1.5', className)}>
                {needsPerson(item) && (
                    <>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            onClick={() => setPickerOpen(true)}
                        >
                            {t('actions.pickStudent')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disabled={skip.isPending}
                            onClick={() => skip.mutate()}
                        >
                            {t('actions.skip')}
                        </MyButton>
                    </>
                )}
                {item.status === 'FAILED' && (
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate()}
                        >
                            {t('actions.retry')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPickerOpen(true)}
                        >
                            {t('actions.pickStudent')}
                        </MyButton>
                    </>
                )}
                {item.status === 'COMPLETED' && item.attempt_id && item.process_id && (
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onOpen}>
                        <CheckCircle size={14} />
                        {t('actions.openResult')}
                    </MyButton>
                )}
            </div>
            {pickerOpen && (
                <StudentPicker
                    item={item}
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    examType={examType}
                    packageSessionIds={packageSessionIds}
                    onClose={() => setPickerOpen(false)}
                    onResolved={() => {
                        setPickerOpen(false);
                        onChanged();
                    }}
                />
            )}
        </>
    );
};

/** Desktop: one table row per copy. */
const ItemRow = (ctx: ItemContext) => {
    const { item } = ctx;
    return (
        <tr className={cn(needsPerson(item) && 'bg-warning-50/40')}>
            <td className="max-w-64 py-2 pr-3">
                <FileCell item={item} />
            </td>
            <td className="py-2 pr-3">
                <ReadCell item={item} submitted={ctx.submitted} />
            </td>
            <td className="py-2 pr-3">
                <StudentCell item={item} />
            </td>
            <td className="py-2 pr-3">
                <StatusCell item={item} />
            </td>
            <td className="py-2 text-right">
                <ItemActions {...ctx} className="flex-nowrap justify-end" />
            </td>
        </tr>
    );
};

/** Phone: the same copy as a card, so the buttons never sit off-screen in a scrolled table. */
const ItemCard = (ctx: ItemContext) => {
    const { item } = ctx;
    const { t } = useTranslation('assessmentCopyIntake');
    return (
        <li
            className={cn(
                'flex flex-col gap-2 rounded-md border border-neutral-200 p-3',
                needsPerson(item) ? 'bg-warning-50/40' : 'bg-white'
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <FileCell item={item} />
                </div>
                <div className="shrink-0">
                    <StatusCell item={item} />
                </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-caption text-neutral-500">{t('table.read')}</dt>
                <dd className="min-w-0">
                    <ReadCell item={item} submitted={ctx.submitted} />
                </dd>
                <dt className="text-caption text-neutral-500">{t('table.student')}</dt>
                <dd className="min-w-0">
                    <StudentCell item={item} />
                </dd>
            </dl>
            <ItemActions {...ctx} />
        </li>
    );
};

interface PickableStudent {
    key: string;
    user_id: string | null;
    registration_id: string | null;
    name: string;
    sub: string;
    batch_id: string | null;
    email: string | null;
    score?: number | null;
}

/**
 * Who is this copy? The reader's shortlist first (with scores), then every
 * participant and batch learner behind a search box, so the admin can always
 * find the right student even when nothing on the sheet was readable.
 */
const StudentPicker = ({
    item,
    assessmentId,
    instituteId,
    examType,
    packageSessionIds,
    onClose,
    onResolved,
}: {
    item: CopyIntakeItem;
    assessmentId: string;
    instituteId: string;
    examType: string;
    packageSessionIds: string[];
    onClose: () => void;
    onResolved: () => void;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const [search, setSearch] = useState('');

    const { data: everyone = [], isLoading } = useQuery({
        queryKey: ['COPY_INTAKE_STUDENTS', assessmentId, instituteId, examType, packageSessionIds],
        queryFn: async () => {
            const out: PickableStudent[] = [];
            const seen = new Set<string>();
            try {
                const parts = await fetchIndividualParticipants(
                    assessmentId,
                    instituteId,
                    examType
                );
                for (const p of parts.content ?? []) {
                    const key = p.user_id || p.registration_id;
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    out.push({
                        key,
                        user_id: p.user_id,
                        registration_id: p.registration_id,
                        name: p.student_name,
                        sub: t('picker.registered'),
                        batch_id: p.batch_id,
                        email: null,
                    });
                }
            } catch {
                /* the batch list below still works */
            }
            if (packageSessionIds.length) {
                try {
                    const learners = await fetchBatchLearners(
                        instituteId,
                        packageSessionIds,
                        0,
                        1000
                    );
                    for (const l of learners.content ?? []) {
                        if (!l.user_id || seen.has(l.user_id)) continue;
                        seen.add(l.user_id);
                        out.push({
                            key: l.user_id,
                            user_id: l.user_id,
                            registration_id: null,
                            name: l.full_name || l.user_id,
                            sub: [l.username, l.email].filter(Boolean).join(' · '),
                            batch_id: l.package_session_id ?? null,
                            email: l.email ?? null,
                        });
                    }
                } catch {
                    /* ignore */
                }
            }
            return out;
        },
        staleTime: 60_000,
    });

    const shortlist: PickableStudent[] = useMemo(
        () =>
            (item.candidates ?? []).map((c: CopyIntakeCandidate, i) => ({
                key: c.user_id || c.registration_id || String(i),
                user_id: c.user_id,
                registration_id: c.registration_id,
                name: c.name ?? '—',
                sub: [c.roll_number, c.email].filter(Boolean).join(' · '),
                batch_id: c.batch_id,
                email: c.email,
                score: c.score,
            })),
        [item.candidates]
    );
    const q = search.trim().toLowerCase();
    const filtered = useMemo(
        () =>
            (q
                ? everyone.filter((s) => `${s.name} ${s.sub}`.toLowerCase().includes(q))
                : everyone
            ).slice(0, 50),
        [everyone, q]
    );

    const resolve = useMutation({
        mutationFn: (s: PickableStudent) =>
            resolveCopyIntakeItem(item.id, instituteId, {
                registration_id: s.registration_id,
                user_id: s.user_id,
                full_name: s.name,
                email: s.email,
                batch_id: s.batch_id,
            }),
        onSuccess: () => {
            toast.success(t('toasts.assigned'));
            onResolved();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('errors.actionFailed')),
    });

    const Row = ({ s }: { s: PickableStudent }) => (
        <li>
            <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate(s)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-primary-50"
            >
                <span className="min-w-0">
                    <span className="block truncate text-sm text-neutral-800">{s.name}</span>
                    {s.sub && (
                        <span className="block truncate text-caption text-neutral-500">
                            {s.sub}
                        </span>
                    )}
                </span>
                {s.score != null && (
                    <span className="shrink-0 text-caption text-neutral-500">
                        {Math.round(s.score * 100)}%
                    </span>
                )}
            </button>
        </li>
    );

    return (
        <MyDialog
            heading={t('picker.title')}
            open
            onOpenChange={(o) => !o && onClose()}
            dialogWidth="max-w-lg"
        >
            <div className="flex flex-col gap-3 p-4">
                <p className="text-sm text-neutral-600">
                    {item.extracted_name
                        ? t('picker.readAs', { name: item.extracted_name })
                        : t('picker.nothingRead')}
                </p>
                {shortlist.length > 0 && (
                    <div>
                        <div className="mb-1 text-caption font-semibold uppercase text-neutral-500">
                            {t('picker.suggested')}
                        </div>
                        <ul className="rounded-md border border-neutral-200">
                            {shortlist.map((s) => (
                                <Row key={`s-${s.key}`} s={s} />
                            ))}
                        </ul>
                    </div>
                )}
                <div>
                    <div className="mb-1 text-caption font-semibold uppercase text-neutral-500">
                        {t('picker.all')}
                    </div>
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('picker.search')}
                        input={search}
                        onChangeFunction={(e) => setSearch(e.target.value)}
                        // MyInput caps itself at sm:w-60; only a same-breakpoint class lifts it.
                        className="w-full text-body sm:w-full"
                    />
                    <div className="mt-2 max-h-list-md overflow-y-auto rounded-md border border-neutral-200">
                        {isLoading ? (
                            <DashboardLoader />
                        ) : filtered.length === 0 ? (
                            <p className="flex items-center gap-2 p-3 text-sm text-neutral-500">
                                <MagnifyingGlass size={16} />
                                {t('picker.none')}
                            </p>
                        ) : (
                            <ul>
                                {filtered.map((s) => (
                                    <Row key={`a-${s.key}`} s={s} />
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </MyDialog>
    );
};

export default CopyIntakeBatchPanel;

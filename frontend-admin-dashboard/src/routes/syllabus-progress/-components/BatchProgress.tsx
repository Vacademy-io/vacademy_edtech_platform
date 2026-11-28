import { memo, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
    ArrowClockwise,
    BookOpenText,
    ChatCenteredText,
    CheckSquare,
    MagnifyingGlass,
    UsersThree,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import {
    SYLLABUS_STATUSES,
    markSyllabusProgress,
    syllabusErrorMessage,
    syllabusProgressKeys,
    useSyllabusBatch,
    type SyllabusBlock,
    type SyllabusLearner,
    type SyllabusProgressEntry,
} from '@/services/syllabus-progress';
import { STATUS_META, blockLongLabel, blockShortLabel } from './status-meta';
import { CellDialog, type MarkPayload } from './CellDialog';
import { BulkMarkDialog } from './BulkMarkDialog';
import { EmptyState } from './EmptyState';

type ProgressByBlock = Map<string, SyllabusProgressEntry>;

/** Learners × week blocks for one batch. Keyed by batch in the parent, so state resets per batch. */
export function BatchProgress({
    instituteId,
    packageSessionId,
}: {
    instituteId: string;
    packageSessionId: string;
}) {
    const { t } = useTranslation('syllabusProgress');
    const queryClient = useQueryClient();
    const { data, isLoading, isError, error, refetch, isFetching } = useSyllabusBatch(
        instituteId,
        packageSessionId
    );

    const [search, setSearch] = useState('');
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(() => new Set());
    const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(() => new Set());
    const [cell, setCell] = useState<{ userId: string; blockId: string } | null>(null);
    const [bulkOpen, setBulkOpen] = useState(false);

    const blocks = useMemo(() => data?.blocks ?? [], [data]);
    const learners = useMemo(() => data?.learners ?? [], [data]);

    /** user_id → (block_id → entry): O(1) lookups for ~30 × 40 cells. */
    const progressByUser = useMemo(() => {
        const map = new Map<string, ProgressByBlock>();
        for (const entry of data?.progress ?? []) {
            let row = map.get(entry.user_id);
            if (!row) {
                row = new Map();
                map.set(entry.user_id, row);
            }
            row.set(entry.block_id, entry);
        }
        return map;
    }, [data]);

    const visibleLearners = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return learners;
        return learners.filter(
            (l) =>
                l.full_name.toLowerCase().includes(q) ||
                (l.enrollment_number ?? '').toLowerCase().includes(q)
        );
    }, [learners, search]);

    const { mutateAsync: mark } = useMutation({
        mutationFn: (payload: MarkPayload) =>
            markSyllabusProgress(instituteId, { package_session_id: packageSessionId, ...payload }),
        onSuccess: (res) => {
            toast.success(t('toast.saved', { count: res?.updated ?? 0 }));
            void queryClient.invalidateQueries({
                queryKey: syllabusProgressKeys.batch(instituteId, packageSessionId),
            });
        },
        onError: (err) => toast.error(syllabusErrorMessage(err, t('toast.saveFailed'))),
    });

    const toggleUser = useCallback((userId: string, on: boolean) => {
        setSelectedUsers((prev) => {
            const next = new Set(prev);
            if (on) next.add(userId);
            else next.delete(userId);
            return next;
        });
    }, []);

    const toggleBlock = useCallback((blockId: string, on: boolean) => {
        setSelectedBlocks((prev) => {
            const next = new Set(prev);
            if (on) next.add(blockId);
            else next.delete(blockId);
            return next;
        });
    }, []);

    const openCell = useCallback(
        (userId: string, blockId: string) => setCell({ userId, blockId }),
        []
    );

    const clearSelection = () => {
        setSelectedUsers(new Set());
        setSelectedBlocks(new Set());
    };

    if (isLoading) {
        return (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <Skeleton className="h-9 w-full sm:w-72" />
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                ))}
            </div>
        );
    }

    if (isError || !data) {
        return (
            <Alert variant="destructive">
                <WarningCircle className="size-4" />
                <AlertTitle>{t('batch.loadFailed')}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                    {syllabusErrorMessage(error, t('batch.loadFailedHint'))}
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

    if (blocks.length === 0) {
        return (
            <EmptyState
                icon={<BookOpenText className="size-8" aria-hidden />}
                title={t('batch.noSyllabusTitle')}
                body={t('batch.noSyllabusBody')}
            />
        );
    }

    if (learners.length === 0) {
        return (
            <EmptyState
                icon={<UsersThree className="size-8" aria-hidden />}
                title={t('batch.noLearnersTitle')}
                body={t('batch.noLearnersBody')}
            />
        );
    }

    const allVisibleSelected =
        visibleLearners.length > 0 && visibleLearners.every((l) => selectedUsers.has(l.user_id));
    const someVisibleSelected = visibleLearners.some((l) => selectedUsers.has(l.user_id));
    const hasSelection = selectedUsers.size > 0 || selectedBlocks.size > 0;
    const bulkUserIds =
        selectedUsers.size > 0 ? [...selectedUsers] : learners.map((l) => l.user_id);

    const cellLearner = cell ? learners.find((l) => l.user_id === cell.userId) : undefined;
    const cellBlock = cell ? blocks.find((b) => b.id === cell.blockId) : undefined;

    return (
        <div className="space-y-4">
            {/* Toolbar: search + bulk action bar */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative w-full md:max-w-xs">
                    <MagnifyingGlass
                        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                        aria-hidden
                    />
                    <MyInput
                        inputType="text"
                        input={search}
                        onChangeFunction={(e) => setSearch(e.target.value)}
                        inputPlaceholder={t('grid.searchPlaceholder')}
                        aria-label={t('grid.searchPlaceholder')}
                        className="w-full ps-9 sm:w-full"
                        size="large"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {hasSelection && (
                        <span className="text-body text-neutral-600" aria-live="polite">
                            {t('bulk.selectionSummary', {
                                learners:
                                    selectedUsers.size > 0
                                        ? t('bulk.learnerCount', { count: selectedUsers.size })
                                        : t('bulk.allLearnersShort'),
                                weeks: t('bulk.weekCount', { count: selectedBlocks.size }),
                            })}
                        </span>
                    )}
                    {hasSelection && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="medium"
                            onClick={clearSelection}
                        >
                            <X className="size-4" aria-hidden /> {t('bulk.clear')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType={hasSelection ? 'primary' : 'secondary'}
                        scale="medium"
                        onClick={() => setBulkOpen(true)}
                    >
                        <CheckSquare className="size-4" aria-hidden /> {t('bulk.open')}
                    </MyButton>
                </div>
            </div>

            <Legend t={t} />

            {visibleLearners.length === 0 ? (
                <EmptyState
                    icon={<MagnifyingGlass className="size-8" aria-hidden />}
                    title={t('grid.noMatchTitle')}
                    body={t('grid.noMatchBody')}
                />
            ) : (
                // The grid card scrolls on its own (both ways); the page never scrolls sideways.
                <div
                    className={cn(
                        'max-h-screen overflow-auto rounded-lg border border-border bg-card transition-opacity',
                        isFetching && 'opacity-70'
                    )}
                >
                    {/* A learner × week matrix, not a paged data list, so MyTable does not fit:
                        native table with a sticky learner column and sticky header row. */}
                    <table className="w-max min-w-full border-separate border-spacing-0 text-body">
                        <caption className="sr-only">
                            {t('grid.caption', {
                                batch: `${data.course_name} · ${data.level_name} · ${data.batch_name}`,
                            })}
                        </caption>
                        <thead>
                            <tr>
                                <th
                                    scope="col"
                                    className="sticky start-0 top-0 z-30 min-w-44 border-b border-e border-border bg-card px-3 py-2 text-start align-bottom font-semibold text-neutral-700 sm:min-w-60"
                                >
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            aria-label={t('grid.selectAllLearners')}
                                            checked={
                                                allVisibleSelected
                                                    ? true
                                                    : someVisibleSelected
                                                      ? 'indeterminate'
                                                      : false
                                            }
                                            onCheckedChange={(v) =>
                                                setSelectedUsers((prev) => {
                                                    const next = new Set(prev);
                                                    visibleLearners.forEach((l) =>
                                                        v === true
                                                            ? next.add(l.user_id)
                                                            : next.delete(l.user_id)
                                                    );
                                                    return next;
                                                })
                                            }
                                        />
                                        <span>
                                            {t('grid.learners', { count: visibleLearners.length })}
                                        </span>
                                    </div>
                                </th>
                                {blocks.map((block, i) => (
                                    <BlockHeader
                                        key={block.id}
                                        block={block}
                                        groupStart={
                                            i === 0 || blocks[i - 1]?.trimester !== block.trimester
                                        }
                                        selected={selectedBlocks.has(block.id)}
                                        onToggle={toggleBlock}
                                        t={t}
                                    />
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visibleLearners.map((learner) => (
                                <LearnerRow
                                    key={learner.user_id}
                                    learner={learner}
                                    blocks={blocks}
                                    progress={progressByUser.get(learner.user_id)}
                                    selected={selectedUsers.has(learner.user_id)}
                                    onToggle={toggleUser}
                                    onOpenCell={openCell}
                                    t={t}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {cell && cellLearner && cellBlock && (
                <CellDialog
                    key={`${cell.userId}:${cell.blockId}`}
                    open
                    onOpenChange={(open) => !open && setCell(null)}
                    learner={cellLearner}
                    block={cellBlock}
                    entry={progressByUser.get(cell.userId)?.get(cell.blockId)}
                    onSave={async (payload) => {
                        await mark(payload);
                        setCell(null);
                    }}
                />
            )}

            {bulkOpen && (
                <BulkMarkDialog
                    open
                    onOpenChange={setBulkOpen}
                    blocks={blocks}
                    initialBlockIds={blocks
                        .filter((b) => selectedBlocks.has(b.id))
                        .map((b) => b.id)}
                    userIds={bulkUserIds}
                    allLearners={selectedUsers.size === 0}
                    onSave={async (payload) => {
                        await mark(payload);
                        setBulkOpen(false);
                        clearSelection();
                    }}
                />
            )}
        </div>
    );
}

function Legend({ t }: { t: TFunction }) {
    return (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-neutral-600">
            {SYLLABUS_STATUSES.map((status) => {
                const meta = STATUS_META[status];
                const Icon = meta.icon;
                return (
                    <li key={status} className="flex items-center gap-1">
                        <Icon className={cn('size-4', meta.text)} weight="fill" aria-hidden />
                        {t(meta.labelKey)}
                    </li>
                );
            })}
            <li className="flex items-center gap-1">
                <ChatCenteredText className="size-4 text-primary-500" weight="fill" aria-hidden />
                {t('legend.note')}
            </li>
        </ul>
    );
}

const BlockHeader = memo(function BlockHeader({
    block,
    groupStart,
    selected,
    onToggle,
    t,
}: {
    block: SyllabusBlock;
    groupStart: boolean;
    selected: boolean;
    onToggle: (blockId: string, on: boolean) => void;
    t: TFunction;
}) {
    const longLabel = blockLongLabel(block, t);
    return (
        <th
            scope="col"
            className={cn(
                'sticky top-0 z-20 border-b border-border bg-card px-1 py-2 align-bottom font-regular',
                groupStart && 'border-s border-s-neutral-300',
                selected && 'bg-primary-50'
            )}
        >
            <div className="flex min-w-14 flex-col items-center gap-1">
                <span
                    className={cn(
                        'max-w-20 truncate text-caption text-neutral-500',
                        !groupStart && 'invisible'
                    )}
                    title={block.trimester ?? undefined}
                >
                    {block.trimester || '—'}
                </span>
                <Popover>
                    <PopoverTrigger asChild>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="whitespace-nowrap px-1 font-semibold text-neutral-800"
                            aria-label={t('grid.showPoints', { block: longLabel })}
                        >
                            {blockShortLabel(block, t)}
                        </MyButton>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 max-w-full space-y-2" align="center">
                        <p className="text-body font-semibold text-neutral-800">{longLabel}</p>
                        {block.points.length === 0 ? (
                            <p className="text-caption text-neutral-500">{t('dialog.noPoints')}</p>
                        ) : (
                            <ol className="max-h-64 space-y-1 overflow-y-auto text-body text-neutral-700">
                                {block.points.map((p) => (
                                    <li key={p.seq} className="flex gap-2">
                                        <span className="shrink-0 text-neutral-500">{p.seq}.</span>
                                        <span>{p.text}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </PopoverContent>
                </Popover>
                <Checkbox
                    aria-label={t('grid.selectWeek', { block: longLabel })}
                    checked={selected}
                    onCheckedChange={(v) => onToggle(block.id, v === true)}
                />
            </div>
        </th>
    );
});

const LearnerRow = memo(function LearnerRow({
    learner,
    blocks,
    progress,
    selected,
    onToggle,
    onOpenCell,
    t,
}: {
    learner: SyllabusLearner;
    blocks: SyllabusBlock[];
    progress: ProgressByBlock | undefined;
    selected: boolean;
    onToggle: (userId: string, on: boolean) => void;
    onOpenCell: (userId: string, blockId: string) => void;
    t: TFunction;
}) {
    let completed = 0;
    progress?.forEach((entry) => {
        if (entry.status === 'COMPLETED') completed += 1;
    });
    const checkboxId = `learner-${learner.user_id}`;
    return (
        <tr className={cn('group', selected && 'bg-primary-50')}>
            <th
                scope="row"
                className={cn(
                    'sticky start-0 z-10 border-b border-e border-border px-3 py-2 text-start font-regular',
                    selected ? 'bg-primary-50' : 'bg-card group-hover:bg-neutral-50'
                )}
            >
                <div className="flex items-center gap-3">
                    <Checkbox
                        id={checkboxId}
                        aria-label={t('grid.selectLearner', { name: learner.full_name })}
                        checked={selected}
                        onCheckedChange={(v) => onToggle(learner.user_id, v === true)}
                    />
                    <div className="min-w-0">
                        <p className="max-w-32 truncate text-body font-semibold text-neutral-800 sm:max-w-48">
                            {learner.full_name}
                        </p>
                        <p className="max-w-32 truncate text-caption text-neutral-500 sm:max-w-48">
                            {learner.enrollment_number ? `${learner.enrollment_number} · ` : ''}
                            {t('grid.completedCount', { done: completed, total: blocks.length })}
                        </p>
                    </div>
                </div>
            </th>
            {blocks.map((block, i) => (
                <td
                    key={block.id}
                    className={cn(
                        'border-b border-border p-1 text-center group-hover:bg-neutral-50',
                        (i === 0 || blocks[i - 1]?.trimester !== block.trimester) &&
                            'border-s border-s-neutral-300'
                    )}
                >
                    <StatusCell
                        entry={progress?.get(block.id)}
                        block={block}
                        learnerName={learner.full_name}
                        onOpen={() => onOpenCell(learner.user_id, block.id)}
                        t={t}
                    />
                </td>
            ))}
        </tr>
    );
});

function StatusCell({
    entry,
    block,
    learnerName,
    onOpen,
    t,
}: {
    entry: SyllabusProgressEntry | undefined;
    block: SyllabusBlock;
    learnerName: string;
    onOpen: () => void;
    t: TFunction;
}) {
    const status = entry?.status ?? 'NOT_STARTED';
    const meta = STATUS_META[status];
    const Icon = meta.icon;
    const total = block.points.length;
    const done = entry?.points_done?.length ?? 0;
    const hasNote = Boolean(entry?.teacher_note?.trim());
    const label = [
        t('grid.cellLabel', {
            name: learnerName,
            block: blockLongLabel(block, t),
            status: t(meta.labelKey),
        }),
        status === 'IN_PROGRESS' && total > 0 ? t('grid.pointsOf', { done, total }) : null,
        hasNote ? t('grid.hasNote') : null,
    ]
        .filter(Boolean)
        .join('. ');
    // A grid cell, not an app action button: a compact status chip that opens the editor.
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={label}
            title={hasNote ? entry?.teacher_note ?? undefined : undefined}
            className={cn(
                'relative mx-auto flex h-8 min-w-12 items-center justify-center gap-1 rounded-md border px-1.5 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                meta.chip
            )}
        >
            <Icon
                className="size-4 shrink-0"
                weight={status === 'NOT_STARTED' ? 'regular' : 'fill'}
                aria-hidden
            />
            {status === 'IN_PROGRESS' && total > 0 && (
                <span className="font-semibold tabular-nums">
                    {done}/{total}
                </span>
            )}
            {hasNote && (
                <ChatCenteredText
                    className="absolute -end-1 -top-1 size-3.5 rounded-full bg-card text-primary-500"
                    weight="fill"
                    aria-hidden
                />
            )}
        </button>
    );
}

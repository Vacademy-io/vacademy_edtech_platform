import { createLazyFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { listTasks } from '../-services';
import { Helmet } from 'react-helmet';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowCounterClockwise,
    ArrowLeft,
    ArrowsClockwise,
    Check,
    CheckCircle,
    Info,
    MagnifyingGlass,
    PaperPlaneTilt,
    Robot,
    Sparkle,
    Tray,
    User,
    Warning,
    X,
    XCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyPagination } from '@/components/design-system/pagination';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { cn } from '@/lib/utils';
import { ToneBadge } from '../-components/ToneBadge';
import {
    CHANNEL_ICON,
    CHANNEL_TINT,
    ChannelChip,
    Chip,
    IconTile,
    KeyValue,
    SubHeading,
} from '../-components/engine-ui';
import {
    buildActionStatusMeta,
    buildChannelMeta,
    CHANNEL_ORDER,
    INBOX_FILTER_KEYS,
    type InboxFilterKey,
} from '../-constants';
import { useEngines, useTaskAction, useTaskPeople, useTasks } from '../-hooks';
import { formatDateTime, safeParse } from '../-utils';
import type { EngagementAction, TaskPerson } from '../-types';

export const Route = createLazyFileRoute('/engagement-engines/inbox/')({
    component: TaskInboxPage,
});

function buildFilters(
    t: TFunction
): { key: InboxFilterKey; label: string; statuses: string; tone: QuickView['tone'] }[] {
    return [
        {
            key: 'needsAction',
            label: t('filters.needsAction'),
            statuses: 'OPEN,ACKED',
            tone: 'warning',
        },
        { key: 'sent', label: t('filters.sent'), statuses: 'SENT', tone: 'success' },
        { key: 'failed', label: t('filters.failed'), statuses: 'FAILED', tone: 'danger' },
        {
            key: 'handled',
            label: t('filters.handled'),
            statuses: 'DONE,DISMISSED',
            tone: 'neutral',
        },
        // What a dry run would have sent: SIMULATED rows, never dispatched.
        { key: 'dryRun', label: t('filters.dryRun'), statuses: 'SIMULATED', tone: 'info' },
    ];
}

/** "High" / "Medium" / "Low" for a 0–100 priority; the number alone meant nothing to admins. */
function priorityLevel(p: number): 'high' | 'medium' | 'low' {
    return p >= 80 ? 'high' : p >= 60 ? 'medium' : 'low';
}

/** "first_name" → "First name"; template slots "1", "2" → "Value 1", "Value 2". */
function variableLabel(key: string, t: TFunction): string {
    if (/^\d+$/.test(key)) return t('detail.variableN', { n: key });
    const words = key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim()
        .toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** The person a task is for, as one line: name, else phone, else email. */
function personTitle(p?: TaskPerson): string | undefined {
    return p?.name?.trim() || p?.phone?.trim() || p?.email?.trim() || undefined;
}

const PAGE_SIZE = 20;

type SortKey = 'priority' | 'oldest' | 'newest';

const time = (iso?: string) => (iso ? new Date(iso).getTime() || 0 : 0);

/** "5m" / "3h" / "2d" since a timestamp; empty when there is none. */
function ageText(iso: string | undefined, t: TFunction): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return '';
    const minutes = Math.max(0, Math.floor(ms / 60000));
    if (minutes < 60) return t('age.minutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('age.hours', { count: hours });
    return t('age.days', { count: Math.floor(hours / 24) });
}

/** Send / handle rules for a task — the same checks the actions have always used. */
function taskRules(task: EngagementAction) {
    // A proactive WhatsApp goes out only as an approved template; without one the backend refuses
    // every send, edited or not, so offering "Review & send" was a dead end.
    const needsTemplate =
        task.channel === 'WHATSAPP' && task.kind !== 'REPLY' && !task.templateName;
    const canSend =
        (task.status === 'OPEN' || task.status === 'ACKED') &&
        !!task.channel &&
        task.channel !== 'AI_CALL' &&
        !needsTemplate;
    const canHandle = task.status === 'OPEN' || task.status === 'ACKED';
    return { needsTemplate, canSend, canHandle };
}

function TaskInboxPage() {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const { filter: filterParam } = useSearch({ strict: false }) as { filter?: InboxFilterKey };
    const [filterIdx, setFilterIdx] = useState(() =>
        Math.max(0, INBOX_FILTER_KEYS.indexOf(filterParam ?? 'needsAction'))
    );
    const [page, setPage] = useState(0);
    const [sending, setSending] = useState<EngagementAction | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [engineFilter, setEngineFilter] = useState('all');
    const [channelFilter, setChannelFilter] = useState('all');
    const [kindFilter, setKindFilter] = useState('all');
    const [sort, setSort] = useState<SortKey>('priority');

    useEffect(() => setNavHeading(t('heading')), [setNavHeading, t]);

    // Labels come from t, so the list is built every render (not memoised).
    const FILTERS = buildFilters(t);
    const statuses = FILTERS[filterIdx]?.statuses ?? 'OPEN,ACKED';
    const { data, isLoading, isError, refetch } = useTasks(statuses, page, PAGE_SIZE);
    const { data: engines } = useEngines();
    const engineNames = useMemo(() => {
        const m: Record<string, string> = {};
        (engines ?? []).forEach((e) => (m[e.id] = e.name));
        return m;
    }, [engines]);

    // A count on each filter chip — the same task list request
    // with one row, only when switched on.
    const instituteId = getInstituteId() || '';
    const counts = useQueries({
        queries: FILTERS.map((f) => ({
            queryKey: ['engagementTasks', instituteId, f.statuses, 0, 1],
            queryFn: () => listTasks(instituteId, f.statuses, 0, 1),
            enabled: !!instituteId,
            staleTime: 60 * 1000,
        })),
    });

    const action = useTaskAction();
    const tasks = data?.content ?? [];
    const { data: people } = useTaskPeople(tasks.map((task) => task.memberId));
    const personOf = (task: EngagementAction) => people?.[task.memberId];

    // Handling the last task on a later page leaves that page empty, and with one page left the
    // pager hides, so the inbox read "Nothing here" while tasks remained on page 1.
    const totalPages = data?.totalPages ?? 0;
    useEffect(() => {
        if (page > 0 && data && page >= totalPages) setPage(Math.max(0, totalPages - 1));
    }, [data, page, totalPages]);

    // Search and filters run over the page already loaded — no extra requests.
    const q = search.trim().toLowerCase();
    const visible = tasks
        .filter(
            (task) =>
                (engineFilter === 'all' || task.engineId === engineFilter) &&
                (channelFilter === 'all' || task.channel === channelFilter) &&
                (kindFilter === 'all' || task.kind === kindFilter) &&
                (!q ||
                    [
                        task.draftBody,
                        task.sentBody,
                        task.rationale,
                        task.templateName,
                        engineNames[task.engineId],
                        personOf(task)?.name,
                        personOf(task)?.phone,
                        personOf(task)?.email,
                    ].some((v) => (v ?? '').toLowerCase().includes(q)))
        )
        .sort((a, b) =>
            sort === 'oldest'
                ? time(a.createdAt) - time(b.createdAt)
                : sort === 'newest'
                  ? time(b.createdAt) - time(a.createdAt)
                  : (b.priority ?? 0) - (a.priority ?? 0)
        );
    const current = visible.find((task) => task.id === selectedId) ?? visible[0];
    const channelMeta = buildChannelMeta(tConstants);

    const views: QuickView[] = FILTERS.map((f, i) => ({
        key: f.statuses,
        label: f.label,
        count: counts[i]?.data ? counts[i]?.data?.totalElements ?? 0 : undefined,
        tone: f.tone,
        active: i === filterIdx,
        onSelect: () => {
            setFilterIdx(i);
            setPage(0);
            setSelectedId(null);
        },
    }));

    const runAction = (
        task: EngagementAction,
        verb: 'ack' | 'done' | 'dismiss' | 'reopen' | 'restore'
    ) => action.mutate({ taskId: task.id, verb });
    const activeKey = FILTERS[filterIdx]?.key ?? 'needsAction';

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('helmetTitle')}</title>
            </Helmet>
            <div className="flex flex-col gap-5 p-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <IconTile icon={Tray} size="lg" />
                        <div>
                            <h1 className="font-semibold text-neutral-900">
                                <span className="text-h2">{t('heading')}</span>
                            </h1>
                            <p className="text-neutral-500">
                                <span className="text-body">{t('subheading')}</span>
                            </p>
                        </div>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => navigate({ to: '/engagement-engines' })}
                    >
                        <ArrowLeft className="me-1 size-4" /> {t('allEngines')}
                    </MyButton>
                </div>

                <QuickViews views={views} />

                <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-72">
                            <MagnifyingGlass
                                size={16}
                                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                            />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('toolbar.search')}
                                aria-label={t('toolbar.search')}
                                className="ps-9"
                            />
                        </div>
                        <Select value={engineFilter} onValueChange={setEngineFilter}>
                            <SelectTrigger className="w-44" aria-label={t('toolbar.allEngines')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('toolbar.allEngines')}</SelectItem>
                                {(engines ?? []).map((e) => (
                                    <SelectItem key={e.id} value={e.id}>
                                        {e.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={channelFilter} onValueChange={setChannelFilter}>
                            <SelectTrigger className="w-36" aria-label={t('toolbar.allChannels')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('toolbar.allChannels')}</SelectItem>
                                {CHANNEL_ORDER.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {channelMeta[c].label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={kindFilter} onValueChange={setKindFilter}>
                            <SelectTrigger className="w-40" aria-label={t('toolbar.allKinds')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('toolbar.allKinds')}</SelectItem>
                                <SelectItem value="TASK">{t('toolbar.kindTask')}</SelectItem>
                                <SelectItem value="REPLY">{t('toolbar.kindReply')}</SelectItem>
                                <SelectItem value="SEND">{t('toolbar.kindSend')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                            <SelectTrigger className="w-36" aria-label={t('toolbar.sortPriority')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="priority">
                                    {t('toolbar.sortPriority')}
                                </SelectItem>
                                <SelectItem value="oldest">{t('toolbar.sortOldest')}</SelectItem>
                                <SelectItem value="newest">{t('toolbar.sortNewest')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {(data?.totalPages ?? 0) > 1 && (
                        <p className="text-neutral-500">
                            <span className="text-caption">{t('toolbar.pageNote')}</span>
                        </p>
                    )}
                </div>

                {isLoading && (
                    <div className="grid gap-4 lg:grid-cols-5">
                        <Skeleton className="h-96 w-full rounded-xl lg:col-span-2" />
                        <Skeleton className="h-96 w-full rounded-xl lg:col-span-3" />
                    </div>
                )}
                {isError && (
                    <Card className="flex flex-col items-center gap-3 p-6 text-center">
                        <span className="text-body text-danger-600">{t('errors.loadFailed')}</span>
                        <MyButton buttonType="secondary" scale="small" onClick={() => refetch()}>
                            <ArrowsClockwise className="me-1 size-4" /> {t('retry')}
                        </MyButton>
                    </Card>
                )}
                {!isLoading && !isError && tasks.length === 0 && (
                    <Card className="flex flex-col items-center gap-2 p-10 text-center">
                        <Tray className="size-10 text-neutral-300" />
                        <p className="text-subtitle font-medium text-neutral-700">
                            {t(`empty.${activeKey}.title`)}
                        </p>
                        <p className="max-w-md text-body text-neutral-500">
                            {t(`empty.${activeKey}.text`)}
                        </p>
                        {activeKey === 'needsAction' && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => navigate({ to: '/engagement-engines' })}
                            >
                                {t('empty.goToEngines')}
                            </MyButton>
                        )}
                    </Card>
                )}
                {!isLoading && !isError && tasks.length > 0 && visible.length === 0 && (
                    <Card className="p-8 text-center text-body text-neutral-500">
                        {t('filteredEmpty')}
                    </Card>
                )}

                {!isLoading && !isError && visible.length > 0 && (
                    <div className="grid items-start gap-4 lg:grid-cols-5">
                        <Card className="flex flex-col overflow-hidden rounded-xl border-neutral-200 shadow-sm lg:col-span-2">
                            <div className="flex max-h-screen flex-col divide-y divide-neutral-100 overflow-y-auto">
                                {visible.map((task) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        person={personOf(task)}
                                        engineName={engineNames[task.engineId]}
                                        active={current?.id === task.id}
                                        onSelect={() => setSelectedId(task.id)}
                                    />
                                ))}
                            </div>
                        </Card>
                        {current && (
                            <TaskDetail
                                key={current.id}
                                task={current}
                                person={personOf(current)}
                                engineName={engineNames[current.engineId]}
                                busy={action.isPending}
                                onOpenEngine={() =>
                                    navigate({
                                        to: '/engagement-engines/$engineId',
                                        params: { engineId: current.engineId },
                                    })
                                }
                                onAck={() => runAction(current, 'ack')}
                                onDone={() => runAction(current, 'done')}
                                onDismiss={() => runAction(current, 'dismiss')}
                                onReopen={() => runAction(current, 'reopen')}
                                onRestore={() => runAction(current, 'restore')}
                                onSend={() => setSending(current)}
                            />
                        )}
                    </div>
                )}

                {(data?.totalPages ?? 0) > 1 && (
                    <MyPagination
                        currentPage={page}
                        totalPages={data?.totalPages ?? 1}
                        onPageChange={setPage}
                    />
                )}

                <p className="flex items-start gap-2 text-neutral-500">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{t('footnote')}</span>
                </p>
            </div>

            {sending && (
                <SendDialog
                    task={sending}
                    onClose={() => setSending(null)}
                    onConfirm={(editedBody) =>
                        action.mutate(
                            { taskId: sending.id, verb: 'send', editedBody },
                            { onSuccess: () => setSending(null) }
                        )
                    }
                    sending={action.isPending}
                />
            )}
        </LayoutContainer>
    );
}

function KindChip({ kind }: { kind: EngagementAction['kind'] }) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    if (kind === 'REPLY')
        return <Chip label={t('kind.reply')} className="bg-info-50 text-info-700" />;
    if (kind === 'SEND')
        return <Chip label={t('kind.autoSend')} className="bg-warning-50 text-warning-700" />;
    return <Chip label={t('kind.task')} />;
}

function TaskRow({
    task,
    person,
    engineName,
    active,
    onSelect,
}: {
    task: EngagementAction;
    person?: TaskPerson;
    engineName?: string;
    active: boolean;
    onSelect: () => void;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const statusMeta = buildActionStatusMeta(tConstants)[task.status] ?? {
        label: task.status,
        tone: 'neutral' as const,
    };
    const ChannelIcon = task.channel ? CHANNEL_ICON[task.channel] : Robot;
    const level = typeof task.priority === 'number' ? priorityLevel(task.priority) : null;
    const who = personTitle(person);
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={active ? 'true' : undefined}
            className={cn(
                'flex w-full items-start gap-3 border-s-2 p-3 text-left transition-colors',
                active
                    ? 'border-s-primary-500 bg-primary-50'
                    : 'border-s-transparent hover:bg-neutral-50'
            )}
        >
            <IconTile
                icon={ChannelIcon}
                size="sm"
                tint={task.channel ? CHANNEL_TINT[task.channel] : undefined}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold text-neutral-900">
                        <span className="text-body">{who ?? engineName ?? t('kind.task')}</span>
                    </span>
                    {level && level !== 'low' && (
                        <span
                            className={cn(
                                'shrink-0 rounded-full px-1.5 py-0.5 font-semibold',
                                level === 'high'
                                    ? 'bg-danger-50 text-danger-600'
                                    : 'bg-warning-50 text-warning-700'
                            )}
                        >
                            <span className="text-caption">{t(`priorityLevel.${level}`)}</span>
                        </span>
                    )}
                </span>
                {who && engineName && (
                    <span className="truncate text-neutral-500">
                        <span className="text-caption">{engineName}</span>
                    </span>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                    <KindChip kind={task.kind} />
                    <ToneBadge label={statusMeta.label} tone={statusMeta.tone} />
                    <span className="ms-auto text-neutral-400">
                        <span className="text-caption">{ageText(task.createdAt, t)}</span>
                    </span>
                </span>
                {(task.rationale || task.draftBody) && (
                    <span className="line-clamp-2 text-neutral-500">
                        <span className="text-caption">{task.rationale || task.draftBody}</span>
                    </span>
                )}
            </span>
        </button>
    );
}

function TaskDetail({
    task,
    person,
    engineName,
    busy,
    onOpenEngine,
    onAck,
    onDone,
    onDismiss,
    onReopen,
    onRestore,
    onSend,
}: {
    task: EngagementAction;
    person?: TaskPerson;
    engineName?: string;
    busy: boolean;
    onOpenEngine: () => void;
    onAck: () => void;
    onDone: () => void;
    onDismiss: () => void;
    onReopen: () => void;
    onRestore: () => void;
    onSend: () => void;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const statusMeta = buildActionStatusMeta(tConstants)[task.status] ?? {
        label: task.status,
        tone: 'neutral' as const,
    };
    const channelMeta = buildChannelMeta(tConstants);
    const { needsTemplate, canSend, canHandle } = taskRules(task);
    const vars = safeParse<Record<string, string>>(task.variablesJson, {});
    const ChannelIcon = task.channel ? CHANNEL_ICON[task.channel] : Robot;
    const priority = typeof task.priority === 'number' ? Math.round(task.priority) : null;
    const who = personTitle(person);
    const contact = [person?.phone, person?.email].filter((v) => v && v !== who).join(' · ');
    const bodyHeading =
        task.status === 'SENT'
            ? t('detail.sentMessage')
            : task.channel === 'AI_CALL'
              ? t('detail.callBrief')
              : t('detail.draft');
    const timing = [
        { k: 'created', v: task.createdAt },
        { k: 'scheduledFor', v: task.scheduledFor },
        { k: 'expiresAt', v: task.expiresAt },
        { k: 'dispatchedAt', v: task.dispatchedAt },
        { k: 'completedAt', v: task.completedAt },
    ].filter((x) => !!x.v);

    return (
        <Card className="flex flex-col gap-4 rounded-xl border-neutral-200 p-4 shadow-sm sm:p-5 lg:col-span-3">
            <div className="flex flex-wrap items-start gap-3">
                <IconTile
                    icon={ChannelIcon}
                    tint={task.channel ? CHANNEL_TINT[task.channel] : undefined}
                />
                <div className="min-w-0 flex-1">
                    {who && (
                        <p className="flex items-center gap-1.5 font-semibold text-neutral-900">
                            <User className="size-4 shrink-0 text-neutral-500" />
                            <span className="truncate text-subtitle">{who}</span>
                        </p>
                    )}
                    {contact && (
                        <p className="truncate text-neutral-600">
                            <span className="text-caption">{contact}</span>
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={onOpenEngine}
                        className={cn(
                            'truncate text-left hover:text-primary-600',
                            who ? 'text-neutral-500' : 'font-semibold text-neutral-900'
                        )}
                    >
                        <span className={who ? 'text-caption' : 'text-subtitle'}>
                            {who
                                ? t('detail.fromEngine', {
                                      engine: engineName ?? t('detail.openEngine'),
                                  })
                                : engineName ?? t('detail.openEngine')}
                        </span>
                    </button>
                    <p className="text-neutral-500">
                        <span className="text-caption">
                            {t('detail.draftedAgo', { age: ageText(task.createdAt, t) })}
                        </span>
                    </p>
                </div>
                <ToneBadge label={statusMeta.label} tone={statusMeta.tone} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <KindChip kind={task.kind} />
                {task.channel && (
                    <ChannelChip
                        channel={task.channel}
                        label={channelMeta[task.channel]?.label ?? task.channel}
                    />
                )}
                {priority !== null && (
                    <Chip
                        label={t('priorityChip', {
                            level: t(`priorityLevel.${priorityLevel(priority)}`),
                        })}
                        className={
                            priority >= 80
                                ? 'bg-danger-50 text-danger-600'
                                : priority >= 60
                                  ? 'bg-warning-50 text-warning-700'
                                  : undefined
                        }
                    />
                )}
                {task.templateName && (
                    <Chip label={t('detail.template', { name: task.templateName })} />
                )}
                {task.status === 'SIMULATED' && (
                    <Chip label={t('detail.simulated')} className="bg-info-50 text-info-700" />
                )}
            </div>

            {task.rationale && (
                <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
                    <Sparkle
                        size={18}
                        weight="duotone"
                        className="mt-0.5 shrink-0 text-primary-500"
                    />
                    <div className="min-w-0">
                        <p className="font-semibold text-neutral-800">
                            <span className="text-body">{t('detail.why')}</span>
                        </p>
                        <p className="text-neutral-600">
                            <span className="text-caption">{task.rationale}</span>
                        </p>
                    </div>
                </div>
            )}

            {task.status === 'FAILED' && task.errorMessage && (
                <p className="flex items-start gap-2 rounded-lg bg-danger-50 p-2 text-danger-600">
                    <XCircle size={16} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{task.errorMessage}</span>
                </p>
            )}
            {/* Why an open task is here or couldn't be sent (out of credits, autonomy off, no contact). */}
            {canHandle && task.errorMessage && (
                <p className="flex items-start gap-2 rounded-lg bg-warning-50 p-2 text-warning-700">
                    <Warning size={16} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{task.errorMessage}</span>
                </p>
            )}
            {canHandle && needsTemplate && (
                <p className="flex items-start gap-2 rounded-lg bg-neutral-50 p-2 text-neutral-600">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{t('needsTemplate')}</span>
                </p>
            )}

            <div>
                <SubHeading>{bodyHeading}</SubHeading>
                <p
                    className={cn(
                        'whitespace-pre-wrap rounded-lg border p-3 text-neutral-800',
                        task.channel === 'WHATSAPP'
                            ? 'border-success-100 bg-success-50'
                            : 'border-neutral-100 bg-neutral-50'
                    )}
                >
                    <span className="text-body">
                        {task.sentBody || task.draftBody || t('noDraft')}
                    </span>
                </p>
                {Object.keys(vars).length > 0 && (
                    <div className="mt-2">
                        {Object.entries(vars).map(([k, v]) => (
                            <KeyValue key={k} label={variableLabel(k, t)}>
                                {v}
                            </KeyValue>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {canSend && (
                    <MyButton buttonType="primary" scale="small" disable={busy} onClick={onSend}>
                        <PaperPlaneTilt className="me-1 size-3.5" /> {t('actions.reviewAndSend')}
                    </MyButton>
                )}
                {canHandle && task.status === 'OPEN' && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onAck}>
                        <Check className="me-1 size-3.5" /> {t('actions.acknowledge')}
                    </MyButton>
                )}
                {canHandle && (
                    <>
                        <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onDone}>
                            <CheckCircle className="me-1 size-3.5" />{' '}
                            {t('actions.handledElsewhere')}
                        </MyButton>
                        <MyButton buttonType="text" scale="small" disable={busy} onClick={onDismiss}>
                            <X className="me-1 size-3.5" /> {t('actions.dismiss')}
                        </MyButton>
                    </>
                )}
                {task.status === 'FAILED' && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onReopen}>
                        <ArrowCounterClockwise className="me-1 size-3.5" /> {t('actions.reopen')}
                    </MyButton>
                )}
                {(task.status === 'DONE' || task.status === 'DISMISSED') &&
                    task.kind !== 'SEND' && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={busy}
                            onClick={onRestore}
                        >
                            <ArrowCounterClockwise className="me-1 size-3.5" />{' '}
                            {t('actions.restore')}
                        </MyButton>
                    )}
            </div>

            {(timing.length > 0 || task.outcome) && (
                <div>
                    <SubHeading>{t('detail.timing')}</SubHeading>
                    {timing.map((x) => (
                        <KeyValue key={x.k} label={t(`detail.${x.k}`)}>
                            {formatDateTime(x.v)}
                        </KeyValue>
                    ))}
                    {task.outcome && (
                        <KeyValue label={t('detail.outcome')}>{task.outcome}</KeyValue>
                    )}
                </div>
            )}
        </Card>
    );
}

function SendDialog({
    task,
    onClose,
    onConfirm,
    sending,
}: {
    task: EngagementAction;
    onClose: () => void;
    onConfirm: (editedBody?: string) => void;
    sending: boolean;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    // A proactive WhatsApp template's text is FIXED (Meta-approved) — it can't be edited; only its
    // variables vary. A WhatsApp REPLY and email/in-app are free-form and editable.
    const isFixedTemplate = task.channel === 'WHATSAPP' && task.kind !== 'REPLY' && !!task.templateName;
    const vars = safeParse<Record<string, string>>(task.variablesJson, {});
    const [body, setBody] = useState(task.draftBody ?? '');

    return (
        <MyDialog
            heading={t('sendDialog.heading')}
            open
            onOpenChange={(o) => !o && onClose()}
            dialogWidth="max-w-lg"
        >
            <div className="flex flex-col gap-3 p-1">
                {isFixedTemplate ? (
                    <>
                        <p className="rounded bg-info-50 p-2 text-caption text-info-600">
                            {t('sendDialog.fixedTemplateNotice')}
                        </p>
                        <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-body text-neutral-700">
                            {task.draftBody}
                        </p>
                        {Object.keys(vars).length > 0 && (
                            <div className="rounded-lg border border-neutral-200 p-2">
                                <p className="mb-1 text-caption text-neutral-500">
                                    {t('sendDialog.variables')}
                                </p>
                                {Object.entries(vars).map(([k, v]) => (
                                    <div key={k} className="flex justify-between text-caption text-neutral-600">
                                        <span className="text-neutral-400">
                                            {variableLabel(k, t)}
                                        </span>
                                        <span>{v}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <p className="text-caption text-neutral-500">{t('sendDialog.editableNotice')}</p>
                        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
                    </>
                )}
                <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
                    <MyButton buttonType="secondary" scale="small" onClick={onClose}>
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={sending || (!isFixedTemplate && !body.trim())}
                        onClick={() => onConfirm(isFixedTemplate ? undefined : body)}
                    >
                        {sending ? t('sendDialog.sending') : t('sendDialog.sendNow')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}

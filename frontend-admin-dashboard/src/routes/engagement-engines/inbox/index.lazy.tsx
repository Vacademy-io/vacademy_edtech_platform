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
    Paperclip,
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
import { ActiveFilters, InboxFilterControls } from './-components/InboxFilters';
import { TaskOutcomeBadges, TaskOutcomeDetail } from './-components/TaskOutcome';
import { hasBeenDispatched } from './-utils/outcome';
import {
    hasInboxFilters,
    hasInboxPeriod,
    normalizeInboxSearch,
    type InboxSearch,
} from './-utils/search';
import { CrmActionChip } from '../-components/crm-action-ui';
import { CrmTaskSection } from '../-components/CrmTaskSection';
import { isCrmAction } from '../-types/actions';
import {
    CHANNEL_ICON,
    CHANNEL_TINT,
    ChannelChip,
    Chip,
    IconTile,
    KeyValue,
    SubHeading,
} from '../-components/engine-ui';
import { buildActionStatusMeta, buildChannelMeta, type InboxFilterKey } from '../-constants';
import { useEngines, useTaskAction, useTaskOutcomes, useTaskPeople, useTasks } from '../-hooks';
import { useAssets } from '../-hooks/assets';
import { formatDateTime, safeParse } from '../-utils';
import type { EngagementAction, TaskListFilters, TaskOutcome, TaskPerson } from '../-types';

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
        // The engine's "decided to wait" decisions: DONE rows of kind NO_OP (the kind is added
        // wherever the tab's list or count is requested).
        { key: 'waited', label: t('filters.waited'), statuses: 'DONE', tone: 'neutral' },
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
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    // The tab and every server-side filter live in the URL (see index.tsx), so a link from the
    // daily report opens exactly the items behind a number.
    const filters = useSearch({ strict: false }) as InboxSearch;
    const activeKey: InboxFilterKey = filters.filter ?? 'needsAction';
    const filtersActive = hasInboxFilters(filters);
    const updateFilters = (patch: Partial<InboxSearch>) =>
        navigate({
            to: '/engagement-engines/inbox',
            search: normalizeInboxSearch({ ...filters, ...patch }),
            replace: true,
        });
    const clearFilters = () =>
        navigate({
            to: '/engagement-engines/inbox',
            search: normalizeInboxSearch({ filter: filters.filter }),
            replace: true,
        });
    // The page number belongs to one tab + filter set: any change starts again at page 1, also
    // when it comes from the browser's back button.
    const pageKey = [
        activeKey,
        filters.engine,
        filters.channel,
        filters.kind,
        filters.date,
        filters.from,
        filters.to,
        filters.template,
        filters.outcome,
    ].join('|');
    const [pageState, setPageState] = useState({ page: 0, key: pageKey });
    const page = pageState.key === pageKey ? pageState.page : 0;
    const setPage = (next: number) => setPageState({ page: next, key: pageKey });
    const [sending, setSending] = useState<EngagementAction | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortKey | null>(null);

    useEffect(() => setNavHeading(t('heading')), [setNavHeading, t]);

    // Labels come from t, so the list is built every render (not memoised).
    const FILTERS = buildFilters(t);
    const statuses = FILTERS.find((f) => f.key === activeKey)?.statuses ?? 'OPEN,ACKED';
    // What the server is asked for. Waited is NO_OP by definition; the rest of the tabs take the
    // kind from the select.
    const serverFilters = (tab: InboxFilterKey, withOutcome: boolean): TaskListFilters => ({
        engineId: filters.engine,
        channel: filters.channel,
        kind: tab === 'waited' ? 'NO_OP' : filters.kind,
        date: filters.date,
        from: filters.from,
        to: filters.to,
        template: filters.template,
        outcome: withOutcome ? filters.outcome : undefined,
    });
    const { data, error, isLoading, isError, refetch } = useTasks(
        statuses,
        page,
        PAGE_SIZE,
        serverFilters(activeKey, true)
    );
    const { data: engines } = useEngines();
    const engineNames = useMemo(() => {
        const m: Record<string, string> = {};
        (engines ?? []).forEach((e) => (m[e.id] = e.name));
        return m;
    }, [engines]);

    // A count on each tab: the same list request with one row and the same engine / channel /
    // kind / day or period / template filters. The outcome filter is left out: it costs a delivery lookup
    // per request, so with one set only the open tab shows a count (from its own list below).
    const instituteId = getInstituteId() || '';
    const counts = useQueries({
        queries: FILTERS.map((f) => {
            const tabFilters = serverFilters(f.key, false);
            return {
                queryKey: ['engagementTasks', instituteId, f.statuses, 0, 1, tabFilters],
                queryFn: () => listTasks(instituteId, f.statuses, 0, 1, tabFilters),
                enabled: !!instituteId && !filters.outcome,
                staleTime: 60 * 1000,
            };
        }),
    });

    const action = useTaskAction();
    const tasks = data?.content ?? [];
    const { data: people } = useTaskPeople(tasks.map((task) => task.memberId));
    const personOf = (task: EngagementAction) => people?.[task.memberId];
    // What came of the messages and calls that actually went out (delivery, opens, replies, the
    // call result). Unsent tasks and waited decisions have none, so they are not asked about.
    const { data: outcomes, isLoading: outcomesLoading } = useTaskOutcomes(
        tasks.filter(hasBeenDispatched).map((task) => task.id)
    );
    const outcomeOf = (task: EngagementAction): TaskOutcome | undefined => outcomes?.[task.id];

    // Handling the last task on a later page leaves that page empty, and with one page left the
    // pager hides, so the inbox read "Nothing here" while tasks remained on page 1.
    const totalPages = data?.totalPages ?? 0;
    useEffect(() => {
        if (page > 0 && data && page >= totalPages)
            setPageState({ page: Math.max(0, totalPages - 1), key: pageKey });
    }, [data, page, pageKey, totalPages]);

    // Engine, channel, kind and day or period are asked of the server; only the search box runs
    // over the page already loaded. With a day or period the server orders by when each item went
    // out, and that order is kept; otherwise the order is the sort select (waited defaults to
    // newest first).
    const q = search.trim().toLowerCase();
    const sortKey: SortKey | null = hasInboxPeriod(filters)
        ? null
        : sort ?? (activeKey === 'waited' ? 'newest' : 'priority');
    const matching = tasks.filter(
        (task) =>
            !q ||
            [
                task.draftBody,
                task.sentBody,
                task.rationale,
                task.templateName,
                engineNames[task.engineId],
                personOf(task)?.name,
                personOf(task)?.phone,
                personOf(task)?.email,
            ].some((v) => (v ?? '').toLowerCase().includes(q))
    );
    const visible = sortKey
        ? matching.sort((a, b) =>
              sortKey === 'oldest'
                  ? time(a.createdAt) - time(b.createdAt)
                  : sortKey === 'newest'
                    ? time(b.createdAt) - time(a.createdAt)
                    : (b.priority ?? 0) - (a.priority ?? 0)
          )
        : matching;
    const current = visible.find((task) => task.id === selectedId) ?? visible[0];

    const views: QuickView[] = FILTERS.map((f, i) => ({
        key: f.key,
        label: f.label,
        // The open tab counts its own list (every filter, outcome included); the others ask.
        count: f.key === activeKey && data ? data.totalElements : counts[i]?.data?.totalElements,
        tone: f.tone,
        active: f.key === activeKey,
        onSelect: () => {
            setSelectedId(null);
            updateFilters({ filter: f.key === 'needsAction' ? undefined : f.key });
        },
    }));

    const runAction = (
        task: EngagementAction,
        verb: 'ack' | 'done' | 'dismiss' | 'reopen' | 'restore'
    ) => action.mutate({ taskId: task.id, verb });
    // A filter the server refuses (an engine that is not this institute's, a malformed or out-of-range day or period).
    const errorStatus = (error as { response?: { status?: number } } | null)?.response?.status;
    const badFilters = isError && filtersActive && (errorStatus === 400 || errorStatus === 404);

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
                        <InboxFilterControls
                            search={filters}
                            engines={engines ?? []}
                            enginesLoaded={!!engines}
                            onChange={updateFilters}
                        />
                        {sortKey && (
                            <Select value={sortKey} onValueChange={(v) => setSort(v as SortKey)}>
                                <SelectTrigger
                                    className="w-36"
                                    aria-label={t('toolbar.sortPriority')}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="priority">
                                        {t('toolbar.sortPriority')}
                                    </SelectItem>
                                    <SelectItem value="oldest">
                                        {t('toolbar.sortOldest')}
                                    </SelectItem>
                                    <SelectItem value="newest">
                                        {t('toolbar.sortNewest')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <ActiveFilters
                        search={filters}
                        onChange={updateFilters}
                        onClear={clearFilters}
                    />
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
                        <span className="text-body text-danger-600">
                            {badFilters ? t('errors.badFilters') : t('errors.loadFailed')}
                        </span>
                        {badFilters ? (
                            <MyButton buttonType="secondary" scale="small" onClick={clearFilters}>
                                {t('chips.clear')}
                            </MyButton>
                        ) : (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => refetch()}
                            >
                                <ArrowsClockwise className="me-1 size-4" /> {t('retry')}
                            </MyButton>
                        )}
                    </Card>
                )}
                {!isLoading && !isError && tasks.length === 0 && (
                    <Card className="flex flex-col items-center gap-2 p-10 text-center">
                        <Tray className="size-10 text-neutral-300" />
                        <p className="text-subtitle font-medium text-neutral-700">
                            {filtersActive
                                ? t('empty.filtered.title')
                                : t(`empty.${activeKey}.title`)}
                        </p>
                        <p className="max-w-md text-body text-neutral-500">
                            {filtersActive
                                ? t('empty.filtered.text')
                                : t(`empty.${activeKey}.text`)}
                        </p>
                        {filtersActive && (
                            <MyButton buttonType="secondary" scale="small" onClick={clearFilters}>
                                {t('chips.clear')}
                            </MyButton>
                        )}
                        {!filtersActive && activeKey === 'needsAction' && (
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
                                        outcome={outcomeOf(task)}
                                        outcomeLoading={outcomesLoading}
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
                                outcome={outcomeOf(current)}
                                outcomeLoading={outcomesLoading}
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
    if (kind === 'NO_OP') return <Chip label={t('kind.waited')} />;
    return <Chip label={t('kind.task')} />;
}

function TaskRow({
    task,
    person,
    engineName,
    outcome,
    outcomeLoading,
    active,
    onSelect,
}: {
    task: EngagementAction;
    person?: TaskPerson;
    engineName?: string;
    outcome?: TaskOutcome;
    outcomeLoading: boolean;
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
    const waited = task.kind === 'NO_OP';
    const level =
        !waited && typeof task.priority === 'number' ? priorityLevel(task.priority) : null;
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
                    {isCrmAction(task.actionType) ? (
                        <CrmActionChip type={task.actionType} />
                    ) : (
                        <KindChip kind={task.kind} />
                    )}
                    {/* A waited decision is "Done" only in the database; it is not a status to show. */}
                    {!waited && <ToneBadge label={statusMeta.label} tone={statusMeta.tone} />}
                    <span className="ms-auto text-neutral-400">
                        <span className="text-caption">{ageText(task.createdAt, t)}</span>
                    </span>
                </span>
                {waited ? (
                    // Why the engine held off is what this tab is for, so it gets the room.
                    <span className="line-clamp-4 text-neutral-800">
                        <span className="text-body">{task.rationale || t('detail.noReason')}</span>
                    </span>
                ) : (
                    (task.rationale || task.draftBody) && (
                        <span className="line-clamp-2 text-neutral-500">
                            <span className="text-caption">{task.rationale || task.draftBody}</span>
                        </span>
                    )
                )}
                {hasBeenDispatched(task) && (
                    <TaskOutcomeBadges task={task} outcome={outcome} loading={outcomeLoading} />
                )}
            </span>
        </button>
    );
}

function TaskDetail({
    task,
    person,
    engineName,
    outcome,
    outcomeLoading,
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
    outcome?: TaskOutcome;
    outcomeLoading: boolean;
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
    // The engine looked at this person and decided to wait: nothing was drafted or sent.
    const waited = task.kind === 'NO_OP';
    // B8: a CRM action (follow-up, note, status, AI call) is approved, not sent.
    const crmType = isCrmAction(task.actionType) ? task.actionType : null;
    const vars = crmType ? {} : safeParse<Record<string, string>>(task.variablesJson, {});
    const ChannelIcon = task.channel ? CHANNEL_ICON[task.channel] : Robot;
    const priority =
        !waited && typeof task.priority === 'number' ? Math.round(task.priority) : null;
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
                            {t(waited ? 'detail.decidedAgo' : 'detail.draftedAgo', {
                                age: ageText(task.createdAt, t),
                            })}
                        </span>
                    </p>
                </div>
                {!waited && <ToneBadge label={statusMeta.label} tone={statusMeta.tone} />}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {crmType ? <CrmActionChip type={crmType} /> : <KindChip kind={task.kind} />}
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

            {(task.rationale || waited) && (
                <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
                    <Sparkle
                        size={18}
                        weight="duotone"
                        className="mt-0.5 shrink-0 text-primary-500"
                    />
                    <div className="min-w-0">
                        <p className="font-semibold text-neutral-800">
                            <span className="text-body">
                                {waited ? t('detail.whyWaited') : t('detail.why')}
                            </span>
                        </p>
                        {/* The engine's own reasoning is the point of a waited decision: full size. */}
                        <p
                            className={
                                waited ? 'whitespace-pre-wrap text-neutral-800' : 'text-neutral-600'
                            }
                        >
                            <span className={waited ? 'text-body' : 'text-caption'}>
                                {task.rationale || t('detail.noReason')}
                            </span>
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

            {crmType && <CrmTaskSection task={task} disabled={busy} />}
            {!crmType && !waited && (
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
            )}

            {!waited && hasBeenDispatched(task) && (
                <TaskOutcomeDetail task={task} outcome={outcome} loading={outcomeLoading} />
            )}

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
                        {!crmType && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                disable={busy}
                                onClick={onDone}
                            >
                                <CheckCircle className="me-1 size-3.5" />{' '}
                                {t('actions.handledElsewhere')}
                            </MyButton>
                        )}
                        <MyButton
                            buttonType="text"
                            scale="small"
                            disable={busy}
                            onClick={onDismiss}
                        >
                            <X className="me-1 size-3.5" /> {t('actions.dismiss')}
                        </MyButton>
                    </>
                )}
                {task.status === 'FAILED' && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy}
                        onClick={onReopen}
                    >
                        <ArrowCounterClockwise className="me-1 size-3.5" /> {t('actions.reopen')}
                    </MyButton>
                )}
                {(task.status === 'DONE' || task.status === 'DISMISSED') &&
                    task.kind !== 'SEND' &&
                    !waited &&
                    // A done CRM action is reversed with Undo, never re-run by restoring it.
                    !(crmType && task.status === 'DONE') && (
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
                        <KeyValue
                            key={x.k}
                            label={
                                x.k === 'created' && waited
                                    ? t('detail.decided')
                                    : t(`detail.${x.k}`)
                            }
                        >
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
    const isFixedTemplate =
        task.channel === 'WHATSAPP' && task.kind !== 'REPLY' && !!task.templateName;
    const vars = safeParse<Record<string, string>>(task.variablesJson, {});
    const [body, setBody] = useState(task.draftBody ?? '');
    // Files the engine chose from its assets for this reply; they go out with the text.
    const attachmentIds = (vars._assetIds ?? '').split(',').filter(Boolean);
    const { data: engineAssets } = useAssets(attachmentIds.length ? task.engineId : undefined);
    const attachments = attachmentIds.map((id) => ({
        id,
        asset: engineAssets?.find((a) => a.id === id),
    }));

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
                                    <div
                                        key={k}
                                        className="flex justify-between text-caption text-neutral-600"
                                    >
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
                        <p className="text-caption text-neutral-500">
                            {t('sendDialog.editableNotice')}
                        </p>
                        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
                    </>
                )}
                {attachments.length > 0 && (
                    <div className="rounded-lg border border-neutral-200 p-2">
                        <p className="mb-1 text-caption text-neutral-500">
                            {t('sendDialog.attachments')}
                        </p>
                        <ul className="flex flex-col gap-1">
                            {attachments.map(({ id, asset }) => (
                                <li
                                    key={id}
                                    className="flex items-center gap-2 text-caption text-neutral-700"
                                >
                                    <Paperclip size={14} className="shrink-0 text-neutral-500" />
                                    {asset ? (
                                        <span className="truncate">{asset.title}</span>
                                    ) : engineAssets ? (
                                        <span className="text-warning-700">
                                            {t('sendDialog.attachmentRemoved')}
                                        </span>
                                    ) : (
                                        <Skeleton className="h-4 w-32" />
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
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

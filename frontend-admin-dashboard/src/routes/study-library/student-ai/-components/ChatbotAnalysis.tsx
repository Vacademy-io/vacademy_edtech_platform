import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
    ChatCircleDots,
    ChatsCircle,
    Lightning,
    Question,
    Student,
    Target,
    Users,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { StatusChip } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import { ChatTranscriptDialog } from './ChatTranscriptDialog';
import {
    CONTEXT_TYPE_LABELS,
    DAY_RANGE_OPTIONS,
    SESSION_MODE_LABELS,
    formatDateTime,
    prettifyLabel,
    useChatbotSessionsQuery,
    useChatbotSummaryQuery,
    type ChatbotSessionRow,
    type CountByValue,
    type DailyActivityRow,
} from '../-services/chatbot-analytics';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 400;

/** Maps the fixed day-window values from chatbot-analytics.ts to translation keys. */
const DAY_RANGE_KEY_BY_VALUE: Record<string, string> = {
    '7': 'dayRange.last7',
    '30': 'dayRange.last30',
    '90': 'dayRange.last90',
    '365': 'dayRange.last365',
};

/**
 * MyDropdown highlights the selected row by matching `currentValue` against the
 * list entries, so the lists are plain translated-label arrays and the label is
 * translated back to the API value here.
 */
function buildDayRangeOptions(t: TFunction) {
    return DAY_RANGE_OPTIONS.map((o) => ({
        label: t(DAY_RANGE_KEY_BY_VALUE[o.value] ?? o.label),
        value: o.value,
    }));
}

function buildStatusOptions(t: TFunction): { label: string; value: string | undefined }[] {
    return [
        { label: t('filters.status.all'), value: undefined },
        { label: t('filters.status.active'), value: 'ACTIVE' },
        { label: t('filters.status.closed'), value: 'CLOSED' },
    ];
}

function buildModeOptions(t: TFunction): { label: string; value: string | undefined }[] {
    return [
        { label: t('filters.mode.all'), value: undefined },
        { label: t('filters.mode.textChat'), value: 'text' },
        { label: t('filters.mode.mockInterview'), value: 'voice_interview' },
        { label: t('filters.mode.voiceDoubt'), value: 'voice_doubt' },
        { label: t('filters.mode.oralTest'), value: 'voice_oral_test' },
    ];
}

// ── summary pieces ─────────────────────────────────────────────────────────

function StatTile({
    icon: Icon,
    label,
    value,
    hint,
}: {
    icon: typeof ChatCircleDots;
    label: string;
    value: string | number;
    hint?: string;
}) {
    return (
        <div className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-card p-4">
            <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                <Icon className="size-4 text-primary-500" />
                {label}
            </span>
            <span className="text-h2-semibold text-neutral-700">{value}</span>
            {hint && <span className="text-caption text-neutral-400">{hint}</span>}
        </div>
    );
}

/**
 * Single-series proportion bars: one hue, share-of-total width, value read from
 * the direct label rather than the axis. No legend — the row label is the name.
 */
function ProportionBars({ rows, emptyText }: { rows: CountByValue[]; emptyText: string }) {
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    if (!rows.length || total === 0) {
        return <p className="text-caption text-neutral-400">{emptyText}</p>;
    }
    return (
        <div className="flex flex-col gap-3">
            {rows.map((row) => {
                const pct = Math.round((row.count / total) * 100);
                return (
                    <div key={row.value} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-body text-neutral-600">
                                {SESSION_MODE_LABELS[row.value] ??
                                    CONTEXT_TYPE_LABELS[row.value] ??
                                    prettifyLabel(row.value)}
                            </span>
                            <span className="shrink-0 text-caption text-neutral-500">
                                {row.count} · {pct}%
                            </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-sm bg-neutral-100">
                            <div
                                className="h-full rounded-sm bg-primary-500"
                                // Width is the datum — the only value that must be dynamic.
                                style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Compact daily bar strip: one series (student messages), hover for the day's numbers. */
function ActivityStrip({ rows, t }: { rows: DailyActivityRow[]; t: TFunction }) {
    const peak = useMemo(
        () => rows.reduce((max, r) => Math.max(max, r.studentMessages), 0),
        [rows]
    );

    if (!rows.length || peak === 0) {
        return <p className="text-caption text-neutral-400">{t('activity.empty')}</p>;
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-24 items-end gap-0.5 overflow-x-auto">
                {rows.map((row) => {
                    const heightPct = Math.round((row.studentMessages / peak) * 100);
                    return (
                        <div
                            key={row.date}
                            title={`${row.date}: ${t('activity.tooltip.studentMessages', {
                                count: row.studentMessages,
                            })}, ${t('activity.tooltip.chats', { count: row.sessions })}`}
                            className="flex h-full min-w-1 max-w-6 flex-1 items-end"
                        >
                            <div
                                className={cn(
                                    'w-full rounded-t-sm',
                                    row.studentMessages > 0 ? 'bg-primary-500' : 'bg-neutral-100'
                                )}
                                // Height is the datum.
                                style={{ height: `${Math.max(heightPct, 2)}%` }}
                            />
                        </div>
                    );
                })}
            </div>
            <div className="flex justify-between text-caption text-neutral-400">
                <span>{rows[0]?.date}</span>
                <span>{t('activity.peak', { count: peak })}</span>
                <span>{rows[rows.length - 1]?.date}</span>
            </div>
        </div>
    );
}

// ── screen ─────────────────────────────────────────────────────────────────

export const ChatbotAnalysis = () => {
    const { t } = useTranslation('studyLibraryChatbotAnalysis');

    const dayRangeOptions = useMemo(() => buildDayRangeOptions(t), [t]);
    const statusOptions = useMemo(() => buildStatusOptions(t), [t]);
    const modeOptions = useMemo(() => buildModeOptions(t), [t]);
    const dayRangeLabels = useMemo(() => dayRangeOptions.map((o) => o.label), [dayRangeOptions]);
    const daysByLabel = useMemo(
        () => new Map(dayRangeOptions.map((o) => [o.label, o.value])),
        [dayRangeOptions]
    );
    const statusLabels = useMemo(() => statusOptions.map((o) => o.label), [statusOptions]);
    const statusByLabel = useMemo(
        () => new Map(statusOptions.map((o) => [o.label, o.value])),
        [statusOptions]
    );
    const modeLabels = useMemo(() => modeOptions.map((o) => o.label), [modeOptions]);
    const modeByLabel = useMemo(
        () => new Map(modeOptions.map((o) => [o.label, o.value])),
        [modeOptions]
    );

    const [dayLabel, setDayLabel] = useState(dayRangeOptions[1]?.label ?? '');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusLabel, setStatusLabel] = useState(statusOptions[0]?.label ?? '');
    const [modeLabel, setModeLabel] = useState(modeOptions[0]?.label ?? '');
    const [page, setPage] = useState(0);
    const [openSession, setOpenSession] = useState<ChatbotSessionRow | null>(null);

    // Debounce the search so typing doesn't fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search.trim());
            setPage(0);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [search]);

    const windowDays = Number(daysByLabel.get(dayLabel) ?? '30');
    const statusFilter = statusByLabel.get(statusLabel);
    const modeFilter = modeByLabel.get(modeLabel);
    const hasFilters = !!debouncedSearch || !!statusFilter || !!modeFilter;

    const summaryQuery = useChatbotSummaryQuery(windowDays);
    const sessionsQuery = useChatbotSessionsQuery(page, PAGE_SIZE, {
        days: windowDays,
        search: debouncedSearch,
        status: statusFilter,
        sessionMode: modeFilter,
    });

    const summary = summaryQuery.data;

    const columns = useMemo<ColumnDef<ChatbotSessionRow>[]>(
        () => [
            {
                id: 'student',
                header: t('table.student'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="truncate text-body text-neutral-700">
                            {row.original.studentName}
                        </span>
                        {row.original.studentEmail && (
                            <span className="truncate text-caption text-neutral-400">
                                {row.original.studentEmail}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'chat',
                header: t('table.chatAbout'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="truncate text-body text-neutral-600">
                            {row.original.contextTitle ||
                                CONTEXT_TYPE_LABELS[row.original.contextType ?? ''] ||
                                prettifyLabel(row.original.contextType)}
                        </span>
                        <span className="line-clamp-1 text-caption text-neutral-400">
                            {row.original.lastStudentMessage || t('table.noStudentMessage')}
                        </span>
                    </div>
                ),
            },
            {
                id: 'mode',
                header: t('table.mode'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">
                        {SESSION_MODE_LABELS[row.original.sessionMode ?? 'text'] ??
                            prettifyLabel(row.original.sessionMode)}
                    </span>
                ),
            },
            {
                id: 'messages',
                header: t('table.messages'),
                cell: ({ row }) => (
                    <div className="text-right">
                        <span className="text-body text-neutral-700">
                            {row.original.messageCount}
                        </span>
                        <span className="block text-caption text-neutral-400">
                            {t('table.fromStudent', { count: row.original.studentMessageCount })}
                        </span>
                    </div>
                ),
            },
            {
                id: 'quizzes',
                header: t('table.quizzes'),
                cell: ({ row }) => (
                    <span className="block text-right text-body text-neutral-600">
                        {row.original.quizCount}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('table.status'),
                cell: ({ row }) => (
                    <StatusChip
                        text={prettifyLabel(row.original.status)}
                        textSize="text-caption"
                        status={row.original.status === 'ACTIVE' ? 'SUCCESS' : 'INFO'}
                        showIcon={false}
                    />
                ),
            },
            {
                id: 'lastActive',
                header: t('table.lastActive'),
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {formatDateTime(row.original.lastActive)}
                    </span>
                ),
            },
            {
                id: 'details',
                header: '',
                cell: ({ row }) => (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => setOpenSession(row.original)}
                    >
                        {t('table.viewChat')}
                    </MyButton>
                ),
            },
        ],
        [t]
    );

    return (
        <div className="flex flex-col gap-6">
            {/* Window selector */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-body text-neutral-500">{t('description')}</p>
                <MyDropdown
                    currentValue={dayLabel}
                    dropdownList={dayRangeLabels}
                    handleChange={(value) => {
                        setDayLabel(value);
                        setPage(0);
                    }}
                />
            </div>

            {/* Summary data points */}
            {summaryQuery.isLoading && (
                <p className="animate-pulse text-body text-neutral-400">
                    {t('summary.loading')}
                </p>
            )}
            {summaryQuery.error && (
                <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4">
                    <p className="text-body text-danger-600">{t('summary.error')}</p>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => summaryQuery.refetch()}
                    >
                        {t('summary.retry')}
                    </MyButton>
                </div>
            )}
            {summary && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatTile
                            icon={ChatsCircle}
                            label={t('summary.chats')}
                            value={summary.sessions}
                            hint={t('summary.allTime', { count: summary.sessionsAllTime })}
                        />
                        <StatTile
                            icon={Users}
                            label={t('summary.studentsReached')}
                            value={summary.uniqueStudents}
                            hint={t('summary.allTime', { count: summary.uniqueStudentsAllTime })}
                        />
                        <StatTile
                            icon={ChatCircleDots}
                            label={t('summary.studentMessages')}
                            value={summary.studentMessages}
                            hint={t('summary.messagesPerChat', {
                                count: summary.avgMessagesPerSession,
                            })}
                        />
                        <StatTile
                            icon={Question}
                            label={t('summary.doubtsAsked')}
                            value={summary.doubtsAsked}
                        />
                        <StatTile
                            icon={Target}
                            label={t('summary.practiceQuizzesTaken')}
                            value={summary.quizzesTaken}
                            hint={
                                summary.avgQuizScorePct !== null
                                    ? t('summary.averageScore', {
                                          percent: summary.avgQuizScorePct,
                                      })
                                    : t('summary.noQuizSubmittedYet')
                            }
                        />
                        <StatTile
                            icon={Lightning}
                            label={t('summary.aiReplies')}
                            value={summary.aiMessages}
                            hint={t('summary.toolLookups', { count: summary.toolCalls })}
                        />
                        <StatTile
                            icon={ChatsCircle}
                            label={t('summary.activeChats')}
                            value={summary.activeSessions}
                            hint={t('summary.notYetClosed')}
                        />
                        <StatTile
                            icon={Student}
                            label={t('summary.quizzesGenerated')}
                            value={summary.quizzesGenerated}
                            hint={t('summary.submittedCount', { count: summary.quizzesSubmitted })}
                        />
                    </div>

                    {/* General analysis */}
                    <div className="grid gap-4 lg:grid-cols-3">
                        <Card className="border-neutral-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-title">
                                    {t('summary.chatModes')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ProportionBars
                                    rows={summary.modeBreakdown}
                                    emptyText={t('summary.noChatsYet')}
                                />
                            </CardContent>
                        </Card>
                        <Card className="border-neutral-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-title">
                                    {t('summary.whereStudentsChat')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ProportionBars
                                    rows={summary.contextBreakdown}
                                    emptyText={t('summary.noChatsYet')}
                                />
                            </CardContent>
                        </Card>
                        <Card className="border-neutral-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-title">
                                    {t('summary.mostAskedTopics')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {summary.topTopics.length === 0 ? (
                                    <p className="text-caption text-neutral-400">
                                        {t('summary.noTopicsYet')}
                                    </p>
                                ) : (
                                    <ul className="flex flex-col gap-2">
                                        {summary.topTopics.slice(0, 8).map((topic) => (
                                            <li
                                                key={`${topic.topic}-${topic.eventType}`}
                                                className="flex items-baseline justify-between gap-2"
                                            >
                                                <span className="truncate text-body text-neutral-600">
                                                    {topic.topic}
                                                </span>
                                                <span className="shrink-0 text-caption text-neutral-400">
                                                    {topic.eventType === 'quiz_score'
                                                        ? t('summary.topicQuiz')
                                                        : t('summary.topicDoubt')}{' '}
                                                    · {topic.count}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-neutral-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-title">
                                {t('summary.dailyActivity')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ActivityStrip rows={summary.dailyActivity} t={t} />
                        </CardContent>
                    </Card>
                </>
            )}

            {/* Recent chats */}
            <Card className="border-neutral-200">
                <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="text-title">{t('recentChats.title')}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="w-56">
                            <MyInput
                                inputType="text"
                                input={search}
                                onChangeFunction={(e) => setSearch(e.target.value)}
                                inputPlaceholder={t('filters.searchPlaceholder')}
                                size="small"
                            />
                        </div>
                        <MyDropdown
                            currentValue={statusLabel}
                            dropdownList={statusLabels}
                            handleChange={(value) => {
                                setStatusLabel(value);
                                setPage(0);
                            }}
                        />
                        <MyDropdown
                            currentValue={modeLabel}
                            dropdownList={modeLabels}
                            handleChange={(value) => {
                                setModeLabel(value);
                                setPage(0);
                            }}
                        />
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {sessionsQuery.error ? (
                        <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4">
                            <p className="text-body text-danger-600">{t('recentChats.error')}</p>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => sessionsQuery.refetch()}
                            >
                                {t('recentChats.retry')}
                            </MyButton>
                        </div>
                    ) : sessionsQuery.data && sessionsQuery.data.content.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-10 text-center">
                            <ChatsCircle className="size-8 text-neutral-300" />
                            <p className="text-body text-neutral-500">
                                {t('recentChats.emptyTitle')}
                            </p>
                            <p className="text-caption text-neutral-400">
                                {hasFilters
                                    ? t('recentChats.emptyFiltered')
                                    : t('recentChats.emptyUnfiltered')}
                            </p>
                        </div>
                    ) : (
                        <>
                            <MyTable<ChatbotSessionRow>
                                data={sessionsQuery.data}
                                columns={columns}
                                isLoading={sessionsQuery.isLoading}
                                error={sessionsQuery.error}
                                currentPage={page}
                                onCellClick={(row) => setOpenSession(row)}
                                enableColumnPinning={false}
                                scrollable
                            />
                            {(sessionsQuery.data?.total_pages ?? 0) > 1 && (
                                <MyPagination
                                    currentPage={page}
                                    totalPages={sessionsQuery.data?.total_pages ?? 1}
                                    onPageChange={setPage}
                                />
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <ChatTranscriptDialog session={openSession} onClose={() => setOpenSession(null)} />
        </div>
    );
};

export default ChatbotAnalysis;
